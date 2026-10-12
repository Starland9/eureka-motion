import { EXPLANATION_ID_PATTERN, getContainer } from "@/server/container";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const language = requestLanguage(request);
  try {
    const { id } = await params;
    if (!EXPLANATION_ID_PATTERN.test(id)) return errorResponse("not_found", language);

    const { store } = getContainer();
    const record = await store.get(id);
    if (!record) {
      return errorResponse((await store.isExpired(id)) ? "expired" : "not_found", language);
    }

    return Response.json(
      {
        id: record.id,
        kind: record.kind,
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
        deep: { status: "none" },
        export: { status: "none" },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalError(error, language);
  }
}
