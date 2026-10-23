export const POLL_MS = 2000;
export const BUSY_AFTER_MS = 90_000;
export const MAX_POLL_FAILURES = 3;
export const ANNOUNCE_STEP = 25;

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface JobView {
  status: JobStatus;
  progress: number;
  resultUrl: string | null;
}

export type Problem =
  | { code: "failed" | "lost" | "notReady" | "unreachable" }
  | { code: "rateLimited"; retryAfterSeconds?: number };

export type Submission =
  { kind: "job"; jobId: string; status: JobStatus } | { kind: "problem"; problem: Problem };

export type JobRead = { kind: "job"; job: JobView } | { kind: "gone" } | { kind: "retry" };

const STATUSES: readonly JobStatus[] = ["queued", "running", "succeeded", "failed"];

const isStatus = (value: unknown): value is JobStatus =>
  STATUSES.some((status) => status === value);

export function parseSubmission(value: unknown): { jobId: string; status: JobStatus } | null {
  if (typeof value !== "object" || value === null) return null;
  const { job_id, status } = value as Record<string, unknown>;
  return typeof job_id === "string" && job_id !== "" && isStatus(status)
    ? { jobId: job_id, status }
    : null;
}

export function parseJob(value: unknown): JobView | null {
  if (typeof value !== "object" || value === null) return null;
  const { status, progress, result_url } = value as Record<string, unknown>;
  if (!isStatus(status)) return null;
  return {
    status,
    progress: typeof progress === "number" && Number.isFinite(progress) ? progress : 0,
    resultUrl: typeof result_url === "string" && result_url !== "" ? result_url : null,
  };
}

export function percentOf(progress: number): number {
  return Math.round(Math.min(100, Math.max(0, progress)));
}

export function announcedPercent(progress: number): number {
  return Math.floor(percentOf(progress) / ANNOUNCE_STEP) * ANNOUNCE_STEP;
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function exportFilename(title: string, fallback: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? fallback : slug}.mp4`;
}

export async function submitExport(
  explanationId: string,
  signal: AbortSignal,
): Promise<Submission> {
  let response: Response;
  try {
    response = await fetch(`/api/explanations/${encodeURIComponent(explanationId)}/export`, {
      method: "POST",
      cache: "no-store",
      signal,
    });
  } catch {
    return { kind: "problem", problem: { code: "unreachable" } };
  }
  if (response.status === 409) return { kind: "problem", problem: { code: "notReady" } };
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
    return {
      kind: "problem",
      problem: {
        code: "rateLimited",
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      },
    };
  }
  const submission = response.ok ? parseSubmission(await readJson(response)) : null;
  return submission === null
    ? { kind: "problem", problem: { code: "failed" } }
    : { kind: "job", ...submission };
}

export async function readJob(jobId: string, signal: AbortSignal): Promise<JobRead> {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal,
    });
    if (response.status === 404) return { kind: "gone" };
    const job = response.ok ? parseJob(await readJson(response)) : null;
    return job === null ? { kind: "retry" } : { kind: "job", job };
  } catch {
    return { kind: "retry" };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
