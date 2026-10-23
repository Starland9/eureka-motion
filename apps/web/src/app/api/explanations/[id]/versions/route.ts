import { EXPLANATION_ID_PATTERN, getContainer } from "@/server/container";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";
import type { ExplanationRecord, ExplanationStatus } from "@/server/pipeline/ports";
import { loadReferenceRecord } from "@/server/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

const NEVER_PLAYABLE = new Set<ExplanationStatus>(["failed", "refused", "needs_clarification"]);

function sceneTitle(record: ExplanationRecord, session: ExplanationRecord[]): string | null {
  if (record.kind !== "zoom") return null;
  const parent = session.find(({ id }) => id === record.parent_id);
  return parent?.payload.scenes.find(({ id }) => id === record.focus_scene_id)?.title ?? null;
}

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const language = requestLanguage(request);
  try {
    const { id } = await params;
    if (!EXPLANATION_ID_PATTERN.test(id)) return errorResponse("not_found", language);

    const { store } = getContainer();
    const reference = await loadReferenceRecord(id);
    const record = reference ?? (await store.get(id));
    if (!record) {
      return errorResponse((await store.isExpired(id)) ? "expired" : "not_found", language);
    }

    // A reference has no row until its first derived version is written.
    const stored = await store.listByRoot(record.root_id);
    const session = reference ? [reference, ...stored.filter((row) => row.id !== id)] : stored;

    return Response.json(
      session
        .filter(({ status }) => !NEVER_PLAYABLE.has(status))
        .map((version) => ({
          id: version.id,
          kind: version.kind,
          title: version.title,
          created_at: version.created_at,
          scene_title: sceneTitle(version, session),
        })),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalError(error, language);
  }
}
