import { EXPLANATION_ID_PATTERN, getContainer } from "@/server/container";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";
import type { ExplanationRecord } from "@/server/pipeline/ports";
import { readDeepVersion, type DeepVersion } from "@/server/deep";
import { loadReferenceRecord } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

async function deepOf(record: ExplanationRecord): Promise<DeepVersion> {
  try {
    return await readDeepVersion(record);
  } catch (error) {
    console.error(`The deep version of explanation ${record.id} could not be read.`, error);
    return { status: "none", result_url: null };
  }
}

async function describe(record: ExplanationRecord): Promise<Response> {
  const deep = await deepOf(record);
  return Response.json(
    {
      id: record.id,
      kind: record.kind,
      question: record.kind === "reference" ? record.question : null,
      parent_id: record.parent_id,
      root_id: record.root_id,
      status: record.status,
      language: record.language,
      level: record.level,
      title: record.title,
      subject: record.subject,
      concept_slug: record.concept_slug,
      payload: record.payload,
      verdicts: record.verdicts,
      scene_count_planned: record.scene_count_planned,
      provider: record.provider,
      model: record.model,
      timings: record.timings,
      deep,
      export: { status: "none" },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const language = requestLanguage(request);
  try {
    const { id } = await params;
    if (!EXPLANATION_ID_PATTERN.test(id)) return errorResponse("not_found", language);

    const reference = await loadReferenceRecord(id);
    if (reference) return await describe(reference);

    const { store } = getContainer();
    const record = await store.get(id);
    if (!record) {
      return errorResponse((await store.isExpired(id)) ? "expired" : "not_found", language);
    }
    return await describe(record);
  } catch (error) {
    return internalError(error, language);
  }
}
