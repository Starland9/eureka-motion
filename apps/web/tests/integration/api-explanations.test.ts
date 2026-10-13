import { DocumentSchema, typesetTexts, type Scene } from "scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { POST } from "../../src/app/api/explanations/route";
import { GET as getEvents } from "../../src/app/api/explanations/[id]/events/route";
import { GET as getExplanation } from "../../src/app/api/explanations/[id]/route";
import type { RateLimiter, RateLimitKind, RateLimitResult } from "../../src/server/db/rate-limit";
import { setContainerForTests, sharePath, type Container } from "../../src/server/container";
import { errorMessage, type ErrorCode } from "../../src/server/http/errors";
import { resetGenerationAvailability } from "../../src/server/http/availability";
import { createFixtureProvider, type Scenario } from "../../src/server/llm";
import { EventLogRegistry, type EventLog } from "../../src/server/pipeline/events";
import { Pipeline } from "../../src/server/pipeline/run";
import {
  FakeVoice,
  MemoryCache,
  MemoryStore,
  spyOn,
  steppingClock,
  type LlmSpy,
} from "../helpers/fakes";
import { scenarioFromReference } from "../helpers/scenario";
import { eventsIn, readSse, sseReader, type SseEvent } from "../helpers/sse";

const llm = vi.hoisted(() => ({
  health: vi.fn<() => Promise<{ ok: boolean; latencyMs: number }>>(),
}));

vi.mock("../../src/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/llm")>()),
  getLlm: () => ({ health: llm.health }),
}));

const document = typesetTexts(DocumentSchema.parse(reference.payload), "fr");
const ORIGIN = "http://localhost:3000";
const BODY = { question: reference.question, language: "fr", level: "lycee" } as const;
const SECRET = "connection refused to postgres://admin:hunter2@10.0.0.5:5432/eureka";
const PAST = new Date("2020-01-01T00:00:00.000Z");
// Far enough ahead that a stored explanation never expires during a test.
const CLOCK_START = new Date("2099-01-01T09:00:00.000Z");

const ID = (n: number): string => `kkkkkkkkkkk${n + 1}`;

class ExpiringStore extends MemoryStore {
  readonly reads: string[] = [];

  override async get(id: string) {
    this.reads.push(`get ${id}`);
    return (await super.isExpired(id)) ? null : super.get(id);
  }

  override async isExpired(id: string) {
    this.reads.push(`isExpired ${id}`);
    return super.isExpired(id);
  }
}

class FakeLimiter implements RateLimiter {
  readonly checks: { address: string; kind: RateLimitKind }[] = [];
  result: RateLimitResult = { allowed: true };

  async check(address: string, kind: RateLimitKind): Promise<RateLimitResult> {
    this.checks.push({ address, kind });
    return this.result;
  }
}

class GatedVoice extends FakeVoice {
  private readonly gates = new Map<string, Promise<void>>();

  holdScene(sceneId: string): () => void {
    let release!: () => void;
    this.gates.set(
      sceneId,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }

  override async narrate(explanationId: string, scene: Scene): Promise<Scene> {
    await this.gates.get(scene.id);
    return super.narrate(explanationId, scene);
  }
}

interface Harness {
  container: Container;
  store: ExpiringStore;
  cache: MemoryCache;
  voice: GatedVoice;
  limiter: FakeLimiter;
  llm: LlmSpy;
  restart(): Container;
}

function boot(scenarios: Scenario[] = [scenarioFromReference(reference)]): Harness {
  const store = new ExpiringStore();
  const cache = new MemoryCache();
  const voice = new GatedVoice();
  const limiter = new FakeLimiter();
  const provider = spyOn(createFixtureProvider(scenarios));
  let next = 0;
  const pipelineOn = (logs: EventLogRegistry): Pipeline =>
    new Pipeline(
      {
        llm: provider,
        store,
        cache,
        voice,
        newId: () => ID(++next),
        now: steppingClock(CLOCK_START),
        shareUrl: sharePath,
      },
      logs,
    );
  const assemble = (): Container => {
    const logs = new EventLogRegistry();
    return { pipeline: pipelineOn(logs), store, cache, limiter, logs };
  };
  const harness: Harness = {
    container: assemble(),
    store,
    cache,
    voice,
    limiter,
    llm: provider,
    restart() {
      harness.container = assemble();
      setContainerForTests(harness.container);
      return harness.container;
    },
  };
  setContainerForTests(harness.container);
  return harness;
}

function post(
  body: unknown,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
) {
  return new Request(`${ORIGIN}/api/explanations`, {
    method: "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: init.signal ?? null,
  });
}

function fetchExplanation(id: string, headers: Record<string, string> = {}) {
  return getExplanation(new Request(`${ORIGIN}/api/explanations/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

function fetchEvents(id: string, query = "", headers: Record<string, string> = {}) {
  return getEvents(new Request(`${ORIGIN}/api/explanations/${id}/events${query}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

async function run(body: unknown = BODY, init: Parameters<typeof post>[1] = {}) {
  const response = await POST(post(body, init));
  return { response, events: eventsIn(await readSse(response)) };
}

function label({ type, data }: SseEvent): string {
  switch (type) {
    case "step":
      return `step:${String(data.name)}:${String(data.status)}`;
    case "verdict":
      return `verdict:${String(data.target)}:${String(data.status)}`;
    case "scene":
    case "scene_dropped":
      return `${type}:${String(data.index)}`;
    case "done":
      return `done:${String(data.status)}`;
    case "error":
      return `error:${String(data.code)}`;
    default:
      return type;
  }
}

const SCENE_COUNT = 6;
const indices = Array.from({ length: SCENE_COUNT }, (_, index) => index);
const NOMINAL = [
  "accepted",
  "step:triage:started",
  "step:triage:done",
  "meta",
  "step:plan:started",
  "step:plan:done",
  "step:verify_plan:started",
  "step:verify_plan:done",
  "verdict:plan:validated",
  "plan",
  "step:scenes:started",
  ...indices.flatMap((index) => [`verdict:s${index + 1}:validated`, `scene:${index}`]),
  "step:scenes:done",
  "done:ready",
];
const REPLAYED = [
  "accepted",
  "meta",
  "verdict:plan:validated",
  "plan",
  ...indices.flatMap((index) => [`verdict:s${index + 1}:validated`, `scene:${index}`]),
  "done:ready",
];

async function untilScene(reader: ReturnType<typeof sseReader>, index: number) {
  const seen: SseEvent[] = [];
  for (;;) {
    const batch = eventsIn(await reader.until("scene"));
    seen.push(...batch);
    if (batch.at(-1)?.data.index === index) return seen;
  }
}

async function hold(h: Harness, sceneId = "s3", sceneIndex = 1) {
  const release = h.voice.holdScene(sceneId);
  const controller = new AbortController();
  const response = await POST(post(BODY, { signal: controller.signal }));
  const reader = sseReader(response);
  const seen = await untilScene(reader, sceneIndex);
  return { release, controller, reader, seen, id: ID(1) };
}

interface ExplanationBody {
  id: string;
  status: string;
  payload: { plan: unknown; scenes: { id: string }[] };
  verdicts: { target: string }[];
  scene_count_planned: number | null;
  [key: string]: unknown;
}

const readExplanation = async (response: Response) => (await response.json()) as ExplanationBody;
const readError = async (response: Response) =>
  (await response.json()) as { error: { code: string; message: string } };

// The registry keeps one listener of its own on every log.
function subscribers(log: EventLog | undefined): number {
  return (log as unknown as { listeners: Set<unknown> }).listeners.size - 1;
}

async function finished(h: Harness, id: string, status = "ready"): Promise<void> {
  await vi.waitFor(() => expect(h.store.records.get(id)?.status).toBe(status), {
    interval: 5,
    timeout: 2_000,
  });
}

beforeEach(() => {
  resetGenerationAvailability();
  llm.health.mockReset();
  llm.health.mockResolvedValue({ ok: true, latencyMs: 0 });
});

afterEach(() => {
  setContainerForTests(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/explanations: request validation", () => {
  const valid = { ...BODY };

  it.each<[string, unknown]>([
    ["a body that is not JSON", "{ not json"],
    ["an empty body", ""],
    ["a JSON array", []],
    ["JSON null", "null"],
    ["a JSON string", '"la gravité"'],
    ["a missing question", { language: "fr", level: "lycee" }],
    ["an empty question", { ...valid, question: "" }],
    ["a blank question", { ...valid, question: " \n\t " }],
    ["a question of 501 characters", { ...valid, question: "a".repeat(501) }],
    ["a question that is not a string", { ...valid, question: 42 }],
    ["a missing language", { question: reference.question, level: "lycee" }],
    ["an unknown language", { ...valid, language: "de" }],
    ["an uppercase language", { ...valid, language: "FR" }],
    ["a missing level", { question: reference.question, language: "fr" }],
    ["an unknown level", { ...valid, level: "primaire" }],
    ["an interpretation of 141 characters", { ...valid, interpretation: "i".repeat(141) }],
    ["an interpretation that is not a string", { ...valid, interpretation: 3 }],
    ["a null interpretation", { ...valid, interpretation: null }],
    ["a mode that does not exist", { ...valid, mode: "banana" }],
  ])("answers 400 invalid_request for %s, before any work", async (_name, body) => {
    const h = boot();
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const { error } = await readError(response);
    expect(error.code).toBe("invalid_request");
    expect(error.message).toBe(errorMessage("fr", "invalid_request"));
    expect(h.cache.calls).toEqual([]);
    expect(h.limiter.checks).toEqual([]);
    expect(h.store.operations).toEqual([]);
    expect(h.llm.calls).toEqual([]);
    expect(llm.health).not.toHaveBeenCalled();
  });

  it.each(["another_analogy", "simpler", "zoom", "followup"])(
    "answers 400 mode_not_supported for the mode %s, before any work",
    async (mode) => {
      const h = boot();
      const response = await POST(post({ ...valid, mode }));
      expect(response.status).toBe(400);
      const { error } = await readError(response);
      expect(error).toEqual({
        code: "mode_not_supported",
        message: errorMessage("fr", "mode_not_supported"),
      });
      expect(h.limiter.checks).toEqual([]);
      expect(h.store.operations).toEqual([]);
    },
  );

  it.each<[string, Record<string, string>, unknown, "fr" | "en"]>([
    ["the language of the body", {}, { ...valid, language: "en", level: "x" }, "en"],
    [
      "the language of the body, over Accept-Language",
      { "accept-language": "en" },
      { ...valid, level: "x" },
      "fr",
    ],
    [
      "Accept-Language when the body language is invalid",
      { "accept-language": "en-US,en;q=0.9,fr;q=0.8" },
      { ...valid, language: "de" },
      "en",
    ],
    [
      "Accept-Language by weight",
      { "accept-language": "en;q=0.4, fr-CH;q=0.9" },
      { ...valid, language: "de" },
      "fr",
    ],
    [
      "the first supported Accept-Language entry",
      { "accept-language": "de, es;q=0.9, en;q=0.5" },
      { ...valid, language: "de" },
      "en",
    ],
    [
      "French when a language is refused with q=0",
      { "accept-language": "en;q=0, fr;q=0.1" },
      "{",
      "fr",
    ],
    ["French by default", {}, "{", "fr"],
    ["French when no supported language is asked", { "accept-language": "de, *;q=0.5" }, "{", "fr"],
  ])("writes the message in %s", async (_name, headers, body, language) => {
    boot();
    const response = await POST(post(body, { headers }));
    const { error } = await readError(response);
    expect(error.message).toBe(errorMessage(language, "invalid_request"));
    expect(errorMessage("fr", "invalid_request")).not.toBe(errorMessage("en", "invalid_request"));
  });

  it("writes the unsupported mode message in the language of the body", async () => {
    boot();
    const { error } = await readError(await POST(post({ ...BODY, language: "en", mode: "zoom" })));
    expect(error.message).toBe(errorMessage("en", "mode_not_supported"));
  });

  it("accepts the initial mode written out, and any extra field", async () => {
    const h = boot();
    const { response, events } = await run({ ...BODY, mode: "initial", parent_id: "ignored" });
    expect(response.status).toBe(200);
    expect(events.map(label)).toEqual(NOMINAL);
    expect(h.store.records.get(ID(1))?.status).toBe("ready");
  });

  it("starts the run with the trimmed question and the interpretation", async () => {
    const h = boot();
    const interpretation = `${reference.question} entre deux masses`;
    const { events } = await run({
      ...BODY,
      question: `  ${reference.question}\n`,
      interpretation: `  ${interpretation} `,
    });
    expect(events.map(label)).toEqual(NOMINAL);
    expect(h.store.records.get(ID(1))?.question).toBe(reference.question);
    const triage = h.llm.calls.find((call) => call.role === "triage")?.user;
    expect(triage).toContain("The student was asked to clarify");
    expect(triage).toContain(interpretation);
  });

  it("ignores a blank interpretation", async () => {
    const h = boot();
    const { events } = await run({ ...BODY, interpretation: "   " });
    expect(events.map(label)).toEqual(NOMINAL);
    expect(h.llm.calls.find((call) => call.role === "triage")?.user).not.toContain(
      "The student was asked to clarify",
    );
  });
});

describe("POST /api/explanations: rate limit", () => {
  it("answers 429 with Retry-After and starts no run when the limiter refuses", async () => {
    const h = boot();
    h.limiter.result = { allowed: false, retryAfterSeconds: 1_800 };
    const response = await POST(post(BODY));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1800");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await readError(response)).toEqual({
      error: { code: "rate_limited", message: errorMessage("fr", "rate_limited") },
    });
    expect(h.limiter.checks).toHaveLength(1);
    expect(h.limiter.checks[0]?.kind).toBe("generation");
    expect(h.store.operations).toEqual([]);
    expect(h.llm.calls).toEqual([]);
    expect(h.container.pipeline.logFor(ID(1))).toBeUndefined();
  });

  it("writes the message in the language of the request", async () => {
    const h = boot();
    h.limiter.result = { allowed: false, retryAfterSeconds: 5 };
    const response = await POST(post({ ...BODY, language: "en" }));
    expect((await readError(response)).error.message).toBe(errorMessage("en", "rate_limited"));
  });

  it.each<[string, Record<string, string>, string]>([
    [
      "the x-forwarded-for entry written by the proxy, not the ones the visitor sent",
      { "x-forwarded-for": " 10.0.0.1 , 203.0.113.7 ", "x-real-ip": "198.51.100.2" },
      "203.0.113.7",
    ],
    ["a single x-forwarded-for entry", { "x-forwarded-for": "203.0.113.9" }, "203.0.113.9"],
    ["x-real-ip without x-forwarded-for", { "x-real-ip": "198.51.100.2" }, "198.51.100.2"],
    [
      "x-real-ip when x-forwarded-for is empty",
      { "x-forwarded-for": "", "x-real-ip": "198.51.100.2" },
      "198.51.100.2",
    ],
    ["a constant without any header", {}, "unknown"],
  ])("limits by %s", async (_name, headers, address) => {
    const h = boot();
    await run(BODY, { headers });
    expect(h.limiter.checks).toEqual([{ address, kind: "generation" }]);
  });

  it("takes one rate limit hit per generation", async () => {
    const h = boot();
    await run();
    expect(h.limiter.checks).toHaveLength(1);
  });
});

describe("POST /api/explanations: generation unavailable", () => {
  it("answers 503 with an empty list of references, using no rate limit hit", async () => {
    const h = boot();
    llm.health.mockResolvedValue({ ok: false, latencyMs: 0 });
    const response = await POST(post(BODY));
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      error: {
        code: "generation_unavailable",
        message: errorMessage("fr", "generation_unavailable"),
      },
      references: [],
    });
    expect(h.limiter.checks).toEqual([]);
    expect(h.store.operations).toEqual([]);
    expect(h.llm.calls).toEqual([]);
  });

  it("answers 503 in the language of the request", async () => {
    boot();
    llm.health.mockResolvedValue({ ok: false, latencyMs: 0 });
    const response = await POST(post({ ...BODY, language: "en" }));
    expect((await readError(response)).error.message).toBe(
      errorMessage("en", "generation_unavailable"),
    );
  });

  it("treats a provider whose health check throws as unavailable", async () => {
    const h = boot();
    llm.health.mockRejectedValue(new Error(SECRET));
    const response = await POST(post(BODY));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
    expect(h.limiter.checks).toEqual([]);
  });

  it("asks the provider once in 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    boot();
    llm.health.mockResolvedValue({ ok: false, latencyMs: 0 });
    for (let call = 0; call < 3; call += 1) await POST(post(BODY));
    expect(llm.health).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(29_999);
    await POST(post(BODY));
    expect(llm.health).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    llm.health.mockResolvedValue({ ok: true, latencyMs: 0 });
    const { response, events } = await run();
    expect(llm.health).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("serves a cached question even when generation is unavailable", async () => {
    const h = boot();
    await run();
    llm.health.mockClear();
    resetGenerationAvailability();
    llm.health.mockResolvedValue({ ok: false, latencyMs: 0 });

    const { response, events } = await run();
    expect(response.status).toBe(200);
    expect(events.map(label)).toEqual(REPLAYED);
    expect(llm.health).not.toHaveBeenCalled();
    expect(h.limiter.checks).toHaveLength(1);
  });
});

describe("POST /api/explanations: the stream", () => {
  it("answers 200 with the event stream headers", async () => {
    boot();
    const response = await POST(post(BODY));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("connection")).toBe("keep-alive");
    await readSse(response);
  });

  it("streams the events in the contract order, with increasing ids, up to done", async () => {
    const h = boot();
    const { events } = await run();
    expect(events.map(label)).toEqual(NOMINAL);
    expect(events.map((event) => event.id)).toEqual(events.map((_, index) => index + 1));

    const id = ID(1);
    expect(events[0]).toMatchObject({
      type: "accepted",
      data: { explanation_id: id, cached: false },
    });
    expect(events.every((event) => !("type" in event.data))).toBe(true);
    expect(events.find((event) => event.type === "meta")?.data).toEqual({
      title: reference.title,
      subject: "physics",
      concept_slug: reference.slug,
      deep_eligible: false,
      detected_language: "fr",
    });
    expect(events.find((event) => event.type === "plan")?.data).toMatchObject({
      plan: document.plan,
      scene_count: SCENE_COUNT,
    });
    expect(events.at(-1)).toMatchObject({
      type: "done",
      data: { status: "ready", share_url: `/fr/e/${id}` },
    });
    expect(h.limiter.checks).toHaveLength(1);
    expect(h.store.records.get(id)?.status).toBe("ready");
  });

  it("emits every scene right after its own passing verdict, in the order of the indexes", async () => {
    boot();
    const { events } = await run();
    const scenes = events.filter((event) => event.type === "scene");
    expect(scenes.map((event) => event.data.index)).toEqual(indices);
    for (const scene of scenes) {
      const position = events.indexOf(scene);
      const before = events[position - 1];
      expect(before?.type).toBe("verdict");
      expect(before?.data.target).toBe(`s${Number(scene.data.index) + 1}`);
      expect(["validated", "corrected"]).toContain(before?.data.status);
    }
    const planAt = events.findIndex((event) => event.type === "plan");
    expect(events.findIndex((event) => event.type === "scene")).toBeGreaterThan(planAt);
  });

  it.each([
    [
      "clarify",
      {
        decision: "clarify",
        reason: "Mercure désigne une planète et un élément chimique.",
        concept: null,
        interpretations: [
          { label: "La planète", question: "Comment est faite la planète Mercure ?" },
          { label: "L'élément", question: "Qu'est-ce que le mercure en chimie ?" },
        ],
        detected_language: "fr",
        deep_eligible: false,
      },
      "needs_clarification",
    ],
    [
      "refused",
      {
        decision: "refuse",
        reason: "Je explique des notions du programme, pas une dissertation.",
        concept: null,
        interpretations: [],
        detected_language: "fr",
        deep_eligible: false,
      },
      "refused",
    ],
  ])("ends the stream after the %s event", async (type, triage, status) => {
    const question = "mercure";
    const h = boot([
      scenarioFromReference(reference, { question, replace: { triage: { response: triage } } }),
    ]);
    const { response, events } = await run({ ...BODY, question });
    expect(response.status).toBe(200);
    expect(events.map(label)).toEqual([
      "accepted",
      "step:triage:started",
      "step:triage:done",
      type,
    ]);
    expect(events.at(-1)?.data).toMatchObject(
      type === "clarify"
        ? { reason: triage.reason, interpretations: triage.interpretations }
        : { reason: triage.reason },
    );
    expect(h.store.records.get(ID(1))?.status).toBe(status);
    expect(
      h.llm.calls.filter((call) => call.role === "author" && call.user.startsWith("SCENE ")),
    ).toEqual([]);
  });

  it("ends the stream with an error event when the run fails", async () => {
    const h = boot([
      scenarioFromReference(reference, { replace: { triage: { error: "unavailable" } } }),
    ]);
    const { events } = await run();
    expect(events.map(label)).toEqual([
      "accepted",
      "step:triage:started",
      "error:generation_unavailable",
    ]);
    expect(events.at(-1)?.data.message).toEqual(expect.any(String));
    expect(h.store.records.get(ID(1))?.status).toBe("failed");
  });
});

describe("POST /api/explanations: the cache", () => {
  it("serves a second POST of the same question from the cache, with no model call and no hit", async () => {
    const h = boot();
    const first = await run();
    const id = ID(1);
    const calls = h.llm.calls.length;
    const operations = h.store.operations.length;
    expect(llm.health).toHaveBeenCalledTimes(1);

    const second = await run();
    expect(second.response.status).toBe(200);
    expect(second.response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(second.events.map(label)).toEqual(REPLAYED);
    expect(second.events.map((event) => event.id)).toEqual(
      second.events.map((_, index) => index + 1),
    );
    expect(second.events[0]).toMatchObject({
      type: "accepted",
      data: { explanation_id: id, cached: true },
    });
    expect(second.events.at(-1)?.data).toEqual({ status: "ready", share_url: `/fr/e/${id}` });

    const scenesOf = (events: SseEvent[]) =>
      events.filter((event) => event.type === "scene").map((event) => event.data);
    expect(scenesOf(second.events)).toEqual(scenesOf(first.events));

    expect(h.llm.calls).toHaveLength(calls);
    expect(h.store.operations).toHaveLength(operations);
    expect(h.limiter.checks).toHaveLength(1);
    expect(llm.health).toHaveBeenCalledTimes(1);
  });

  it("does not serve another level from the cache", async () => {
    const h = boot();
    await run();
    const { events } = await run({ ...BODY, level: "college" });
    expect(events.map(label)).toEqual(NOMINAL);
    expect(events[0]?.data.explanation_id).toBe(ID(2));
    expect(h.limiter.checks).toHaveLength(2);
  });

  it("replays the cached explanation when the pipeline finds it after the first lookup missed", async () => {
    const h = boot();
    await run();
    const calls = h.llm.calls.length;
    vi.spyOn(h.cache, "findByQuestion").mockResolvedValueOnce(null);

    const { events } = await run();
    expect(events.map(label)).toEqual(REPLAYED);
    expect(events[0]?.data).toEqual({ explanation_id: ID(1), cached: true });
    expect(h.llm.calls).toHaveLength(calls);
    expect(h.limiter.checks).toHaveLength(2);
  });

  it("answers 500 internal_error when the cache points to an explanation that cannot be played", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = boot();
    h.cache.seed(ID(9), {
      question: reference.question,
      slug: reference.slug,
      language: "fr",
      level: "lycee",
    });
    const response = await POST(post(BODY));
    expect(response.status).toBe(500);
    expect((await readError(response)).error).toEqual({
      code: "internal_error",
      message: errorMessage("fr", "internal_error"),
    });
    expect(h.llm.calls).toEqual([]);
  });
});

describe("POST /api/explanations: keep-alive and disconnection", () => {
  const FAKE: Parameters<typeof vi.useFakeTimers>[0] = {
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  };

  it("sends a keep-alive comment every 15 seconds on an open stream, then none once it is closed", async () => {
    vi.useFakeTimers(FAKE);
    boot([scenarioFromReference(reference, { replace: { triage: { delayMs: 40_000 } } })]);
    const timers = vi.getTimerCount();
    const reader = sseReader(await POST(post(BODY)));
    expect(vi.getTimerCount()).toBeGreaterThan(timers);
    expect(eventsIn([(await reader.next())!, (await reader.next())!]).map(label)).toEqual(
      NOMINAL.slice(0, 2),
    );

    const waiting = reader.next();
    let arrived = false;
    void waiting.then(() => {
      arrived = true;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(arrived).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toEqual({ kind: "comment", text: "keep-alive" });

    const second = reader.next();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await second).toEqual({ kind: "comment", text: "keep-alive" });

    const ending = reader.rest();
    await vi.advanceTimersByTimeAsync(10_001);
    const events = eventsIn(await ending);
    expect(events.map(label)).toEqual(NOMINAL.slice(2));
    expect(vi.getTimerCount()).toBe(timers);
  });

  it("stops the response, and keeps the run going, when the request is aborted", async () => {
    const h = boot();
    const held = await hold(h);
    const id = held.id;
    const log = h.container.pipeline.logFor(id);
    expect(subscribers(log)).toBe(1);

    held.controller.abort();
    const tail = await held.reader.rest();
    expect(eventsIn(tail).some((event) => event.type === "done")).toBe(false);
    await vi.waitFor(() => expect(subscribers(log)).toBe(0), { interval: 5, timeout: 2_000 });
    expect(log?.closed).toBe(false);
    expect(h.store.records.get(id)?.status).toBe("streaming");

    held.release();
    await finished(h, id);
    expect(h.store.records.get(id)?.payload.scenes).toHaveLength(SCENE_COUNT);
    expect(log?.closed).toBe(true);
    expect(h.cache.calls.some((call) => call.method === "remember")).toBe(true);
  });

  it("frees the subscription and the timer when the client cancels the body", async () => {
    vi.useFakeTimers(FAKE);
    const h = boot();
    const timers = vi.getTimerCount();
    const release = h.voice.holdScene("s3");
    const reader = sseReader(await POST(post(BODY)));
    await untilScene(reader, 1);
    const log = h.container.pipeline.logFor(ID(1));
    expect(subscribers(log)).toBe(1);

    await reader.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribers(log)).toBe(0);
    expect(vi.getTimerCount()).toBe(timers);

    vi.useRealTimers();
    release();
    await finished(h, ID(1));
  });
});

describe("GET /api/explanations/{id}", () => {
  it("answers 200 with the state of a finished run", async () => {
    const h = boot();
    await run();
    const id = ID(1);
    const response = await fetchExplanation(id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await readExplanation(response);

    expect(Object.keys(body).sort()).toEqual(
      [
        "concept_slug",
        "deep",
        "export",
        "id",
        "kind",
        "language",
        "level",
        "model",
        "parent_id",
        "payload",
        "provider",
        "root_id",
        "scene_count_planned",
        "status",
        "subject",
        "timings",
        "title",
        "verdicts",
      ].sort(),
    );
    expect(body).toMatchObject({
      id,
      kind: "initial",
      parent_id: null,
      root_id: id,
      status: "ready",
      language: "fr",
      level: "lycee",
      title: reference.title,
      subject: "physics",
      concept_slug: reference.slug,
      scene_count_planned: SCENE_COUNT,
      provider: "fixture",
      model: "fixture",
      deep: { status: "none" },
      export: { status: "none" },
    });
    expect(body.payload.plan).toEqual(document.plan);
    expect(body.payload.scenes.map((scene) => scene.id)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
    ]);
    expect(body.verdicts.map((verdict) => verdict.target)).toEqual([
      "plan",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
    ]);
    expect(body.timings).toEqual(h.store.records.get(id)?.timings);
    expect(body.timings).toHaveProperty("total");
  });

  it("shows only the verified scenes while a run is held midway", async () => {
    const h = boot();
    const held = await hold(h);
    await vi.waitFor(
      async () => {
        const body = await readExplanation(await fetchExplanation(held.id));
        expect(body.payload.scenes.map((scene) => scene.id)).toEqual(["s1", "s2"]);
      },
      { interval: 5, timeout: 2_000 },
    );
    const body = await readExplanation(await fetchExplanation(held.id));
    expect(body.status).toBe("streaming");
    expect(body.scene_count_planned).toBe(SCENE_COUNT);
    expect(body.payload.plan).toEqual(document.plan);
    expect(body.verdicts.map((verdict) => verdict.target)).toEqual(["plan", "s1", "s2"]);

    held.release();
    await held.reader.rest();
    const done = await readExplanation(await fetchExplanation(held.id));
    expect(done.status).toBe("ready");
    expect(done.payload.scenes).toHaveLength(SCENE_COUNT);
  });

  it("answers 404 not_found for an unknown id, in the language of Accept-Language", async () => {
    boot();
    const unknown = await fetchExplanation(ID(7));
    expect(unknown.status).toBe(404);
    expect(await readError(unknown)).toEqual({
      error: { code: "not_found", message: errorMessage("fr", "not_found") },
    });
    const english = await fetchExplanation(ID(7), { "accept-language": "en" });
    expect((await readError(english)).error.message).toBe(errorMessage("en", "not_found"));
  });

  it.each([
    "abc",
    "kkkkkkkkkkk0",
    "kkkkkkkkkkk1",
    "KKKKKKKKKKK2",
    "kkkkkkkkkkk22",
    "kkkkkkkkkk2",
    "kkkkkkkkkkki",
    "../../etc/passwd",
    "kkkkkkkkkkk2%20",
    "",
  ])("answers 404 not_found for the malformed id %j without touching the database", async (id) => {
    const h = boot();
    const response = await fetchExplanation(id);
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("not_found");
    expect(h.store.reads).toEqual([]);
  });

  it("answers 410 expired for an expired explanation", async () => {
    const h = boot();
    await run();
    await h.store.update(ID(1), { expires_at: PAST });
    const response = await fetchExplanation(ID(1), { "accept-language": "en" });
    expect(response.status).toBe(410);
    expect(await readError(response)).toEqual({
      error: { code: "expired", message: errorMessage("en", "expired") },
    });
  });

  it("does not treat an explanation expiring in the future as expired", async () => {
    const h = boot();
    await run();
    expect(h.store.records.get(ID(1))?.expires_at?.getTime()).toBeGreaterThan(PAST.getTime());
    await h.store.update(ID(1), { expires_at: new Date(Date.now() + 86_400_000) });
    expect((await fetchExplanation(ID(1))).status).toBe(200);
  });
});

describe("GET /api/explanations/{id}/events", () => {
  it("returns everything up to done for after=0, and when after is omitted", async () => {
    boot();
    const { events } = await run();
    const id = ID(1);
    for (const query of ["", "?after=0", "?after=00"]) {
      const response = await fetchEvents(id, query);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
      expect(response.headers.get("x-accel-buffering")).toBe("no");
      expect(eventsIn(await readSse(response))).toEqual(events);
    }
  });

  it("returns only the events after n, with their original ids", async () => {
    boot();
    const { events } = await run();
    const id = ID(1);
    const planAt = events.findIndex((event) => event.type === "plan");
    const resumed = eventsIn(await readSse(await fetchEvents(id, `?after=${planAt + 1}`)));
    expect(resumed).toEqual(events.slice(planAt + 1));
    expect(resumed[0]?.id).toBe(planAt + 2);
    expect(resumed.at(-1)?.type).toBe("done");

    expect(eventsIn(await readSse(await fetchEvents(id, `?after=${events.length - 1}`)))).toEqual(
      events.slice(-1),
    );
  });

  it.each([0, 50])(
    "returns an empty stream when after is %i past the last event",
    async (extra) => {
      boot();
      const { events } = await run();
      const response = await fetchEvents(ID(1), `?after=${events.length + extra}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    },
  );

  it("delivers the rest of a run held midway, live, after a lost connection", async () => {
    const h = boot();
    const held = await hold(h);
    const lastSeen = held.seen.at(-1)?.id ?? 0;
    held.controller.abort();
    await held.reader.rest();

    const response = await fetchEvents(held.id, `?after=${lastSeen}`);
    expect(response.status).toBe(200);
    const reader = sseReader(response);
    const pending = reader.rest();
    const log = h.container.pipeline.logFor(held.id);
    await vi.waitFor(() => expect(subscribers(log)).toBe(1), { interval: 5, timeout: 2_000 });
    held.release();
    const tail = eventsIn(await pending);

    expect(tail[0]?.id).toBe(lastSeen + 1);
    expect(tail.map(label)).toEqual(NOMINAL.slice(held.seen.length));
    expect([...held.seen, ...tail].map(label)).toEqual(NOMINAL);
    expect([...held.seen, ...tail].map((event) => event.id)).toEqual(
      NOMINAL.map((_, index) => index + 1),
    );
    await vi.waitFor(() => expect(subscribers(log)).toBe(0), { interval: 5, timeout: 2_000 });
  });

  it.each(["abc", "-1", "1.5", "", "1e3", "0x10", "+2", " 3", "99999999999999999999"])(
    "answers 400 invalid_request for after=%j",
    async (after) => {
      const h = boot();
      await run();
      h.store.reads.length = 0;
      const response = await fetchEvents(ID(1), `?after=${encodeURIComponent(after)}`);
      expect(response.status).toBe(400);
      expect(await readError(response)).toEqual({
        error: { code: "invalid_request", message: errorMessage("fr", "invalid_request") },
      });
      expect(h.store.reads).toEqual([]);
    },
  );

  it("answers 404 not_found for an unknown id and for a malformed one", async () => {
    const h = boot();
    for (const id of [ID(7), "nope"]) {
      const response = await fetchEvents(id);
      expect(response.status).toBe(404);
      expect((await readError(response)).error.code).toBe("not_found");
    }
    expect(h.store.reads).toEqual([`get ${ID(7)}`, `isExpired ${ID(7)}`]);
  });

  describe("when the run is no longer in memory", () => {
    it("replays a finished explanation from the store, numbered from 1", async () => {
      const h = boot();
      await run();
      const id = ID(1);
      h.restart();
      expect(h.container.pipeline.logFor(id)).toBeUndefined();

      const replayed = eventsIn(await readSse(await fetchEvents(id)));
      expect(replayed.map(label)).toEqual(REPLAYED);
      expect(replayed.map((event) => event.id)).toEqual(replayed.map((_, index) => index + 1));
      expect(replayed[0]?.data).toEqual({ explanation_id: id, cached: true });
      expect(replayed.at(-1)?.data).toEqual({ status: "ready", share_url: `/fr/e/${id}` });
    });

    it("keeps only the replayed events above after", async () => {
      const h = boot();
      await run();
      h.restart();
      const all = eventsIn(await readSse(await fetchEvents(ID(1))));
      const resumed = eventsIn(await readSse(await fetchEvents(ID(1), "?after=4")));
      expect(resumed).toEqual(all.slice(4));
      expect(resumed[0]?.id).toBe(5);
      expect(await (await fetchEvents(ID(1), `?after=${all.length}`)).text()).toBe("");
    });

    it("answers 404 for an explanation that cannot be played", async () => {
      const question = "écris-moi ma dissertation";
      const h = boot([
        scenarioFromReference(reference, {
          question,
          replace: {
            triage: {
              response: {
                decision: "refuse",
                reason: "Je explique des notions du programme.",
                concept: null,
                interpretations: [],
                detected_language: "fr",
                deep_eligible: false,
              },
            },
          },
        }),
      ]);
      await run({ ...BODY, question });
      expect(h.store.records.get(ID(1))?.status).toBe("refused");
      h.restart();
      const response = await fetchEvents(ID(1));
      expect(response.status).toBe(404);
      expect((await readError(response)).error.code).toBe("not_found");
    });

    it("answers 410 expired for an expired explanation", async () => {
      const h = boot();
      await run();
      await h.store.update(ID(1), { expires_at: PAST });
      h.restart();
      const response = await fetchEvents(ID(1), "", { "accept-language": "en" });
      expect(response.status).toBe(410);
      expect(await readError(response)).toEqual({
        error: { code: "expired", message: errorMessage("en", "expired") },
      });
    });
  });
});

describe("unexpected failures", () => {
  const leaks = ["hunter2", "postgres", "10.0.0.5", "connection refused", "Error"];

  async function expectInternalError(response: Response, language: "fr" | "en") {
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    const text = await response.text();
    for (const leak of leaks) expect(text).not.toContain(leak);
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal_error", message: errorMessage(language, "internal_error") },
    });
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers 500 internal_error when the store fails on a read", async () => {
    const h = boot();
    vi.spyOn(h.store, "get").mockRejectedValue(new Error(SECRET));
    await expectInternalError(await fetchExplanation(ID(1)), "fr");
    await expectInternalError(await fetchEvents(ID(1), "", { "accept-language": "en" }), "en");
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("answers 500 internal_error when the store fails to tell whether an id expired", async () => {
    const h = boot();
    vi.spyOn(h.store, "isExpired").mockRejectedValue(new Error(SECRET));
    await expectInternalError(await fetchExplanation(ID(1)), "fr");
  });

  it("answers 500 internal_error when the cache fails", async () => {
    const h = boot();
    vi.spyOn(h.cache, "findByQuestion").mockRejectedValue(new Error(SECRET));
    await expectInternalError(await POST(post({ ...BODY, language: "en" })), "en");
    expect(h.limiter.checks).toEqual([]);
  });

  it("answers 500 internal_error when the rate limiter fails", async () => {
    const h = boot();
    vi.spyOn(h.limiter, "check").mockRejectedValue(new Error(SECRET));
    await expectInternalError(await POST(post(BODY)), "fr");
    expect(h.store.operations).toEqual([]);
  });

  it("answers 500 internal_error when the pipeline cannot start", async () => {
    const h = boot();
    vi.spyOn(h.container.pipeline, "start").mockRejectedValue(new Error(SECRET));
    await expectInternalError(await POST(post(BODY)), "fr");
  });
});

describe("error messages", () => {
  const codes: ErrorCode[] = [
    "invalid_request",
    "mode_not_supported",
    "not_found",
    "expired",
    "rate_limited",
    "generation_unavailable",
    "internal_error",
  ];

  it.each(codes)("has a short, readable message in French and in English for %s", (code) => {
    const fr = errorMessage("fr", code);
    const en = errorMessage("en", code);
    expect(fr).not.toBe(en);
    for (const message of [fr, en]) {
      expect(message.length).toBeGreaterThan(10);
      expect(message.length).toBeLessThan(120);
      expect(message).toMatch(/[.!]$/);
      expect(message).not.toMatch(/exception|stack|undefined|null|sql|zod|json|http|\d{3}/i);
    }
  });
});
