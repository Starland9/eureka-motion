import { stat } from "node:fs/promises";
import path from "node:path";
import type { Database } from "../../../../apps/web/src/server/db/client";
import type { Job, Jobs } from "../../../../apps/web/src/server/db/jobs";
import { createExplanationStore } from "../../../../apps/web/src/server/db/store";
import {
  POLL_INTERVAL_MS,
  PROGRESS_INTERVAL_MS,
  STALE_CHECK_INTERVAL_MS,
  type Loop,
} from "../loop";
import type { DeepRenderer } from "./orchestrate";

const MAX_ERROR_LENGTH = 200;
const PLAYABLE = new Set(["ready", "partial"]);
const PROGRESS_CEILING = 99;

export interface DeepLoopOptions {
  db: Database;
  jobs: Jobs;
  mediaDir: string;
  render: DeepRenderer;
  pollIntervalMs?: number;
  staleCheckIntervalMs?: number;
  progressIntervalMs?: number;
  now?: () => number;
}

export function deepResultUrl(explanationId: string): string {
  return `/media/${explanationId}/deep.mp4`;
}

export function isDeepEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.DEEP !== "off";
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n").find((line) => line.trim() !== "") ?? "Unknown error";
  return firstLine.trim().slice(0, MAX_ERROR_LENGTH);
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => null))?.isFile() === true;
}

export function startDeepLoop(options: DeepLoopOptions): Loop {
  const { db, jobs, mediaDir, render } = options;
  const pollMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const progressMs = options.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
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

  async function settle(job: Job, status: "succeeded" | "abandoned", detail = ""): Promise<void> {
    const finished =
      status === "succeeded"
        ? await jobs.succeed(job.id, deepResultUrl(job.explanation_id))
        : await jobs.abandon(job.id, detail);
    if (!finished) console.warn(`Job ${job.id} was no longer running when it was settled.`);
  }

  async function deepJob(job: Job): Promise<void> {
    const record = await store.get(job.explanation_id);
    if (!record || !PLAYABLE.has(record.status) || record.payload.plan === null) {
      return settle(job, "abandoned", "The explanation is missing, expired or not playable.");
    }
    if (await exists(path.join(mediaDir, record.id, "deep.mp4"))) return settle(job, "succeeded");

    let lastSent = Number.NEGATIVE_INFINITY;
    const outcome = await render({
      record,
      signal: wake.signal,
      onProgress: (percent) => {
        const at = now();
        if (at - lastSent < progressMs) return;
        lastSent = at;
        jobs.setProgress(job.id, Math.min(percent, PROGRESS_CEILING)).catch((error) => {
          console.error(`Progress of job ${job.id} could not be saved.`, error);
        });
      },
    });
    if (outcome.status === "cancelled") {
      console.warn(`Job ${job.id} was interrupted by the shutdown; it will be taken back later.`);
      return;
    }
    return outcome.status === "succeeded"
      ? settle(job, "succeeded")
      : settle(job, "abandoned", outcome.reason.slice(0, MAX_ERROR_LENGTH));
  }

  async function handle(job: Job): Promise<void> {
    try {
      await deepJob(job);
    } catch (error) {
      if (stopping) {
        console.error(`Job ${job.id} was interrupted by the shutdown.`, error);
        return;
      }
      const message = describeError(error);
      console.error(`Job ${job.id} failed (attempt ${job.attempts}): ${message}`);
      await jobs.fail(job.id, message);
    }
  }

  async function run(): Promise<void> {
    await requeueStale();
    while (!stopping) {
      let job: Job | null = null;
      try {
        job = await jobs.reserve("deep");
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
