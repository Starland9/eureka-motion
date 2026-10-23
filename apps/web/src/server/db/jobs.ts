import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "./client";
import { jobs } from "./schema";
import type { Clock } from "./store";

export type Job = typeof jobs.$inferSelect;
export type JobType = Job["type"];
export type JobStatus = Job["status"];

// Mirrors the jobs_attempts_limit check of the schema.
export const MAX_ATTEMPTS: Readonly<Record<JobType, number>> = { export: 2, deep: 3 };
export const STALE_AFTER_MS = 10 * 60 * 1000;

const EXHAUSTED: Readonly<Record<JobType, JobStatus>> = { export: "failed", deep: "abandoned" };
const ACTIVE: readonly JobStatus[] = ["queued", "running"];
const ENQUEUE_ATTEMPTS = 3;

export function exportResultUrl(explanationId: string): string {
  return `/media/${explanationId}/export.mp4`;
}

export interface Jobs {
  enqueue(explanationId: string, type: JobType): Promise<Job>;
  findActive(explanationId: string, type: JobType): Promise<Job | null>;
  latest(explanationId: string, type: JobType): Promise<Job | null>;
  ensureSucceeded(explanationId: string, type: JobType, resultUrl: string): Promise<Job>;
  get(id: string): Promise<Job | null>;
  reserve(type: JobType): Promise<Job | null>;
  setProgress(id: string, percent: number): Promise<void>;
  succeed(id: string, resultUrl: string): Promise<Job | null>;
  fail(id: string, error: string): Promise<Job | null>;
  abandon(id: string, error: string): Promise<Job | null>;
  requeueStale(olderThanMs?: number): Promise<Job[]>;
}

function afterFailure(job: Job, error: string, at: Date): Partial<typeof jobs.$inferInsert> {
  if (job.attempts < MAX_ATTEMPTS[job.type]) {
    return { status: "queued", locked_at: null, progress: 0, error };
  }
  return { status: EXHAUSTED[job.type], error, finished_at: at };
}

export function createJobs(db: Database, clock: Clock = {}): Jobs {
  const now = clock.now ?? (() => new Date());

  const findActive: Jobs["findActive"] = async (explanationId, type) => {
    const [job] = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.explanation_id, explanationId),
          eq(jobs.type, type),
          inArray(jobs.status, [...ACTIVE]),
        ),
      )
      .limit(1);
    return job ?? null;
  };

  return {
    findActive,

    async latest(explanationId, type) {
      const [job] = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.explanation_id, explanationId), eq(jobs.type, type)))
        .orderBy(desc(jobs.created_at), desc(jobs.id))
        .limit(1);
      return job ?? null;
    },

    async enqueue(explanationId, type) {
      for (let attempt = 0; attempt < ENQUEUE_ATTEMPTS; attempt += 1) {
        // The partial unique index decides the race: the loser inserts nothing and reads the winner.
        const [created] = await db
          .insert(jobs)
          .values({ explanation_id: explanationId, type, created_at: now() })
          .onConflictDoNothing()
          .returning();
        if (created) return created;
        const active = await findActive(explanationId, type);
        if (active) return active;
      }
      throw new Error(`No active ${type} job could be created for ${explanationId}`);
    },

    async ensureSucceeded(explanationId, type, resultUrl) {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${type}:${explanationId}`}, 0))`,
        );
        const [existing] = await tx
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.explanation_id, explanationId),
              eq(jobs.type, type),
              eq(jobs.status, "succeeded"),
              eq(jobs.result_url, resultUrl),
            ),
          )
          .orderBy(desc(jobs.finished_at))
          .limit(1);
        if (existing) return existing;

        const at = now();
        const [created] = await tx
          .insert(jobs)
          .values({
            explanation_id: explanationId,
            type,
            status: "succeeded",
            progress: 100,
            result_url: resultUrl,
            created_at: at,
            finished_at: at,
          })
          .returning();
        return created!;
      });
    },

    async get(id) {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      return job ?? null;
    },

    async reserve(type) {
      return db.transaction(async (tx) => {
        const [next] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.type, type), eq(jobs.status, "queued")))
          .orderBy(asc(jobs.created_at), asc(jobs.id))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!next) return null;

        const [job] = await tx
          .update(jobs)
          .set({
            status: "running",
            locked_at: now(),
            progress: 0,
            attempts: sql`${jobs.attempts} + 1`,
          })
          .where(eq(jobs.id, next.id))
          .returning();
        return job ?? null;
      });
    },

    async setProgress(id, percent) {
      if (!Number.isFinite(percent)) return;
      const bounded = Math.min(100, Math.max(0, Math.round(percent)));
      await db
        .update(jobs)
        .set({ progress: sql`greatest(${jobs.progress}, ${bounded}::int)` })
        .where(and(eq(jobs.id, id), eq(jobs.status, "running")));
    },

    async succeed(id, resultUrl) {
      const [job] = await db
        .update(jobs)
        .set({
          status: "succeeded",
          progress: 100,
          result_url: resultUrl,
          error: null,
          finished_at: now(),
        })
        .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
        .returning();
      return job ?? null;
    },

    async fail(id, error) {
      return db.transaction(async (tx) => {
        const [running] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
          .for("update");
        if (!running) return null;
        const [job] = await tx
          .update(jobs)
          .set(afterFailure(running, error, now()))
          .where(eq(jobs.id, id))
          .returning();
        return job ?? null;
      });
    },

    // Gives up on a deep version at once, whatever attempts remain.
    async abandon(id, error) {
      const [job] = await db
        .update(jobs)
        .set({ status: "abandoned", error, finished_at: now() })
        .where(and(eq(jobs.id, id), eq(jobs.type, "deep"), eq(jobs.status, "running")))
        .returning();
      return job ?? null;
    },

    async requeueStale(olderThanMs = STALE_AFTER_MS) {
      const at = now();
      const cutoff = new Date(at.getTime() - olderThanMs);
      return db.transaction(async (tx) => {
        const stale = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.status, "running"), lt(jobs.locked_at, cutoff)))
          .orderBy(asc(jobs.created_at), asc(jobs.id))
          .for("update", { skipLocked: true });

        const settled: Job[] = [];
        for (const job of stale) {
          const [updated] = await tx
            .update(jobs)
            .set(afterFailure(job, "The worker stopped answering while it held the job.", at))
            .where(eq(jobs.id, job.id))
            .returning();
          if (updated) settled.push(updated);
        }
        return settled;
      });
    },
  };
}
