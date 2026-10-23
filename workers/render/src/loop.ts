import { stat } from "node:fs/promises";
import path from "node:path";
import type { Database } from "../../../apps/web/src/server/db/client";
import { exportResultUrl, type Job, type Jobs } from "../../../apps/web/src/server/db/jobs";
import { createExplanationStore } from "../../../apps/web/src/server/db/store";
import { prepareDocument } from "./document";
import type { ExportRenderer } from "./render";

export const PROGRESS_INTERVAL_MS = 1000;
export const POLL_INTERVAL_MS = 2000;
export const STALE_CHECK_INTERVAL_MS = 60_000;
// The queue takes a job back ten minutes after it was reserved, and the lock is never renewed.
export const RENDER_TIMEOUT_MS = 9 * 60 * 1000;

const MAX_ERROR_LENGTH = 200;
const PLAYABLE = new Set(["ready", "partial"]);
const RENDER_PROGRESS_CEILING = 99;

export interface LoopOptions {
  db: Database;
  jobs: Jobs;
  mediaDir: string;
  render: ExportRenderer;
  pollIntervalMs?: number;
  staleCheckIntervalMs?: number;
  progressIntervalMs?: number;
  renderTimeoutMs?: number;
  now?: () => number;
}

export interface Loop {
  stop(): Promise<void>;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n").find((line) => line.trim() !== "") ?? "Unknown error";
  return firstLine.trim().slice(0, MAX_ERROR_LENGTH);
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => null))?.isFile() === true;
}

export function startLoop(options: LoopOptions): Loop {
  const { db, jobs, mediaDir, render } = options;
  const pollMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const progressMs = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
  const timeoutMs = options.renderTimeoutMs ?? RENDER_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const store = createExplanationStore(db);
  const wake = new AbortController();
  let stopping = false;

  function pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (wake.signal.aborted) return resolve();
      const timer = setTimeout(done, ms);
      wake.signal.addEventListener("abort", done, { once: true });
      function done() {
        clearTimeout(timer);
        wake.signal.removeEventListener("abort", done);
        resolve();
      }
    });
  }

  async function requeueStale(): Promise<void> {
    try {
      for (const job of await jobs.requeueStale()) {
        console.warn(`Job ${job.id} was taken back from a silent worker.`);
      }
    } catch (error) {
      console.error("Stale jobs could not be requeued.", error);
    }
  }

  async function exportJob(job: Job, signal: AbortSignal): Promise<void> {
    const record = await store.get(job.explanation_id);
    if (!record || !PLAYABLE.has(record.status) || record.payload.plan === null) {
      throw new Error("The explanation is missing, expired or not playable.");
    }
    const outFile = path.join(mediaDir, record.id, "export.mp4");
    if (await exists(outFile)) return;

    let lastSent = Number.NEGATIVE_INFINITY;
    await render({
      document: prepareDocument(record.payload, record.language),
      language: record.language,
      outFile,
      signal,
      onProgress: (percent) => {
        const at = now();
        if (at - lastSent < progressMs) return;
        lastSent = at;
        jobs.setProgress(job.id, Math.min(percent, RENDER_PROGRESS_CEILING)).catch((error) => {
          console.error(`Progress of job ${job.id} could not be saved.`, error);
        });
      },
    });
  }

  async function handle(job: Job): Promise<void> {
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      await exportJob(job, deadline);
    } catch (error) {
      const message = deadline.aborted
        ? "The render exceeded its time limit."
        : describeError(error);
      console.error(`Job ${job.id} failed (attempt ${job.attempts}): ${message}`);
      await jobs.fail(job.id, message);
      return;
    }
    const finished = await jobs.succeed(job.id, exportResultUrl(job.explanation_id));
    if (!finished) console.warn(`Job ${job.id} was no longer running when its export was done.`);
  }

  async function run(): Promise<void> {
    await requeueStale();
    while (!stopping) {
      let job: Job | null = null;
      try {
        job = await jobs.reserve("export");
      } catch (error) {
        console.error("The queue could not be read.", error);
      }
      if (!job) {
        await pause(pollMs);
        continue;
      }
      await handle(job).catch((error) =>
        console.error(`Job ${job.id} could not be settled.`, error),
      );
    }
  }

  const staleTimer = setInterval(
    () => void requeueStale(),
    options.staleCheckIntervalMs ?? STALE_CHECK_INTERVAL_MS,
  );
  const finished = run();
  return {
    async stop() {
      stopping = true;
      clearInterval(staleTimer);
      wake.abort();
      await finished;
    },
  };
}
