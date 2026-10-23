import { DocumentSchema, typeset, typesetTexts, type Outline, type Scene } from "scene";
import { describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import {
  createFixtureProvider,
  type GenerateRequest,
  type LlmProvider,
  type Scenario,
  type ScenarioStep,
} from "../../src/server/llm";
import type { PipelineEvent, SequencedEvent } from "../../src/server/pipeline/events";
import { pipelineMessage } from "../../src/server/pipeline/messages";
import type { ExplanationRecord } from "../../src/server/pipeline/ports";
import {
  FOLLOWUP_CHECK_MARKER,
  LEVEL_GUIDE,
  modeMarker,
  OUTLINE_MARKER,
  sceneMarker,
  type Analogy,
} from "../../src/server/pipeline/prompts";
import { ParentNotFoundError, Pipeline, type PipelineRequest } from "../../src/server/pipeline/run";
import {
  collectEvents,
  FakeVoice,
  MemoryCache,
  MemoryStore,
  sequentialIds,
  spyOn,
  steppingClock,
  traceCollector,
  type RecordedCall,
} from "../helpers/fakes";
import { acceptance, scenarioFromReference, type ReferenceFile } from "../helpers/scenario";

const DOCUMENT = DocumentSchema.parse(reference.payload);
const OUTLINE: Outline = { plan: DOCUMENT.plan, params: DOCUMENT.params, model: DOCUMENT.model };
const SCENES = DOCUMENT.scenes;
const LAMP = DOCUMENT.plan.analogy;
const SPEAKER: Analogy = {
  name: "Le haut-parleur qu'on entend moins de loin",
  mapping:
    "Le haut-parleur joue le rôle de la masse ; le son reçu joue le rôle de la force ; il faiblit comme le carré de la distance.",
};
const PAINT: Analogy = {
  name: "La bombe de peinture",
  mapping:
    "La peinture d'un jet se répartit sur une surface quatre fois plus grande à distance double : chaque point en reçoit quatre fois moins.",
};
const FOLLOWUP = "et si la distance double ?";
const UNRELATED = "comment les plantes fabriquent-elles leur sucre ?";
const PARENT_ID = "p00000000001";
const REFERENCE_ID = "ref000000001";
const BASE = { language: "fr", level: "lycee" } as const;

const GRAVITY = scenarioFromReference(reference);
const JUDGE_VALID: ScenarioStep = {
  role: "judge",
  repeat: true,
  response: { verdict: "valid", issues: [], reason: "Le plan est exact." },
};
const CHECK_VALID: ScenarioStep = {
  role: "checker",
  when: "Step of the plan for this scene",
  repeat: true,
  response: { verdict: "valid", problem: "", reason: "La scène dit ce que dit le plan." },
};

function withAnalogy(analogy: Analogy): Outline {
  return { ...OUTLINE, plan: { ...OUTLINE.plan, analogy } };
}

const SIMPLER_OUTLINE: Outline = {
  ...OUTLINE,
  plan: {
    ...OUTLINE.plan,
    prerequisites: OUTLINE.plan.prerequisites.slice(0, 2),
    steps: OUTLINE.plan.steps.filter((step) => step.role !== "formula"),
  },
};

const ZOOM_OUTLINE: Outline = {
  ...OUTLINE,
  plan: {
    ...OUTLINE.plan,
    objective: "Comprendre pourquoi les deux flèches restent égales quand la distance change.",
    key_rule: { statement: "La Terre et la Lune s'attirent avec des forces égales et opposées." },
    steps: [
      {
        role: "mechanism",
        intent: "Voir que les deux flèches ont toujours la même longueur.",
        visual: "La Terre et la Lune, deux flèches F égales ; la Lune s'éloigne.",
      },
      {
        role: "mechanism",
        intent: "Voir que la distance change les deux flèches à la fois.",
        visual: "r double, les deux flèches F rétrécissent ensemble.",
      },
    ],
  },
};

const FOLLOWUP_OUTLINE: Outline = {
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
      {
        role: "mechanism",
        intent: "Voir la force diminuer quand la Lune s'éloigne.",
        visual: "La Terre et la Lune ; r double, les flèches F rétrécissent.",
      },
      {
        role: "example",
        intent: "Comparer la force à r et à 2r.",
        visual: "Deux barres : F et F_2r, la seconde quatre fois plus courte.",
      },
    ],
  },
};

const sceneSteps = (scenes: readonly Scene[]): ScenarioStep[] =>
  scenes.map((scene, index) => ({ role: "author", when: sceneMarker(index), response: scene }));

const byIndex = (...indexes: number[]): Scene[] => indexes.map((index) => SCENES[index] as Scene);

function scenario(name: string, question: string, steps: ScenarioStep[]): Scenario {
  return { name, question, steps: [...steps, JUDGE_VALID, CHECK_VALID] };
}

const ANOTHER_ANALOGY = scenario("modes.another-analogy", modeMarker("another_analogy"), [
  { role: "author", when: modeMarker("another_analogy"), response: withAnalogy(SPEAKER) },
  ...sceneSteps(SCENES),
]);

const SIMPLER = scenario("modes.simpler", modeMarker("simpler"), [
  { role: "author", when: modeMarker("simpler"), response: SIMPLER_OUTLINE },
  ...sceneSteps(byIndex(0, 1, 2, 4, 5)),
]);

const ZOOM = scenario("modes.zoom", modeMarker("zoom"), [
  { role: "author", when: modeMarker("zoom"), response: ZOOM_OUTLINE },
  ...sceneSteps(byIndex(2, 2)),
]);

const relatedCheck: ScenarioStep = {
  role: "triage",
  when: FOLLOWUP_CHECK_MARKER,
  response: { related: true, title: "Et si la distance double ?", detected_language: "fr" },
};

const RELATED = scenario("modes.followup", FOLLOWUP, [
  relatedCheck,
  { role: "author", when: modeMarker("followup"), response: FOLLOWUP_OUTLINE },
  ...sceneSteps(byIndex(2, 4)),
]);

const FREE_FALL: ReferenceFile = {
  ...reference,
  slug: "physics/free-fall",
  title: "La chute libre",
  subject: "physics",
};

function unrelated(triage: unknown): Scenario {
  return scenario("modes.unrelated", UNRELATED, [
    {
      role: "triage",
      when: FOLLOWUP_CHECK_MARKER,
      response: { related: false, title: "", detected_language: "fr" },
    },
    { role: "author", when: modeMarker("followup"), response: FOLLOWUP_OUTLINE, delayMs: 40 },
    { role: "triage", response: triage },
    { role: "author", when: OUTLINE_MARKER, response: OUTLINE },
    ...sceneSteps(SCENES),
  ]);
}

function parentRecord(id: string, patch: Partial<ExplanationRecord> = {}): ExplanationRecord {
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
    payload: {
      version: 1,
      plan: OUTLINE.plan,
      params: OUTLINE.params,
      model: OUTLINE.model,
      scenes: SCENES,
      quiz: null,
    },
    verdicts: [],
    scene_count_planned: SCENES.length,
    provider: "fixture",
    model: "fixture",
    timings: {},
    created_at: new Date("2026-02-20T09:00:00.000Z"),
    completed_at: new Date("2026-02-20T09:00:30.000Z"),
    expires_at: new Date("2026-05-20T09:00:00.000Z"),
    ...patch,
  };
}

interface SignalledCall {
  role: string;
  user: string;
  signal: AbortSignal | undefined;
}

function recordSignals(inner: LlmProvider, calls: SignalledCall[]): LlmProvider {
  return {
    ...inner,
    generateObject<T>(request: GenerateRequest<T>) {
      calls.push({
        role: request.role,
        user: request.messages.map((message) => message.content).join("\n"),
        signal: request.signal,
      });
      return inner.generateObject(request);
    },
  };
}

interface Options {
  parents?: ExplanationRecord[];
  references?: ExplanationRecord[];
}

function harness(scenarios: Scenario[], options: Options = {}) {
  const store = new MemoryStore();
  for (const parent of options.parents ?? [parentRecord(PARENT_ID)]) {
    store.records.set(parent.id, structuredClone(parent));
  }
  const references = new Map((options.references ?? []).map((record) => [record.id, record]));
  const cache = new MemoryCache();
  const voice = new FakeVoice();
  const signals: SignalledCall[] = [];
  const llm = spyOn(recordSignals(createFixtureProvider([GRAVITY, ...scenarios]), signals));
  const quizzes: string[] = [];
  const traces = traceCollector();
  const pipeline = new Pipeline({
    llm,
    store,
    cache,
    voice,
    newId: sequentialIds(),
    now: steppingClock(),
    shareUrl: (id, language) => `https://eureka.test/${language}/e/${id}`,
    trace: traces.trace,
    findReference: async (id) => structuredClone(references.get(id) ?? null),
    writeQuiz: async ({ traceId }) => {
      quizzes.push(traceId);
      return null;
    },
  });

  async function run(input: PipelineRequest) {
    const started = await pipeline.start(input);
    if (!started.log) throw new Error("Expected a new run");
    const events = await collectEvents(started.log);
    return { id: started.id, events, record: await store.get(started.id) };
  }

  const calls = (id: string, select: (call: RecordedCall) => boolean = () => true) =>
    llm.calls.filter((call) => call.traceId === id && select(call));

  const rejections = (label: string): string[] =>
    traces.entries.filter((entry) => entry.label === label).flatMap((entry) => entry.rejections);

  return { pipeline, store, cache, llm, signals, quizzes, run, calls, rejections };
}

function label({ event }: SequencedEvent): string {
  switch (event.type) {
    case "step":
      return `step:${event.name}:${event.status}`;
    case "verdict":
      return `verdict:${event.target}:${event.status}`;
    case "scene":
      return `scene:${event.index}`;
    case "done":
      return `done:${event.status}`;
    case "error":
      return `error:${event.code}`;
    default:
      return event.type;
  }
}

const labels = (events: SequencedEvent[]): string[] => events.map(label);

function eventOf<T extends PipelineEvent["type"]>(events: SequencedEvent[], type: T) {
  return events
    .map((item) => item.event)
    .find((event): event is Extract<PipelineEvent, { type: T }> => event.type === type);
}

const HEAD = [
  "accepted",
  "step:triage:started",
  "step:triage:done",
  "meta",
  "step:plan:started",
  "step:plan:done",
  "step:verify_plan:started",
  "step:verify_plan:done",
];

function expected(count: number, { quiz, plan = "validated" }: { quiz: boolean; plan?: string }) {
  return [
    ...HEAD,
    `verdict:plan:${plan}`,
    "plan",
    "step:scenes:started",
    ...Array.from({ length: count }, (_, i) => [
      `verdict:s${i + 1}:validated`,
      `scene:${i}`,
    ]).flat(),
    "step:scenes:done",
    ...(quiz ? ["step:quiz:started", "step:quiz:done"] : []),
    "done:ready",
  ];
}

const isOutline = (call: RecordedCall): boolean =>
  call.role === "author" && call.user.startsWith(OUTLINE_MARKER);
const isScene = (call: RecordedCall): boolean =>
  call.role === "author" && call.user.startsWith("SCENE ");

const PARENT_META = {
  type: "meta",
  title: reference.title,
  subject: "physics",
  concept_slug: reference.slug,
  deep_eligible: false,
  detected_language: "fr",
};

describe("another analogy", () => {
  it("writes a full new version from the parent, with the event sequence of a question", async () => {
    const h = harness([ANOTHER_ANALOGY]);
    const { id, events, record } = await h.run({
      mode: "another_analogy",
      parent_id: PARENT_ID,
      ...BASE,
    });
    expect(labels(events)).toEqual(expected(6, { quiz: true }));
    expect(eventOf(events, "meta")).toEqual(PARENT_META);
    expect(eventOf(events, "plan")?.plan.analogy).toEqual(typesetTexts(SPEAKER, "fr"));

    expect(record).toMatchObject({
      kind: "another_analogy",
      parent_id: PARENT_ID,
      root_id: PARENT_ID,
      focus_scene_id: null,
      question: reference.question,
      language: "fr",
      level: "lycee",
      concept_slug: reference.slug,
      title: reference.title,
      status: "ready",
      scene_count_planned: 6,
    });
    expect(record?.expires_at).not.toBeNull();
    expect(h.quizzes).toEqual([id]);
    expect(h.calls(id, (call) => call.role === "triage")).toEqual([]);
    expect(h.cache.calls).toEqual([]);
  });

  it("gives the outline writer the parent outline and every analogy of the session", async () => {
    const middle = parentRecord("p00000000002", {
      kind: "another_analogy",
      parent_id: PARENT_ID,
      root_id: PARENT_ID,
      payload: { ...parentRecord("x").payload, plan: withAnalogy(SPEAKER).plan },
    });
    const h = harness(
      [
        scenario("modes.third-analogy", modeMarker("another_analogy"), [
          {
            role: "author",
            when: modeMarker("another_analogy"),
            response: withAnalogy({ name: "La lampe de poche", mapping: "La lumière faiblit." }),
          },
          { role: "author", when: modeMarker("another_analogy"), response: withAnalogy(PAINT) },
          ...sceneSteps(SCENES),
        ]),
      ],
      { parents: [parentRecord(PARENT_ID), middle] },
    );
    const { id, events, record } = await h.run({
      mode: "another_analogy",
      parent_id: middle.id,
      ...BASE,
    });
    expect(labels(events)).toEqual(expected(6, { quiz: true, plan: "corrected" }));

    const [outline] = h.calls(id, isOutline);
    expect(outline?.user).toContain(JSON.stringify(withAnalogy(SPEAKER)));
    expect(outline?.user).toContain(`- ${SPEAKER.name}: ${SPEAKER.mapping}`);
    expect(outline?.user).toContain(`- ${LAMP.name}: ${LAMP.mapping}`);
    expect(h.rejections("outline")).toEqual([
      expect.stringContaining('plan.analogy: "La lampe de poche" repeats the analogy'),
    ]);

    expect(record?.payload.plan?.analogy).toEqual(typesetTexts(PAINT, "fr"));
    expect(record).toMatchObject({ parent_id: middle.id, root_id: PARENT_ID });
    expect(record?.verdicts[0]).toMatchObject({ target: "plan", status: "corrected", attempts: 2 });
  });

  it("stores a reference parent once, so that new versions can point at it", async () => {
    const referenceRecord = parentRecord(REFERENCE_ID, {
      kind: "reference",
      provider: "reference",
      model: "reference",
      expires_at: null,
    });
    const h = harness([ANOTHER_ANALOGY], { parents: [], references: [referenceRecord] });
    const request = { mode: "another_analogy", parent_id: REFERENCE_ID, ...BASE } as const;
    const first = await h.run(request);
    const second = await h.run(request);

    expect(first.record).toMatchObject({ parent_id: REFERENCE_ID, root_id: REFERENCE_ID });
    expect(second.record?.status).toBe("ready");
    expect(h.store.operationsOn(REFERENCE_ID)).toEqual(["create"]);
    expect(await h.store.get(REFERENCE_ID)).toMatchObject({ kind: "reference", status: "ready" });
  });
});

describe("simpler", () => {
  it("goes one level down, never above the parent, and asks for fewer notions", async () => {
    const h = harness([SIMPLER]);
    const { id, events, record } = await h.run({
      mode: "simpler",
      parent_id: PARENT_ID,
      language: "fr",
      level: "superieur",
    });
    expect(labels(events)).toEqual(expected(5, { quiz: true }));
    expect(record).toMatchObject({ kind: "simpler", level: "college", scene_count_planned: 5 });

    const [outline] = h.calls(id, isOutline);
    expect(outline?.system).toContain(`Audience: ${LEVEL_GUIDE.college}`);
    expect(outline?.system).toContain(`written for this audience: ${LEVEL_GUIDE.lycee}`);
    expect(outline?.system).toContain("Mode: simpler");
    for (const call of h.calls(id)) {
      expect(call.system).not.toContain(LEVEL_GUIDE.superieur);
    }
  });
});

describe("zoom", () => {
  it("writes a short answer on the designated scene only, without quiz", async () => {
    const h = harness([ZOOM]);
    const { id, events, record } = await h.run({
      mode: "zoom",
      parent_id: PARENT_ID,
      scene_id: "s3",
      ...BASE,
    });
    expect(labels(events)).toEqual(expected(2, { quiz: false }));
    expect(eventOf(events, "plan")?.scene_count).toBe(2);
    expect(record).toMatchObject({
      kind: "zoom",
      parent_id: PARENT_ID,
      root_id: PARENT_ID,
      focus_scene_id: "s3",
      scene_count_planned: 2,
      status: "ready",
    });
    expect(h.quizzes).toEqual([]);

    const [outline] = h.calls(id, isOutline);
    expect(outline?.user).toContain('step 3 of 6, scene "s3"');
    expect(outline?.user).not.toContain('"id":"apple"');
    for (const scene of h.calls(id, isScene)) {
      expect(scene.system).toContain("Continuity");
      expect(scene.user).toContain('"id":"sys"');
    }
  });

  it("refuses a scene the parent does not have, before creating anything", async () => {
    const h = harness([ZOOM]);
    const attempt = h.pipeline.start({
      mode: "zoom",
      parent_id: PARENT_ID,
      scene_id: "s9",
      ...BASE,
    });
    await expect(attempt).rejects.toBeInstanceOf(ParentNotFoundError);
    await expect(attempt).rejects.toMatchObject({ code: "parent_not_found" });
    expect(h.store.operations).toEqual([]);
    expect(h.llm.calls).toEqual([]);
  });
});

describe("follow-up question", () => {
  it("answers in short scenes that keep the parameters and objects of the parent", async () => {
    const h = harness([RELATED]);
    const { id, events, record } = await h.run({
      mode: "followup",
      parent_id: PARENT_ID,
      question: FOLLOWUP,
      ...BASE,
    });
    expect(labels(events)).toEqual(expected(2, { quiz: false }));
    expect(eventOf(events, "meta")).toEqual({
      ...PARENT_META,
      title: typeset("Et si la distance double ?", "fr"),
    });
    expect(record).toMatchObject({
      kind: "followup",
      parent_id: PARENT_ID,
      root_id: PARENT_ID,
      question: FOLLOWUP,
      scene_count_planned: 2,
      status: "ready",
    });
    expect(record?.payload.params.map((param) => [param.id, param.symbol, param.unit])).toEqual(
      OUTLINE.params.map((param) => [param.id, param.symbol, param.unit]),
    );

    const [check] = h.calls(id, (call) => call.role === "triage");
    expect(check?.user.startsWith(FOLLOWUP_CHECK_MARKER)).toBe(true);
    const [outline] = h.calls(id, isOutline);
    expect(outline?.user).toContain(`<student_text>\n${FOLLOWUP}\n</student_text>`);
    expect(outline?.system).not.toContain(FOLLOWUP);
    for (const scene of h.calls(id, isScene)) {
      expect(scene.user).toContain('"id":"earth"');
      expect(scene.system).toContain("Continuity");
    }
    const [judge] = h.calls(id, (call) => call.role === "judge");
    expect(judge?.user.startsWith(`Concept: ${reference.title}\n`)).toBe(true);
    expect(h.cache.calls).toEqual([]);
  });

  it("sends back an outline that renames the unit of a parameter of the parent", async () => {
    const kilometres = structuredClone(FOLLOWUP_OUTLINE);
    const r = kilometres.params.find((param) => param.id === "r");
    if (r) r.unit = "km";
    const h = harness([
      scenario("modes.followup-units", FOLLOWUP, [
        relatedCheck,
        { role: "author", when: modeMarker("followup"), response: kilometres },
        { role: "author", when: modeMarker("followup"), response: FOLLOWUP_OUTLINE },
        ...sceneSteps(byIndex(2, 4)),
      ]),
    ]);
    const { record } = await h.run({
      mode: "followup",
      parent_id: PARENT_ID,
      question: FOLLOWUP,
      ...BASE,
    });
    expect(h.rejections("outline")).toEqual([
      expect.stringContaining('params › r: the previous explanation writes it "r" with "m"'),
    ]);
    expect(record?.payload.params.find((param) => param.id === "r")?.unit).toBe("m");
    expect(record?.status).toBe("ready");
  });

  it("bounds the level to the parent and keeps the language of the parent", async () => {
    const h = harness([RELATED]);
    const { id, record } = await h.run({
      mode: "followup",
      parent_id: PARENT_ID,
      question: FOLLOWUP,
      language: "en",
      level: "superieur",
    });
    expect(record).toMatchObject({ language: "fr", level: "lycee" });
    for (const call of h.calls(id, (item) => item.role !== "triage")) {
      expect(call.system).not.toContain(LEVEL_GUIDE.superieur);
    }
    const [outline] = h.calls(id, isOutline);
    expect(outline?.system).toContain("write every text in French");
  });

  it("is redirected as a new question when it is unrelated, and cancels the follow-up outline", async () => {
    const h = harness([unrelated(acceptance(FREE_FALL))]);
    const { id, events, record } = await h.run({
      mode: "followup",
      parent_id: PARENT_ID,
      question: UNRELATED,
      language: "fr",
      level: "college",
    });
    expect(labels(events)).toEqual([
      "accepted",
      "step:triage:started",
      "redirected",
      ...expected(6, { quiz: true }).slice(2),
    ]);
    expect(eventOf(events, "redirected")).toEqual({
      type: "redirected",
      reason: "unrelated_followup",
    });
    expect(eventOf(events, "meta")).toMatchObject({
      title: FREE_FALL.title,
      concept_slug: FREE_FALL.slug,
    });
    expect(record).toMatchObject({
      kind: "initial",
      parent_id: null,
      root_id: id,
      focus_scene_id: null,
      question: UNRELATED,
      level: "college",
      concept_slug: FREE_FALL.slug,
      status: "ready",
    });
    expect(h.cache.calls).toContainEqual({
      method: "remember",
      id,
      entry: { question: UNRELATED, slug: FREE_FALL.slug, language: "fr", level: "college" },
    });

    const speculative = h.signals.find((call) => call.user.includes(modeMarker("followup")));
    expect(speculative?.signal?.aborted).toBe(true);
    const triage = h.calls(id, (call) => call.role === "triage").map((call) => call.user);
    expect(triage[0]?.startsWith(FOLLOWUP_CHECK_MARKER)).toBe(true);
    expect(triage[1]).toContain(`<student_text>\n${UNRELATED}\n</student_text>`);
    for (const scene of h.calls(id, isScene)) {
      expect(scene.system).not.toContain(FOLLOWUP_OUTLINE.plan.objective);
      expect(scene.system).not.toContain("Continuity");
    }
  });

  it("ends refused when the redirected question is not a school question", async () => {
    const reason = "Je peux t'expliquer une notion de cours, pas autre chose.";
    const h = harness([
      unrelated({
        decision: "refuse",
        reason,
        concept: null,
        interpretations: [],
        detected_language: "fr",
        deep_eligible: false,
      }),
    ]);
    const { id, events, record } = await h.run({
      mode: "followup",
      parent_id: PARENT_ID,
      question: UNRELATED,
      ...BASE,
    });
    expect(labels(events)).toEqual([
      "accepted",
      "step:triage:started",
      "redirected",
      "step:triage:done",
      "refused",
    ]);
    expect(record).toMatchObject({ kind: "initial", parent_id: null, status: "refused" });
    expect(h.calls(id, isScene)).toEqual([]);
    expect(h.signals.every((call) => call.signal?.aborted)).toBe(true);
  });

  it("serves the cached explanation of the redirected concept", async () => {
    const h = harness([unrelated(acceptance(FREE_FALL))]);
    h.cache.seed("c00000000001", {
      question: "la chute des corps",
      slug: FREE_FALL.slug,
      language: "fr",
      level: "lycee",
    });
    const { id, events } = await h.run({
      mode: "followup",
      parent_id: PARENT_ID,
      question: UNRELATED,
      ...BASE,
    });
    expect(labels(events)).toEqual([
      "accepted",
      "step:triage:started",
      "redirected",
      "step:triage:done",
      "cached",
    ]);
    expect(eventOf(events, "cached")).toEqual({ type: "cached", explanation_id: "c00000000001" });
    expect(await h.store.get(id)).toBeNull();
  });

  it("fails cleanly and cancels the follow-up outline when the check cannot run", async () => {
    const h = harness([
      scenario("modes.followup-down", FOLLOWUP, [
        { ...relatedCheck, response: undefined, error: "unavailable" },
        { role: "author", when: modeMarker("followup"), response: FOLLOWUP_OUTLINE, delayMs: 40 },
      ]),
    ]);
    const { id, events, record } = await h.run({
      mode: "followup",
      parent_id: PARENT_ID,
      question: FOLLOWUP,
      ...BASE,
    });
    expect(labels(events)).toEqual([
      "accepted",
      "step:triage:started",
      "error:generation_unavailable",
    ]);
    expect(record?.status).toBe("failed");
    expect(h.signals.find((call) => call.role === "author")?.signal?.aborted).toBe(true);
    expect(h.calls(id, isScene)).toEqual([]);
  });
});

describe("parents", () => {
  const modes: PipelineRequest[] = [
    { mode: "another_analogy", parent_id: "unknown", ...BASE },
    { mode: "simpler", parent_id: "unknown", ...BASE },
    { mode: "zoom", parent_id: "unknown", scene_id: "s1", ...BASE },
    { mode: "followup", parent_id: "unknown", question: FOLLOWUP, ...BASE },
  ];

  it.each(modes.map((request) => [request.mode, request] as const))(
    "rejects %s on an unknown parent with parent_not_found, before creating anything",
    async (_mode, request) => {
      const h = harness([]);
      await expect(h.pipeline.start(request)).rejects.toMatchObject({
        name: "ParentNotFoundError",
        code: "parent_not_found",
      });
      expect(h.store.operations).toEqual([]);
      expect(h.llm.calls).toEqual([]);
    },
  );

  it.each(["failed", "refused", "needs_clarification", "streaming"] as const)(
    "rejects a parent whose status is %s",
    async (status) => {
      const h = harness([ANOTHER_ANALOGY], { parents: [parentRecord(PARENT_ID, { status })] });
      await expect(
        h.pipeline.start({ mode: "another_analogy", parent_id: PARENT_ID, ...BASE }),
      ).rejects.toBeInstanceOf(ParentNotFoundError);
      expect(h.store.operations).toEqual([]);
    },
  );

  it("reports a new version that cannot be written with its own message", async () => {
    const h = harness([
      scenario("modes.analogy-down", modeMarker("another_analogy"), [
        { role: "author", when: modeMarker("another_analogy"), error: "invalid_output" },
      ]),
    ]);
    const { events, record } = await h.run({
      mode: "another_analogy",
      parent_id: PARENT_ID,
      ...BASE,
    });
    expect(eventOf(events, "error")).toEqual({
      type: "error",
      code: "generation_failed",
      message: pipelineMessage("fr", "versionFailed"),
    });
    expect(record?.status).toBe("failed");
  });
});
