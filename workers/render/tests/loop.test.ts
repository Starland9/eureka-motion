import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createJobs, exportResultUrl, type Jobs } from "@/server/db/jobs";
import { jobs as jobsTable } from "@/server/db/schema";
import type { ExplanationRecord } from "@/server/pipeline/ports";
import {
  describeTarget,
  openTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from "../../../apps/web/tests/helpers/db";
import { startLoop, type Loop } from "../src/loop";
import type { ExportRenderer, RenderRequest } from "../src/render";
import { DATABASE, loadGravity, scratchDir, storeExplanation, waitFor } from "./helpers/support";

const database = await openTestDatabase(DATABASE);
if (!database) {
  console.warn(
    `PostgreSQL is unreachable at ${describeTarget(testDatabaseUrl(DATABASE))}: loop tests skipped`,
  );
}

const MINUTE = 60_000;
const FAST = { pollIntervalMs: 20, staleCheckIntervalMs: 60 * MINUTE };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFake(request: RenderRequest): Promise<void> {
  await mkdir(path.dirname(request.outFile), { recursive: true });
  await writeFile(request.outFile, "fake mp4");
}

describe.skipIf(!database)("render loop", () => {
  const { db, reset, close } = database as TestDatabase;
  const jobs: Jobs = createJobs(db);
  let gravity: ExplanationRecord;
  let mediaDir: string;
  let loop: Loop | undefined;

  beforeAll(async () => {
    gravity = await loadGravity();
  });

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await reset();
    mediaDir = await scratchDir("loop-media");
  });

  afterEach(async () => {
    await loop?.stop();
    loop = undefined;
    vi.restoreAllMocks();
    await rm(mediaDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await close();
  });

  function start(render: ExportRenderer, options: Partial<Parameters<typeof startLoop>[0]> = {}) {
    loop = startLoop({ db, jobs, mediaDir, render, ...FAST, ...options });
    return loop;
  }

  async function queue(patch: Partial<ExplanationRecord> = {}) {
    const record = await storeExplanation(db, gravity, patch);
    const job = await jobs.enqueue(record.id, "export");
    return { record, job };
  }

  const settled = (id: string) => async () => {
    const job = await jobs.get(id);
    return job && (job.status === "succeeded" || job.status === "failed") ? job : null;
  };

  it("reserves a job, reports progress, writes the export and succeeds", async () => {
    const { record, job } = await queue();
    const seen: RenderRequest[] = [];
    let during: number | undefined;
    start(async (request) => {
      seen.push(request);
      request.onProgress?.(40);
      await waitFor(async () => ((await jobs.get(job.id))?.progress ?? 0) >= 40);
      during = (await jobs.get(job.id))?.progress;
      await writeFake(request);
    });

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("succeeded");
    expect(done.progress).toBe(100);
    expect(done.attempts).toBe(1);
    expect(done.error).toBeNull();
    expect(done.result_url).toBe(`/media/${record.id}/export.mp4`);
    expect(done.result_url).toBe(exportResultUrl(record.id));
    expect(done.finished_at).not.toBeNull();
    expect(during).toBe(40);
    expect(await readFile(path.join(mediaDir, record.id, "export.mp4"), "utf8")).toBe("fake mp4");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.outFile).toBe(path.join(mediaDir, record.id, "export.mp4"));
    expect(seen[0]!.language).toBe("fr");
    expect(seen[0]!.document.scenes).toHaveLength(6);
  });

  it("saves progress at most once per interval and never reaches 100 before the end", async () => {
    const { job } = await queue();
    const spy = vi.spyOn(jobs, "setProgress");
    start(
      async (request) => {
        for (let percent = 0; percent <= 100; percent += 2) {
          request.onProgress?.(percent);
          await delay(10);
        }
        await writeFake(request);
      },
      { progressIntervalMs: 200 },
    );

    await waitFor(settled(job.id));
    const sent = spy.mock.calls.map(([, percent]) => percent);
    spy.mockRestore();

    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.length).toBeLessThanOrEqual(8);
    expect(Math.max(...sent)).toBeLessThanOrEqual(99);
    expect(sent).toEqual([...sent].sort((a, b) => a - b));
  });

  it("retries a failed render once, then marks the job failed with a short message", async () => {
    const { job } = await queue();
    const render = vi.fn<ExportRenderer>(async () => {
      throw new Error(`Chrome crashed\n    at somewhere (${"x".repeat(500)})`);
    });
    start(render);

    const done = await waitFor(settled(job.id));

    expect(render).toHaveBeenCalledTimes(2);
    expect(done.status).toBe("failed");
    expect(done.attempts).toBe(2);
    expect(done.error).toBe("Chrome crashed");
    expect(done.result_url).toBeNull();
  });

  it("succeeds on the second attempt after a first failure", async () => {
    const { record, job } = await queue();
    let calls = 0;
    start(async (request) => {
      calls += 1;
      if (calls === 1) throw new Error("Out of memory");
      await writeFake(request);
    });

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("succeeded");
    expect(done.attempts).toBe(2);
    expect(done.error).toBeNull();
    expect(done.result_url).toBe(exportResultUrl(record.id));
  });

  it("does not render again when the export file already exists", async () => {
    const { record, job } = await queue();
    await mkdir(path.join(mediaDir, record.id), { recursive: true });
    await writeFile(path.join(mediaDir, record.id, "export.mp4"), "already there");
    const render = vi.fn<ExportRenderer>(async () => undefined);
    start(render);

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("succeeded");
    expect(done.result_url).toBe(exportResultUrl(record.id));
    expect(render).not.toHaveBeenCalled();
    expect(await readFile(path.join(mediaDir, record.id, "export.mp4"), "utf8")).toBe(
      "already there",
    );
  });

  it("takes back a job held by a silent worker and renders it", async () => {
    const { record, job } = await queue();
    await jobs.reserve("export");
    await db
      .update(jobsTable)
      .set({ locked_at: sql`now() - interval '11 minutes'`, progress: 70 })
      .where(eq(jobsTable.id, job.id));
    start(writeFake);

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("succeeded");
    expect(done.attempts).toBe(2);
    expect(done.result_url).toBe(exportResultUrl(record.id));
  });

  it("gives up on a silent job whose attempts are spent", async () => {
    const { job } = await queue();
    await jobs.reserve("export");
    await jobs.fail(job.id, "first");
    await jobs.reserve("export");
    await db
      .update(jobsTable)
      .set({ locked_at: sql`now() - interval '11 minutes'` })
      .where(eq(jobsTable.id, job.id));
    const render = vi.fn<ExportRenderer>(async () => undefined);
    start(render);

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("failed");
    expect(done.attempts).toBe(2);
    expect(render).not.toHaveBeenCalled();
  });

  it("looks for silent jobs again while it runs", async () => {
    start(writeFake, { staleCheckIntervalMs: 40 });
    await delay(150);
    const record = await storeExplanation(db, gravity);
    const [orphan] = await db
      .insert(jobsTable)
      .values({
        explanation_id: record.id,
        type: "export",
        status: "running",
        attempts: 1,
        locked_at: new Date(Date.now() - 11 * MINUTE),
      })
      .returning();

    const done = await waitFor(settled(orphan!.id));

    expect(done.status).toBe("succeeded");
    expect(done.attempts).toBe(2);
  });

  it("fails a job whose explanation is not playable, without rendering", async () => {
    const { job } = await queue({ status: "failed" });
    const render = vi.fn<ExportRenderer>(async () => undefined);
    start(render);

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/not playable/);
    expect(render).not.toHaveBeenCalled();
  });

  it("fails a job whose render exceeds the time limit", async () => {
    const { job } = await queue();
    start(
      (request) =>
        new Promise((_, reject) => {
          request.signal?.addEventListener("abort", () => reject(new Error("cancelled")));
        }),
      { renderTimeoutMs: 40 },
    );

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("failed");
    expect(done.error).toBe("The render exceeded its time limit.");
  });

  it("renders one job at a time, oldest first, and picks up jobs queued later", async () => {
    const first = await queue();
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    start(async (request) => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(path.basename(path.dirname(request.outFile)));
      await delay(60);
      await writeFake(request);
      active -= 1;
    });
    const second = await queue();
    const third = await queue();

    await waitFor(settled(third.job.id));

    expect(peak).toBe(1);
    expect(order).toEqual([first.record.id, second.record.id, third.record.id]);
  });

  it("finishes the running render on stop and reserves nothing more", async () => {
    const first = await queue();
    const second = await queue();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started = false;
    const running = start(async (request) => {
      started = true;
      await gate;
      await writeFake(request);
    });
    await waitFor(async () => started);

    let stopped = false;
    const stopping = running.stop().then(() => (stopped = true));
    await delay(150);
    expect(stopped).toBe(false);
    expect((await jobs.get(first.job.id))?.status).toBe("running");

    release();
    await stopping;

    expect((await jobs.get(first.job.id))?.status).toBe("succeeded");
    const untouched = await jobs.get(second.job.id);
    expect(untouched?.status).toBe("queued");
    expect(untouched?.attempts).toBe(0);
    expect((await stat(path.join(mediaDir, first.record.id, "export.mp4"))).isFile()).toBe(true);
  });

  it("stops promptly when it is idle", async () => {
    const idle = start(writeFake, { pollIntervalMs: 60_000 });
    await delay(100);
    const began = Date.now();
    await idle.stop();
    expect(Date.now() - began).toBeLessThan(1000);
  });
});
