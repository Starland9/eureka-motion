export const POLL_MS = 10_000;
export const MAX_POLL_FAILURES = 3;
export const TICK_MS = 1000;

export type DeepStatus = "none" | "queued" | "running" | "ready" | "abandoned";
export type DeepPhase = "queued" | "running";

export interface DeepAnswer {
  status: DeepStatus;
  resultUrl: string | null;
  queuedAt: number | null;
  startedAt: number | null;
}

export type DeepRead = ({ kind: "answer" } & DeepAnswer) | { kind: "failed" };

const STATUSES: readonly DeepStatus[] = ["none", "queued", "running", "ready", "abandoned"];

export const isDeepStatus = (value: unknown): value is DeepStatus =>
  STATUSES.some((status) => status === value);

export const isPreparing = (status: DeepStatus | null): status is DeepPhase =>
  status === "queued" || status === "running";

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function elapsedSeconds(since: number, now: number): number {
  return Math.max(0, Math.floor((now - since) / 1000));
}

export function parseDeep(value: unknown): DeepAnswer | null {
  if (typeof value !== "object" || value === null) return null;
  const { status, result_url, queued_at, started_at } = value as Record<string, unknown>;
  if (!isDeepStatus(status)) return null;
  return {
    status,
    resultUrl: typeof result_url === "string" && result_url !== "" ? result_url : null,
    queuedAt: parseTime(queued_at),
    startedAt: parseTime(started_at),
  };
}

export async function readDeep(explanationId: string, signal: AbortSignal): Promise<DeepRead> {
  try {
    const response = await fetch(`/api/explanations/${encodeURIComponent(explanationId)}/deep`, {
      cache: "no-store",
      signal,
    });
    if (response.status === 404 || response.status === 410) {
      return { kind: "answer", status: "none", resultUrl: null, queuedAt: null, startedAt: null };
    }
    const answer = response.ok ? parseDeep(await response.json()) : null;
    return answer === null ? { kind: "failed" } : { kind: "answer", ...answer };
  } catch {
    return { kind: "failed" };
  }
}
