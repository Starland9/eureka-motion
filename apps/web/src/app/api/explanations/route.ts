import { getContainer, sharePath, type Container } from "@/server/container";
import { isGenerationAvailable } from "@/server/http/availability";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";
import { clientAddress, parseCreateRequest, readJson } from "@/server/http/request";
import { replaySource, sseResponse } from "@/server/http/sse";
import { isPlayable, replayEvents } from "@/server/pipeline/replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serveCached(
  { store }: Container,
  id: string,
  signal: AbortSignal,
): Promise<Response | null> {
  const record = await store.get(id);
  if (!record || !isPlayable(record)) return null;
  const events = replayEvents(record, sharePath(id, record.language));
  return sseResponse(() => replaySource(events), signal);
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const language = requestLanguage(request, body);
  try {
    const parsed = parseCreateRequest(body);
    if (!parsed.ok) return errorResponse(parsed.code, language);
    const { question, level, interpretation } = parsed.value;
    const container = getContainer();

    const hit = await container.cache.findByQuestion(question, { language, level });
    if (hit) {
      const cached = await serveCached(container, hit, request.signal);
      if (cached) return cached;
    }

    if (!(await isGenerationAvailable())) {
      return errorResponse("generation_unavailable", language, { extra: { references: [] } });
    }

    const allowance = await container.limiter.check(clientAddress(request.headers), "generation");
    if (!allowance.allowed) {
      return errorResponse("rate_limited", language, {
        headers: { "Retry-After": String(allowance.retryAfterSeconds) },
      });
    }

    const started = await container.pipeline.start({ question, language, level, interpretation });
    const { log } = started;
    if (log) return sseResponse((signal) => log.stream(0, signal), request.signal);
    return (
      (await serveCached(container, started.id, request.signal)) ??
      internalError(new Error(`Cached explanation ${started.id} cannot be replayed.`), language)
    );
  } catch (error) {
    return internalError(error, language);
  }
}
