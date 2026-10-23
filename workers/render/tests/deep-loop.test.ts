import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createJobs, exportResultUrl, type Jobs } from "@/server/db/jobs";
import { jobs as jobsTable } from "@/server/db/schema";
import { deepResultUrl as webDeepResultUrl } from "@/server/deep";
import type { ExplanationRecord } from "@/server/pipeline/ports";
import {
  describeTarget,
  openTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from "../../../apps/web/tests/helpers/db";
import { deepResultUrl, isDeepEnabled, startDeepLoop } from "../src/deep/loop";
import type { DeepRenderer, DeepRequest } from "../src/deep/orchestrate";
import { startLoop, type Loop } from "../src/loop";
import type { RenderRequest } from "../src/render";
import { DATABASE, loadGravity, scratchDir, storeExplanation, waitFor } from "./helpers/support";

const database = await openTestDatabase(DATABASE);
if (!database) {
  console.warn(
    `PostgreSQL is unreachable at ${describeTarget(testDatabaseUrl(DATABASE))}: deep loop tests skipped`,
  );
}

const MINUTE = 60_000;
const FAST = { pollIntervalMs: 20, staleCheckIntervalMs: 60 * MINUTE };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("deep version switch", () => {
  it("is on unless DEEP=off", () => {
    expect(isDeepEnabled({})).toBe(true);
    expect(isDeepEnabled({ DEEP: "on" })).toBe(true);
    expect(isDeepEnabled({ DEEP: "off" })).toBe(false);
    expect(deepResultUrl("abcdefghijkl")).toBe(webDeepResultUrl("abcdefghijkl"));
  });
});

describe.skipIf(!database)("deep version loop", () => {
  const { db, reset, close } = database as TestDatabase;
  const jobs: Jobs = createJobs(db);
  let gravity: ExplanationRecord;
  let mediaDir: string;
  let loops: Loop[] = [];

  beforeAll(async () => {
    gravity = await loadGravity();
  });

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await reset();
    mediaDir = await scratchDir("deep-loop-media");
  });

  afterEach(async () => {
    await Promise.all(loops.map((loop) => loop.stop()));
    loops = [];
    vi.restoreAllMocks();
    await rm(mediaDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await close();
  });

  function start(render: DeepRenderer, options: Partial<Parameters<typeof startDeepLoop>[0]> = {}) {
    const loop = startDeepLoop({ db, jobs, mediaDir, render, ...FAST, ...options });
    loops.push(loop);
    return loop;
  }

  async function queue(patch: Partial<ExplanationRecord> = {}) {
    const record = await storeExplanation(db, gravity, { kind: "initial", ...patch });
    const job = await jobs.enqueue(record.id, "deep");
    return { record, job };
  }

  const settled = (id: string) => async () => {
    const job = await jobs.get(id);
    return job && ["succeeded", "failed", "abandoned"].includes(job.status) ? job : null;
  };

  async function writeDeep(request: DeepRequest, content = "fake deep video") {
    const file = path.join(mediaDir, request.record.id, "deep.mp4");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    return { status: "succeeded" as const, file, attempts: 1 };
  }

  it("reserves a deep job, reports progress and succeeds with the video", async () => {
    const { record, job } = await queue();
    const seen: DeepRequest[] = [];
    let during: number | undefined;
    start(
      async (request) => {
        seen.push(request);
        request.onProgress?.(5);
        await delay(20);
        request.onProgress?.(40);
        await waitFor(async () => ((await jobs.get(job.id))?.progress ?? 0) >= 5);
        during = (await jobs.get(job.id))?.progress;
        return writeDeep(request);
      },
      { progressIntervalMs: 0 },
    );

    const done = await waitFor(settled(job.id));

    expect(done).toMatchObject({
      status: "succeeded",
      progress: 100,
      attempts: 1,
      error: null,
      result_url: `/media/${record.id}/deep.mp4`,
    });
    expect(during).toBeGreaterThanOrEqual(5);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.record.id).toBe(record.id);
    expect(seen[0]!.record.payload.plan).toEqual(gravity.payload.plan);
    expect(seen[0]!.signal?.aborted).toBe(false);
    expect(await readFile(path.join(mediaDir, record.id, "deep.mp4"), "utf8")).toBe(
      "fake deep video",
    );
  });

  it("saves progress at most once per interval and never reaches 100 before the end", async () => {
    const { job } = await queue();
    const spy = vi.spyOn(jobs, "setProgress");
    start(
      async (request) => {
        for (let percent = 5; percent <= 100; percent += 1) {
          request.onProgress?.(percent);
          await delay(5);
        }
        return writeDeep(request);
      },
      { progressIntervalMs: 150 },
    );

    await waitFor(settled(job.id));
    const sent = spy.mock.calls.map(([, percent]) => percent);
    spy.mockRestore();

    expect(sent[0]).toBe(5);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.length).toBeLessThanOrEqual(8);
    expect(Math.max(...sent)).toBeLessThanOrEqual(99);
  });

  it("abandons the job at once with the reason when the deep version cannot be made", async () => {
    const { job } = await queue();
    const render = vi.fn<DeepRenderer>(async () => ({
      status: "abandoned",
      reason: "attempts_exhausted (render)",
      attempts: 3,
    }));
    start(render);

    const done = await waitFor(settled(job.id));

    expect(render).toHaveBeenCalledTimes(1);
    expect(done).toMatchObject({
      status: "abandoned",
      attempts: 1,
      error: "attempts_exhausted (render)",
      result_url: null,
    });
    expect(done.finished_at).not.toBeNull();
  });

  it("succeeds without rendering when the video is already there", async () => {
    const { record, job } = await queue();
    await mkdir(path.join(mediaDir, record.id), { recursive: true });
    await writeFile(path.join(mediaDir, record.id, "deep.mp4"), "already there");
    const render = vi.fn<DeepRenderer>();
    start(render);

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("succeeded");
    expect(done.result_url).toBe(deepResultUrl(record.id));
    expect(render).not.toHaveBeenCalled();
    expect(await readFile(path.join(mediaDir, record.id, "deep.mp4"), "utf8")).toBe(
      "already there",
    );
  });

  it("abandons a job whose explanation is expired or not playable, without rendering", async () => {
    const failed = await queue({ status: "failed" });
    const expired = await queue({ expires_at: new Date(Date.now() - MINUTE) });
    const planless = await queue({ payload: { ...gravity.payload, plan: null } });
    const render = vi.fn<DeepRenderer>();
    start(render);

    for (const { job } of [failed, expired, planless]) {
      const done = await waitFor(settled(job.id));
      expect(done.status).toBe("abandoned");
      expect(done.attempts).toBe(1);
      expect(done.error).toMatch(/missing, expired or not playable/);
    }
    expect(render).not.toHaveBeenCalled();
  });

  it("takes back a deep job held by a silent worker and makes it", async () => {
    const { record, job } = await queue();
    await jobs.reserve("deep");
    await db
      .update(jobsTable)
      .set({ locked_at: sql`now() - interval '11 minutes'`, progress: 60 })
      .where(eq(jobsTable.id, job.id));
    start(writeDeep);

    const done = await waitFor(settled(job.id));

    expect(done.status).toBe("succeeded");
    expect(done.attempts).toBe(2);
    expect(done.result_url).toBe(deepResultUrl(record.id));
  });

  it("sends a job back to the queue on an unexpected error, and abandons it after three", async () => {
    const { job } = await queue();
    const render = vi.fn<DeepRenderer>(async () => {
      throw new Error(`EACCES: permission denied\n${"x".repeat(500)}`);
    });
    start(render);

    const done = await waitFor(settled(job.id));

    expect(render).toHaveBeenCalledTimes(3);
    expect(done).toMatchObject({
      status: "abandoned",
      attempts: 3,
      error: "EACCES: permission denied",
    });
  });

  it("leaves the job running for a later worker when it stops in the middle", async () => {
    const first = await queue();
    const second = await queue();
    let signal: AbortSignal | undefined;
    const running = start(async (request) => {
      signal = request.signal;
      await new Promise((resolve) => request.signal?.addEventListener("abort", resolve));
      return { status: "cancelled", attempts: 1 };
    });
    await waitFor(async () => signal);

    await running.stop();
    loops = [];

    expect(signal?.aborted).toBe(true);
    expect(await jobs.get(first.job.id)).toMatchObject({ status: "running", attempts: 1 });
    expect(await jobs.get(second.job.id)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("makes one deep version at a time, beside an export that does not wait for it", async () => {
    const deep = await queue();
    const other = await queue();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let active = 0;
    let peak = 0;
    start(async (request) => {
      active += 1;
      peak = Math.max(peak, active);
      if (request.record.id === deep.record.id) await gate;
      const outcome = await writeDeep(request);
      active -= 1;
      return outcome;
    });
    const exporting = startLoop({
      db,
      jobs,
      mediaDir,
      ...FAST,
      render: async (request: RenderRequest) => {
        await mkdir(path.dirname(request.outFile), { recursive: true });
        await writeFile(request.outFile, "fake export");
      },
    });
    loops.push(exporting);
    await waitFor(async () => (await jobs.get(deep.job.id))?.status === "running");
    const exported = await jobs.enqueue(deep.record.id, "export");

    const exportDone = await waitFor(settled(exported.id));
    expect(exportDone.result_url).toBe(exportResultUrl(deep.record.id));
    expect((await jobs.get(deep.job.id))?.status).toBe("running");
    expect((await jobs.get(other.job.id))?.status).toBe("queued");

    release();
    await waitFor(settled(other.job.id));
    expect((await jobs.get(deep.job.id))?.status).toBe("succeeded");
    expect(peak).toBe(1);
  });

  it("stops promptly when it is idle", async () => {
    const idle = start(writeDeep, { pollIntervalMs: 60_000 });
    await delay(100);
    const began = Date.now();
    await idle.stop();
    loops = [];
    expect(Date.now() - began).toBeLessThan(1000);
  });
});
