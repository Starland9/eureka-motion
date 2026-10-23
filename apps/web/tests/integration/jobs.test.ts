import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postExport } from "@/app/api/explanations/[id]/export/route";
import { GET as getJob } from "@/app/api/jobs/[id]/route";
import { setContainerForTests, setJobsForTests, type Container } from "@/server/container";
import type { Database } from "@/server/db/client";
import {
  createJobs,
  exportResultUrl,
  MAX_ATTEMPTS,
  STALE_AFTER_MS,
  type Job,
  type Jobs,
} from "@/server/db/jobs";
import { createRateLimiter, type RateLimiter } from "@/server/db/rate-limit";
import { explanations, jobs, rateLimits } from "@/server/db/schema";
import { createExplanationStore } from "@/server/db/store";
import { errorMessage } from "@/server/http/errors";
import type { ExplanationRecord, ExplanationStore } from "@/server/pipeline/ports";
import { loadReferenceRecord, referenceId } from "@/server/reference";
import { describeTarget, openTestDatabase, testDatabaseUrl } from "../helpers/db";

const DATABASE = "eureka_jobs_test";
const database = await openTestDatabase(DATABASE);
const target = describeTarget(testDatabaseUrl(DATABASE));
if (!database) console.warn(`PostgreSQL is unreachable at ${target}: integration tests skipped`);

const ORIGIN = "http://localhost:3000";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = new Date("2026-03-04T10:00:00.000Z");
const SECRET = "connection refused to postgres://admin:hunter2@10.0.0.5:5432/eureka";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";

const REFERENCE_ID = referenceId("physics/universal-gravitation", "fr");
const loaded = await loadReferenceRecord(REFERENCE_ID);
if (!loaded) throw new Error("The gravitation reference is missing from the repository");
const reference: ExplanationRecord = loaded;

const LETTERS = "abcdefghjkmnpqrstuvwxyz";
let counter = 0;

function nextId(): string {
  counter += 1;
  return (
    "k".repeat(10) +
    LETTERS[Math.floor(counter / LETTERS.length)]! +
    LETTERS[counter % LETTERS.length]!
  );
}

function delay(ms: number): Promise<"waited"> {
  return new Promise((resolve) => setTimeout(() => resolve("waited"), ms));
}

function pgCode(error: unknown): string | undefined {
  for (let cause: unknown = error; cause; cause = (cause as Error).cause) {
    if (typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
      return cause.code;
    }
  }
  return undefined;
}

function unwrap<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected a value");
  return value;
}

describe.skipIf(!database)(
  database ? `jobs on ${target}` : `jobs (skipped: PostgreSQL unreachable at ${target})`,
  () => {
    let db: Database;
    let store: ExplanationStore;
    let mediaDir: string;
    let time = T0.getTime();
    let queue: Jobs;

    const now = () => new Date(time);
    const advance = (ms: number) => {
      time += ms;
    };

    async function explanation(overrides: Partial<ExplanationRecord> = {}) {
      const id = overrides.id ?? nextId();
      const record: ExplanationRecord = {
        ...reference,
        id,
        kind: "initial",
        root_id: id,
        status: "ready",
        created_at: T0,
        completed_at: T0,
        expires_at: new Date(Date.now() + 90 * DAY),
        ...overrides,
      };
      await store.create(record);
      return record;
    }

    async function seed(explanationId: string, overrides: Partial<typeof jobs.$inferInsert> = {}) {
      const [row] = await db
        .insert(jobs)
        .values({ type: "export", explanation_id: explanationId, created_at: now(), ...overrides })
        .returning();
      return unwrap(row);
    }

    async function reload(job: Job): Promise<Job> {
      return unwrap(await queue.get(job.id));
    }

    async function jobRows(): Promise<Job[]> {
      return db.select().from(jobs);
    }

    async function hits(): Promise<number> {
      const [row] = await db
        .select({ total: sql<string>`coalesce(sum(${rateLimits.count}), 0)` })
        .from(rateLimits);
      return Number(row?.total);
    }

    beforeAll(async () => {
      if (!database) return;
      db = database.db;
      store = createExplanationStore(db);
      mediaDir = await mkdtemp(path.join(tmpdir(), "eureka-jobs-"));
      vi.stubEnv("MEDIA_DIR", mediaDir);
    });

    beforeEach(async () => {
      time = T0.getTime();
      queue = createJobs(db, { now });
      await database?.reset();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      setContainerForTests(undefined);
      setJobsForTests(undefined);
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await rm(mediaDir, { recursive: true, force: true });
      await database?.close();
    });

    describe("enqueue", () => {
      it("creates a queued job that nobody has touched yet", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        expect(job).toMatchObject({
          type: "export",
          explanation_id: id,
          status: "queued",
          progress: 0,
          attempts: 0,
          result_url: null,
          error: null,
          locked_at: null,
          finished_at: null,
          created_at: T0,
        });
        expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
      });

      it("returns the job that is already queued instead of creating a second one", async () => {
        const { id } = await explanation();
        const first = await queue.enqueue(id, "export");
        advance(MINUTE);
        expect((await queue.enqueue(id, "export")).id).toBe(first.id);
        expect(await jobRows()).toHaveLength(1);
      });

      it("returns the job that is already running", async () => {
        const { id } = await explanation();
        const first = await queue.enqueue(id, "export");
        await queue.reserve("export");
        const again = await queue.enqueue(id, "export");
        expect(again).toMatchObject({ id: first.id, status: "running" });
      });

      it("creates a single job when ten requests arrive at once", async () => {
        const { id } = await explanation();
        const answers = await Promise.all(
          Array.from({ length: 10 }, () => queue.enqueue(id, "export")),
        );
        expect(new Set(answers.map((job) => job.id)).size).toBe(1);
        expect(await jobRows()).toHaveLength(1);
      });

      it("creates a single job when requests race against a reservation", async () => {
        const { id } = await explanation();
        await queue.enqueue(id, "export");
        const answers = await Promise.all([
          queue.reserve("export"),
          ...Array.from({ length: 6 }, () => queue.enqueue(id, "export")),
        ]);
        expect(await jobRows()).toHaveLength(1);
        expect(new Set(answers.filter(Boolean).map((job) => job?.id)).size).toBe(1);
      });

      it("keeps one active job per type and per explanation", async () => {
        const one = await explanation();
        const two = await explanation();
        const ids = new Set([
          (await queue.enqueue(one.id, "export")).id,
          (await queue.enqueue(one.id, "deep")).id,
          (await queue.enqueue(two.id, "export")).id,
        ]);
        expect(ids.size).toBe(3);
      });

      it.each(["succeeded", "failed", "abandoned"] as const)(
        "creates a new job once the previous one is %s",
        async (status) => {
          const { id } = await explanation();
          const old = await seed(id, { status, finished_at: T0 });
          const fresh = await queue.enqueue(id, "export");
          expect(fresh.id).not.toBe(old.id);
          expect(fresh.status).toBe("queued");
          expect(await jobRows()).toHaveLength(2);
        },
      );

      it("refuses an explanation that has no row", async () => {
        const error = await queue.enqueue("missing00000", "export").catch((cause) => cause);
        expect(pgCode(error)).toBe(FOREIGN_KEY);
      });

      it("finds the active job without creating one", async () => {
        const { id } = await explanation();
        expect(await queue.findActive(id, "export")).toBeNull();
        const job = await queue.enqueue(id, "export");
        expect(await queue.findActive(id, "export")).toMatchObject({ id: job.id });
        expect(await queue.findActive(id, "deep")).toBeNull();
        await queue.reserve("export");
        await queue.succeed(job.id, exportResultUrl(id));
        expect(await queue.findActive(id, "export")).toBeNull();
        expect(await jobRows()).toHaveLength(1);
      });
    });

    describe("get", () => {
      it("returns a job by id and null for an unknown one", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        expect(await queue.get(job.id)).toEqual(job);
        expect(await queue.get("00000000-0000-4000-8000-000000000000")).toBeNull();
      });
    });

    describe("reserve", () => {
      it("takes the oldest queued job of the type and locks it", async () => {
        const first = await explanation();
        const second = await explanation();
        await queue.enqueue(first.id, "export");
        advance(MINUTE);
        await queue.enqueue(second.id, "export");

        advance(MINUTE);
        const job = unwrap(await queue.reserve("export"));
        expect(job).toMatchObject({
          explanation_id: first.id,
          status: "running",
          attempts: 1,
          progress: 0,
          locked_at: new Date(time),
        });
        expect(unwrap(await queue.reserve("export")).explanation_id).toBe(second.id);
        expect(await queue.reserve("export")).toBeNull();
      });

      it("serves each type from its own queue", async () => {
        const { id } = await explanation();
        const deep = await queue.enqueue(id, "deep");
        expect(await queue.reserve("export")).toBeNull();
        expect(unwrap(await queue.reserve("deep")).id).toBe(deep.id);
      });

      it("returns null when nothing is queued", async () => {
        expect(await queue.reserve("export")).toBeNull();
        const { id } = await explanation();
        await seed(id, { status: "running", locked_at: T0, attempts: 1 });
        expect(await queue.reserve("export")).toBeNull();
      });

      it("never hands the same job to concurrent workers", async () => {
        const queued: string[] = [];
        for (let index = 0; index < 5; index += 1) {
          const { id } = await explanation();
          queued.push((await queue.enqueue(id, "export")).id);
          advance(1000);
        }

        const taken = await Promise.all(Array.from({ length: 9 }, () => queue.reserve("export")));
        const reserved = taken.filter((job): job is Job => job !== null);
        expect(reserved).toHaveLength(5);
        expect(new Set(reserved.map((job) => job.id)).size).toBe(5);
        expect(reserved.map((job) => job.id).sort()).toEqual([...queued].sort());
        expect(reserved.every((job) => job.attempts === 1 && job.status === "running")).toBe(true);
      });

      it("skips a job another transaction holds instead of waiting for it", async () => {
        const first = await explanation();
        const second = await explanation();
        const held = await queue.enqueue(first.id, "export");
        advance(MINUTE);
        const free = await queue.enqueue(second.id, "export");

        let outcome: Job | null | "waited" = null;
        await db.transaction(async (tx) => {
          await tx.select().from(jobs).where(eq(jobs.id, held.id)).for("update");
          outcome = await Promise.race([queue.reserve("export"), delay(3000)]);
        });

        expect(outcome).toMatchObject({ id: free.id, status: "running" });
        expect(await reload(held)).toMatchObject({ status: "queued", attempts: 0 });
      });

      it("answers null at once when the only queued job is locked", async () => {
        const { id } = await explanation();
        const held = await queue.enqueue(id, "export");

        let outcome: Job | null | "waited" = null;
        await db.transaction(async (tx) => {
          await tx.select().from(jobs).where(eq(jobs.id, held.id)).for("update");
          outcome = await Promise.race([queue.reserve("export"), delay(3000)]);
        });

        expect(outcome).toBeNull();
        expect(await reload(held)).toMatchObject({ status: "queued" });
      });

      it("hands a retried job out again with one more attempt", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.setProgress(job.id, 60);
        await queue.fail(job.id, "first failure");

        advance(MINUTE);
        expect(unwrap(await queue.reserve("export"))).toMatchObject({
          id: job.id,
          attempts: 2,
          progress: 0,
          locked_at: new Date(time),
        });
      });
    });

    describe("progress", () => {
      async function running() {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        return job;
      }

      it("only goes up", async () => {
        const job = await running();
        const seen: number[] = [];
        for (const percent of [10, 40, 25, 40, 90, 3]) {
          await queue.setProgress(job.id, percent);
          seen.push((await reload(job)).progress);
        }
        expect(seen).toEqual([10, 40, 40, 40, 90, 90]);
      });

      it("stays within 0 and 100", async () => {
        const job = await running();
        await queue.setProgress(job.id, -20);
        expect((await reload(job)).progress).toBe(0);
        await queue.setProgress(job.id, 250);
        expect((await reload(job)).progress).toBe(100);
      });

      it("rounds to a whole percent and ignores a value that is not a number", async () => {
        const job = await running();
        await queue.setProgress(job.id, 41.6);
        expect((await reload(job)).progress).toBe(42);
        await queue.setProgress(job.id, Number.NaN);
        await queue.setProgress(job.id, Number.POSITIVE_INFINITY);
        expect((await reload(job)).progress).toBe(42);
      });

      it("ignores a job that is not running", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.setProgress(job.id, 50);
        expect((await reload(job)).progress).toBe(0);
        await queue.setProgress("00000000-0000-4000-8000-000000000000", 50);
      });
    });

    describe("succeed", () => {
      it("finishes a running job with its file and a full progress", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.setProgress(job.id, 70);
        advance(2 * MINUTE);

        const done = unwrap(await queue.succeed(job.id, exportResultUrl(id)));
        expect(done).toMatchObject({
          id: job.id,
          status: "succeeded",
          progress: 100,
          result_url: `/media/${id}/export.mp4`,
          error: null,
          finished_at: new Date(time),
        });
        expect(await queue.reserve("export")).toBeNull();
      });

      it("clears the error of an earlier attempt", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.fail(job.id, "boom");
        await queue.reserve("export");
        expect(unwrap(await queue.succeed(job.id, exportResultUrl(id))).error).toBeNull();
      });

      it("leaves a job that is not running alone", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        expect(await queue.succeed(job.id, exportResultUrl(id))).toBeNull();
        expect(await reload(job)).toMatchObject({ status: "queued", result_url: null });
      });

      it("lets a new export be requested afterwards", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.succeed(job.id, exportResultUrl(id));
        expect((await queue.enqueue(id, "export")).id).not.toBe(job.id);
      });
    });

    describe("fail", () => {
      async function takeAndFail(id: string, type: "export" | "deep", message: string) {
        await queue.reserve(type);
        return unwrap(await queue.fail(id, message));
      }

      it("sends an export back to the queue after its first failure", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.setProgress(job.id, 80);

        const retried = unwrap(await queue.fail(job.id, "ffmpeg exited with 1"));
        expect(retried).toMatchObject({
          status: "queued",
          attempts: 1,
          progress: 0,
          locked_at: null,
          finished_at: null,
          error: "ffmpeg exited with 1",
        });
        expect((await queue.enqueue(id, "export")).id).toBe(job.id);
      });

      it("fails an export for good after its second attempt", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await takeAndFail(job.id, "export", "first");
        advance(MINUTE);
        const last = await takeAndFail(job.id, "export", "second");
        expect(last).toMatchObject({
          status: "failed",
          attempts: MAX_ATTEMPTS.export,
          error: "second",
          finished_at: new Date(time),
        });
        expect(await queue.reserve("export")).toBeNull();
      });

      it("abandons a deep version only after its third attempt", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "deep");
        expect((await takeAndFail(job.id, "deep", "one")).status).toBe("queued");
        expect((await takeAndFail(job.id, "deep", "two")).status).toBe("queued");
        const last = await takeAndFail(job.id, "deep", "three");
        expect(last).toMatchObject({
          status: "abandoned",
          attempts: MAX_ATTEMPTS.deep,
          error: "three",
        });
        expect(last.finished_at).not.toBeNull();
      });

      it("allows a fresh export after one has failed for good", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await takeAndFail(job.id, "export", "first");
        await takeAndFail(job.id, "export", "second");
        const fresh = await queue.enqueue(id, "export");
        expect(fresh).toMatchObject({ status: "queued", attempts: 0 });
        expect(fresh.id).not.toBe(job.id);
      });

      it("leaves a job that is not running alone", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        expect(await queue.fail(job.id, "late")).toBeNull();
        expect(await queue.fail("00000000-0000-4000-8000-000000000000", "late")).toBeNull();
        expect(await reload(job)).toMatchObject({ status: "queued", error: null });
      });
    });

    describe("abandon", () => {
      it("gives up on a running deep version at once, whatever attempts remain", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "deep");
        await queue.reserve("deep");
        await queue.setProgress(job.id, 40);
        advance(MINUTE);

        const given = unwrap(await queue.abandon(job.id, "attempts_exhausted (render)"));
        expect(given).toMatchObject({
          status: "abandoned",
          attempts: 1,
          error: "attempts_exhausted (render)",
          result_url: null,
          finished_at: new Date(time),
        });
        expect(await queue.reserve("deep")).toBeNull();
        expect(await queue.findActive(id, "deep")).toBeNull();
        expect((await queue.latest(id, "deep"))?.id).toBe(job.id);
      });

      it("leaves a deep version that is not running alone", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "deep");
        expect(await queue.abandon(job.id, "late")).toBeNull();
        expect(await queue.abandon("00000000-0000-4000-8000-000000000000", "late")).toBeNull();
        expect(await reload(job)).toMatchObject({ status: "queued", error: null });

        await queue.reserve("deep");
        await queue.succeed(job.id, `/media/${id}/deep.mp4`);
        expect(await queue.abandon(job.id, "late")).toBeNull();
        expect(await reload(job)).toMatchObject({ status: "succeeded", error: null });
      });

      it("never abandons an export", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        expect(await queue.abandon(job.id, "not for exports")).toBeNull();
        expect(await reload(job)).toMatchObject({ status: "running", error: null });
      });
    });

    describe("requeueStale", () => {
      it("sends back a job that has been running for more than ten minutes", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.setProgress(job.id, 30);

        advance(STALE_AFTER_MS - 1);
        expect(await queue.requeueStale()).toEqual([]);
        expect(await reload(job)).toMatchObject({ status: "running" });

        advance(2);
        const [back] = await queue.requeueStale();
        expect(back).toMatchObject({ id: job.id, status: "queued", locked_at: null, progress: 0 });
        expect(back?.error).toEqual(expect.any(String));
        expect(unwrap(await queue.reserve("export"))).toMatchObject({ id: job.id, attempts: 2 });
      });

      it("fails an export that has no attempt left", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.fail(job.id, "first");
        await queue.reserve("export");

        advance(11 * MINUTE);
        const [stopped] = await queue.requeueStale();
        expect(stopped).toMatchObject({
          id: job.id,
          status: "failed",
          attempts: 2,
          finished_at: new Date(time),
        });
        expect(await queue.reserve("export")).toBeNull();
      });

      it("abandons a deep version that has no attempt left", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "deep");
        for (let attempt = 1; attempt < MAX_ATTEMPTS.deep; attempt += 1) {
          await queue.reserve("deep");
          await queue.fail(job.id, "retry");
        }
        await queue.reserve("deep");

        advance(11 * MINUTE);
        const [stopped] = await queue.requeueStale();
        expect(stopped).toMatchObject({ id: job.id, status: "abandoned", attempts: 3 });
      });

      it("touches neither queued, finished nor recently locked jobs", async () => {
        const [one, two, three, four, five] = [
          await explanation(),
          await explanation(),
          await explanation(),
          await explanation(),
          await explanation(),
        ];
        const queued = await seed(one.id, { status: "queued" });
        const succeeded = await seed(two.id, {
          status: "succeeded",
          progress: 100,
          locked_at: T0,
          finished_at: T0,
        });
        const failed = await seed(three.id, {
          status: "failed",
          attempts: 2,
          locked_at: T0,
          finished_at: T0,
        });
        const recent = await seed(four.id, {
          status: "running",
          attempts: 1,
          locked_at: new Date(T0.getTime() + 25 * MINUTE),
        });
        const stale = await seed(five.id, { status: "running", attempts: 1, locked_at: T0 });

        advance(30 * MINUTE);
        const settled = await queue.requeueStale();

        expect(settled.map((job) => job.id)).toEqual([stale.id]);
        expect(await reload(queued)).toEqual(queued);
        expect(await reload(succeeded)).toEqual(succeeded);
        expect(await reload(failed)).toEqual(failed);
        expect(await reload(recent)).toEqual(recent);
        expect((await reload(stale)).status).toBe("queued");
      });

      it("settles several jobs at once and honours another threshold", async () => {
        const settled: string[] = [];
        for (let index = 0; index < 3; index += 1) {
          const { id } = await explanation();
          settled.push((await queue.enqueue(id, "export")).id);
          await queue.reserve("export");
          advance(MINUTE);
        }

        const back = await queue.requeueStale(90 * 1000);
        expect(back.map((job) => job.id).sort()).toEqual(settled.slice(0, 2).sort());
        expect(back.every((job) => job.status === "queued")).toBe(true);
      });

      it("keeps the unique active job when it requeues", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        advance(11 * MINUTE);
        await queue.requeueStale();
        expect((await queue.enqueue(id, "export")).id).toBe(job.id);
        expect(await jobRows()).toHaveLength(1);
      });

      it("skips a stale job that another transaction holds", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        advance(11 * MINUTE);

        let outcome: Job[] | "waited" = [];
        await db.transaction(async (tx) => {
          await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
          outcome = await Promise.race([queue.requeueStale(), delay(3000)]);
        });
        expect(outcome).toEqual([]);
        expect((await reload(job)).status).toBe("running");
      });
    });

    describe("ensureSucceeded", () => {
      it("records a finished export that has no job yet", async () => {
        const { id } = await explanation();
        const job = await queue.ensureSucceeded(id, "export", exportResultUrl(id));
        expect(job).toMatchObject({
          explanation_id: id,
          type: "export",
          status: "succeeded",
          progress: 100,
          result_url: `/media/${id}/export.mp4`,
          attempts: 0,
          finished_at: T0,
        });
      });

      it("returns the same job on every later call, even simultaneous ones", async () => {
        const { id } = await explanation();
        const answers = await Promise.all(
          Array.from({ length: 6 }, () => queue.ensureSucceeded(id, "export", exportResultUrl(id))),
        );
        expect(new Set(answers.map((job) => job.id)).size).toBe(1);
        expect(await jobRows()).toHaveLength(1);
      });

      it("returns the job a worker has finished", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.succeed(job.id, exportResultUrl(id));
        expect((await queue.ensureSucceeded(id, "export", exportResultUrl(id))).id).toBe(job.id);
        expect(await jobRows()).toHaveLength(1);
      });

      it("does not stand in the way of a new export", async () => {
        const { id } = await explanation();
        const done = await queue.ensureSucceeded(id, "export", exportResultUrl(id));
        const fresh = await queue.enqueue(id, "export");
        expect(fresh.id).not.toBe(done.id);
      });
    });

    describe("export route", () => {
      let limiter: RateLimiter;

      function useRoutes(env: Record<string, string> = {}): void {
        limiter = createRateLimiter(db, { now, env });
        setContainerForTests({ store, limiter } as unknown as Container);
        setJobsForTests(queue);
      }

      function requestExport(id: string, headers: Record<string, string> = {}) {
        return postExport(
          new Request(`${ORIGIN}/api/explanations/${id}/export`, { method: "POST", headers }),
          { params: Promise.resolve({ id }) },
        );
      }

      function visitor(address: string, language = "fr") {
        return { "x-forwarded-for": address, "accept-language": language };
      }

      async function writeExport(id: string) {
        await mkdir(path.join(mediaDir, id), { recursive: true });
        await writeFile(path.join(mediaDir, id, "export.mp4"), "video");
      }

      beforeEach(() => {
        useRoutes();
      });

      it("creates a queued job for a ready explanation", async () => {
        const { id } = await explanation();
        const response = await requestExport(id);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const body = await response.json();
        expect(body).toEqual({ job_id: expect.any(String), status: "queued" });
        expect(await queue.get(body.job_id)).toMatchObject({
          explanation_id: id,
          type: "export",
          status: "queued",
        });
      });

      it("accepts a partial explanation", async () => {
        const { id } = await explanation({ status: "partial" });
        const response = await requestExport(id);
        expect(response.status).toBe(200);
        expect((await response.json()).status).toBe("queued");
      });

      it("returns the job that exists instead of creating one, running or not", async () => {
        const { id } = await explanation();
        const first = await (await requestExport(id)).json();
        expect(await (await requestExport(id)).json()).toEqual(first);

        await queue.reserve("export");
        await queue.setProgress(first.job_id, 40);
        expect(await (await requestExport(id)).json()).toEqual({
          job_id: first.job_id,
          status: "running",
        });
        expect(await jobRows()).toHaveLength(1);
      });

      it("creates a single job for simultaneous requests", async () => {
        useRoutes({ RATE_LIMIT_EXPORT_PER_HOUR: "50" });
        const { id } = await explanation();
        const responses = await Promise.all(
          Array.from({ length: 6 }, () => requestExport(id, visitor("203.0.113.5"))),
        );
        expect(responses.map((response) => response.status)).toEqual(Array(6).fill(200));
        const bodies = await Promise.all(responses.map((response) => response.json()));
        expect(new Set(bodies.map((body) => body.job_id)).size).toBe(1);
        expect(await jobRows()).toHaveLength(1);
      });

      it("answers a finished export with a succeeded job and does not count it", async () => {
        useRoutes({ RATE_LIMIT_EXPORT_PER_HOUR: "1" });
        const { id } = await explanation();
        await writeExport(id);

        const answers = [];
        for (let call = 0; call < 3; call += 1) {
          const response = await requestExport(id, visitor("203.0.113.5"));
          expect(response.status).toBe(200);
          answers.push(await response.json());
        }
        expect(answers.map((answer) => answer.status)).toEqual([
          "succeeded",
          "succeeded",
          "succeeded",
        ]);
        expect(new Set(answers.map((answer) => answer.job_id)).size).toBe(1);
        expect(await queue.get(answers[0].job_id)).toMatchObject({
          status: "succeeded",
          result_url: `/media/${id}/export.mp4`,
        });
        expect(await hits()).toBe(0);

        const other = await explanation();
        expect((await requestExport(other.id, visitor("203.0.113.5"))).status).toBe(200);
      });

      it("returns the job a worker finished when the file is there", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.succeed(job.id, exportResultUrl(id));
        await writeExport(id);
        expect(await (await requestExport(id)).json()).toEqual({
          job_id: job.id,
          status: "succeeded",
        });
      });

      it("starts a new export when the file has been removed", async () => {
        const { id } = await explanation();
        const done = await queue.ensureSucceeded(id, "export", exportResultUrl(id));
        const body = await (await requestExport(id)).json();
        expect(body.status).toBe("queued");
        expect(body.job_id).not.toBe(done.id);
      });

      it("stores a reference explanation before queueing its export", async () => {
        const response = await requestExport(REFERENCE_ID);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe("queued");

        const rows = await db.select().from(explanations).where(eq(explanations.id, REFERENCE_ID));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          kind: "reference",
          root_id: REFERENCE_ID,
          expires_at: null,
        });
        expect(await queue.get(body.job_id)).toMatchObject({ explanation_id: REFERENCE_ID });

        const again = await (await requestExport(REFERENCE_ID)).json();
        expect(again).toEqual(body);
        expect(await db.select().from(explanations)).toHaveLength(1);
      });

      it("exports a reference that a derived version already stored", async () => {
        await store.create(reference);
        const response = await requestExport(REFERENCE_ID);
        expect(response.status).toBe(200);
        expect(await jobRows()).toHaveLength(1);
      });

      it.each([
        ["malformed", "not-an-id"],
        ["an uppercase one", "KKKKKKKKKKKK"],
        ["too short", "kkkkkkkkkkk"],
        ["unknown", "kkkkkkkkkkkk"],
      ])("answers 404 for an id that is %s", async (_label, id) => {
        const response = await requestExport(id);
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: { code: "not_found", message: errorMessage("fr", "not_found") },
        });
        expect(await jobRows()).toHaveLength(0);
      });

      it("answers 410 for an expired explanation", async () => {
        const { id } = await explanation({ expires_at: new Date(Date.now() - 1000) });
        const response = await requestExport(id, visitor("203.0.113.5", "en"));
        expect(response.status).toBe(410);
        expect(await response.json()).toEqual({
          error: { code: "expired", message: errorMessage("en", "expired") },
        });
        expect(await jobRows()).toHaveLength(0);
      });

      it.each([
        "triaging",
        "planning",
        "streaming",
        "failed",
        "refused",
        "needs_clarification",
      ] as const)("answers 409 not_ready for an explanation that is %s", async (status) => {
        const { id } = await explanation({ status });
        for (const language of ["fr", "en"] as const) {
          const response = await requestExport(id, visitor("203.0.113.5", language));
          expect(response.status).toBe(409);
          expect(await response.json()).toEqual({
            error: { code: "not_ready", message: errorMessage(language, "not_ready") },
          });
        }
        expect(await jobRows()).toHaveLength(0);
        expect(await hits()).toBe(0);
      });

      it("answers 429 with the waiting time after five exports in an hour", async () => {
        const address = visitor("203.0.113.5");
        for (let call = 0; call < 5; call += 1) {
          const { id } = await explanation();
          expect((await requestExport(id, address)).status).toBe(200);
        }

        const { id } = await explanation();
        const response = await requestExport(id, address);
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("3600");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: { code: "rate_limited", message: errorMessage("fr", "rate_limited") },
        });
        expect(await queue.findActive(id, "export")).toBeNull();
        expect(await jobRows()).toHaveLength(5);
      });

      it("shortens the waiting time as the hour goes by", async () => {
        useRoutes({ RATE_LIMIT_EXPORT_PER_HOUR: "1" });
        const address = visitor("203.0.113.5", "en");
        const first = await explanation();
        const second = await explanation();
        await requestExport(first.id, address);
        advance(20 * MINUTE);
        const response = await requestExport(second.id, address);
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe(String(40 * 60));
        expect((await response.json()).error.message).toBe(errorMessage("en", "rate_limited"));
      });

      it("reads the limit from RATE_LIMIT_EXPORT_PER_HOUR", async () => {
        useRoutes({ RATE_LIMIT_EXPORT_PER_HOUR: "2" });
        const address = visitor("203.0.113.5");
        const statuses = [];
        for (let call = 0; call < 3; call += 1) {
          const { id } = await explanation();
          statuses.push((await requestExport(id, address)).status);
        }
        expect(statuses).toEqual([200, 200, 429]);
      });

      it("counts a request for a job that is already active only once", async () => {
        useRoutes({ RATE_LIMIT_EXPORT_PER_HOUR: "1" });
        const address = visitor("203.0.113.5");
        const { id } = await explanation();
        for (let call = 0; call < 4; call += 1) {
          expect((await requestExport(id, address)).status).toBe(200);
        }
        expect(await hits()).toBe(1);
        expect(await jobRows()).toHaveLength(1);
      });

      it("counts each visitor on their own", async () => {
        useRoutes({ RATE_LIMIT_EXPORT_PER_HOUR: "1" });
        const one = await explanation();
        const two = await explanation();
        const three = await explanation();
        expect((await requestExport(one.id, visitor("203.0.113.5"))).status).toBe(200);
        expect((await requestExport(two.id, visitor("203.0.113.6"))).status).toBe(200);
        expect((await requestExport(three.id, visitor("203.0.113.5"))).status).toBe(429);
      });

      it("counts exports apart from generations", async () => {
        const address = "203.0.113.5";
        for (let call = 0; call < 10; call += 1) await limiter.check(address, "generation");
        expect(await limiter.check(address, "generation")).toMatchObject({ allowed: false });

        const { id } = await explanation();
        expect((await requestExport(id, visitor(address))).status).toBe(200);
        expect(await limiter.check(address, "generation")).toMatchObject({ allowed: false });
      });

      it("lets a visitor retry an export that failed, within the limit", async () => {
        const address = visitor("203.0.113.5");
        const { id } = await explanation();
        const first = await (await requestExport(id, address)).json();
        await queue.reserve("export");
        await queue.fail(first.job_id, "first");
        await queue.reserve("export");
        await queue.fail(first.job_id, "second");

        const retry = await (await requestExport(id, address)).json();
        expect(retry.status).toBe("queued");
        expect(retry.job_id).not.toBe(first.job_id);
      });

      it("hides the details of an unexpected failure", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(limiter, "check").mockRejectedValue(new Error(SECRET));
        const { id } = await explanation();
        const response = await requestExport(id);
        const text = await response.text();
        expect(response.status).toBe(500);
        expect(text).not.toContain("hunter2");
        expect(JSON.parse(text).error.code).toBe("internal_error");
        expect(error).toHaveBeenCalled();
      });
    });

    describe("job route", () => {
      function requestJob(id: string, headers: Record<string, string> = {}) {
        return getJob(new Request(`${ORIGIN}/api/jobs/${id}`, { headers }), {
          params: Promise.resolve({ id }),
        });
      }

      beforeEach(() => {
        setContainerForTests({
          store,
          limiter: createRateLimiter(db, { now }),
        } as unknown as Container);
        setJobsForTests(queue);
      });

      it("describes a queued job", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        const response = await requestJob(job.id);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          id: job.id,
          type: "export",
          status: "queued",
          progress: 0,
          result_url: null,
        });
      });

      it("follows a job through its states up to the file", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.setProgress(job.id, 35);
        expect(await (await requestJob(job.id)).json()).toEqual({
          id: job.id,
          type: "export",
          status: "running",
          progress: 35,
          result_url: null,
        });

        await queue.succeed(job.id, exportResultUrl(id));
        expect(await (await requestJob(job.id)).json()).toEqual({
          id: job.id,
          type: "export",
          status: "succeeded",
          progress: 100,
          result_url: `/media/${id}/export.mp4`,
        });
      });

      it("reports a failure without its technical message", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.fail(job.id, SECRET);
        await queue.reserve("export");
        await queue.fail(job.id, SECRET);

        const response = await requestJob(job.id);
        const text = await response.text();
        expect(text).not.toContain("hunter2");
        expect(text).not.toContain("postgres");
        const body = JSON.parse(text);
        expect(body).not.toHaveProperty("error");
        expect(body).toEqual({
          id: job.id,
          type: "export",
          status: "failed",
          progress: 0,
          result_url: null,
        });
      });

      it("does not show the error of a job that is waiting for a new attempt", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "export");
        await queue.reserve("export");
        await queue.fail(job.id, SECRET);
        const text = await (await requestJob(job.id)).text();
        expect(text).not.toContain("hunter2");
        expect(JSON.parse(text).status).toBe("queued");
      });

      it("reads a deep version that was given up on as a failure", async () => {
        const { id } = await explanation();
        const job = await seed(id, {
          type: "deep",
          status: "abandoned",
          attempts: 3,
          error: SECRET,
        });
        const body = await (await requestJob(job.id)).json();
        expect(body).toEqual({
          id: job.id,
          type: "deep",
          status: "failed",
          progress: 0,
          result_url: null,
        });
      });

      it.each([
        ["unknown", "00000000-0000-4000-8000-000000000000"],
        ["malformed", "not-a-uuid"],
        ["an explanation id", "kkkkkkkkkkkk"],
        ["an injection attempt", "' or 1=1 --"],
      ])("answers 404 for an id that is %s", async (_label, id) => {
        const response = await requestJob(id, { "accept-language": "en" });
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: { code: "not_found", message: errorMessage("en", "not_found") },
        });
      });

      it("hides the details of an unexpected failure", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        setJobsForTests({ ...queue, get: () => Promise.reject(new Error(SECRET)) });
        const response = await requestJob("00000000-0000-4000-8000-000000000000");
        const text = await response.text();
        expect(response.status).toBe(500);
        expect(text).not.toContain("hunter2");
        expect(error).toHaveBeenCalled();
      });
    });

    describe("database constraints behind the queue", () => {
      it("rejects a second active job even when written directly", async () => {
        const { id } = await explanation();
        await seed(id, { status: "running", locked_at: T0, attempts: 1 });
        const error = await seed(id, { status: "queued" }).catch((cause) => cause);
        expect(pgCode(error)).toBe(UNIQUE);
      });
    });
  },
);
