import { stat } from "node:fs/promises";
import { getJobs } from "./container";
import type { DeepEventStatus } from "./pipeline/events";
import type { ExplanationRecord } from "./pipeline/ports";
import { readWorkerHealth } from "./health/workers";
import { resolveMediaPath } from "./media";

export type DeepStatus = "none" | "queued" | "running" | "ready" | "abandoned";

export interface DeepVersion {
  status: DeepStatus;
  result_url: string | null;
}

const NONE: DeepVersion = { status: "none", result_url: null };

export function deepResultUrl(explanationId: string): string {
  return `/media/${explanationId}/deep.mp4`;
}

async function deepFileExists(explanationId: string): Promise<boolean> {
  const file = resolveMediaPath([explanationId, "deep.mp4"]);
  return file !== null && (await stat(file).catch(() => null))?.isFile() === true;
}

async function readyIfFile(explanationId: string): Promise<DeepVersion> {
  return (await deepFileExists(explanationId))
    ? { status: "ready", result_url: deepResultUrl(explanationId) }
    : NONE;
}

// A reference has no job and no database row: only its file tells.
export async function readDeepVersion(
  record: Pick<ExplanationRecord, "id" | "kind">,
): Promise<DeepVersion> {
  if (record.kind === "reference") return readyIfFile(record.id);

  const job = await getJobs().latest(record.id, "deep");
  if (!job) return NONE;
  switch (job.status) {
    case "queued":
    case "running":
      // Nothing is announced while no worker is there to take the job.
      return (await readWorkerHealth()).render_worker
        ? { status: job.status, result_url: null }
        : NONE;
    case "succeeded":
      return readyIfFile(record.id);
    default:
      return { status: "abandoned", result_url: null };
  }
}

// The replay of an explanation must keep working when the job queue does not answer.
export async function replayDeepStatus(
  record: Pick<ExplanationRecord, "id" | "kind">,
): Promise<DeepEventStatus | null> {
  try {
    const { status } = await readDeepVersion(record);
    return status === "queued" || status === "running" || status === "ready" ? status : null;
  } catch (error) {
    console.error(`The deep version of explanation ${record.id} could not be read.`, error);
    return null;
  }
}
