import { DocumentSchema } from "scene";
import { describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import {
  createLevelRequest,
  type LevelRequest,
  type LevelRequestView,
  type LevelSource,
} from "../../src/components/explanation/level-request";
import {
  createExplanationClient,
  type ExplanationClient,
} from "../../src/components/explanation/stream";
import { encodeEvent } from "../../src/server/http/sse";
import type { PipelineEvent, SequencedEvent } from "../../src/server/pipeline/events";

const document = DocumentSchema.parse(reference.payload);
const REF_ID = "3xgqjxv6p8j6";
const NEW_ID = "kkkkkkkkkkk2";
const OTHER_ID = "mmmmmmmmmmm3";
const QUESTION = "la loi de la gravité";
const SOURCE: LevelSource = { question: QUESTION, language: "fr", level: "lycee" };
const encoder = new TextEncoder();

function story(id: string): PipelineEvent[] {
  return [
    { type: "accepted", explanation_id: id, cached: false },
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
    ...document.scenes.map<PipelineEvent>((scene) => ({
      type: "scene",
      index: scene.index,
      scene,
    })),
    { type: "quiz", quiz: document.quiz! },
    { type: "done", status: "ready", share_url: `/fr/e/${id}` },
  ];
}

const ACCEPTED = 1;
const PLAN_AT = 5;
const FIRST_SCENE_AT = 6;

function sequence(events: PipelineEvent[], from = 1): SequencedEvent[] {
  return events.map((event, index) => ({ seq: from + index, event }));
}

function chunk(items: SequencedEvent[]): Uint8Array {
  return encoder.encode(items.map(encodeEvent).join(""));
}

function eventResponse(items: SequencedEvent[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk(items));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null;
}

type Handler = (call: Call) => Response | Promise<Response>;

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init?.signal ?? null,
    };
    calls.push(call);
    if (call.signal?.aborted) throw abortError();
    return handler(call);
  };
  return { fetch, calls };
}

function clientOver(fetch: typeof globalThis.fetch): ExplanationClient {
  return createExplanationClient({
    fetch,
    wait: async () => undefined,
    interfaceLanguage: () => "fr",
  });
}

function recordResponse(id: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    id,
    kind: "initial",
    question: null,
    language: "fr",
    level: "lycee",
    provider: "simulated",
    model: "sim-1",
    timings: {},
    ...extra,
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): Response {
  return Response.json({ error: { code, message } }, { status, headers });
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
        controller.enqueue(chunk(items));
      } catch {
        // The client aborted this stream.
      }
    },
    close() {
      try {
        controller.close();
      } catch {
        // The client aborted this stream.
      }
    },
  };
}

function until(
  controller: LevelRequest,
  predicate: (view: LevelRequestView) => boolean,
): Promise<LevelRequestView> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (!predicate(controller.getSnapshot())) return;
      unsubscribe();
      resolve(controller.getSnapshot());
    };
    const unsubscribe = controller.subscribe(check);
    check();
  });
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

function levelServer(post: Handler = () => eventResponse(sequence(story(NEW_ID)))) {
  const server = fakeFetch((call) => {
    if (call.method === "POST") return post(call);
    const [, , , id = "", tail = ""] = call.url.split("/");
    if (tail.startsWith("events")) return eventResponse(sequence(story(id)));
    return id === REF_ID
      ? recordResponse(REF_ID, { kind: "reference", question: QUESTION, provider: "reference" })
      : recordResponse(id);
  });
  const controller = createLevelRequest(clientOver(server.fetch));
  const posts = () => server.calls.filter((call) => call.method === "POST");
  const openReference = async (): Promise<ExplanationClient> => {
    const client = clientOver(server.fetch);
    client.open(REF_ID);
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (client.getSnapshot().state?.status === "ready") resolve();
      };
      client.subscribe(check);
      check();
    });
    await settled();
    return client;
  };
  return { ...server, controller, posts, openReference };
}

describe("a reference explanation loaded by the client", () => {
  async function load(record: Record<string, unknown>) {
    const { fetch } = fakeFetch((call) =>
      call.url.includes("/events")
        ? eventResponse(sequence(story(REF_ID)))
        : recordResponse(REF_ID, record),
    );
    const client = clientOver(fetch);
    client.open(REF_ID);
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (client.getSnapshot().state?.status !== "ready") return;
        resolve();
      };
      client.subscribe(check);
      check();
    });
    return client.getSnapshot().state!;
  }

  it("carries its original question", async () => {
    const state = await load({ kind: "reference", question: QUESTION, provider: "reference" });
    expect(state.reference).toEqual({ question: QUESTION });
    expect(state).toMatchObject({ id: REF_ID, language: "fr", level: "lycee", status: "ready" });
  });

  it("carries no question when it was generated, whatever the record says", async () => {
    expect((await load({ kind: "initial", question: null })).reference).toBeNull();
    expect((await load({ kind: "initial", question: QUESTION })).reference).toBeNull();
    expect((await load({ kind: "reference", question: null })).reference).toBeNull();
    expect((await load({ kind: "reference", question: "  " })).reference).toBeNull();
  });
});

describe("createLevelRequest: the request", () => {
  it("posts the question of the reference as a free question, in its language, at the level chosen", async () => {
    const { controller, calls } = levelServer();
    await controller.request("college", SOURCE);

    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/explanations");
    expect(post.headers.get("accept-language")).toBe("fr");
    expect(post.body).toEqual({ question: QUESTION, language: "fr", level: "college" });
  });

  it("uses the language of the explanation, not the one of the interface", async () => {
    const { controller, posts } = levelServer();
    await controller.request("superieur", { question: "gravity", language: "en", level: "lycee" });
    expect(posts()[0]?.body).toEqual({ question: "gravity", language: "en", level: "superieur" });
    expect(posts()[0]?.headers.get("accept-language")).toBe("en");
  });

  it("sends nothing for the level of the reference and stays idle", async () => {
    const { controller, calls } = levelServer();
    await controller.request("lycee", SOURCE);
    expect(calls).toEqual([]);
    expect(controller.getSnapshot()).toEqual({ kind: "idle" });
  });

  it("keeps the preparation in progress when the level of the reference is chosen", async () => {
    let live!: Live;
    const { controller, posts } = levelServer((call) => {
      live = liveStream(call.signal);
      return live.response;
    });
    const pending = controller.request("college", SOURCE);
    live.push(sequence(story(NEW_ID)).slice(0, PLAN_AT));
    await pending;
    const before = await until(
      controller,
      (view) => view.kind === "preparing" && view.total !== null,
    );

    await controller.request("lycee", SOURCE);
    expect(controller.getSnapshot()).toBe(before);
    expect(posts()).toHaveLength(1);
  });

  it("does not ask twice for the level it is already preparing or has prepared", async () => {
    const { controller, posts } = levelServer();
    await controller.request("college", SOURCE);
    await until(controller, (view) => view.kind === "ready");
    await controller.request("college", SOURCE);
    expect(posts()).toHaveLength(1);
  });
});

describe("createLevelRequest: the reference stays as it is", () => {
  it("does not change the state of the explanation being played, nor send it any request", async () => {
    const { controller, posts, calls, openReference } = levelServer();
    const reference = await openReference();
    const shown = reference.getSnapshot();
    const callsBefore = calls.length;
    let notified = 0;
    reference.subscribe(() => {
      notified += 1;
    });

    await controller.request("college", { ...SOURCE, question: shown.state!.reference!.question });
    await until(controller, (view) => view.kind === "ready");
    await controller.request("superieur", SOURCE);
    await until(controller, (view) => view.kind === "ready" && view.level === "superieur");

    expect(posts().map((call) => (call.body as { level: string }).level)).toEqual([
      "college",
      "superieur",
    ]);
    expect(reference.getSnapshot()).toBe(shown);
    expect(reference.getSnapshot().state?.scenes).toHaveLength(document.scenes.length);
    expect(notified).toBe(0);
    expect(
      calls.slice(callsBefore).filter((call) => call.url.includes(`/explanations/${REF_ID}`)),
    ).toEqual([]);
  });

  it("does not change it either while the preparation runs and when it is refused", async () => {
    let refuse = false;
    const { controller, openReference } = levelServer(() =>
      refuse
        ? errorResponse(503, "generation_unavailable", "Indisponible")
        : eventResponse(sequence(story(NEW_ID).slice(0, FIRST_SCENE_AT))),
    );
    const reference = await openReference();
    const shown = reference.getSnapshot();

    await controller.request("college", SOURCE);
    await until(controller, (view) => view.kind === "preparing" && view.done === 1);
    expect(reference.getSnapshot()).toBe(shown);

    refuse = true;
    await controller.request("superieur", SOURCE);
    expect(controller.getSnapshot().kind).toBe("rejected");
    expect(reference.getSnapshot()).toBe(shown);
  });
});

describe("createLevelRequest: the progress", () => {
  it("goes from preparing to a link as soon as a scene exists, then to ready", async () => {
    let live!: Live;
    const { controller } = levelServer((call) => {
      live = liveStream(call.signal);
      return live.response;
    });
    const events = sequence(story(NEW_ID));
    const pending = controller.request("college", SOURCE);

    expect(controller.getSnapshot()).toEqual({
      kind: "preparing",
      level: "college",
      done: 0,
      total: null,
      openId: null,
    });

    live.push(events.slice(0, ACCEPTED));
    await pending;
    await settled();
    expect(controller.getSnapshot()).toMatchObject({ kind: "preparing", done: 0, openId: null });

    live.push(events.slice(ACCEPTED, PLAN_AT));
    await until(controller, (view) => view.kind === "preparing" && view.total !== null);
    expect(controller.getSnapshot()).toEqual({
      kind: "preparing",
      level: "college",
      done: 0,
      total: document.scenes.length,
      openId: null,
    });

    live.push(events.slice(PLAN_AT, FIRST_SCENE_AT));
    expect(await until(controller, (view) => view.kind === "preparing" && view.done === 1)).toEqual(
      {
        kind: "preparing",
        level: "college",
        done: 1,
        total: document.scenes.length,
        openId: NEW_ID,
      },
    );

    live.push(events.slice(FIRST_SCENE_AT, FIRST_SCENE_AT + 2));
    await until(controller, (view) => view.kind === "preparing" && view.done === 3);

    live.push(events.slice(FIRST_SCENE_AT + 2));
    live.close();
    expect(await until(controller, (view) => view.kind === "ready")).toEqual({
      kind: "ready",
      level: "college",
      openId: NEW_ID,
    });
  });

  it("links to the explanation the triage recognised when it is already prepared", async () => {
    const cached: PipelineEvent[] = [
      { type: "accepted", explanation_id: NEW_ID, cached: false },
      { type: "cached", explanation_id: OTHER_ID },
    ];
    const { controller } = levelServer(() => eventResponse(sequence(cached)));
    await controller.request("college", SOURCE);
    expect(await until(controller, (view) => view.kind === "ready")).toEqual({
      kind: "ready",
      level: "college",
      openId: OTHER_ID,
    });
  });

  it("is ready at once when the explanation comes from the cache", async () => {
    const events = story(NEW_ID);
    events[0] = { type: "accepted", explanation_id: NEW_ID, cached: true };
    const { controller } = levelServer(() => eventResponse(sequence(events)));
    await controller.request("superieur", SOURCE);
    expect(await until(controller, (view) => view.kind === "ready")).toEqual({
      kind: "ready",
      level: "superieur",
      openId: NEW_ID,
    });
  });

  it("keeps the link when the preparation fails after the first scene", async () => {
    const events: PipelineEvent[] = [
      ...story(NEW_ID).slice(0, FIRST_SCENE_AT),
      { type: "error", code: "generation_failed", message: "Raté" },
    ];
    const { controller } = levelServer(() => eventResponse(sequence(events)));
    await controller.request("college", SOURCE);
    expect(await until(controller, (view) => view.kind === "ready")).toMatchObject({
      level: "college",
      openId: NEW_ID,
    });
  });

  it("replaces the first request by the second, whose progress alone is shown", async () => {
    const lives: Live[] = [];
    const { controller, posts } = levelServer((call) => {
      const live = liveStream(call.signal);
      lives.push(live);
      return live.response;
    });
    const first = controller.request("college", SOURCE);
    lives[0]!.push(sequence(story(NEW_ID)).slice(0, FIRST_SCENE_AT));
    await first;
    await until(controller, (view) => view.kind === "preparing" && view.done === 1);

    const second = controller.request("superieur", SOURCE);
    expect(controller.getSnapshot()).toMatchObject({
      kind: "preparing",
      level: "superieur",
      done: 0,
      openId: null,
    });
    lives[1]!.push(sequence(story(OTHER_ID)).slice(0, FIRST_SCENE_AT));
    await second;
    await until(controller, (view) => view.kind === "preparing" && view.done === 1);

    lives[0]!.push(sequence(story(NEW_ID), FIRST_SCENE_AT + 1).slice(0, 2));
    await settled();
    expect(controller.getSnapshot()).toMatchObject({
      level: "superieur",
      done: 1,
      openId: OTHER_ID,
    });
    expect(posts().map((call) => (call.body as { level: string }).level)).toEqual([
      "college",
      "superieur",
    ]);
    expect(posts()[0]?.signal?.aborted).toBe(true);
  });

  it("stops following the preparation when it is aborted", async () => {
    let live!: Live;
    const { controller, posts } = levelServer((call) => {
      live = liveStream(call.signal);
      return live.response;
    });
    const pending = controller.request("college", SOURCE);
    live.push(sequence(story(NEW_ID)).slice(0, ACCEPTED));
    await pending;
    controller.abort();
    expect(posts()[0]?.signal?.aborted).toBe(true);
  });
});

describe("createLevelRequest: the refusals", () => {
  it("reports a rate limit with the time to wait", async () => {
    const { controller } = levelServer(() =>
      errorResponse(429, "rate_limited", "Trop de demandes", { "Retry-After": "42" }),
    );
    await controller.request("college", SOURCE);
    expect(controller.getSnapshot()).toEqual({
      kind: "rejected",
      level: "college",
      rejection: {
        kind: "rejected",
        code: "rate_limited",
        message: "Trop de demandes",
        retryAfterSeconds: 42,
      },
    });
  });

  it("reports an unavailable generation", async () => {
    const { controller } = levelServer(() =>
      errorResponse(503, "generation_unavailable", "Indisponible"),
    );
    await controller.request("superieur", SOURCE);
    expect(controller.getSnapshot()).toMatchObject({
      kind: "rejected",
      level: "superieur",
      rejection: { code: "generation_unavailable" },
    });
  });

  it("reports an unreachable server", async () => {
    const server = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const controller = createLevelRequest(clientOver(server.fetch));
    await controller.request("college", SOURCE);
    expect(controller.getSnapshot()).toMatchObject({
      kind: "rejected",
      rejection: { code: "network", message: "" },
    });
  });

  it("reports a question the platform declines to explain", async () => {
    const events: PipelineEvent[] = [
      { type: "accepted", explanation_id: NEW_ID, cached: false },
      { type: "refused", reason: "Hors programme" },
    ];
    const { controller } = levelServer(() => eventResponse(sequence(events)));
    await controller.request("college", SOURCE);
    expect(await until(controller, (view) => view.kind === "rejected")).toMatchObject({
      rejection: { code: "refused", message: "Hors programme" },
    });
  });

  it("reports a preparation that fails before any scene", async () => {
    const events: PipelineEvent[] = [
      { type: "accepted", explanation_id: NEW_ID, cached: false },
      { type: "error", code: "generation_failed", message: "Raté" },
    ];
    const { controller } = levelServer(() => eventResponse(sequence(events)));
    await controller.request("college", SOURCE);
    expect(await until(controller, (view) => view.kind === "rejected")).toMatchObject({
      rejection: { code: "generation_failed", message: "Raté" },
    });
  });

  it("lets the same level be asked again after a refusal", async () => {
    let refuse = true;
    const { controller, posts } = levelServer(() =>
      refuse
        ? errorResponse(429, "rate_limited", "Trop de demandes", { "Retry-After": "3" })
        : eventResponse(sequence(story(NEW_ID))),
    );
    await controller.request("college", SOURCE);
    expect(controller.getSnapshot().kind).toBe("rejected");

    refuse = false;
    await controller.request("college", SOURCE);
    expect(await until(controller, (view) => view.kind === "ready")).toMatchObject({
      level: "college",
    });
    expect(posts()).toHaveLength(2);
  });

  it("clears the previous refusal as soon as a new request starts", async () => {
    let refuse = true;
    let live!: Live;
    const { controller } = levelServer((call) => {
      if (refuse) return errorResponse(503, "generation_unavailable", "Indisponible");
      live = liveStream(call.signal);
      return live.response;
    });
    await controller.request("college", SOURCE);
    expect(controller.getSnapshot().kind).toBe("rejected");

    refuse = false;
    const pending = controller.request("superieur", SOURCE);
    expect(controller.getSnapshot()).toMatchObject({ kind: "preparing", level: "superieur" });
    live.push(sequence(story(NEW_ID)).slice(0, ACCEPTED));
    await pending;
  });

  it("notifies its subscribers on every change and no longer after unsubscribing", async () => {
    const { controller } = levelServer();
    let notified = 0;
    const unsubscribe = controller.subscribe(() => {
      notified += 1;
    });
    await controller.request("college", SOURCE);
    await until(controller, (view) => view.kind === "ready");
    const seen = notified;
    expect(seen).toBeGreaterThan(1);

    unsubscribe();
    await controller.request("superieur", SOURCE);
    await until(controller, (view) => view.kind === "ready" && view.level === "superieur");
    expect(notified).toBe(seen);
  });
});
