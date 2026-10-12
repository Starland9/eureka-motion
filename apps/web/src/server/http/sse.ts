import { isTerminal, type PipelineEvent, type SequencedEvent } from "../pipeline/events";

export const KEEP_ALIVE_MS = 15_000;

const KEEP_ALIVE_COMMENT = ": keep-alive\n\n";

const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  Connection: "keep-alive",
};

export type EventSource = (signal: AbortSignal) => AsyncIterable<SequencedEvent>;

// JSON.stringify escapes every line break, so the data field always fits on one line.
export function encodeEvent({ seq, event }: SequencedEvent): string {
  const { type, ...data } = event;
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function* replaySource(
  events: readonly PipelineEvent[],
  after = 0,
): AsyncGenerator<SequencedEvent> {
  for (const [index, event] of events.entries()) {
    if (index + 1 > after) yield { seq: index + 1, event };
  }
}

export function sseResponse(
  source: EventSource,
  requestSignal: AbortSignal,
  keepAliveMs = KEEP_ALIVE_MS,
): Response {
  const encoder = new TextEncoder();
  const stop = new AbortController();
  const iterator = source(AbortSignal.any([requestSignal, stop.signal]))[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setInterval> | undefined;
  let finished = false;

  // Frees the subscription and the timer; true only the first time.
  const release = (): boolean => {
    if (finished) return false;
    finished = true;
    clearInterval(timer);
    stop.abort();
    iterator.return?.().catch(() => undefined);
    return true;
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(
        () => controller.enqueue(encoder.encode(KEEP_ALIVE_COMMENT)),
        keepAliveMs,
      );
      requestSignal.addEventListener("abort", () => release() && controller.close(), {
        once: true,
      });
    },
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (finished) return;
        if (!next.done) {
          controller.enqueue(encoder.encode(encodeEvent(next.value)));
          if (!isTerminal(next.value.event)) return;
        }
        release();
        controller.close();
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    cancel() {
      release();
    },
  });

  return new Response(body, { headers: HEADERS });
}
