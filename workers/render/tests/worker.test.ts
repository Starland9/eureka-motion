import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJobs, exportResultUrl } from "@/server/db/jobs";
import type { ExplanationRecord } from "@/server/pipeline/ports";
import { readWorkerHealth } from "../../../apps/web/src/server/health/workers";
import {
  describeTarget,
  openTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from "../../../apps/web/tests/helpers/db";
import {
  DATABASE,
  REFERENCE_DIR,
  findBrowser,
  loadGravity,
  scratchDir,
  storeExplanation,
  waitFor,
} from "./helpers/support";

const WORKER_DIR = fileURLToPath(new URL("..", import.meta.url));
const database = await openTestDatabase(DATABASE);
if (!database) {
  console.warn(
    `PostgreSQL is unreachable at ${describeTarget(testDatabaseUrl(DATABASE))}: worker tests skipped`,
  );
}

interface Worker {
  child: ChildProcess;
  output(): string;
  exited: Promise<number | null>;
}

describe.skipIf(!database)("render worker process", () => {
  const { db, reset, close } = database as TestDatabase;
  const jobs = createJobs(db);
  let gravity: ExplanationRecord;
  let mediaDir: string;
  let sandboxDir: string;
  let browser: string | undefined;
  let worker: Worker | undefined;

  beforeAll(async () => {
    const full = await loadGravity();
    const [scene] = full.payload.scenes;
    gravity = {
      ...full,
      scene_count_planned: null,
      payload: {
        ...full.payload,
        quiz: null,
        scenes: [{ ...scene!, beats: scene!.beats.slice(0, 1) }],
      },
    };
    browser = await findBrowser();
  });

  beforeEach(async () => {
    await reset();
    mediaDir = await scratchDir("worker-media");
    sandboxDir = await scratchDir("worker-sandbox");
  });

  afterEach(async () => {
    worker?.child.kill("SIGKILL");
    worker = undefined;
    await Promise.all([
      rm(mediaDir, { recursive: true, force: true }),
      rm(sandboxDir, { recursive: true, force: true }),
    ]);
  });

  afterAll(async () => {
    await close();
  });

  function launch(): Worker {
    let text = "";
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: WORKER_DIR,
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl(DATABASE).href,
        MEDIA_DIR: mediaDir,
        SANDBOX_DIR: sandboxDir,
        REFERENCE_DIR,
        ...(browser ? { BROWSER_EXECUTABLE: browser } : {}),
      },
    });
    child.stdout?.on("data", (chunk: Buffer) => (text += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (text += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    worker = { child, output: () => text, exited };
    return worker;
  }

  it("leaves at once on SIGTERM when it has nothing to render, after announcing itself", async () => {
    const started = launch();
    await waitFor(async () => started.output().includes("Waiting for export jobs"), 60_000);

    const health = await readWorkerHealth(mediaDir);
    expect(health.render_worker).toBe(true);
    expect(health.deep_worker).toBe(false);

    const began = Date.now();
    started.child.kill("SIGTERM");

    expect(await started.exited).toBe(0);
    expect(Date.now() - began).toBeLessThan(10_000);
    expect(started.output()).toContain("SIGTERM received");
  }, 90_000);

  it("finishes the render in progress on SIGTERM, records the result and exits cleanly", async () => {
    const record = await storeExplanation(db, gravity);
    const job = await jobs.enqueue(record.id, "export");
    const started = launch();

    await waitFor(async () => (await jobs.get(job.id))?.status === "running", 90_000);
    started.child.kill("SIGTERM");

    expect(await started.exited).toBe(0);
    const done = await jobs.get(job.id);
    expect(done).toMatchObject({
      status: "succeeded",
      progress: 100,
      attempts: 1,
      result_url: exportResultUrl(record.id),
    });
    const exported = path.join(mediaDir, record.id, "export.mp4");
    expect((await stat(exported)).size).toBeGreaterThan(1000);
    expect((await readFile(exported)).subarray(4, 8).toString()).toBe("ftyp");
  }, 180_000);
});
