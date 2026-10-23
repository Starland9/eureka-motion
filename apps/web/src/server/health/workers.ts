import { readFile } from "node:fs/promises";
import path from "node:path";
import { getMediaDir } from "../media";

const HEARTBEAT_FILE = path.join(".health", "worker.json");
const HEARTBEAT_MAX_AGE_MS = 60_000;

export interface WorkerHealth {
  render_worker: boolean;
  deep_worker: boolean;
}

const DOWN: WorkerHealth = { render_worker: false, deep_worker: false };

// An ISO date, or a number of seconds (as the sandbox heartbeat) or of milliseconds.
function beatTime(value: unknown): number {
  if (typeof value === "string") return Date.parse(value);
  if (typeof value === "number") return value > 1e11 ? value : value * 1000;
  return Number.NaN;
}

function isFresh(value: unknown, now: number): boolean {
  const at = beatTime(value);
  return Number.isFinite(at) && now - at <= HEARTBEAT_MAX_AGE_MS;
}

export async function readWorkerHealth(
  mediaDir: string = getMediaDir(),
  now: number = Date.now(),
): Promise<WorkerHealth> {
  try {
    const beat: unknown = JSON.parse(await readFile(path.join(mediaDir, HEARTBEAT_FILE), "utf8"));
    if (typeof beat !== "object" || beat === null) return DOWN;
    const { render_at, deep_at } = beat as Record<string, unknown>;
    return { render_worker: isFresh(render_at, now), deep_worker: isFresh(deep_at, now) };
  } catch {
    return DOWN;
  }
}
