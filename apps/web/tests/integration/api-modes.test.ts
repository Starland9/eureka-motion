import { DocumentSchema, type Outline, type Scene } from "scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { POST } from "../../src/app/api/explanations/route";
import { GET as getVersions } from "../../src/app/api/explanations/[id]/versions/route";
import type { RateLimiter, RateLimitKind, RateLimitResult } from "../../src/server/db/rate-limit";
import { setContainerForTests, sharePath, type Container } from "../../src/server/container";
import { resetGenerationAvailability } from "../../src/server/http/availability";
import { errorMessage } from "../../src/server/http/errors";
import { createFixtureProvider, type Scenario, type ScenarioStep } from "../../src/server/llm";
import { EventLogRegistry } from "../../src/server/pipeline/events";
import type { ExplanationRecord } from "../../src/server/pipeline/ports";
import { FOLLOWUP_CHECK_MARKER, modeMarker, sceneMarker } from "../../src/server/pipeline/prompts";
import { Pipeline } from "../../src/server/pipeline/run";
import { loadReferenceRecord, referenceId } from "../../src/server/reference";
import {
  FakeVoice,
  MemoryCache,
  MemoryStore,
  spyOn,
  steppingClock,
  type LlmSpy,
} from "../helpers/fakes";
import { scenarioFromReference } from "../helpers/scenario";
import { eventsIn, readSse, type SseEvent } from "../helpers/sse";

const llm = vi.hoisted(() => ({
  health: vi.fn<() => Promise<{ ok: boolean; latencyMs: number }>>(),
}));

vi.mock("../../src/server/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/llm")>()),
  getLlm: () => ({ health: llm.health }),
}));

const ORIGIN = "http://localhost:3000";
const DOCUMENT = DocumentSchema.parse(reference.payload);
const OUTLINE: Outline = { plan: DOCUMENT.plan, params: DOCUMENT.params, model: DOCUMENT.model };
const SCENES = DOCUMENT.scenes;
const BASE = { language: "fr", level: "lycee" } as const;
const FOLLOWUP = "et si la distance double ?";
const PAST = new Date("2020-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-06-01T00:00:00.000Z");
const CLOCK_START = new Date("2099-01-01T09:00:00.000Z");

const sid = (letter: string): string => letter.repeat(12);
const PARENT = sid("p");
const UNKNOWN = sid("u");
const REFERENCE_ID = referenceId(reference.slug, "fr");
const NEW_ID = (n: number): string => `nnnnnnnnnnn${n + 1}`;

class ExpiringStore extends MemoryStore {
  override async get(id: string) {
    return (await this.isExpired(id)) ? null : super.get(id);
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

const sceneSteps = (indexes: number[]): ScenarioStep[] =>
  indexes.map((original, position) => ({
    role: "author",
    when: sceneMarker(position),
    response: SCENES[original] as Scene,
  }));

function scenario(name: string, question: string, steps: ScenarioStep[]): Scenario {
  return {
    name,
    question,
    steps: [
      ...steps,
      {
        role: "judge",
        repeat: true,
        response: { verdict: "valid", issues: [], reason: "Le plan est exact." },
      },
      {
        role: "checker",
        when: "Step of the plan for this scene",
        repeat: true,
        response: { verdict: "valid", problem: "", reason: "La scène dit ce que dit le plan." },
      },
    ],
  };
}

const step = (title: string, role: "mechanism" | "example") => ({
  role,
  intent: title,
  visual: title,
});

const SCENARIOS: Scenario[] = [
  scenarioFromReference(reference),
  scenario("modes.another-analogy", modeMarker("another_analogy"), [
    {
      role: "author",
      when: modeMarker("another_analogy"),
      response: {
        ...OUTLINE,
        plan: {
          ...OUTLINE.plan,
          analogy: {
            name: "Le haut-parleur qu'on entend moins de loin",
            mapping:
              "Le haut-parleur joue le rôle de la masse ; le son reçu joue le rôle de la force ; il faiblit comme le carré de la distance.",
          },
        },
      },
    },
    ...sceneSteps([0, 1, 2, 3, 4, 5]),
  ]),
  scenario("modes.simpler", modeMarker("simpler"), [
    {
      role: "author",
      when: modeMarker("simpler"),
      response: {
        ...OUTLINE,
        plan: {
          ...OUTLINE.plan,
          prerequisites: OUTLINE.plan.prerequisites.slice(0, 2),
          steps: OUTLINE.plan.steps.filter(({ role }) => role !== "formula"),
        },
      },
    },
    ...sceneSteps([0, 1, 2, 4, 5]),
  ]),
  scenario("modes.zoom", modeMarker("zoom"), [
    {
      role: "author",
      when: modeMarker("zoom"),
      response: {
        ...OUTLINE,
        plan: {
          ...OUTLINE.plan,
          objective:
            "Comprendre pourquoi les deux flèches restent égales quand la distance change.",
          key_rule: {
            statement: "La Terre et la Lune s'attirent avec des forces égales et opposées.",
          },
          steps: [
            step("Voir que les deux flèches ont toujours la même longueur.", "mechanism"),
            step("Voir que la distance change les deux flèches à la fois.", "mechanism"),
          ],
        },
      },
    },
    ...sceneSteps([2, 2]),
  ]),
  scenario("modes.followup", FOLLOWUP, [
    {
      role: "triage",
      when: FOLLOWUP_CHECK_MARKER,
      response: { related: true, title: "Et si la distance double ?", detected_language: "fr" },
    },
    {
      role: "author",
      when: modeMarker("followup"),
      response: {
        ...OUTLINE,
        plan: {
          ...OUTLINE.plan,
          objective: "Voir que doubler la distance divise la force par quatre.",
          prerequisites: [],
          key_rule: {
            statement: "À distance double, la force d'attraction est quatre fois plus faible.",
            formula: OUTLINE.plan.key_rule.formula,
          },
          steps: [
            step("Voir la force diminuer quand la Lune s'éloigne.", "mechanism"),
            step("Comparer la force à r et à 2r.", "example"),
          ],
        },
      },
    },
    ...sceneSteps([2, 4]),
  ]),
];

function record(id: string, patch: Partial<ExplanationRecord> = {}): ExplanationRecord {
  return {
    id,
    kind: "initial",
    parent_id: null,
    root_id: id,
    focus_scene_id: null,
    question: reference.question,
    language: "fr",
    level: "lycee",
    concept_slug: reference.slug,
    subject: "physics",
    title: reference.title,
    status: "ready",
    payload: { version: 1, ...OUTLINE, scenes: SCENES, quiz: null },
    verdicts: [],
    scene_count_planned: SCENES.length,
    provider: "fixture",
    model: "fixture",
    timings: {},
    created_at: new Date("2098-01-01T09:00:00.000Z"),
    completed_at: new Date("2098-01-01T09:00:30.000Z"),
    expires_at: FUTURE,
    ...patch,
  };
}

const at = (minutes: number): Date => new Date(Date.UTC(2098, 0, 1, 9, minutes));

interface Harness {
  container: Container;
  store: ExpiringStore;
  cache: MemoryCache;
  limiter: FakeLimiter;
  llm: LlmSpy;
}

function boot(seeds: ExplanationRecord[] = [record(PARENT)]): Harness {
  const store = new ExpiringStore();
  for (const seed of seeds) store.records.set(seed.id, structuredClone(seed));
  const cache = new MemoryCache();
  const limiter = new FakeLimiter();
  const provider = spyOn(createFixtureProvider(SCENARIOS));
  let next = 0;
  const logs = new EventLogRegistry();
  const container: Container = {
    pipeline: new Pipeline(
      {
        llm: provider,
        store,
        cache,
        voice: new FakeVoice(),
        newId: () => NEW_ID(++next),
        now: steppingClock(CLOCK_START),
        shareUrl: sharePath,
        findReference: loadReferenceRecord,
      },
      logs,
    ),
    store,
    cache,
    limiter,
    logs,
  };
  setContainerForTests(container);
  return { container, store, cache, limiter, llm: provider };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/explanations`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function fetchVersions(id: string, headers: Record<string, string> = {}) {
  return getVersions(new Request(`${ORIGIN}/api/explanations/${id}/versions`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

async function run(body: unknown) {
  const response = await POST(post(body));
  return { response, events: eventsIn(await readSse(response)) };
}

const labels = (events: SseEvent[]): string[] =>
  events.map(({ type, data }) => (type === "done" ? `done:${String(data.status)}` : type));

const readError = async (response: Response) =>
  (await response.json()) as { error: { code: string; message: string } };

interface VersionItem {
  id: string;
  kind: string;
  title: string | null;
  created_at: string;
  scene_title: string | null;
}

const readVersions = async (response: Response) => (await response.json()) as VersionItem[];

function expectNoWork(h: Harness): void {
  expect(h.store.operations).toEqual([]);
  expect(h.llm.calls).toEqual([]);
}

beforeEach(() => {
  resetGenerationAvailability();
  llm.health.mockReset();
  llm.health.mockResolvedValue({ ok: true, latencyMs: 0 });
  vi.stubEnv("REFERENCE_DIR", "");
});

afterEach(() => {
  setContainerForTests(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const DERIVED = [
  {
    mode: "another_analogy",
    extra: {},
    scenes: 6,
    expected: { focus_scene_id: null, question: reference.question, level: "lycee" },
  },
  {
    mode: "simpler",
    extra: {},
    scenes: 5,
    expected: { focus_scene_id: null, question: reference.question, level: "college" },
  },
  {
    mode: "zoom",
    extra: { scene_id: "s3" },
    scenes: 2,
    expected: { focus_scene_id: "s3", question: reference.question, level: "lycee" },
  },
  {
    mode: "followup",
    extra: { question: `  ${FOLLOWUP}\n` },
    scenes: 2,
    expected: { focus_scene_id: null, question: FOLLOWUP, level: "lycee" },
  },
] as const;

describe("POST /api/explanations: derived modes", () => {
  it.each(DERIVED)(
    "streams a new $mode version of the parent, with no cache and one rate limit hit",
    async ({ mode, extra, scenes, expected }) => {
      const h = boot();
      h.cache.seed(PARENT, { question: FOLLOWUP, slug: reference.slug, ...BASE });
      const { response, events } = await run({ mode, parent_id: PARENT, ...BASE, ...extra });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(events[0]).toMatchObject({
        type: "accepted",
        data: { explanation_id: NEW_ID(1), cached: false },
      });
      expect(events.filter(({ type }) => type === "scene")).toHaveLength(scenes);
      expect(labels(events).at(-1)).toBe("done:ready");

      expect(h.store.records.get(NEW_ID(1))).toMatchObject({
        kind: mode,
        parent_id: PARENT,
        root_id: PARENT,
        status: "ready",
        scene_count_planned: scenes,
        ...expected,
      });
      expect(h.cache.calls).toEqual([]);
      expect(h.limiter.checks).toEqual([{ address: "unknown", kind: "generation" }]);
    },
  );

  it("takes the rate limit address from the proxy header, as for a question", async () => {
    const h = boot();
    const response = await POST(
      post(
        { mode: "simpler", parent_id: PARENT, ...BASE },
        { "x-forwarded-for": "10.0.0.1, 203.0.113.7" },
      ),
    );
    await readSse(response);
    expect(h.limiter.checks).toEqual([{ address: "203.0.113.7", kind: "generation" }]);
  });

  it("continues from a version of the session as from the first explanation", async () => {
    const version = sid("v");
    const h = boot([
      record(PARENT),
      record(version, { kind: "simpler", parent_id: PARENT, root_id: PARENT, level: "college" }),
    ]);
    const { events } = await run({ mode: "zoom", parent_id: version, scene_id: "s2", ...BASE });
    expect(labels(events).at(-1)).toBe("done:ready");
    expect(h.store.records.get(NEW_ID(1))).toMatchObject({
      kind: "zoom",
      parent_id: version,
      root_id: PARENT,
      focus_scene_id: "s2",
    });
  });

  it("continues from a reference explanation, which is stored with its first version", async () => {
    const h = boot([]);
    const { events } = await run({
      mode: "another_analogy",
      parent_id: REFERENCE_ID,
      ...BASE,
    });
    expect(labels(events).at(-1)).toBe("done:ready");
    expect(h.store.records.get(NEW_ID(1))).toMatchObject({
      kind: "another_analogy",
      parent_id: REFERENCE_ID,
      root_id: REFERENCE_ID,
    });
    expect(h.store.records.get(REFERENCE_ID)).toMatchObject({ kind: "reference", status: "ready" });
  });

  it("does not need the cache, which may be failing", async () => {
    const h = boot();
    vi.spyOn(h.cache, "findByQuestion").mockRejectedValue(new Error("cache down"));
    const { events } = await run({
      mode: "followup",
      parent_id: PARENT,
      question: FOLLOWUP,
      ...BASE,
    });
    expect(labels(events).at(-1)).toBe("done:ready");
  });
});

describe("POST /api/explanations: derived modes, invalid requests", () => {
  const valid = { parent_id: PARENT, ...BASE };

  it.each<[string, unknown]>([
    ["another_analogy without parent_id", { mode: "another_analogy", ...BASE }],
    ["simpler without parent_id", { mode: "simpler", ...BASE }],
    ["zoom without parent_id", { mode: "zoom", scene_id: "s1", ...BASE }],
    ["followup without parent_id", { mode: "followup", question: FOLLOWUP, ...BASE }],
    [
      "the old shape of a zoom, with a question only",
      { question: FOLLOWUP, mode: "zoom", ...BASE },
    ],
    ["a null parent_id", { mode: "simpler", ...BASE, parent_id: null }],
    ["a parent_id that is not a string", { mode: "simpler", ...BASE, parent_id: 42 }],
    ["a parent_id of 11 characters", { mode: "simpler", ...BASE, parent_id: "p".repeat(11) }],
    ["a parent_id of 13 characters", { mode: "simpler", ...BASE, parent_id: "p".repeat(13) }],
    ["a parent_id in capitals", { mode: "simpler", ...BASE, parent_id: "P".repeat(12) }],
    [
      "a parent_id with a letter outside the alphabet",
      { mode: "simpler", ...BASE, parent_id: `${"p".repeat(11)}l` },
    ],
    ["a parent_id with a path", { mode: "simpler", ...BASE, parent_id: `../${"p".repeat(9)}` }],
    ["zoom without scene_id", { mode: "zoom", ...valid }],
    ["zoom with an empty scene_id", { mode: "zoom", ...valid, scene_id: "" }],
    ["zoom with a scene_id starting with a digit", { mode: "zoom", ...valid, scene_id: "1s" }],
    ["zoom with a scene_id with a space", { mode: "zoom", ...valid, scene_id: "s 1" }],
    ["zoom with a scene_id of 41 characters", { mode: "zoom", ...valid, scene_id: "s".repeat(41) }],
    ["zoom with a scene_id that is not a string", { mode: "zoom", ...valid, scene_id: 3 }],
    ["zoom with a question", { mode: "zoom", ...valid, scene_id: "s1", question: FOLLOWUP }],
    ["another_analogy with a question", { mode: "another_analogy", ...valid, question: FOLLOWUP }],
    ["simpler with a scene_id", { mode: "simpler", ...valid, scene_id: "s1" }],
    ["simpler with an interpretation", { mode: "simpler", ...valid, interpretation: "x" }],
    ["another_analogy with an unknown field", { mode: "another_analogy", ...valid, foo: 1 }],
    ["followup without question", { mode: "followup", ...valid }],
    ["followup with a blank question", { mode: "followup", ...valid, question: " \n " }],
    [
      "followup with a question of 501 characters",
      { mode: "followup", ...valid, question: "q".repeat(501) },
    ],
    ["followup with a question that is not a string", { mode: "followup", ...valid, question: 7 }],
    [
      "followup with a scene_id",
      { mode: "followup", ...valid, question: FOLLOWUP, scene_id: "s1" },
    ],
    ["a derived mode without language", { mode: "simpler", parent_id: PARENT, level: "lycee" }],
    ["a derived mode with an unknown level", { mode: "simpler", ...valid, level: "primaire" }],
    ["an initial mode with no question", { mode: "initial", ...BASE }],
    ["a mode in capitals", { mode: "ZOOM", ...valid, scene_id: "s1" }],
    ["an empty mode", { mode: "", ...valid }],
    ["a null mode", { mode: null, ...valid }],
    ["a mode that is not a string", { mode: 1, ...valid }],
  ])("answers 400 invalid_request for %s, before any work", async (_name, body) => {
    const h = boot();
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await readError(response)).toEqual({
      error: { code: "invalid_request", message: errorMessage("fr", "invalid_request") },
    });
    expect(h.cache.calls).toEqual([]);
    expect(h.limiter.checks).toEqual([]);
    expect(llm.health).not.toHaveBeenCalled();
    expectNoWork(h);
  });

  it("writes the message in the language of the body", async () => {
    boot();
    const response = await POST(post({ mode: "zoom", language: "en", level: "lycee" }));
    expect((await readError(response)).error.message).toBe(errorMessage("en", "invalid_request"));
  });
});

describe("POST /api/explanations: parent_not_found", () => {
  const requests = [
    ["another_analogy", {}],
    ["simpler", {}],
    ["zoom", { scene_id: "s1" }],
    ["followup", { question: FOLLOWUP }],
  ] as const;

  it.each(requests)(
    "answers 404 for %s on an unknown parent, creating nothing",
    async (mode, extra) => {
      const h = boot();
      const response = await POST(post({ mode, parent_id: UNKNOWN, ...BASE, ...extra }));
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await readError(response)).toEqual({
        error: { code: "parent_not_found", message: errorMessage("fr", "parent_not_found") },
      });
      expect(h.limiter.checks).toHaveLength(1);
      expectNoWork(h);
    },
  );

  it("writes the message in the language of the body", async () => {
    boot();
    const response = await POST(
      post({ mode: "simpler", parent_id: UNKNOWN, language: "en", level: "lycee" }),
    );
    expect((await readError(response)).error.message).toBe(errorMessage("en", "parent_not_found"));
    expect(errorMessage("fr", "parent_not_found")).not.toBe(errorMessage("en", "parent_not_found"));
  });

  it("answers 404 for a zoom on a scene the parent does not have", async () => {
    const h = boot();
    const response = await POST(post({ mode: "zoom", parent_id: PARENT, scene_id: "s9", ...BASE }));
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("parent_not_found");
    expectNoWork(h);
  });

  it("answers 404 for a parent that has expired", async () => {
    const h = boot([record(PARENT, { expires_at: PAST })]);
    const response = await POST(post({ mode: "another_analogy", parent_id: PARENT, ...BASE }));
    expect(response.status).toBe(404);
    expect((await readError(response)).error.code).toBe("parent_not_found");
    expectNoWork(h);
  });

  it.each(["failed", "refused", "needs_clarification", "streaming"] as const)(
    "answers 404 for a parent whose status is %s",
    async (status) => {
      const h = boot([record(PARENT, { status })]);
      const response = await POST(post({ mode: "simpler", parent_id: PARENT, ...BASE }));
      expect(response.status).toBe(404);
      expect((await readError(response)).error.code).toBe("parent_not_found");
      expectNoWork(h);
    },
  );

  it("answers 500 for any other failure of the pipeline", async () => {
    const h = boot();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(h.container.pipeline, "start").mockRejectedValue(new Error("disk full"));
    const response = await POST(post({ mode: "simpler", parent_id: PARENT, ...BASE }));
    expect(response.status).toBe(500);
    expect((await readError(response)).error.code).toBe("internal_error");
  });
});

describe("POST /api/explanations: derived modes, rate limit and availability", () => {
  const body = { mode: "zoom", parent_id: PARENT, scene_id: "s3", ...BASE };

  it("answers 429 with Retry-After and starts nothing when the limiter refuses", async () => {
    const h = boot();
    h.limiter.result = { allowed: false, retryAfterSeconds: 1_800 };
    const response = await POST(post(body));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1800");
    expect(await readError(response)).toEqual({
      error: { code: "rate_limited", message: errorMessage("fr", "rate_limited") },
    });
    expectNoWork(h);
  });

  it("limits before looking at the parent", async () => {
    const h = boot();
    h.limiter.result = { allowed: false, retryAfterSeconds: 5 };
    const response = await POST(post({ ...body, parent_id: UNKNOWN }));
    expect(response.status).toBe(429);
    expectNoWork(h);
  });

  it("answers 503 with the references, using no rate limit hit, when generation is unavailable", async () => {
    const h = boot();
    llm.health.mockResolvedValue({ ok: false, latencyMs: 0 });
    const response = await POST(post(body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "generation_unavailable",
        message: errorMessage("fr", "generation_unavailable"),
      },
      references: expect.any(Array),
    });
    expect(h.limiter.checks).toEqual([]);
    expectNoWork(h);
  });

  it("answers 503 before looking at the parent, in the language of the body", async () => {
    const h = boot();
    llm.health.mockResolvedValue({ ok: false, latencyMs: 0 });
    const response = await POST(post({ ...body, parent_id: UNKNOWN, language: "en" }));
    expect(response.status).toBe(503);
    expect((await readError(response)).error.message).toBe(
      errorMessage("en", "generation_unavailable"),
    );
    expectNoWork(h);
  });

  it("does not serve a derived mode from the cache while generation is unavailable", async () => {
    const h = boot();
    h.cache.seed(PARENT, { question: reference.question, slug: reference.slug, ...BASE });
    llm.health.mockResolvedValue({ ok: false, latencyMs: 0 });
    const response = await POST(
      post({ mode: "followup", parent_id: PARENT, question: reference.question, ...BASE }),
    );
    expect(response.status).toBe(503);
    expect(h.cache.calls).toEqual([]);
  });
});

describe("GET /api/explanations/{id}/versions", () => {
  const ROOT = sid("r");
  const ANALOGY = sid("a");
  const ZOOM_OF_ROOT = sid("z");
  const ZOOM_OF_ANALOGY = sid("w");
  const FOLLOW = sid("f");
  const OTHER_ROOT = sid("q");
  const SECRET_QUESTION = "question-du-visiteur-à-ne-pas-renvoyer";
  const retitled = SCENES.map((scene) => ({ ...scene, title: `Autre image : ${scene.title}` }));

  function session(): ExplanationRecord[] {
    const child = { parent_id: ROOT, root_id: ROOT };
    return [
      record(FOLLOW, {
        ...child,
        kind: "followup",
        question: SECRET_QUESTION,
        title: "Et si la distance double ?",
        created_at: at(4),
      }),
      record(ZOOM_OF_ANALOGY, {
        kind: "zoom",
        parent_id: ANALOGY,
        root_id: ROOT,
        focus_scene_id: "s2",
        title: "Zoom sur la lampe",
        created_at: at(3),
      }),
      record(ZOOM_OF_ROOT, {
        ...child,
        kind: "zoom",
        focus_scene_id: "s3",
        title: "Zoom sur les masses",
        created_at: at(2),
      }),
      record(ANALOGY, {
        ...child,
        kind: "another_analogy",
        title: "Une autre image",
        created_at: at(1),
        payload: { ...record(ANALOGY).payload, scenes: retitled },
      }),
      record(ROOT, { created_at: at(0) }),
      record(OTHER_ROOT, { title: "Une autre session", created_at: at(0) }),
    ];
  }

  const compact = (items: VersionItem[]) =>
    items.map(({ id, kind, scene_title }) => [id, kind, scene_title]);

  it("lists the whole session from its root, oldest first, with the zoomed scene", async () => {
    boot(session());
    const response = await fetchVersions(ROOT);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const items = await readVersions(response);
    expect(compact(items)).toEqual([
      [ROOT, "initial", null],
      [ANALOGY, "another_analogy", null],
      [ZOOM_OF_ROOT, "zoom", SCENES[2]?.title],
      [ZOOM_OF_ANALOGY, "zoom", retitled[1]?.title],
      [FOLLOW, "followup", null],
    ]);
    expect(items.map(({ title }) => title)).toEqual([
      reference.title,
      "Une autre image",
      "Zoom sur les masses",
      "Zoom sur la lampe",
      "Et si la distance double ?",
    ]);
    expect(items[0]?.created_at).toBe(at(0).toISOString());
  });

  it("returns the same session whichever version is asked", async () => {
    boot(session());
    const fromRoot = await readVersions(await fetchVersions(ROOT));
    for (const id of [ANALOGY, ZOOM_OF_ROOT, ZOOM_OF_ANALOGY, FOLLOW]) {
      expect(await readVersions(await fetchVersions(id))).toEqual(fromRoot);
    }
  });

  it("returns only id, kind, title, created_at and scene_title, never the question", async () => {
    boot(session());
    const response = await fetchVersions(FOLLOW);
    const text = await response.text();
    expect(text).not.toContain(SECRET_QUESTION);
    expect(text).not.toContain(reference.question);
    for (const item of JSON.parse(text) as VersionItem[]) {
      expect(Object.keys(item).sort()).toEqual([
        "created_at",
        "id",
        "kind",
        "scene_title",
        "title",
      ]);
    }
  });

  it("leaves out the other sessions", async () => {
    boot(session());
    const items = await readVersions(await fetchVersions(OTHER_ROOT));
    expect(items.map(({ id }) => id)).toEqual([OTHER_ROOT]);
  });

  it("gives a null scene_title to a zoom whose parent is no longer kept", async () => {
    boot(session().map((item) => (item.id === ANALOGY ? { ...item, expires_at: PAST } : item)));
    const items = await readVersions(await fetchVersions(ROOT));
    expect(compact(items)).toEqual([
      [ROOT, "initial", null],
      [ZOOM_OF_ROOT, "zoom", SCENES[2]?.title],
      [ZOOM_OF_ANALOGY, "zoom", null],
      [FOLLOW, "followup", null],
    ]);
  });

  it("does not list expired versions", async () => {
    boot(session().map((item) => (item.id === FOLLOW ? { ...item, expires_at: PAST } : item)));
    const items = await readVersions(await fetchVersions(ZOOM_OF_ROOT));
    expect(items.map(({ id }) => id)).not.toContain(FOLLOW);
    expect(items).toHaveLength(4);
  });

  it.each(["failed", "refused", "needs_clarification"] as const)(
    "does not list a version whose status is %s",
    async (status) => {
      boot(session().map((item) => (item.id === ANALOGY ? { ...item, status } : item)));
      const items = await readVersions(await fetchVersions(ROOT));
      expect(items.map(({ id }) => id)).not.toContain(ANALOGY);
      expect(items).toHaveLength(4);
    },
  );

  it("lists a version being written", async () => {
    boot(session().map((item) => (item.id === FOLLOW ? { ...item, status: "streaming" } : item)));
    const items = await readVersions(await fetchVersions(ROOT));
    expect(items.map(({ id }) => id)).toContain(FOLLOW);
  });

  it("answers 404 not_found for an unknown id, in the language of Accept-Language", async () => {
    boot(session());
    const response = await fetchVersions(UNKNOWN, { "accept-language": "en" });
    expect(response.status).toBe(404);
    expect(await readError(response)).toEqual({
      error: { code: "not_found", message: errorMessage("en", "not_found") },
    });
  });

  it("answers 404 not_found for a malformed id", async () => {
    boot(session());
    for (const id of ["short", "R".repeat(12), "../etc/passwd", `${"r".repeat(11)}l`]) {
      expect((await fetchVersions(id)).status).toBe(404);
    }
  });

  it("answers 410 expired for an expired id, even when its session is still kept", async () => {
    boot(session().map((item) => (item.id === FOLLOW ? { ...item, expires_at: PAST } : item)));
    const response = await fetchVersions(FOLLOW);
    expect(response.status).toBe(410);
    expect(await readError(response)).toEqual({
      error: { code: "expired", message: errorMessage("fr", "expired") },
    });
  });

  it("answers 500 internal_error, without leaking, when the store fails", async () => {
    const h = boot(session());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(h.store, "listByRoot").mockRejectedValue(new Error("postgres://admin:hunter2@db"));
    const response = await fetchVersions(ROOT);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text)).toEqual({
      error: { code: "internal_error", message: errorMessage("fr", "internal_error") },
    });
  });

  describe("with a reference explanation", () => {
    it("lists the reference alone before any version, without writing anything", async () => {
      const h = boot([]);
      const items = await readVersions(await fetchVersions(REFERENCE_ID));
      expect(items).toEqual([
        {
          id: REFERENCE_ID,
          kind: "reference",
          title: reference.title,
          created_at: new Date(0).toISOString(),
          scene_title: null,
        },
      ]);
      expect(h.store.operations).toEqual([]);
    });

    it("lists the reference once, then its versions, whichever of them is asked", async () => {
      const h = boot([]);
      await run({ mode: "another_analogy", parent_id: REFERENCE_ID, ...BASE });
      await run({ mode: "zoom", parent_id: NEW_ID(1), scene_id: "s3", ...BASE });

      const expected = [
        [REFERENCE_ID, "reference", null],
        [NEW_ID(1), "another_analogy", null],
        [NEW_ID(2), "zoom", h.store.records.get(NEW_ID(1))?.payload.scenes[2]?.title],
      ];
      for (const id of [REFERENCE_ID, NEW_ID(1), NEW_ID(2)]) {
        expect(compact(await readVersions(await fetchVersions(id)))).toEqual(expected);
      }
    });
  });
});

describe("a session built through the API", () => {
  it("lists the question, a reformulation and a zoom of it as one session", async () => {
    const h = boot([]);
    const first = await run({ ...BASE, question: reference.question });
    expect(labels(first.events).at(-1)).toBe("done:ready");
    await run({ mode: "simpler", parent_id: NEW_ID(1), ...BASE });
    await run({ mode: "zoom", parent_id: NEW_ID(2), scene_id: "s3", ...BASE });
    await run({ mode: "followup", parent_id: NEW_ID(1), question: FOLLOWUP, ...BASE });

    const zoomed = h.store.records.get(NEW_ID(2))?.payload.scenes[2]?.title;
    const items = await readVersions(await fetchVersions(NEW_ID(3)));
    expect(items.map(({ id, kind, scene_title }) => [id, kind, scene_title])).toEqual([
      [NEW_ID(1), "initial", null],
      [NEW_ID(2), "simpler", null],
      [NEW_ID(3), "zoom", zoomed],
      [NEW_ID(4), "followup", null],
    ]);
    expect(h.store.records.get(NEW_ID(3))).toMatchObject({
      parent_id: NEW_ID(2),
      root_id: NEW_ID(1),
    });
  });
});
