export const POLL_MS = 10_000;
export const MAX_POLL_FAILURES = 3;

export type DeepStatus = "none" | "queued" | "running" | "ready" | "abandoned";

export type DeepRead =
  { kind: "answer"; status: DeepStatus; resultUrl: string | null } | { kind: "failed" };

const STATUSES: readonly DeepStatus[] = ["none", "queued", "running", "ready", "abandoned"];

export const isDeepStatus = (value: unknown): value is DeepStatus =>
  STATUSES.some((status) => status === value);

export const isPreparing = (status: DeepStatus | null): boolean =>
  status === "queued" || status === "running";

export function parseDeep(value: unknown): { status: DeepStatus; resultUrl: string | null } | null {
  if (typeof value !== "object" || value === null) return null;
  const { status, result_url } = value as Record<string, unknown>;
  if (!isDeepStatus(status)) return null;
  return {
    status,
    resultUrl: typeof result_url === "string" && result_url !== "" ? result_url : null,
  };
}

export async function readDeep(explanationId: string, signal: AbortSignal): Promise<DeepRead> {
  try {
    const response = await fetch(`/api/explanations/${encodeURIComponent(explanationId)}/deep`, {
      cache: "no-store",
      signal,
    });
    if (response.status === 404 || response.status === 410) {
      return { kind: "answer", status: "none", resultUrl: null };
    }
    const answer = response.ok ? parseDeep(await response.json()) : null;
    return answer === null ? { kind: "failed" } : { kind: "answer", ...answer };
  } catch {
    return { kind: "failed" };
  }
}
