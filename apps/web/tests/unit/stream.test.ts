import { DocumentSchema, type Language } from "scene";
import { describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { reduceExplanation } from "../../src/components/explanation/reducer";
import {
  createExplanationClient,
  parseEventStream,
  type ExplanationClient,
  type ExplanationSnapshot,
} from "../../src/components/explanation/stream";
import {
  initialExplanationState,
  type ExplanationState,
} from "../../src/components/explanation/types";
import { encodeEvent } from "../../src/server/http/sse";
import type { PipelineEvent, SequencedEvent } from "../../src/server/pipeline/events";

const document = DocumentSchema.parse(reference.payload);
const ID = "kkkkkkkkkkk2";
const OTHER_ID = "mmmmmmmmmmm3";
const SCENE_INDEXES = document.scenes.map((scene) => scene.index);

const verdict = {
  target: "s1",
  status: "validated" as const,
  attempts: 1,
  reason: "Validée dès la première écriture.",
  checks: ["structure", "references"],
};

const STORY: PipelineEvent[] = [
  { type: "accepted", explanation_id: ID, cached: false },
  { type: "step", name: "triage", status: "started" },
  { type: "step", name: "triage", status: "done" },
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
    scene_count: document.scenes.length,
  },
  ...document.scenes.flatMap<PipelineEvent>((scene) => [
    { type: "verdict", ...verdict, target: scene.id },
    { type: "scene", index: scene.index, scene },
  ]),
  { type: "quiz", quiz: document.quiz! },
  { type: "done", status: "ready", share_url: `/fr/e/${ID}` },
];

const encoder = new TextEncoder();

function sequence(events: PipelineEvent[]): SequencedEvent[] {
  return events.map((event, index) => ({ seq: index + 1, event }));
}

function wire(events: PipelineEvent[]): string {
  return sequence(events).map(encodeEvent).join("");
}

function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function chunked(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) chunks.push(bytes.slice(at, at + size));
  return chunks;
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SequencedEvent[]> {
  const items: SequencedEvent[] = [];
  for await (const item of parseEventStream(body)) items.push(item);
  return items;
}

const TRICKY: PipelineEvent[] = [
  { type: "accepted", explanation_id: ID, cached: false },
  { type: "error", code: "x", message: 'Une erreur « bizarre » : "x" ✓ 日本 😀   fin' },
  { type: "refused", reason: "Ligne un\nligne deux" },
  { type: "done", status: "partial", share_url: "/en/e/abc" },
];

describe("parseEventStream", () => {
  it("gives the same events whatever the chunk size", async () => {
    const bytes = encoder.encode(wire(STORY));
    const expected = sequence(STORY);
    for (const size of [1, 2, 3, 7, 64, 1000, bytes.length]) {
      expect(await collect(bodyOf(chunked(bytes, size)))).toEqual(expected);
    }
  });

  it("gives the same events when the text is cut at any single byte", async () => {
    const bytes = encoder.encode(wire(TRICKY));
    const expected = sequence(TRICKY);
    for (let at = 0; at <= bytes.length; at += 1) {
      const chunks = [bytes.slice(0, at), bytes.slice(at)];
      expect(await collect(bodyOf(chunks))).toEqual(expected);
    }
  });

  it("ignores comment lines, including between the lines of an event", async () => {
    const text =
      ": keep-alive\n\n" +
      'id: 1\n: in the middle\nevent: step\ndata: {"name":"plan","status":"started"}\n\n' +
      ": keep-alive\n\n" +
      'id: 2\nevent: deep\ndata: {"status":"queued"}\n\n';
    const items = await collect(bodyOf(chunked(encoder.encode(text), 5)));
    expect(items).toEqual([
      { seq: 1, event: { type: "step", name: "plan", status: "started" } },
      { seq: 2, event: { type: "deep", status: "queued" } },
    ]);
  });

  it("reads CRLF line breaks, data without a space and data spread on several lines", async () => {
    const text =
      'id: 4\r\nevent: step\r\ndata:{"name":"plan",\r\ndata: "status":"done"}\r\n\r\n' +
      'retry: 3000\r\nid: 5\r\nevent: deep\r\ndata: {"status":"queued"}\r\n\r\n';
    const expected = [
      { seq: 4, event: { type: "step", name: "plan", status: "done" } },
      { seq: 5, event: { type: "deep", status: "queued" } },
    ];
    expect(await collect(bodyOf(chunked(encoder.encode(text), 1)))).toEqual(expected);
    expect(await collect(bodyOf(chunked(encoder.encode(text), 1000)))).toEqual(expected);
  });

  it("drops a last event that was cut before its blank line", async () => {
    const text = wire(TRICKY).slice(0, -1);
    expect(await collect(bodyOf([encoder.encode(text)]))).toEqual(sequence(TRICKY).slice(0, -1));
  });

  it("fails on data that is not JSON, after yielding the events before it", async () => {
    const text = wire(TRICKY.slice(0, 1)) + "id: 2\nevent: step\ndata: {oops\n\n";
    const seen: SequencedEvent[] = [];
    await expect(
      (async () => {
        for await (const item of parseEventStream(bodyOf([encoder.encode(text)]))) seen.push(item);
      })(),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });
});

function fold(events: PipelineEvent[]): ExplanationState {
  return sequence(events).reduce(
    reduceExplanation,
    initialExplanationState({ question: "q", language: "fr", level: "lycee" }),
  );
}

describe("reduceExplanation", () => {
  const fresh = initialExplanationState({ question: "q", language: "fr", level: "lycee" });

  it("records the explanation on accepted", () => {
    const state = fold([{ type: "accepted", explanation_id: ID, cached: true }]);
    expect(state).toMatchObject({ id: ID, cached: true, status: "preparing", lastSeq: 1 });
  });

  it("records the steps", () => {
    const state = fold([
      { type: "step", name: "triage", status: "started" },
      { type: "step", name: "plan", status: "started" },
      { type: "step", name: "triage", status: "done" },
    ]);
    expect(state.steps).toEqual({ triage: "done", plan: "started" });
  });

  it("maps the meta fields to camelCase", () => {
    const state = fold([STORY[3]!]);
    expect(state.meta).toEqual({
      title: reference.title,
      subject: "physics",
      conceptSlug: reference.slug,
      deepEligible: false,
      detectedLanguage: "fr",
    });
  });

  it("records the plan, the parameters, the model and the scene count", () => {
    const state = fold([STORY[4]!]);
    expect(state.plan).toEqual(document.plan);
    expect(state.params).toEqual(document.params);
    expect(state.model).toEqual(document.model);
    expect(state.sceneCount).toBe(document.scenes.length);
  });

  it("replaces the verdict of the same target and appends the others", () => {
    const state = fold([
      { type: "verdict", ...verdict },
      { type: "verdict", ...verdict, target: "s2" },
      { type: "verdict", ...verdict, status: "corrected", attempts: 2 },
    ]);
    expect(state.verdicts.map((item) => [item.target, item.status, item.attempts])).toEqual([
      ["s1", "corrected", 2],
      ["s2", "validated", 1],
    ]);
  });

  it("keeps the scenes sorted by index and moves to streaming", () => {
    const state = fold([
      { type: "scene", index: 2, scene: document.scenes[2]! },
      { type: "scene", index: 0, scene: document.scenes[0]! },
      { type: "scene", index: 1, scene: document.scenes[1]! },
    ]);
    expect(state.scenes.map((scene) => scene.index)).toEqual([0, 1, 2]);
    expect(state.status).toBe("streaming");
  });

  it("stores a scene received twice for the same index once, with the latest content", () => {
    const scene = document.scenes[1]!;
    const state = fold([
      { type: "scene", index: 1, scene },
      { type: "scene", index: 1, scene: { ...scene, title: "Nouvelle version" } },
    ]);
    expect(state.scenes).toHaveLength(1);
    expect(state.scenes[0]?.title).toBe("Nouvelle version");
  });

  it("records a dropped scene once", () => {
    const state = fold([
      { type: "scene_dropped", index: 3 },
      { type: "scene_dropped", index: 3 },
      { type: "scene_dropped", index: 1 },
    ]);
    expect(state.dropped).toEqual([3, 1]);
  });

  it("records the quiz", () => {
    expect(fold([{ type: "quiz", quiz: document.quiz! }]).quiz).toEqual(document.quiz);
  });

  it("moves to clarify with the interpretations", () => {
    const interpretations = [{ label: "La planète", question: "Comment est faite Mercure ?" }];
    const state = fold([{ type: "clarify", reason: "Ambigu", interpretations }]);
    expect(state.status).toBe("clarify");
    expect(state.clarify).toEqual({ reason: "Ambigu", interpretations });
  });

  it("moves to refused with the reason", () => {
    const state = fold([{ type: "refused", reason: "Hors programme" }]);
    expect(state).toMatchObject({ status: "refused", refusal: "Hors programme" });
  });

  it("keeps the status on cached and sets the redirection", () => {
    const state = fold([
      { type: "accepted", explanation_id: ID, cached: false },
      { type: "cached", explanation_id: OTHER_ID },
    ]);
    expect(state).toMatchObject({ status: "preparing", redirectTo: OTHER_ID, id: ID });
  });

  it("finishes on done with the share url", () => {
    const state = fold([{ type: "done", status: "partial", share_url: "/fr/e/x" }]);
    expect(state).toMatchObject({ status: "partial", shareUrl: "/fr/e/x" });
  });

  it("fails on error with its code and message", () => {
    const state = fold([{ type: "error", code: "generation_failed", message: "Raté" }]);
    expect(state).toMatchObject({
      status: "failed",
      error: { code: "generation_failed", message: "Raté" },
    });
  });

  it("only advances the sequence number on an unknown event", () => {
    const state = fold([{ type: "future" } as unknown as PipelineEvent]);
    expect(state).toEqual({ ...fresh, lastSeq: 1 });
  });

  it("starts without a deep version and records its status when the event arrives", () => {
    expect(fresh.deep).toBeNull();
    expect(fold([{ type: "deep", status: "queued" }])).toEqual({
      ...fresh,
      deep: { status: "queued" },
      lastSeq: 1,
    });
  });

  it("follows the status of the deep version and keeps it through the final events", () => {
    const state = fold([
      { type: "deep", status: "queued" },
      { type: "deep", status: "running" },
      { type: "done", status: "ready", share_url: "/fr/e/x" },
    ]);
    expect(state).toMatchObject({ deep: { status: "running" }, status: "ready", lastSeq: 3 });
  });

  it("does not record a deep event that is not newer", () => {
    const state = reduceExplanation(fold([{ type: "deep", status: "running" }]), {
      seq: 1,
      event: { type: "deep", status: "ready" },
    });
    expect(state.deep).toEqual({ status: "running" });
  });

  it("notes that an unrelated follow-up was redirected", () => {
    const state = fold([{ type: "redirected", reason: "unrelated_followup" }]);
    expect(state).toEqual({ ...fresh, redirected: true, lastSeq: 1 });
  });

  it("ignores an item whose sequence number is not newer, and returns the same state", () => {
    const state = reduceExplanation(fresh, { seq: 1, event: STORY[0]! });
    const again = reduceExplanation(state, {
      seq: 1,
      event: { type: "error", code: "late", message: "" },
    });
    const older = reduceExplanation(state, {
      seq: 0,
      event: { type: "error", code: "late", message: "" },
    });
    expect(again).toBe(state);
    expect(older).toBe(state);
    expect(state.status).toBe("preparing");
  });

  it("does not change the state it receives", () => {
    const frozen = structuredClone(fresh);
    reduceExplanation(fresh, { seq: 1, event: STORY[0]! });
    expect(fresh).toEqual(frozen);
  });
});

interface Recorded {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

type Handler = (request: Recorded, signal: AbortSignal | null) => Response | Promise<Response>;

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

interface SetupOptions {
  language?: Language;
  wait?: (ms: number) => Promise<void>;
}

function setup(handler: Handler, { language = "fr", wait }: SetupOptions = {}) {
  const requests: Recorded[] = [];
  const waits: number[] = [];
  const client = createExplanationClient({
    fetch: async (input, init) => {
      const request: Recorded = {
        method: init?.method ?? "GET",
        url: String(input),
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);
      const signal = init?.signal ?? null;
      if (signal?.aborted) throw abortError();
      return handler(request, signal);
    },
    wait:
      wait ??
      (async (ms) => {
        waits.push(ms);
      }),
    interfaceLanguage: () => language,
  });
  return { client, requests, waits };
}

function eventResponse(items: SequencedEvent[], trailing = new Uint8Array()): Response {
  const bytes = encoder.encode(items.map(encodeEvent).join(""));
  const body = bodyOf([bytes, trailing]);
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function serverAfter(events: PipelineEvent[], request: Recorded): Response {
  const after = Number(new URL(request.url, "http://localhost").searchParams.get("after"));
  return eventResponse(sequence(events).filter((item) => item.seq > after));
}

function recordResponse(extra: Record<string, unknown> = {}): Response {
  return Response.json({
    id: ID,
    language: "fr",
    level: "lycee",
    provider: "simulated",
    model: "sim-1",
    timings: { total_ms: 1200, label: "ignored" },
    ...extra,
  });
}

function failingResponse(items: SequencedEvent[]): Response {
  const bytes = encoder.encode(items.map(encodeEvent).join(""));
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.error(new TypeError("network error"));
        else controller.enqueue(bytes);
        sent = true;
      },
    }),
  );
}

function errorResponse(status: number, code: string, headers?: Record<string, string>): Response {
  return Response.json({ error: { code, message: `message ${code}` } }, { status, headers });
}

interface Live {
  response: Response;
  push(items: SequencedEvent[]): void;
  close(): void;
}

function liveStream(signal: AbortSignal | null): Live {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
      signal?.addEventListener("abort", () => started.error(abortError()), { once: true });
    },
  });
  return {
    response: new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    push(items) {
      try {
        controller.enqueue(encoder.encode(items.map(encodeEvent).join("")));
      } catch {
        // The stream was aborted by the client.
      }
    },
    close() {
      try {
        controller.close();
      } catch {
        // The stream was aborted by the client.
      }
    },
  };
}

function until(
  client: ExplanationClient,
  predicate: (snapshot: ExplanationSnapshot) => boolean,
): Promise<ExplanationSnapshot> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (!predicate(client.getSnapshot())) return;
      unsubscribe();
      resolve(client.getSnapshot());
    };
    const unsubscribe = client.subscribe(check);
    check();
  });
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

const REQUEST = { question: "la loi de la gravité", language: "fr", level: "lycee" } as const;

describe("createExplanationClient: start", () => {
  it("posts the question, with the language header, and reduces the whole stream", async () => {
    const { client, requests } = setup((request) =>
      request.method === "POST" ? eventResponse(sequence(STORY)) : recordResponse(),
    );
    const outcome = await client.start({ ...REQUEST, interpretation: "La planète" });
    expect(outcome).toEqual({ kind: "accepted", id: ID });
    const snapshot = await until(client, (current) => current.state?.status === "ready");

    expect(requests[0]).toMatchObject({ method: "POST", url: "/api/explanations" });
    expect(requests[0]?.headers.get("accept-language")).toBe("fr");
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(requests[0]?.body).toEqual({
      question: "la loi de la gravité",
      language: "fr",
      level: "lycee",
      interpretation: "La planète",
    });
    expect(snapshot.startedHere).toBe(true);
    expect(snapshot.state).toMatchObject({
      id: ID,
      question: REQUEST.question,
      status: "ready",
      shareUrl: `/fr/e/${ID}`,
      lastSeq: STORY.length,
    });
    expect(snapshot.state?.scenes.map((scene) => scene.index)).toEqual(SCENE_INDEXES);
    expect(snapshot.state?.quiz).toEqual(document.quiz);
  });

  it("leaves the interpretation out of the body when there is none", async () => {
    const { client, requests } = setup(() => eventResponse(sequence(STORY.slice(0, 1))));
    await client.start(REQUEST);
    expect(requests[0]?.body).toEqual({
      question: REQUEST.question,
      language: "fr",
      level: "lycee",
    });
  });

  it("resolves accepted at the first event, before the stream ends", async () => {
    let live!: Live;
    const { client } = setup((request, signal) => {
      if (request.method !== "POST") return recordResponse();
      live = liveStream(signal);
      return live.response;
    });
    const pending = client.start(REQUEST);
    await settled();
    expect(client.getSnapshot().state?.status).toBe("connecting");

    live.push(sequence(STORY).slice(0, 1));
    expect(await pending).toEqual({ kind: "accepted", id: ID });
    expect(client.getSnapshot().state).toMatchObject({ id: ID, status: "preparing" });

    live.push(sequence(STORY).slice(1, 6));
    await until(client, (snapshot) => snapshot.state?.lastSeq === 6);
    expect(client.getSnapshot().state?.status).toBe("preparing");

    live.push(sequence(STORY).slice(6));
    live.close();
    const snapshot = await until(client, (current) => current.state?.status === "ready");
    expect(snapshot.state?.scenes).toHaveLength(document.scenes.length);
  });

  it("rejects with the code, the message and Retry-After on a 429", async () => {
    const { client, requests } = setup(() =>
      errorResponse(429, "rate_limited", { "Retry-After": "42" }),
    );
    const outcome = await client.start(REQUEST);
    expect(outcome).toStrictEqual({
      kind: "rejected",
      code: "rate_limited",
      message: "message rate_limited",
      retryAfterSeconds: 42,
    });
    expect(client.getSnapshot()).toEqual({ state: null, startedHere: false });
    expect(requests).toHaveLength(1);
  });

  it("rejects without retryAfterSeconds when the header is absent or not a number", async () => {
    const plain = setup(() => errorResponse(503, "generation_unavailable"));
    expect(await plain.client.start(REQUEST)).toStrictEqual({
      kind: "rejected",
      code: "generation_unavailable",
      message: "message generation_unavailable",
    });
    const dated = setup(() =>
      errorResponse(429, "rate_limited", { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }),
    );
    expect(await dated.client.start(REQUEST)).not.toHaveProperty("retryAfterSeconds");
  });

  it("rejects with http_error when the failure body is not the documented shape", async () => {
    const { client } = setup(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await client.start(REQUEST)).toEqual({
      kind: "rejected",
      code: "http_error",
      message: "",
    });
    expect(client.getSnapshot().state).toBeNull();
  });

  it("rejects with network when the request fails before any response", async () => {
    const { client } = setup(() => {
      throw new TypeError("fetch failed");
    });
    expect(await client.start(REQUEST)).toEqual({ kind: "rejected", code: "network", message: "" });
    expect(client.getSnapshot()).toEqual({ state: null, startedHere: false });
  });

  it("rejects with network when the stream ends before the accepted event", async () => {
    const { client, requests } = setup(() => eventResponse([]));
    expect(await client.start(REQUEST)).toEqual({ kind: "rejected", code: "network", message: "" });
    expect(client.getSnapshot().state).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("clears a superseded start and lets only the newer stream write", async () => {
    const lives: Live[] = [];
    const { client } = setup((request, signal) => {
      if (request.method !== "POST") return recordResponse();
      const live = liveStream(signal);
      lives.push(live);
      return live.response;
    });
    const first = client.start(REQUEST);
    lives[0]!.push(sequence(STORY).slice(0, 5));
    expect(await first).toEqual({ kind: "accepted", id: ID });

    const second = client.start({ ...REQUEST, question: "autre question" });
    const replacement = STORY.map((event) =>
      event.type === "accepted" ? { ...event, explanation_id: OTHER_ID } : event,
    );
    lives[1]!.push(sequence(replacement).slice(0, 1));
    expect(await second).toEqual({ kind: "accepted", id: OTHER_ID });

    lives[0]!.push(sequence(STORY).slice(5));
    lives[1]!.push(sequence(replacement).slice(1, 7));
    await until(client, (snapshot) => snapshot.state?.lastSeq === 7);
    await settled();
    const state = client.getSnapshot().state;
    expect(state?.id).toBe(OTHER_ID);
    expect(state?.question).toBe("autre question");
    expect(state?.status).toBe("streaming");
    expect(state?.scenes).toHaveLength(1);
    expect(state?.lastSeq).toBe(7);
  });

  it("resolves superseded for a start replaced before its response arrives", async () => {
    let hang = true;
    const { client } = setup((request, signal) => {
      if (hang) {
        hang = false;
        return new Promise<Response>((_, reject) => {
          signal?.addEventListener("abort", () => reject(abortError()));
        });
      }
      return request.method === "POST" ? eventResponse(sequence(STORY)) : recordResponse();
    });
    const first = client.start(REQUEST);
    const second = client.start(REQUEST);
    expect(await first).toEqual({ kind: "rejected", code: "superseded", message: "" });
    expect(await second).toEqual({ kind: "accepted", id: ID });
    await until(client, (snapshot) => snapshot.state?.status === "ready");
  });

  it("clears the snapshot on reset and ignores what the old stream still sends", async () => {
    let live!: Live;
    const { client } = setup((_, signal) => {
      live = liveStream(signal);
      return live.response;
    });
    const pending = client.start(REQUEST);
    live.push(sequence(STORY).slice(0, 3));
    await pending;
    client.reset();
    expect(client.getSnapshot()).toEqual({ state: null, startedHere: false });
    live.push(sequence(STORY).slice(3, 8));
    await settled();
    expect(client.getSnapshot()).toEqual({ state: null, startedHere: false });
  });

  it("notifies subscribers with a new snapshot on each change only", async () => {
    const { client } = setup(() => eventResponse(sequence(STORY.slice(0, 3))));
    const seen: ExplanationSnapshot[] = [];
    const unsubscribe = client.subscribe(() => seen.push(client.getSnapshot()));
    await client.start(REQUEST);
    await until(client, (snapshot) => snapshot.state?.lastSeq === 3);
    unsubscribe();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(4);
    const before = client.getSnapshot();
    expect(client.getSnapshot()).toBe(before);
  });
});

const WITH_DEEP: PipelineEvent[] = [
  ...STORY.slice(0, -1),
  { type: "deep", status: "queued" },
  STORY.at(-1)!,
];

describe("createExplanationClient: deep version", () => {
  it("keeps the deep status announced by a stream it started", async () => {
    const { client } = setup((request) =>
      request.method === "POST" ? eventResponse(sequence(WITH_DEEP)) : recordResponse(),
    );
    await client.start(REQUEST);
    const { state } = await until(client, (current) => current.state?.status === "ready");
    expect(state?.deep).toEqual({ status: "queued" });
    expect(state?.lastSeq).toBe(WITH_DEEP.length);
  });

  it("keeps the deep status when the stream is cut just before it and resumed", async () => {
    const cut = WITH_DEEP.length - 2;
    const { client, requests } = setup((request) => {
      if (request.method === "POST") return eventResponse(sequence(WITH_DEEP).slice(0, cut));
      if (request.url.includes("/events")) return serverAfter(WITH_DEEP, request);
      return recordResponse();
    });
    await client.start(REQUEST);
    const { state } = await until(client, (current) => current.state?.status === "ready");
    expect(requests[1]?.url).toBe(`/api/explanations/${ID}/events?after=${cut}`);
    expect(state?.deep).toEqual({ status: "queued" });
  });

  it("does not lose the deep status when a resume sends it again", async () => {
    const items = sequence(WITH_DEEP);
    const { client } = setup((request) => {
      if (request.method === "POST") return eventResponse(items.slice(0, -1));
      if (request.url.includes("/events")) return eventResponse(items.slice(-3));
      return recordResponse();
    });
    await client.start(REQUEST);
    const { state } = await until(client, (current) => current.state?.status === "ready");
    expect(state?.deep).toEqual({ status: "queued" });
  });

  it("takes the status the replay of an explanation opened by its link carries", async () => {
    const replay: PipelineEvent[] = [
      ...STORY.slice(0, -1),
      { type: "deep", status: "running" },
      STORY.at(-1)!,
    ];
    const { client } = setup((request) =>
      request.url.includes("/events") ? serverAfter(replay, request) : recordResponse(),
    );
    client.open(ID);
    const { state } = await until(client, (snapshot) => snapshot.state?.status === "ready");
    expect(state?.deep).toEqual({ status: "running" });
  });

  it("leaves the deep status empty when the stream announces none", async () => {
    const { client } = setup((request) =>
      request.url.includes("/events") ? serverAfter(STORY, request) : recordResponse(),
    );
    client.open(ID);
    const { state } = await until(client, (snapshot) => snapshot.state?.status === "ready");
    expect(state?.deep).toBeNull();
  });
});

describe("createExplanationClient: resume", () => {
  it("resumes a stream cut in the middle with ?after=N and ends with the complete state", async () => {
    const CUT = 8;
    const items = sequence(STORY);
    const interrupted = items.slice(CUT, CUT + 1).map(encodeEvent)[0]!;
    const half = encoder.encode(interrupted.slice(0, 25));
    const { client, requests, waits } = setup((request) => {
      if (request.method === "POST") return eventResponse(items.slice(0, CUT), half);
      if (request.url.includes("/events")) return serverAfter(STORY, request);
      return recordResponse();
    });

    expect(await client.start(REQUEST)).toEqual({ kind: "accepted", id: ID });
    const reached = await until(client, (current) => current.state?.status === "ready");
    await settled();
    const snapshot = client.getSnapshot();
    expect(reached.state?.status).toBe("ready");

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST /api/explanations",
      `GET /api/explanations/${ID}/events?after=${CUT}`,
      `GET /api/explanations/${ID}`,
    ]);
    expect(requests[1]?.headers.get("accept-language")).toBe("fr");
    expect(waits).toEqual([500]);
    const state = snapshot.state!;
    expect(state.status).toBe("ready");
    expect(state.lastSeq).toBe(STORY.length);
    expect(state.scenes.map((scene) => scene.index)).toEqual(SCENE_INDEXES);
    expect(state.verdicts).toHaveLength(document.scenes.length);
    expect(state.quiz).toEqual(document.quiz);
    expect(state.error).toBeNull();
  });

  it("applies once the events a server sends again after a resume", async () => {
    const items = sequence(STORY);
    const { client } = setup((request) => {
      if (request.method === "POST") return eventResponse(items.slice(0, 9));
      if (request.url.includes("/events")) return eventResponse(items.slice(4));
      return recordResponse();
    });
    await client.start(REQUEST);
    const { state } = await until(client, (current) => current.state?.status === "ready");
    expect(state?.scenes.map((scene) => scene.index)).toEqual(SCENE_INDEXES);
    expect(state?.verdicts).toHaveLength(document.scenes.length);
    expect(state?.lastSeq).toBe(STORY.length);
  });

  it("resumes after a stream that errors, not only after one that closes", async () => {
    const items = sequence(STORY);
    const { client, requests } = setup((request) => {
      if (request.method === "POST") return failingResponse(items.slice(0, 6));
      return request.url.includes("/events") ? serverAfter(STORY, request) : recordResponse();
    });
    await client.start(REQUEST);
    const { state } = await until(client, (current) => current.state?.status === "ready");
    expect(requests[1]?.url).toBe(`/api/explanations/${ID}/events?after=6`);
    expect(state?.scenes.map((scene) => scene.index)).toEqual(SCENE_INDEXES);
  });

  it("restarts the delay sequence after any event received", async () => {
    const items = sequence(STORY);
    let resumes = 0;
    const { client, waits } = setup((request) => {
      if (request.method === "POST") return eventResponse(items.slice(0, 2));
      if (!request.url.includes("/events")) return recordResponse();
      resumes += 1;
      if (resumes === 1) return eventResponse(items.slice(2, 4));
      if (resumes === 2 || resumes === 3) return errorResponse(503, "unavailable");
      if (resumes === 4) return eventResponse(items.slice(4, 6));
      return serverAfter(STORY, request);
    });
    await client.start(REQUEST);
    await until(client, (snapshot) => snapshot.state?.status === "ready");
    expect(waits).toEqual([500, 500, 1000, 2000, 500]);
  });

  it("fails with connection_lost after five failed resumes, waiting longer each time", async () => {
    const { client, requests, waits } = setup((request) =>
      request.method === "POST"
        ? eventResponse(sequence(STORY).slice(0, 3))
        : errorResponse(503, "x"),
    );
    expect(await client.start(REQUEST)).toEqual({ kind: "accepted", id: ID });
    const { state } = await until(client, (snapshot) => snapshot.state?.status === "failed");

    expect(waits).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(requests).toHaveLength(6);
    expect(requests.slice(1).map((request) => request.url)).toEqual(
      Array(5).fill(`/api/explanations/${ID}/events?after=3`),
    );
    expect(state?.error).toEqual({ code: "connection_lost", message: "" });
    expect(state?.scenes).toEqual([]);
    expect(state?.lastSeq).toBe(3);
  });

  it("counts network errors on resume as failed attempts", async () => {
    const { client, waits } = setup((request) => {
      if (request.method === "POST") return eventResponse(sequence(STORY).slice(0, 2));
      throw new TypeError("fetch failed");
    });
    await client.start(REQUEST);
    const { state } = await until(client, (snapshot) => snapshot.state?.status === "failed");
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(state?.error?.code).toBe("connection_lost");
  });

  it("stops resuming once reset is called", async () => {
    const { client, requests } = setup(() => eventResponse(sequence(STORY).slice(0, 3)), {
      wait: () => new Promise(() => undefined),
    });
    await client.start(REQUEST);
    await settled();
    client.reset();
    await settled();
    expect(client.getSnapshot()).toEqual({ state: null, startedHere: false });
    expect(requests).toHaveLength(1);
  });

  it("does not resume a stream that ended on a terminal event", async () => {
    const terminals: PipelineEvent[][] = [
      [STORY[0]!, { type: "refused", reason: "Hors programme" }],
      [STORY[0]!, { type: "clarify", reason: "Ambigu", interpretations: [] }],
      [STORY[0]!, { type: "error", code: "generation_failed", message: "Raté" }],
    ];
    for (const events of terminals) {
      const { client, requests } = setup(() => eventResponse(sequence(events)));
      await client.start(REQUEST);
      await settled();
      expect(requests).toHaveLength(1);
      expect(["refused", "clarify", "failed"]).toContain(client.getSnapshot().state?.status);
    }
  });

  it("copies the generator and timings from the record after done, and survives its failure", async () => {
    const withRecord = setup((request) =>
      request.method === "POST" ? eventResponse(sequence(STORY)) : recordResponse(),
    );
    await withRecord.client.start(REQUEST);
    const { state } = await until(
      withRecord.client,
      (snapshot) => snapshot.state?.generator !== null && snapshot.state?.status === "ready",
    );
    expect(state?.generator).toEqual({ provider: "simulated", model: "sim-1" });
    expect(state?.timings).toEqual({ total_ms: 1200 });
    expect(withRecord.requests.at(-1)?.url).toBe(`/api/explanations/${ID}`);

    const broken = setup((request) =>
      request.method === "POST" ? eventResponse(sequence(STORY)) : errorResponse(500, "internal"),
    );
    await broken.client.start(REQUEST);
    await until(broken.client, (snapshot) => snapshot.state?.status === "ready");
    await settled();
    expect(broken.client.getSnapshot().state).toMatchObject({
      status: "ready",
      generator: null,
      timings: {},
    });
    expect(broken.requests).toHaveLength(2);
  });
});

describe("createExplanationClient: open", () => {
  it("answers missing on a 404 and expired on a 410", async () => {
    const missing = setup(() => errorResponse(404, "not_found"));
    missing.client.open(ID);
    const absent = await until(missing.client, (snapshot) => snapshot.state !== null);
    expect(absent.state).toMatchObject({ id: ID, status: "missing" });
    expect(absent.startedHere).toBe(false);
    expect(missing.requests).toHaveLength(1);

    const expired = setup(() => errorResponse(410, "expired"), { language: "en" });
    expired.client.open(ID);
    const gone = await until(expired.client, (snapshot) => snapshot.state !== null);
    expect(gone.state).toMatchObject({ id: ID, status: "expired" });
    expect(expired.requests[0]?.headers.get("accept-language")).toBe("en");
  });

  it("fails with network when the record cannot be reached", async () => {
    const { client } = setup(() => {
      throw new TypeError("fetch failed");
    });
    client.open(ID);
    const { state } = await until(client, (snapshot) => snapshot.state !== null);
    expect(state).toMatchObject({ id: ID, status: "failed", error: { code: "network" } });
  });

  it("fails with the error of the server on another failure", async () => {
    const { client } = setup(() => errorResponse(500, "internal_error"));
    client.open(ID);
    const { state } = await until(client, (snapshot) => snapshot.state !== null);
    expect(state).toMatchObject({
      status: "failed",
      error: { code: "internal_error", message: "message internal_error" },
    });
  });

  it("loads the record, replays the events from the start and fills the state", async () => {
    const { client, requests } = setup((request) =>
      request.url.includes("/events")
        ? serverAfter(STORY, request)
        : recordResponse({ level: "superieur" }),
    );
    client.open(ID);
    expect(client.getSnapshot()).toEqual({ state: null, startedHere: false });
    const { state, startedHere } = await until(
      client,
      (snapshot) => snapshot.state?.status === "ready",
    );
    await settled();

    expect(requests.map((request) => request.url)).toEqual([
      `/api/explanations/${ID}`,
      `/api/explanations/${ID}/events?after=0`,
      `/api/explanations/${ID}`,
    ]);
    expect(startedHere).toBe(false);
    expect(state).toMatchObject({
      id: ID,
      question: "",
      language: "fr",
      level: "superieur",
      generator: { provider: "simulated", model: "sim-1" },
      timings: { total_ms: 1200 },
    });
    expect(state?.scenes.map((scene) => scene.index)).toEqual(SCENE_INDEXES);
  });

  it("resumes the replay like a live stream when it is cut", async () => {
    let calls = 0;
    const { client, requests, waits } = setup((request) => {
      if (!request.url.includes("/events")) return recordResponse();
      calls += 1;
      return calls === 1 ? eventResponse(sequence(STORY).slice(0, 7)) : serverAfter(STORY, request);
    });
    client.open(ID);
    const { state } = await until(client, (snapshot) => snapshot.state?.status === "ready");
    expect(requests[2]?.url).toBe(`/api/explanations/${ID}/events?after=7`);
    expect(waits).toEqual([500]);
    expect(state?.scenes.map((scene) => scene.index)).toEqual(SCENE_INDEXES);
  });

  it("retries an events request that fails at first, up to five times", async () => {
    const { client, waits } = setup((request) =>
      request.url.includes("/events") ? errorResponse(503, "x") : recordResponse(),
    );
    client.open(ID);
    const { state } = await until(client, (snapshot) => snapshot.state?.status === "failed");
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(state?.error?.code).toBe("connection_lost");
  });

  it("does nothing when the state already has this id", async () => {
    const { client, requests } = setup((request) =>
      request.url.includes("/events") ? serverAfter(STORY, request) : recordResponse(),
    );
    client.open(ID);
    await until(client, (snapshot) => snapshot.state?.status === "ready");
    await settled();
    const calls = requests.length;
    const before = client.getSnapshot();
    client.open(ID);
    await settled();
    expect(requests).toHaveLength(calls);
    expect(client.getSnapshot()).toBe(before);
  });

  it("replaces the explanation when another id is opened, and drops the old stream", async () => {
    let live!: Live;
    const { client } = setup((request, signal) => {
      if (request.method === "POST") {
        live = liveStream(signal);
        return live.response;
      }
      if (request.url.includes(`/${OTHER_ID}`) && request.url.includes("/events")) {
        return eventResponse(
          sequence(
            STORY.map((event) =>
              event.type === "accepted" ? { ...event, explanation_id: OTHER_ID } : event,
            ),
          ),
        );
      }
      return recordResponse({ id: OTHER_ID });
    });
    const pending = client.start(REQUEST);
    live.push(sequence(STORY).slice(0, 5));
    await pending;
    client.open(OTHER_ID);
    live.push(sequence(STORY).slice(5, 9));
    const snapshot = await until(client, (current) => current.state?.status === "ready");
    expect(snapshot.state?.id).toBe(OTHER_ID);
    expect(snapshot.startedHere).toBe(false);
    expect(snapshot.state?.scenes).toHaveLength(document.scenes.length);
  });

  it("keeps startedHere after a cached event and opens the explanation it points to", async () => {
    const cachedStream: PipelineEvent[] = [
      { type: "accepted", explanation_id: ID, cached: false },
      { type: "step", name: "triage", status: "done" },
      { type: "cached", explanation_id: OTHER_ID },
    ];
    const replay = STORY.map((event) =>
      event.type === "accepted" ? { ...event, explanation_id: OTHER_ID, cached: true } : event,
    );
    const { client, requests } = setup((request) => {
      if (request.method === "POST") return eventResponse(sequence(cachedStream));
      if (request.url.includes(`/${OTHER_ID}/events`)) return serverAfter(replay, request);
      return recordResponse({ id: OTHER_ID });
    });

    expect(await client.start(REQUEST)).toEqual({ kind: "accepted", id: ID });
    const redirected = await until(client, (snapshot) => snapshot.state?.redirectTo === OTHER_ID);
    await settled();
    expect(redirected.state?.status).toBe("preparing");
    expect(requests).toHaveLength(1);
    expect(client.getSnapshot().state?.status).toBe("preparing");

    client.open(OTHER_ID);
    const { state, startedHere } = await until(
      client,
      (snapshot) => snapshot.state?.status === "ready",
    );
    expect(startedHere).toBe(true);
    expect(state).toMatchObject({ id: OTHER_ID, cached: true, redirectTo: null });
    expect(state?.scenes.map((scene) => scene.index)).toEqual(SCENE_INDEXES);

    client.open(ID);
    expect(client.getSnapshot().startedHere).toBe(false);
    client.abort();
  });

  it("does not keep startedHere for an id other than the redirection", async () => {
    const { client } = setup((request) =>
      request.method === "POST"
        ? eventResponse(sequence(STORY))
        : request.url.includes("/events")
          ? serverAfter(STORY, request)
          : recordResponse(),
    );
    await client.start(REQUEST);
    await until(client, (snapshot) => snapshot.state?.status === "ready");
    expect(client.getSnapshot().startedHere).toBe(true);
    client.open(OTHER_ID);
    expect(client.getSnapshot()).toEqual({ state: null, startedHere: false });
    client.abort();
  });

  it("abort stops the stream without touching the snapshot", async () => {
    let live!: Live;
    const { client, requests } = setup((_, signal) => {
      live = liveStream(signal);
      return live.response;
    });
    const pending = client.start(REQUEST);
    live.push(sequence(STORY).slice(0, 3));
    await pending;
    const before = client.getSnapshot();
    client.abort();
    live.push(sequence(STORY).slice(3, 6));
    await settled();
    expect(client.getSnapshot()).toBe(before);
    expect(requests).toHaveLength(1);
  });
});
