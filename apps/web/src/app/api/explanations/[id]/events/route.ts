import { EXPLANATION_ID_PATTERN, getContainer, sharePath } from "@/server/container";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";
import { parseAfter } from "@/server/http/request";
import { replaySource, sseResponse } from "@/server/http/sse";
import { isPlayable, replayEvents } from "@/server/pipeline/replay";

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
    const after = parseAfter(new URL(request.url).searchParams.get("after"));
    if (after === null) return errorResponse("invalid_request", language);

    const { pipeline, store } = getContainer();
    const log = pipeline.logFor(id);
    if (log) return sseResponse((signal) => log.stream(after, signal), request.signal);

    const record = await store.get(id);
    if (!record) {
      return errorResponse((await store.isExpired(id)) ? "expired" : "not_found", language);
    }
    if (!isPlayable(record)) return errorResponse("not_found", language);
    const events = replayEvents(record, sharePath(id, record.language));
    return sseResponse(() => replaySource(events, after), request.signal);
  } catch (error) {
    return internalError(error, language);
  }
}
