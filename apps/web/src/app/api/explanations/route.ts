import type { Language, Level } from "scene";
import { getContainer, sharePath, type Container } from "@/server/container";
import { generationUnavailableResponse } from "@/server/health/degraded";
import { within } from "@/server/health/timeout";
import { isGenerationAvailable } from "@/server/http/availability";
import { errorResponse, internalError, requestLanguage } from "@/server/http/errors";
import { clientAddress, parseCreateRequest, readJson } from "@/server/http/request";
import { replaySource, sseResponse } from "@/server/http/sse";
import { isPlayable, replayEvents } from "@/server/pipeline/replay";
import { ParentNotFoundError, type Started } from "@/server/pipeline/run";

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

async function fromCache(
  request: Request,
  question: string,
  language: Language,
  level: Level,
): Promise<Response | null> {
  const container = getContainer();
  const hit = await container.cache.findByQuestion(question, { language, level });
  return hit ? serveCached(container, hit, request.signal) : null;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const language = requestLanguage(request, body);
  try {
    const parsed = parseCreateRequest(body);
    if (!parsed.ok) return errorResponse(parsed.code, language);
    const create = parsed.value;

    // The references need no database: a failed lookup must not hide an unavailable generation.
    let lookupFailure: { error: unknown } | null = null;
    if (create.mode === "initial") {
      try {
        const cached = await within(fromCache(request, create.question, language, create.level));
        if (cached) return cached;
      } catch (error) {
        lookupFailure = { error };
      }
    }

    if (!(await isGenerationAvailable())) return generationUnavailableResponse(language);
    if (lookupFailure) throw lookupFailure.error;

    const container = getContainer();

    const allowance = await container.limiter.check(clientAddress(request.headers), "generation");
    if (!allowance.allowed) {
      return errorResponse("rate_limited", language, {
        headers: { "Retry-After": String(allowance.retryAfterSeconds) },
      });
    }

    let started: Started;
    try {
      started = await container.pipeline.start(create);
    } catch (error) {
      if (error instanceof ParentNotFoundError) return errorResponse("parent_not_found", language);
      throw error;
    }
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
