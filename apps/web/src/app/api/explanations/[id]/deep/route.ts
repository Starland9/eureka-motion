import { EXPLANATION_ID_PATTERN, getContainer } from "@/server/container";
import { readDeepVersion } from "@/server/deep";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";
import { loadReferenceRecord } from "@/server/reference";

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

    let record = await loadReferenceRecord(id);
    if (!record) {
      const { store } = getContainer();
      record = await store.get(id);
      if (!record) {
        return errorResponse((await store.isExpired(id)) ? "expired" : "not_found", language);
      }
    }
    return Response.json(await readDeepVersion(record), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return internalError(error, language);
  }
}
