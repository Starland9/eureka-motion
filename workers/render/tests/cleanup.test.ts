import { chmod, lstat, lutimes, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db/client";
import { createJobs, exportResultUrl, type Jobs } from "@/server/db/jobs";
import { conceptCache, explanations, jobs as jobsTable, questionCache } from "@/server/db/schema";
import type { ExplanationRecord } from "@/server/pipeline/ports";
import {
  describeTarget,
  openTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from "../../../apps/web/tests/helpers/db";
import {
  CLEANUP_INTERVAL_MS,
  CLEANUP_START_DELAY_MS,
  EXPORT_RETENTION_MS,
  createCleanup,
  isCleanupEnabled,
  startCleanup,
  type Cleanup,
  type CleanupOptions,
  type CleanupReport,
} from "../src/cleanup";
import { DATABASE, loadGravity, scratchDir, storeExplanation, waitFor } from "./helpers/support";

const database = await openTestDatabase(DATABASE);
if (!database) {
  console.warn(
    `PostgreSQL is unreachable at ${describeTarget(testDatabaseUrl(DATABASE))}: cleanup tests skipped`,
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const NONE: CleanupReport = {
  exportsDeleted: 0,
  explanationsDeleted: 0,
  orphanFoldersDeleted: 0,
  bytesFreed: 0,
  errors: 0,
};

function orphanId(n: number): string {
  return `zzzzzzzzzz${ALPHABET[Math.floor(n / ALPHABET.length)]}${ALPHABET[n % ALPHABET.length]}`;
}

async function present(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

async function age(file: string, ageMs: number): Promise<void> {
  const at = new Date(NOW - ageMs);
  await utimes(file, at, at);
}

async function writeAged(file: string, size: number, ageMs: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.alloc(size, 1));
  await age(file, ageMs);
}

interface PgError {
  code: string;
  constraint_name?: string;
}

async function rejection(statement: PromiseLike<unknown>): Promise<PgError> {
  try {
    await statement;
  } catch (error) {
    for (let cause: unknown = error; cause; cause = (cause as Error).cause) {
      if (typeof cause === "object" && cause !== null && "code" in cause) return cause as PgError;
    }
    throw error;
  }
  throw new Error("The database accepted a statement it should have rejected");
}

describe.skipIf(!database)("periodic cleanup", () => {
  const { db, reset, close } = database as TestDatabase;
  const jobs: Jobs = createJobs(db);
  const log = { info: vi.fn(), error: vi.fn() };
  let gravity: ExplanationRecord;
  let mediaDir: string;
  let outsideDir: string;
  const locked: string[] = [];

  beforeAll(async () => {
    gravity = await loadGravity();
  });

  beforeEach(async () => {
    log.info.mockClear();
    log.error.mockClear();
    await reset();
    mediaDir = await scratchDir("cleanup-media");
    outsideDir = await scratchDir("cleanup-outside");
  });

  afterEach(async () => {
    for (const folder of locked.splice(0)) await chmod(folder, 0o700).catch(() => undefined);
    await rm(mediaDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await close();
  });

  const cleaner = (options: Partial<CleanupOptions> = {}) =>
    createCleanup({ db, mediaDir, now: () => NOW, log, ...options });
  const run = (options: Partial<CleanupOptions> = {}) => cleaner(options).run();
  const folder = (id: string) => path.join(mediaDir, id);

  const live = (patch: Partial<ExplanationRecord> = {}) =>
    storeExplanation(db, gravity, {
      kind: "initial",
      expires_at: new Date(NOW + 30 * DAY),
      ...patch,
    });
  const expired = (patch: Partial<ExplanationRecord> = {}) =>
    live({ expires_at: new Date(NOW - DAY), ...patch });
  const reference = (patch: Partial<ExplanationRecord> = {}) =>
    storeExplanation(db, gravity, { kind: "reference", expires_at: null, ...patch });
  const followup = (parent: ExplanationRecord, patch: Partial<ExplanationRecord> = {}) =>
    live({
      kind: "followup",
      parent_id: parent.id,
      root_id: parent.root_id,
      scene_count_planned: null,
      ...patch,
    });

  async function exists(id: string): Promise<boolean> {
    const rows = await db
      .select({ id: explanations.id })
      .from(explanations)
      .where(eq(explanations.id, id));
    return rows.length === 1;
  }

  async function runningJob(explanationId: string, type: "export" | "deep") {
    const [job] = await db
      .insert(jobsTable)
      .values({ explanation_id: explanationId, type, status: "running", attempts: 1 })
      .returning();
    return job!;
  }

  describe("constants", () => {
    it("keeps an export for seven days and cleans every hour, after 30 seconds", () => {
      expect(EXPORT_RETENTION_MS).toBe(7 * DAY);
      expect(CLEANUP_INTERVAL_MS).toBe(HOUR);
      expect(CLEANUP_START_DELAY_MS).toBe(30_000);
    });

    it("is switched off by CLEANUP=off only", () => {
      expect(isCleanupEnabled({})).toBe(true);
      expect(isCleanupEnabled({ CLEANUP: "" })).toBe(true);
      expect(isCleanupEnabled({ CLEANUP: "on" })).toBe(true);
      expect(isCleanupEnabled({ CLEANUP: "off" })).toBe(false);
      expect(isCleanupEnabled({ CLEANUP: " OFF " })).toBe(false);
    });
  });

  describe("old exports", () => {
    it("deletes an export of eight days, keeps one of six, and leaves the other files", async () => {
      const old = await live();
      const recent = await live();
      await writeAged(path.join(folder(old.id), "export.mp4"), 11, 8 * DAY);
      await writeAged(path.join(folder(old.id), "scene-beat.mp3"), 5, 8 * DAY);
      await writeAged(path.join(folder(old.id), "deep.mp4"), 7, 8 * DAY);
      await writeAged(path.join(folder(recent.id), "export.mp4"), 13, 6 * DAY);

      const report = await run();

      expect(report).toEqual({ ...NONE, exportsDeleted: 1, bytesFreed: 11 });
      expect(await present(path.join(folder(old.id), "export.mp4"))).toBe(false);
      expect(await present(path.join(folder(old.id), "scene-beat.mp3"))).toBe(true);
      expect(await present(path.join(folder(old.id), "deep.mp4"))).toBe(true);
      expect(await present(path.join(folder(recent.id), "export.mp4"))).toBe(true);
      expect(await exists(old.id)).toBe(true);
    });

    it("keeps an export of exactly seven days", async () => {
      const record = await live();
      await writeAged(path.join(folder(record.id), "export.mp4"), 4, EXPORT_RETENTION_MS);

      expect(await run()).toEqual(NONE);
    });

    it("lets the next export request create a job, and no job claims the missing file", async () => {
      const record = await live();
      await writeAged(path.join(folder(record.id), "export.mp4"), 4, 8 * DAY);
      const done = await jobs.ensureSucceeded(record.id, "export", exportResultUrl(record.id));
      const [failed] = await db
        .insert(jobsTable)
        .values({ explanation_id: record.id, type: "export", status: "failed", attempts: 2 })
        .returning();

      await run();

      expect(await jobs.get(done.id)).toBeNull();
      expect((await jobs.get(failed!.id))?.status).toBe("failed");
      expect(await jobs.findActive(record.id, "export")).toBeNull();
      const next = await jobs.enqueue(record.id, "export");
      expect(next.status).toBe("queued");
      expect(next.id).not.toBe(done.id);
    });

    it("deletes the export of a reference and keeps the reference", async () => {
      const record = await reference();
      await writeAged(path.join(folder(record.id), "export.mp4"), 9, 8 * DAY);

      expect(await run()).toEqual({ ...NONE, exportsDeleted: 1, bytesFreed: 9 });
      expect(await exists(record.id)).toBe(true);
    });

    it.each(["queued", "running"] as const)(
      "keeps the export while a job is %s",
      async (status) => {
        const record = await live();
        await writeAged(path.join(folder(record.id), "export.mp4"), 4, 8 * DAY);
        await db.insert(jobsTable).values({
          explanation_id: record.id,
          type: "export",
          status,
          attempts: status === "running" ? 1 : 0,
        });

        expect(await run()).toEqual(NONE);
        expect(await present(path.join(folder(record.id), "export.mp4"))).toBe(true);
      },
    );

    it("does not follow an export that is a symbolic link", async () => {
      const record = await live();
      const target = path.join(outsideDir, "precious.mp4");
      await writeAged(target, 8, 30 * DAY);
      await mkdir(folder(record.id), { recursive: true });
      await symlink(target, path.join(folder(record.id), "export.mp4"));

      expect(await run()).toEqual(NONE);
      expect(await present(target)).toBe(true);
      expect(await present(path.join(folder(record.id), "export.mp4"))).toBe(true);
    });
  });

  describe("expired explanations", () => {
    it("deletes the row, the linked rows and the whole media folder", async () => {
      const record = await expired();
      const keeper = await live();
      await writeAged(path.join(folder(record.id), "export.mp4"), 3, 1 * DAY);
      await writeAged(path.join(folder(record.id), "scene-beat.mp3"), 5, 80 * DAY);
      await writeAged(path.join(folder(record.id), "deep.mp4"), 7, 80 * DAY);
      await writeAged(path.join(folder(keeper.id), "scene-beat.mp3"), 2, 80 * DAY);
      await jobs.ensureSucceeded(record.id, "export", exportResultUrl(record.id));
      await jobs.enqueue(record.id, "deep");
      await db.insert(questionCache).values({
        question_hash: "h1",
        language: "fr",
        level: "lycee",
        explanation_id: record.id,
      });
      await db.insert(conceptCache).values({
        concept_slug: "physics/universal-gravitation",
        language: "fr",
        level: "lycee",
        explanation_id: record.id,
      });
      await jobs.enqueue(keeper.id, "deep");

      const report = await run();

      expect(report).toEqual({ ...NONE, explanationsDeleted: 1, bytesFreed: 15 });
      expect(await exists(record.id)).toBe(false);
      expect(await present(folder(record.id))).toBe(false);
      expect(await db.select().from(questionCache)).toHaveLength(0);
      expect(await db.select().from(conceptCache)).toHaveLength(0);
      expect(await db.select().from(jobsTable)).toHaveLength(1);
      expect(await exists(keeper.id)).toBe(true);
      expect(await present(path.join(folder(keeper.id), "scene-beat.mp3"))).toBe(true);
    });

    it("keeps an explanation without an expiry date and one that expires later", async () => {
      const open = await live({ expires_at: null });
      const later = await live({ expires_at: new Date(NOW + 1) });
      await writeAged(path.join(folder(open.id), "scene-beat.mp3"), 5, 200 * DAY);
      await writeAged(path.join(folder(later.id), "scene-beat.mp3"), 5, 200 * DAY);

      expect(await run()).toEqual(NONE);
      expect(await exists(open.id)).toBe(true);
      expect(await exists(later.id)).toBe(true);
      expect(await present(folder(open.id))).toBe(true);
      expect(await present(folder(later.id))).toBe(true);
    });

    it("never deletes a reference: the database refuses it an expiry date", async () => {
      const error = await rejection(
        storeExplanation(db, gravity, { kind: "reference", expires_at: new Date(NOW - DAY) }),
      );

      expect(error).toMatchObject({
        code: "23514",
        constraint_name: "explanations_reference_no_expiry",
      });
    });

    it("never deletes a reference: the code refuses it too, without the constraint", async () => {
      const constraint = "explanations_reference_no_expiry";
      await db.execute(sql.raw(`alter table explanations drop constraint ${constraint}`));
      try {
        const stray = await reference({ expires_at: new Date(NOW - 100 * DAY) });
        const clean = await reference();
        await jobs.enqueue(stray.id, "export");
        await writeAged(path.join(folder(stray.id), "scene-beat.mp3"), 5, 200 * DAY);
        await writeAged(path.join(folder(stray.id), "deep.mp4"), 7, 200 * DAY);
        await writeAged(path.join(folder(clean.id), "scene-beat.mp3"), 5, 200 * DAY);

        const report = await run();

        expect(report).toEqual(NONE);
        expect(await exists(stray.id)).toBe(true);
        expect(await exists(clean.id)).toBe(true);
        expect(await present(path.join(folder(stray.id), "scene-beat.mp3"))).toBe(true);
        expect(await present(path.join(folder(stray.id), "deep.mp4"))).toBe(true);
        expect(await present(path.join(folder(clean.id), "scene-beat.mp3"))).toBe(true);
        expect(await db.select().from(jobsTable)).toHaveLength(1);
      } finally {
        await reset();
        await db.execute(
          sql.raw(
            `alter table explanations add constraint ${constraint} check (kind <> 'reference' or expires_at is null)`,
          ),
        );
      }
    });

    it.each(["export", "deep"] as const)(
      "keeps an expired explanation while its %s job is running, then removes it",
      async (type) => {
        const record = await expired();
        await writeAged(path.join(folder(record.id), "scene-beat.mp3"), 5, 80 * DAY);
        const job = await runningJob(record.id, type);

        expect(await run()).toEqual(NONE);
        expect(await exists(record.id)).toBe(true);
        expect(await present(folder(record.id))).toBe(true);

        await db.update(jobsTable).set({ status: "failed" }).where(eq(jobsTable.id, job.id));

        expect(await run()).toEqual({ ...NONE, explanationsDeleted: 1, bytesFreed: 5 });
        expect(await exists(record.id)).toBe(false);
        expect(await present(folder(record.id))).toBe(false);
      },
    );

    it("does not take with it a follow-up whose own 90 days are not over", async () => {
      const root = await expired({ expires_at: new Date(NOW - 2 * DAY) });
      const child = await followup(root);
      await writeAged(path.join(folder(root.id), "scene-beat.mp3"), 5, 90 * DAY);
      await writeAged(path.join(folder(child.id), "scene-beat.mp3"), 6, 10 * DAY);

      expect(await run()).toEqual(NONE);
      expect(await exists(root.id)).toBe(true);
      expect(await exists(child.id)).toBe(true);
      expect(await present(folder(child.id))).toBe(true);

      await db
        .update(explanations)
        .set({ expires_at: new Date(NOW - DAY) })
        .where(eq(explanations.id, child.id));

      expect(await run()).toEqual({ ...NONE, explanationsDeleted: 2, bytesFreed: 11 });
      expect(await exists(root.id)).toBe(false);
      expect(await exists(child.id)).toBe(false);
      expect(await present(folder(root.id))).toBe(false);
      expect(await present(folder(child.id))).toBe(false);
    });

    it("keeps an expired root while a row of its session hangs on another parent", async () => {
      const root = await expired({ expires_at: new Date(NOW - 2 * DAY) });
      const other = await live();
      const stray = await followup(other, { root_id: root.id });

      expect(await run()).toEqual(NONE);
      expect(await exists(root.id)).toBe(true);
      expect(await exists(stray.id)).toBe(true);
    });

    it("keeps an expired root while a job runs on one of its follow-ups", async () => {
      const root = await expired({ expires_at: new Date(NOW - 2 * DAY) });
      const child = await followup(root, { expires_at: new Date(NOW - DAY) });
      await runningJob(child.id, "deep");

      expect(await run()).toEqual(NONE);
      expect(await exists(root.id)).toBe(true);
      expect(await exists(child.id)).toBe(true);
    });

    it("leaves an explanation alone while a render is still writing in its folder", async () => {
      const record = await expired();
      const partial = path.join(folder(record.id), ".export.mp4.0a1b.part.mp4");
      await writeAged(partial, 40, MINUTE);
      await writeAged(path.join(folder(record.id), "scene-beat.mp3"), 5, 80 * DAY);

      expect(await run()).toEqual(NONE);
      expect(await exists(record.id)).toBe(true);
      expect(await present(partial)).toBe(true);

      await age(partial, 2 * HOUR);

      expect(await run()).toEqual({ ...NONE, explanationsDeleted: 1, bytesFreed: 45 });
      expect(await present(folder(record.id))).toBe(false);
    });

    it("does not follow a media folder that is a symbolic link", async () => {
      const record = await expired();
      const target = path.join(outsideDir, "precious.mp3");
      await writeAged(target, 8, 200 * DAY);
      await symlink(outsideDir, folder(record.id));

      expect(await run()).toEqual({ ...NONE, explanationsDeleted: 1 });
      expect(await exists(record.id)).toBe(false);
      expect(await present(target)).toBe(true);
      expect(await present(folder(record.id))).toBe(true);
    });

    it("removes the row of an identifier outside the alphabet but not a folder named after it", async () => {
      const record = await expired();
      const odd = "AAAAAAAAAAAA";
      await db
        .insert(explanations)
        .values({ ...record, id: odd, root_id: odd, expires_at: new Date(NOW - DAY) });
      await writeAged(path.join(folder(odd), "scene-beat.mp3"), 5, 200 * DAY);

      const report = await run();

      expect(report).toEqual({ ...NONE, explanationsDeleted: 2 });
      expect(await exists(odd)).toBe(false);
      expect(await present(path.join(folder(odd), "scene-beat.mp3"))).toBe(true);
    });

    it("still deletes the rows when the media directory does not exist", async () => {
      const record = await expired();

      const report = await run({ mediaDir: path.join(mediaDir, "absent") });

      expect(report).toEqual({ ...NONE, explanationsDeleted: 1 });
      expect(await exists(record.id)).toBe(false);
    });
  });

  describe("orphan folders", () => {
    it("deletes an old folder without a row and keeps a recent one", async () => {
      const gone = orphanId(1);
      const fresh = orphanId(2);
      await writeAged(path.join(folder(gone), "scene-beat.mp3"), 5, 8 * DAY);
      await writeAged(path.join(folder(gone), "nested", "deep.mp4"), 7, 9 * DAY);
      await age(path.join(folder(gone), "nested"), 9 * DAY);
      await age(folder(gone), 8 * DAY);
      await writeAged(path.join(folder(fresh), "scene-beat.mp3"), 5, 6 * DAY);
      await age(folder(fresh), 6 * DAY);

      const report = await run();

      expect(report).toEqual({ ...NONE, orphanFoldersDeleted: 1, bytesFreed: 12 });
      expect(await present(folder(gone))).toBe(false);
      expect(await present(path.join(folder(fresh), "scene-beat.mp3"))).toBe(true);
    });

    it("keeps an old folder that holds one recent file", async () => {
      const id = orphanId(3);
      await writeAged(path.join(folder(id), "scene-beat.mp3"), 5, 40 * DAY);
      await writeAged(path.join(folder(id), "other.mp3"), 5, 2 * DAY);
      await age(folder(id), 40 * DAY);

      expect(await run()).toEqual(NONE);
      expect(await present(folder(id))).toBe(true);
    });

    it("keeps an old folder where a render is still writing", async () => {
      const id = orphanId(4);
      await writeAged(path.join(folder(id), "scene-beat.mp3"), 5, 40 * DAY);
      await writeAged(path.join(folder(id), ".export.mp4.9f.part.mp4"), 5, 30 * MINUTE);
      await age(folder(id), 40 * DAY);

      expect(await run()).toEqual(NONE);
      expect(await present(folder(id))).toBe(true);
    });

    it("never touches the health folder, the voice cache or a name that is not an identifier", async () => {
      const kept = [
        ".health",
        ".tts-cache",
        "NOT-AN-ID",
        "AAAAAAAAAAAA",
        "short",
        "lllllllllll1",
        "zzzzzzzzzzzzzz",
        "zzzzzzzzzzz.",
      ];
      for (const name of kept) {
        await writeAged(path.join(mediaDir, name, "worker.json"), 5, 200 * DAY);
        await age(path.join(mediaDir, name), 200 * DAY);
      }
      await writeAged(path.join(mediaDir, "stray-file.mp3"), 5, 200 * DAY);

      expect(await run()).toEqual(NONE);
      for (const name of kept)
        expect(await present(path.join(mediaDir, name, "worker.json"))).toBe(true);
      expect(await present(path.join(mediaDir, "stray-file.mp3"))).toBe(true);
    });

    it("does not follow a symbolic link named like an identifier", async () => {
      const target = path.join(outsideDir, "precious.mp3");
      await writeAged(target, 8, 200 * DAY);
      await age(outsideDir, 200 * DAY);
      await symlink(outsideDir, folder(orphanId(5)));

      expect(await run()).toEqual(NONE);
      expect(await present(target)).toBe(true);
      expect(await present(folder(orphanId(5)))).toBe(true);
    });

    it("removes a symbolic link inside an orphan folder without following it", async () => {
      const id = orphanId(6);
      const target = path.join(outsideDir, "precious.mp3");
      await writeAged(target, 8, 200 * DAY);
      await writeAged(path.join(folder(id), "scene-beat.mp3"), 5, 40 * DAY);
      const link = path.join(folder(id), "escape");
      await symlink(outsideDir, link);
      await lutimes(link, new Date(NOW - 40 * DAY), new Date(NOW - 40 * DAY));
      await age(folder(id), 40 * DAY);

      const report = await run();

      expect(report).toEqual({ ...NONE, orphanFoldersDeleted: 1, bytesFreed: 5 });
      expect(await present(folder(id))).toBe(false);
      expect(await present(target)).toBe(true);
    });

    it("keeps the folder of an explanation that exists, however old", async () => {
      const record = await live();
      await writeAged(path.join(folder(record.id), "scene-beat.mp3"), 5, 300 * DAY);
      await age(folder(record.id), 300 * DAY);

      expect(await run()).toEqual(NONE);
      expect(await present(folder(record.id))).toBe(true);
    });
  });

  describe("report and errors", () => {
    it("counts every kind exactly, then finds nothing left", async () => {
      const kept = await live();
      const gone = await expired();
      const orphan = orphanId(7);
      await writeAged(path.join(folder(kept.id), "export.mp4"), 100, 8 * DAY);
      await writeAged(path.join(folder(gone.id), "export.mp4"), 50, 8 * DAY);
      await writeAged(path.join(folder(gone.id), "scene-beat.mp3"), 30, 80 * DAY);
      await writeAged(path.join(folder(gone.id), "deep.mp4"), 70, 80 * DAY);
      await writeAged(path.join(folder(orphan), "scene-beat.mp3"), 25, 20 * DAY);
      await age(folder(orphan), 20 * DAY);

      const first = await run();
      const second = await run();

      expect(first).toEqual({
        exportsDeleted: 2,
        explanationsDeleted: 1,
        orphanFoldersDeleted: 1,
        bytesFreed: 275,
        errors: 0,
      });
      expect(second).toEqual(NONE);
      expect(log.info).toHaveBeenCalledTimes(1);
      expect(log.error).not.toHaveBeenCalled();
    });

    it.skipIf(process.getuid?.() === 0)(
      "logs an input-output error on one folder and goes on with the others",
      async () => {
        const stuck = orphanId(8);
        const free = orphanId(9);
        const inner = path.join(folder(stuck), "inner");
        await writeAged(path.join(inner, "scene-beat.mp3"), 5, 40 * DAY);
        await age(inner, 40 * DAY);
        await age(folder(stuck), 40 * DAY);
        await writeAged(path.join(folder(free), "scene-beat.mp3"), 6, 40 * DAY);
        await age(folder(free), 40 * DAY);
        await chmod(inner, 0o500);
        locked.push(inner);

        const report = await run();

        expect(report).toEqual({ ...NONE, orphanFoldersDeleted: 1, bytesFreed: 6, errors: 1 });
        expect(await present(folder(free))).toBe(false);
        expect(await present(folder(stuck))).toBe(true);
        expect(log.error).toHaveBeenCalledTimes(1);
        expect(String(log.error.mock.calls[0]?.[0])).toContain(stuck);
      },
    );

    it("goes on with the other steps when the database fails", async () => {
      const record = await live();
      await writeAged(path.join(folder(record.id), "export.mp4"), 4, 8 * DAY);
      const broken = Object.create(db, {
        execute: { value: () => Promise.reject(new Error("database down")) },
      }) as Database;

      const report = await run({ db: broken });

      expect(report).toEqual({ ...NONE, exportsDeleted: 1, bytesFreed: 4, errors: 1 });
      expect(log.error).toHaveBeenCalledTimes(1);
    });

    it("works through at most one batch of each kind per pass", async () => {
      for (let i = 0; i < 5; i += 1) {
        const old = await live();
        await writeAged(path.join(folder(old.id), "export.mp4"), 1, 8 * DAY);
        const dead = await expired();
        await writeAged(path.join(folder(dead.id), "scene-beat.mp3"), 1, 80 * DAY);
        const orphan = folder(orphanId(10 + i));
        await writeAged(path.join(orphan, "scene-beat.mp3"), 1, 30 * DAY);
        await age(orphan, 30 * DAY);
      }

      const first = await run({ batchSize: 2 });
      const second = await run({ batchSize: 2 });
      const third = await run({ batchSize: 2 });
      const fourth = await run({ batchSize: 2 });

      expect([first, second, third]).toEqual([
        {
          ...NONE,
          exportsDeleted: 2,
          explanationsDeleted: 2,
          orphanFoldersDeleted: 2,
          bytesFreed: 6,
        },
        {
          ...NONE,
          exportsDeleted: 2,
          explanationsDeleted: 2,
          orphanFoldersDeleted: 2,
          bytesFreed: 6,
        },
        {
          ...NONE,
          exportsDeleted: 1,
          explanationsDeleted: 1,
          orphanFoldersDeleted: 1,
          bytesFreed: 3,
        },
      ]);
      expect(fourth).toEqual(NONE);
    });
  });

  describe("scheduling", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function stubCleanup() {
      const releases: Array<() => void> = [];
      const failures: Array<(error: Error) => void> = [];
      const run = vi.fn<Cleanup["run"]>(
        () =>
          new Promise<CleanupReport>((resolve, reject) => {
            releases.push(() => resolve(NONE));
            failures.push(reject);
          }),
      );
      return {
        cleanup: { run } satisfies Cleanup,
        run,
        release: () => releases.at(-1)!(),
        fail: (error: Error) => failures.at(-1)!(error),
      };
    }

    const schedule = (
      cleanup: Cleanup,
      options: Partial<Parameters<typeof startCleanup>[0]> = {},
    ) => startCleanup({ db, mediaDir, log, cleanup, ...options });

    it("starts after 30 seconds, then every hour once the pass is over", async () => {
      vi.useFakeTimers();
      const { cleanup, run, release } = stubCleanup();
      const scheduled = schedule(cleanup);

      await vi.advanceTimersByTimeAsync(CLEANUP_START_DELAY_MS - 1);
      expect(run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(1);

      release();
      await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS - 1);
      expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(2);

      release();
      await scheduled.stop();
    });

    it("never starts a pass while the previous one is running", async () => {
      vi.useFakeTimers();
      const { cleanup, run, release } = stubCleanup();
      const scheduled = schedule(cleanup, { startDelayMs: 10, intervalMs: 1000 });

      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(run).toHaveBeenCalledTimes(1);

      release();
      await vi.advanceTimersByTimeAsync(999);
      expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(run).toHaveBeenCalledTimes(2);

      release();
      await scheduled.stop();
    });

    it("waits for the pass in progress when it stops, and starts no other", async () => {
      vi.useFakeTimers();
      const { cleanup, run, release } = stubCleanup();
      const scheduled = schedule(cleanup, { startDelayMs: 10, intervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(10);

      let stopped = false;
      const stopping = scheduled.stop().then(() => (stopped = true));
      await vi.advanceTimersByTimeAsync(5000);
      expect(stopped).toBe(false);

      release();
      await stopping;
      expect(stopped).toBe(true);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("stops at once between two passes, and before the first", async () => {
      vi.useFakeTimers();
      const early = stubCleanup();
      await schedule(early.cleanup).stop();
      await vi.advanceTimersByTimeAsync(2 * CLEANUP_INTERVAL_MS);
      expect(early.run).not.toHaveBeenCalled();

      const idle = stubCleanup();
      const scheduled = schedule(idle.cleanup, { startDelayMs: 10, intervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(10);
      idle.release();
      await vi.advanceTimersByTimeAsync(500);
      await scheduled.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(idle.run).toHaveBeenCalledTimes(1);
    });

    it("logs a pass that fails and keeps its schedule", async () => {
      vi.useFakeTimers();
      const { cleanup, run, fail, release } = stubCleanup();
      const scheduled = schedule(cleanup, { startDelayMs: 10, intervalMs: 1000 });

      await vi.advanceTimersByTimeAsync(10);
      fail(new Error("boom"));
      await vi.advanceTimersByTimeAsync(1000);

      expect(log.error).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(2);
      release();
      await scheduled.stop();
    });

    it("runs the real cleanup", async () => {
      const record = await live();
      const file = path.join(folder(record.id), "export.mp4");
      await writeAged(file, 4, 8 * DAY);
      const scheduled = startCleanup({
        db,
        mediaDir,
        log,
        now: () => NOW,
        startDelayMs: 10,
        intervalMs: 20,
      });

      await waitFor(async () => !(await present(file)));
      await scheduled.stop();

      expect(await exists(record.id)).toBe(true);
    });
  });
});
