import { stat } from "node:fs/promises";
import { EXPLANATION_ID_PATTERN, getContainer, getJobs } from "@/server/container";
import { exportResultUrl, type Job } from "@/server/db";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";
import { clientAddress } from "@/server/http/request";
import { resolveMediaPath } from "@/server/media";
import { isPlayable } from "@/server/pipeline/replay";
import type { ExplanationRecord, ExplanationStore } from "@/server/pipeline/ports";
import { loadReferenceRecord } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

function describe(job: Job): Response {
  return Response.json(
    { job_id: job.id, status: job.status },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function exportExists(id: string): Promise<boolean> {
  const file = resolveMediaPath([id, "export.mp4"]);
  return file !== null && (await stat(file).catch(() => null))?.isFile() === true;
}

// A job points at an explanation row, and a reference has none until it is stored.
async function keepReference(store: ExplanationStore, record: ExplanationRecord): Promise<void> {
  if (await store.get(record.id)) return;
  try {
    await store.create(record);
  } catch (error) {
    if (!(await store.get(record.id))) throw error;
  }
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const language = requestLanguage(request);
  try {
    const { id } = await params;
    if (!EXPLANATION_ID_PATTERN.test(id)) return errorResponse("not_found", language);

    const { store, limiter } = getContainer();
    let record = await loadReferenceRecord(id);
    if (!record) {
      record = await store.get(id);
      if (!record) {
        return errorResponse((await store.isExpired(id)) ? "expired" : "not_found", language);
      }
    }
    if (!isPlayable(record)) return errorResponse("not_ready", language);
    if (record.kind === "reference") await keepReference(store, record);

    const jobs = getJobs();
    const active = await jobs.findActive(id, "export");
    if (active) return describe(active);

    if (await exportExists(id)) {
      return describe(await jobs.ensureSucceeded(id, "export", exportResultUrl(id)));
    }

    const allowance = await limiter.check(clientAddress(request.headers), "export");
    if (!allowance.allowed) {
      return errorResponse("rate_limited", language, {
        headers: { "Retry-After": String(allowance.retryAfterSeconds) },
      });
    }
    return describe(await jobs.enqueue(id, "export"));
  } catch (error) {
    return internalError(error, language);
  }
}
