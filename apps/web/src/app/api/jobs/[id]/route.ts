import { getJobs } from "@/server/container";
import type { JobStatus } from "@/server/db";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The contract has four states; a deep version that was given up on reads as a failure.
function publicStatus(status: JobStatus): "queued" | "running" | "succeeded" | "failed" {
  return status === "abandoned" ? "failed" : status;
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const language = requestLanguage(request);
  try {
    const { id } = await params;
    if (!JOB_ID_PATTERN.test(id)) return errorResponse("not_found", language);

    const job = await getJobs().get(id);
    if (!job) return errorResponse("not_found", language);

    return Response.json(
      {
        id: job.id,
        type: job.type,
        status: publicStatus(job.status),
        progress: job.progress,
        result_url: job.status === "succeeded" ? job.result_url : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalError(error, language);
  }
}
