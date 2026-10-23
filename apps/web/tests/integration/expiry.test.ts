import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DocumentSchema, type Outline, type Scene } from "scene";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { createFixtureProvider, type Scenario, type ScenarioStep } from "../../src/server/llm";
import { SHARE_RETENTION_DAYS, type ExplanationRecord } from "../../src/server/pipeline/ports";
import { FOLLOWUP_CHECK_MARKER, modeMarker, sceneMarker } from "../../src/server/pipeline/prompts";
import { Pipeline, type PipelineRequest } from "../../src/server/pipeline/run";
import { listReferences, loadReferenceRecord } from "../../src/server/reference";
import {
  collectEvents,
  FakeVoice,
  MemoryCache,
  MemoryStore,
  sequentialIds,
  steppingClock,
} from "../helpers/fakes";
import { scenarioFromReference } from "../helpers/scenario";

const DAY_MS = 24 * 60 * 60 * 1000;
const PARENT_ID = "p00000000001";
const BASE = { language: "fr", level: "lycee" } as const;

const DOCUMENT = DocumentSchema.parse(reference.payload);
const OUTLINE: Outline = { plan: DOCUMENT.plan, params: DOCUMENT.params, model: DOCUMENT.model };
const SCENES = DOCUMENT.scenes;
const byIndex = (...indexes: number[]): Scene[] => indexes.map((index) => SCENES[index] as Scene);

const sceneSteps = (scenes: readonly Scene[]): ScenarioStep[] =>
  scenes.map((scene, index) => ({ role: "author", when: sceneMarker(index), response: scene }));

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

const withPlan = (plan: Partial<Outline["plan"]>): Outline => ({
  ...OUTLINE,
  plan: { ...OUTLINE.plan, ...plan },
});

const ANOTHER_ANALOGY = scenario("expiry.another-analogy", modeMarker("another_analogy"), [
  {
    role: "author",
    when: modeMarker("another_analogy"),
    response: withPlan({
      analogy: {
        name: "Le haut-parleur qu'on entend moins de loin",
        mapping:
          "Le haut-parleur joue le rôle de la masse ; le son reçu joue le rôle de la force ; il faiblit comme le carré de la distance.",
      },
    }),
  },
  ...sceneSteps(SCENES),
]);

const SIMPLER = scenario("expiry.simpler", modeMarker("simpler"), [
  {
    role: "author",
    when: modeMarker("simpler"),
    response: withPlan({
      prerequisites: OUTLINE.plan.prerequisites.slice(0, 2),
      steps: OUTLINE.plan.steps.filter((step) => step.role !== "formula"),
    }),
  },
  ...sceneSteps(byIndex(0, 1, 2, 4, 5)),
]);

const ZOOM = scenario("expiry.zoom", modeMarker("zoom"), [
  {
    role: "author",
    when: modeMarker("zoom"),
    response: withPlan({
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
    }),
  },
  ...sceneSteps(byIndex(2, 2)),
]);

const FOLLOWUP_QUESTION = "et si la distance double ?";
const FOLLOWUP = scenario("expiry.followup", FOLLOWUP_QUESTION, [
  {
    role: "triage",
    when: FOLLOWUP_CHECK_MARKER,
    response: { related: true, title: "Et si la distance double ?", detected_language: "fr" },
  },
  {
    role: "author",
    when: modeMarker("followup"),
    response: withPlan({
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
    }),
  },
  ...sceneSteps(byIndex(2, 4)),
]);

function parentRecord(): ExplanationRecord {
  return {
    id: PARENT_ID,
    kind: "initial",
    parent_id: null,
    root_id: PARENT_ID,
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
    created_at: new Date("2026-02-20T09:00:00.000Z"),
    completed_at: new Date("2026-02-20T09:00:30.000Z"),
    expires_at: new Date("2026-05-20T09:00:00.000Z"),
  };
}

let referenceDir: string;
let referenceRecord: ExplanationRecord;

beforeAll(async () => {
  referenceDir = await mkdtemp(path.join(tmpdir(), "expiry-"));
  await writeFile(
    path.join(referenceDir, "physics.universal-gravitation.fr.json"),
    JSON.stringify(reference),
  );
  const [entry] = await listReferences("fr", referenceDir);
  const loaded = entry ? await loadReferenceRecord(entry.explanation_id, referenceDir) : null;
  if (!loaded) throw new Error("The reference explanation could not be loaded");
  referenceRecord = loaded;
});

afterAll(async () => {
  await rm(referenceDir, { recursive: true, force: true });
});

function harness(scenarios: Scenario[], parents: ExplanationRecord[] = [parentRecord()]) {
  const store = new MemoryStore();
  for (const parent of parents) store.records.set(parent.id, structuredClone(parent));
  const pipeline = new Pipeline({
    llm: createFixtureProvider([scenarioFromReference(reference), ...scenarios]),
    store,
    cache: new MemoryCache(),
    voice: new FakeVoice(),
    newId: sequentialIds(),
    now: steppingClock(),
    shareUrl: (id, language) => `https://eureka.test/${language}/e/${id}`,
    findReference: async (id) =>
      structuredClone(id === referenceRecord.id ? referenceRecord : null),
    writeQuiz: async () => null,
  });

  async function run(input: PipelineRequest) {
    const started = await pipeline.start(input);
    if (!started.log) throw new Error("Expected a new run");
    await collectEvents(started.log);
    const record = await store.get(started.id);
    if (!record) throw new Error("The run left no record");
    return record;
  }

  return { store, run };
}

const DERIVED: [string, Scenario, PipelineRequest][] = [
  ["another_analogy", ANOTHER_ANALOGY, { mode: "another_analogy", parent_id: PARENT_ID, ...BASE }],
  ["simpler", SIMPLER, { mode: "simpler", parent_id: PARENT_ID, ...BASE }],
  ["zoom", ZOOM, { mode: "zoom", parent_id: PARENT_ID, scene_id: "s3", ...BASE }],
  [
    "followup",
    FOLLOWUP,
    { mode: "followup", parent_id: PARENT_ID, question: FOLLOWUP_QUESTION, ...BASE },
  ],
];

function expectExpiresAfterRetention(record: ExplanationRecord): void {
  expect(record.status).toBe("ready");
  expect(record.completed_at).toBeInstanceOf(Date);
  expect(record.expires_at?.getTime()).toBe(record.completed_at!.getTime() + 90 * DAY_MS);
  expect(record.expires_at!.getTime()).toBeGreaterThanOrEqual(
    record.created_at.getTime() + 90 * DAY_MS,
  );
}

describe("expiry of the explanations the pipeline creates", () => {
  it("keeps a share link for 90 days", () => {
    expect(SHARE_RETENTION_DAYS).toBe(90);
  });

  it("expires a free question 90 days after it was created", async () => {
    const h = harness([]);
    expectExpiresAfterRetention(await h.run({ question: reference.question, ...BASE }));
  });

  it.each(DERIVED)(
    "expires a %s version 90 days after it was created",
    async (mode, wanted, request) => {
      const h = harness([wanted]);
      const record = await h.run(request);
      expect(record.kind).toBe(mode);
      expectExpiresAfterRetention(record);
    },
  );

  it("never expires the reference copied for a new version, while the version expires", async () => {
    expect(referenceRecord.kind).toBe("reference");
    expect(referenceRecord.expires_at).toBeNull();

    const h = harness([ANOTHER_ANALOGY], []);
    const version = await h.run({
      mode: "another_analogy",
      parent_id: referenceRecord.id,
      ...BASE,
    });

    expect(version.parent_id).toBe(referenceRecord.id);
    expectExpiresAfterRetention(version);
    expect(h.store.operationsOn(referenceRecord.id)).toEqual(["create"]);
    expect((await h.store.get(referenceRecord.id))?.expires_at).toBeNull();
  });
});
