import { DocumentSchema } from "scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import type { PipelineEvent, SequencedEvent } from "../../src/server/pipeline/events";
import {
  encodeEvent,
  KEEP_ALIVE_MS,
  replaySource,
  sseResponse,
  type EventSource,
} from "../../src/server/http/sse";
import { eventsIn, parseSse, sseReader, toPipelineEvent } from "../helpers/sse";

const document = DocumentSchema.parse(reference.payload);
const scene = document.scenes[0]!;
const quiz = document.quiz!;

const verdict = {
  target: "s1",
  status: "validated" as const,
  attempts: 1,
  reason: "Validée dès la première écriture.",
  checks: ["structure", "references"],
};

const EVERY_EVENT: PipelineEvent[] = [
  { type: "accepted", explanation_id: "kkkkkkkkkkk2", cached: false },
  { type: "step", name: "verify_plan", status: "started" },
  {
    type: "clarify",
    reason: "Mercure désigne une planète et un élément.",
    interpretations: [{ label: "La planète", question: "Comment est faite la planète Mercure ?" }],
  },
  { type: "refused", reason: "Je explique des notions du programme." },
  { type: "redirected", reason: "unrelated_followup" },
  { type: "cached", explanation_id: "kkkkkkkkkkk3" },
  {
    type: "meta",
    title: reference.title,
    subject: "physics",
    concept_slug: reference.slug,
    deep_eligible: false,
    detected_language: "fr",
  },
  {
    type: "plan",
    plan: document.plan,
    params: document.params,
    model: document.model,
    scene_count: 6,
  },
  { type: "verdict", ...verdict },
  { type: "scene", index: 0, scene },
  { type: "scene_dropped", index: 2 },
  { type: "quiz", quiz },
  { type: "deep", status: "queued" },
  { type: "done", status: "ready", share_url: "/fr/e/kkkkkkkkkkk2" },
  { type: "error", code: "generation_failed", message: 'Une erreur « bizarre » : "x" ✓' },
];

const step = (seq: number): SequencedEvent => ({
  seq,
  event: { type: "step", name: "scenes", status: "started" },
});
const done = (seq: number): SequencedEvent => ({
  seq,
  event: { type: "done", status: "ready", share_url: "/fr/e/kkkkkkkkkkk2" },
});

interface Gate {
  source: EventSource;
  push(item: SequencedEvent): void;
  fail(error: Error): void;
  readonly started: boolean;
  readonly cleaned: boolean;
  readonly signal: AbortSignal | undefined;
}

function gatedSource(): Gate {
  const queue: SequencedEvent[] = [];
  let wake: (() => void) | undefined;
  let failure: Error | undefined;
  const state: { started: boolean; cleaned: boolean; signal: AbortSignal | undefined } = {
    started: false,
    cleaned: false,
    signal: undefined,
  };
  async function* source(signal: AbortSignal): AsyncGenerator<SequencedEvent> {
    state.started = true;
    state.signal = signal;
    try {
      for (;;) {
        if (failure) throw failure;
        while (queue.length > 0) yield queue.shift() as SequencedEvent;
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    } finally {
      state.cleaned = true;
    }
  }
  return {
    source,
    push(item) {
      queue.push(item);
      wake?.();
    },
    fail(error) {
      failure = error;
      wake?.();
    },
    get started() {
      return state.started;
    },
    get cleaned() {
      return state.cleaned;
    },
    get signal() {
      return state.signal;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("encodeEvent", () => {
  it("writes the id, the event name and the data of the event without its type", () => {
    expect(encodeEvent({ seq: 7, event: { type: "step", name: "plan", status: "started" } })).toBe(
      'id: 7\nevent: step\ndata: {"name":"plan","status":"started"}\n\n',
    );
    expect(encodeEvent({ seq: 1, event: { type: "deep", status: "queued" } })).toBe(
      'id: 1\nevent: deep\ndata: {"status":"queued"}\n\n',
    );
  });

  it("keeps the data on one line whatever the text contains", () => {
    const reason = "ligne un\nligne deux\r\nligne trois\rfin  ";
    const encoded = encodeEvent({ seq: 3, event: { type: "refused", reason } });
    expect(encoded.split("\n")).toHaveLength(5);
    expect(encoded).not.toContain("\r");
    expect(encoded.split("\n").filter((line) => line.startsWith("data:"))).toHaveLength(1);
    const [message] = parseSse(encoded);
    expect(message).toMatchObject({ kind: "event", id: 3, type: "refused", data: { reason } });
  });

  it("round-trips every event of the contract through the test parser", () => {
    const items = EVERY_EVENT.map((event, index) => ({ seq: index + 1, event }));
    const parsed = eventsIn(parseSse(items.map(encodeEvent).join("")));
    expect(parsed.map((message) => message.id)).toEqual(items.map((item) => item.seq));
    expect(parsed.map(toPipelineEvent)).toEqual(EVERY_EVENT);
    expect(parsed.every((message) => !("type" in message.data))).toBe(true);
  });

  it("is read back with a keep-alive comment between two events", () => {
    const text = `${encodeEvent(step(1))}: keep-alive\n\n${encodeEvent(done(2))}`;
    expect(parseSse(text).map((message) => message.kind)).toEqual(["event", "comment", "event"]);
  });

  it("is parsed like any event stream: several data lines are joined by a line feed", () => {
    const [message] = parseSse('id: 4\nevent: refused\ndata: {"reason":\ndata: "a"}\n\n');
    expect(message).toMatchObject({ id: 4, type: "refused", data: { reason: "a" } });
  });
});

describe("replaySource", () => {
  const events: PipelineEvent[] = [
    { type: "accepted", explanation_id: "kkkkkkkkkkk2", cached: true },
    { type: "step", name: "scenes", status: "started" },
    { type: "done", status: "ready", share_url: "/fr/e/kkkkkkkkkkk2" },
  ];

  async function collect(after?: number): Promise<SequencedEvent[]> {
    const items: SequencedEvent[] = [];
    for await (const item of replaySource(events, after)) items.push(item);
    return items;
  }

  it("numbers the events from 1", async () => {
    expect((await collect()).map((item) => item.seq)).toEqual([1, 2, 3]);
    expect((await collect(0)).map((item) => item.event)).toEqual(events);
  });

  it("keeps only the events after the given sequence number", async () => {
    expect(await collect(1)).toEqual([
      { seq: 2, event: events[1] },
      { seq: 3, event: events[2] },
    ]);
    expect(await collect(3)).toEqual([]);
    expect(await collect(99)).toEqual([]);
  });
});

describe("sseResponse", () => {
  it("answers with the event stream headers", () => {
    const gate = gatedSource();
    const response = sseResponse(gate.source, new AbortController().signal);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("connection")).toBe("keep-alive");
    void response.body?.cancel();
  });

  it("writes each event as it arrives, in the wire format", async () => {
    const gate = gatedSource();
    const reader = sseReader(sseResponse(gate.source, new AbortController().signal));
    gate.push(step(1));
    expect(await reader.next()).toEqual({
      kind: "event",
      id: 1,
      type: "step",
      data: { name: "scenes", status: "started" },
    });
    gate.push(step(2));
    expect(await reader.next()).toMatchObject({ id: 2 });
    await reader.cancel();
  });

  it("closes after a terminal event and releases the source", async () => {
    const gate = gatedSource();
    const response = sseResponse(gate.source, new AbortController().signal);
    gate.push(step(1));
    gate.push(done(2));
    gate.push(step(3));
    const messages = eventsIn(await sseReader(response).rest());
    expect(messages.map((message) => message.type)).toEqual(["step", "done"]);
    expect(gate.cleaned).toBe(true);
    expect(gate.signal?.aborted).toBe(true);
  });

  it.each(["clarify", "refused", "cached", "error"] as const)(
    "closes after the %s event",
    async (type) => {
      const gate = gatedSource();
      const event = EVERY_EVENT.find((candidate) => candidate.type === type) as PipelineEvent;
      gate.push({ seq: 1, event });
      gate.push(step(2));
      const messages = eventsIn(
        await sseReader(sseResponse(gate.source, new AbortController().signal)).rest(),
      );
      expect(messages.map((message) => message.type)).toEqual([type]);
    },
  );

  it("sends a keep-alive comment every 15 seconds while the stream is open", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    expect(KEEP_ALIVE_MS).toBe(15_000);
    const gate = gatedSource();
    const response = sseResponse(gate.source, new AbortController().signal);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const received: string[] = [];
    const pump = (async () => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        received.push(decoder.decode(chunk.value));
      }
    })();

    await vi.advanceTimersByTimeAsync(14_999);
    expect(received).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(received).toEqual([": keep-alive\n\n"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(received).toEqual([": keep-alive\n\n", ": keep-alive\n\n"]);

    gate.push(done(1));
    await pump;
    expect(received.at(-1)).toBe(encodeEvent(done(1)));
    const count = received.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(received).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the source and the keep-alive timer when the client cancels", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const gate = gatedSource();
    const reader = sseReader(sseResponse(gate.source, new AbortController().signal));
    gate.push(step(1));
    await reader.next();
    expect(vi.getTimerCount()).toBe(1);

    await reader.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.cleaned).toBe(true);
    expect(gate.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the stream and releases everything when the request is aborted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const request = new AbortController();
    const gate = gatedSource();
    const reader = sseReader(sseResponse(gate.source, request.signal));
    gate.push(step(1));
    await reader.next();

    const ending = reader.rest();
    request.abort();
    expect(await ending).toEqual([]);
    expect(gate.cleaned).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("errors the stream, without keeping the timer, when the source fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const gate = gatedSource();
    const reader = sseReader(sseResponse(gate.source, new AbortController().signal));
    const reading = reader.next();
    const rejection = expect(reading).rejects.toThrow("source failed");
    gate.fail(new Error("source failed"));
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(gate.cleaned).toBe(true);
  });

  it("ends at once when the request is already aborted", async () => {
    const request = new AbortController();
    request.abort();
    const gate = gatedSource();
    const messages = await sseReader(sseResponse(gate.source, request.signal)).rest();
    expect(messages).toEqual([]);
    expect(gate.cleaned).toBe(true);
  });
});
