import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DocumentSchema, type Outline, type Scene } from "scene";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { GET as getDeep } from "@/app/api/explanations/[id]/deep/route";
import { GET as getEvents } from "@/app/api/explanations/[id]/events/route";
import { setContainerForTests, setJobsForTests, type Container } from "@/server/container";
import { createExplanationCache } from "@/server/db";
import type { Database } from "@/server/db/client";
import { createJobs, type Jobs } from "@/server/db/jobs";
import { jobs } from "@/server/db/schema";
import { createExplanationStore } from "@/server/db/store";
import { errorMessage } from "@/server/http/errors";
import { createFixtureProvider, type Scenario, type ScenarioStep } from "@/server/llm";
import type { PipelineEvent, SequencedEvent } from "@/server/pipeline/events";
import type { ExplanationRecord, PipelineDeps } from "@/server/pipeline/ports";
import { modeMarker, sceneMarker } from "@/server/pipeline/prompts";
import type { Subject } from "@/server/pipeline/prompts/schemas";
import { Pipeline, type PipelineRequest, type StartInput } from "@/server/pipeline/run";
import { loadReferenceRecord, referenceId } from "@/server/reference";
import {
  collectEvents,
  FakeVoice,
  MemoryCache,
  MemoryStore,
  sequentialIds,
  spyOn,
  steppingClock,
} from "../helpers/fakes";
import { describeTarget, openTestDatabase, testDatabaseUrl } from "../helpers/db";
import { brokenScene, scenarioFromReference, sceneIdKey } from "../helpers/scenario";
import { eventsIn, readSse } from "../helpers/sse";

const DATABASE = "eureka_deep_test";
const database = await openTestDatabase(DATABASE);
const target = describeTarget(testDatabaseUrl(DATABASE));
if (!database) console.warn(`PostgreSQL is unreachable at ${target}: integration tests skipped`);

const ORIGIN = "http://localhost:3000";
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "connection refused to postgres://admin:hunter2@10.0.0.5:5432/eureka";
const T0 = new Date("2026-03-04T10:00:00.000Z");
// Far enough ahead that a stored explanation never expires during a test.
const CLOCK_START = new Date("2099-01-01T09:00:00.000Z");
const INPUT: StartInput = { question: reference.question, language: "fr", level: "lycee" };
const DOCUMENT = DocumentSchema.parse(reference.payload);
const SCENES = DOCUMENT.scenes;
const OUTLINE: Outline = { plan: DOCUMENT.plan, params: DOCUMENT.params, model: DOCUMENT.model };
const PARENT_ID = "p00000000001";
const REFERENCE_ID = referenceId("physics/universal-gravitation", "fr");

function triage(subject: Subject, deepEligible: boolean) {
  return {
    decision: "accept",
    reason: "",
    concept: { slug: reference.slug, title: reference.title, subject },
    interpretations: [],
    detected_language: "fr",
    deep_eligible: deepEligible,
  };
}

function conceptScenario(
  subject: Subject,
  deepEligible: boolean,
  options: Parameters<typeof scenarioFromReference>[1] = {},
): Scenario {
  return scenarioFromReference(reference, {
    ...options,
    replace: { ...options.replace, triage: { response: triage(subject, deepEligible) } },
  });
}

const MATHS = conceptScenario("maths", true);
const HISTORY = conceptScenario("other", false);

type Enqueue = NonNullable<PipelineDeps["enqueueDeep"]>;

function memoryPipeline(scenarios: Scenario[], enqueue?: Enqueue | null) {
  const store = new MemoryStore();
  store.records.set(PARENT_ID, parentRecord());
  const cache = new MemoryCache();
  const queued: string[] = [];
  const record: Enqueue = async (id) => {
    queued.push(id);
  };
  const pipeline = new Pipeline({
    llm: spyOn(createFixtureProvider(scenarios)),
    store,
    cache,
    voice: new FakeVoice(),
    newId: sequentialIds(),
    now: steppingClock(),
    shareUrl: (id, language) => `https://eureka.test/${language}/e/${id}`,
    ...(enqueue === null ? {} : { enqueueDeep: enqueue ?? record }),
  });

  async function run(input: PipelineRequest = INPUT) {
    const started = await pipeline.start(input);
    if (!started.log) throw new Error("Expected a new run, got a cached explanation");
    const events = await collectEvents(started.log);
    return { id: started.id, events, record: await store.get(started.id) };
  }

  return { pipeline, store, cache, queued, run };
}

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
    expires_at: new Date("2099-01-01T00:00:00.000Z"),
  };
}

const typesOf = (events: SequencedEvent[]): PipelineEvent["type"][] =>
  events.map(({ event }) => event.type);

function deepEvents(events: SequencedEvent[]): PipelineEvent[] {
  return events.map(({ event }) => event).filter((event) => event.type === "deep");
}

function endOf(events: SequencedEvent[]): PipelineEvent | undefined {
  return events.at(-1)?.event;
}

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

function derived(mode: "another_analogy" | "simpler", outline: Outline, scenes: Scene[]): Scenario {
  const marker = modeMarker(mode);
  return {
    name: `deep.${mode}`,
    question: marker,
    steps: [
      { role: "author", when: marker, response: outline },
      ...scenes.map<ScenarioStep>((scene, index) => ({
        role: "author",
        when: sceneMarker(index),
        response: scene,
      })),
      JUDGE_VALID,
      CHECK_VALID,
    ],
  };
}

const ANOTHER_ANALOGY = derived(
  "another_analogy",
  {
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
  SCENES,
);

const SIMPLER = derived(
  "simpler",
  {
    ...OUTLINE,
    plan: {
      ...OUTLINE.plan,
      prerequisites: OUTLINE.plan.prerequisites.slice(0, 2),
      steps: OUTLINE.plan.steps.filter((step) => step.role !== "formula"),
    },
  },
  [0, 1, 2, 4, 5].map((index) => SCENES[index] as Scene),
);

describe("the deep version at the end of the pipeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queues one deep job for a maths concept and announces it just before done", async () => {
    const h = memoryPipeline([MATHS]);
    const { id, events, record } = await h.run();

    expect(h.queued).toEqual([id]);
    expect(deepEvents(events)).toEqual([{ type: "deep", status: "queued" }]);
    expect(typesOf(events).slice(-2)).toEqual(["deep", "done"]);
    expect(endOf(events)).toMatchObject({ type: "done", status: "ready" });
    expect(record?.status).toBe("ready");
  });

  it("queues the job for a physics concept too, and announces it in the same order", async () => {
    const h = memoryPipeline([conceptScenario("physics", true)]);
    const { id, events } = await h.run();
    expect(h.queued).toEqual([id]);
    expect(typesOf(events).slice(-2)).toEqual(["deep", "done"]);
  });

  it("queues the job only once the explanation is stored as ready", async () => {
    const h = memoryPipeline([MATHS], async (id) => {
      expect((await h.store.get(id))?.status).toBe("ready");
      h.queued.push(id);
    });
    const { id } = await h.run();
    expect(h.queued).toEqual([id]);
  });

  it("marks the meta event as eligible when the triage said so", async () => {
    const { events } = await memoryPipeline([MATHS]).run();
    const meta = events.map(({ event }) => event).find((event) => event.type === "meta");
    expect(meta).toMatchObject({ subject: "maths", deep_eligible: true });
  });

  it("queues the job for a partial explanation", async () => {
    const h = memoryPipeline([
      conceptScenario("maths", true, {
        prepend: [
          {
            role: "checker",
            when: sceneIdKey(3),
            repeat: true,
            response: {
              verdict: "invalid",
              problem: "Le balayage ne correspond pas.",
              reason: "x",
            },
          },
        ],
        replace: { scenes: { 3: { repeat: true } } },
      }),
    ]);
    const { id, events, record } = await h.run();
    expect(record?.status).toBe("partial");
    expect(h.queued).toEqual([id]);
    expect(typesOf(events).slice(-2)).toEqual(["deep", "done"]);
    expect(endOf(events)).toMatchObject({ type: "done", status: "partial" });
  });

  it("queues nothing and announces nothing for a history concept", async () => {
    const h = memoryPipeline([HISTORY]);
    const { events, record } = await h.run();
    expect(h.queued).toEqual([]);
    expect(typesOf(events)).not.toContain("deep");
    expect(endOf(events)).toMatchObject({ type: "done", status: "ready" });
    expect(record?.status).toBe("ready");
  });

  it("queues nothing when the triage flags a subject that is neither maths nor physics", async () => {
    const h = memoryPipeline([conceptScenario("other", true)]);
    const { events } = await h.run();
    expect(h.queued).toEqual([]);
    expect(typesOf(events)).not.toContain("deep");
    const meta = events.map(({ event }) => event).find((event) => event.type === "meta");
    expect(meta).toMatchObject({ deep_eligible: false });
  });

  it("queues nothing for a maths concept the triage did not flag", async () => {
    const h = memoryPipeline([conceptScenario("maths", false)]);
    const { events } = await h.run();
    expect(h.queued).toEqual([]);
    expect(typesOf(events)).not.toContain("deep");
  });

  it("ends ready, announces nothing and logs the error when the job cannot be created", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error(SECRET);
    const h = memoryPipeline([MATHS], async () => {
      throw failure;
    });
    const { id, events, record } = await h.run();

    expect(record?.status).toBe("ready");
    expect(typesOf(events)).not.toContain("deep");
    expect(typesOf(events)).not.toContain("error");
    expect(endOf(events)).toMatchObject({ type: "done", status: "ready" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(id), failure);
  });

  it("does not let a queue that throws before returning a promise fail the explanation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = memoryPipeline([MATHS], () => {
      throw new Error("synchronous failure");
    });
    const { events } = await h.run();
    expect(typesOf(events)).not.toContain("deep");
    expect(endOf(events)).toMatchObject({ type: "done", status: "ready" });
  });

  it("still remembers the explanation in the cache when the job cannot be created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = memoryPipeline([MATHS], async () => {
      throw new Error("down");
    });
    const { id } = await h.run();
    expect(await h.cache.findByQuestion(INPUT.question, { language: "fr", level: "lycee" })).toBe(
      id,
    );
  });

  it("runs as before when no queue is provided", async () => {
    const h = memoryPipeline([MATHS], null);
    const { events } = await h.run();
    expect(typesOf(events)).not.toContain("deep");
    expect(endOf(events)).toMatchObject({ type: "done", status: "ready" });
  });

  it("queues nothing when the generation fails", async () => {
    const h = memoryPipeline([
      conceptScenario("maths", true, {
        prepend: SCENES.map((scene) => ({
          role: "author" as const,
          when: sceneMarker(scene.index),
          repeat: true,
          response: brokenScene(scene),
        })),
      }),
    ]);
    const { events, record } = await h.run();
    expect(record?.status).toBe("failed");
    expect(endOf(events)).toMatchObject({ type: "error", code: "generation_failed" });
    expect(h.queued).toEqual([]);
    expect(typesOf(events)).not.toContain("deep");
  });

  it.each([
    ["another analogy", "another_analogy", ANOTHER_ANALOGY],
    ["a simpler version", "simpler", SIMPLER],
  ] as const)("queues nothing for %s of an explanation", async (_label, mode, scenario) => {
    const h = memoryPipeline([scenario]);
    const { events, record } = await h.run({
      mode,
      parent_id: PARENT_ID,
      language: "fr",
      level: "lycee",
    });
    expect(record?.status).toBe("ready");
    expect(endOf(events)).toMatchObject({ type: "done", status: "ready" });
    expect(h.queued).toEqual([]);
    expect(typesOf(events)).not.toContain("deep");
  });

  it("queues no second job for a question answered from the cache", async () => {
    const h = memoryPipeline([MATHS]);
    const first = await h.run();
    expect(h.queued).toEqual([first.id]);

    const again = await h.pipeline.start(INPUT);
    expect(again).toEqual({ id: first.id, cached: true, log: null });
    expect(h.queued).toEqual([first.id]);
  });

  it("queues no second job when another wording leads to a concept already explained", async () => {
    const question = "pourquoi la pomme tombe-t-elle ?";
    const h = memoryPipeline([
      MATHS,
      scenarioFromReference(reference, {
        question,
        name: "deep.apple",
        replace: { triage: { response: triage("maths", true) } },
      }),
    ]);
    const first = await h.run();
    const second = await h.run({ ...INPUT, question });
    expect(typesOf(second.events)).toContain("cached");
    expect(typesOf(second.events)).not.toContain("deep");
    expect(h.queued).toEqual([first.id]);
  });
});

describe.skipIf(!database)(
  database
    ? `deep version on ${target}`
    : `deep version (skipped: PostgreSQL unreachable at ${target})`,
  () => {
    let db: Database;
    let store: ReturnType<typeof createExplanationStore>;
    let queue: Jobs;
    let mediaDir: string;
    let time = T0.getTime();
    let counter = 0;

    const now = () => new Date(time);
    const advance = (ms: number) => {
      time += ms;
    };

    const LETTERS = "abcdefghjkmnpqrstuvwxyz";
    function nextId(): string {
      counter += 1;
      return (
        "k".repeat(10) +
        LETTERS[Math.floor(counter / LETTERS.length)]! +
        LETTERS[counter % LETTERS.length]!
      );
    }

    async function explanation(overrides: Partial<ExplanationRecord> = {}) {
      const loaded = await loadReferenceRecord(REFERENCE_ID);
      if (!loaded) throw new Error("The gravitation reference is missing from the repository");
      const id = overrides.id ?? nextId();
      const record: ExplanationRecord = {
        ...loaded,
        id,
        kind: "initial",
        root_id: id,
        status: "ready",
        created_at: T0,
        completed_at: T0,
        expires_at: new Date(Date.now() + 90 * DAY),
        ...overrides,
      };
      await store.create(record);
      return record;
    }

    async function writeDeep(id: string) {
      await mkdir(path.join(mediaDir, id), { recursive: true });
      await writeFile(path.join(mediaDir, id, "deep.mp4"), "video");
    }

    async function giveUp(id: string) {
      const job = await queue.enqueue(id, "deep");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await queue.reserve("deep");
        await queue.fail(job.id, SECRET);
      }
      return job;
    }

    async function jobRows() {
      return db.select().from(jobs);
    }

    function useRoutes(): void {
      setContainerForTests({
        store,
        pipeline: { logFor: () => undefined },
      } as unknown as Container);
      setJobsForTests(queue);
    }

    function requestDeep(id: string, headers: Record<string, string> = {}) {
      return getDeep(new Request(`${ORIGIN}/api/explanations/${id}/deep`, { headers }), {
        params: Promise.resolve({ id }),
      });
    }

    function requestEvents(id: string) {
      return getEvents(new Request(`${ORIGIN}/api/explanations/${id}/events`), {
        params: Promise.resolve({ id }),
      });
    }

    async function replayed(id: string): Promise<PipelineEvent[]> {
      const messages = eventsIn(await readSse(await requestEvents(id)));
      return messages.map(({ type, data }) => ({ type, ...data }) as PipelineEvent);
    }

    beforeAll(async () => {
      if (!database) return;
      db = database.db;
      store = createExplanationStore(db);
      mediaDir = await mkdtemp(path.join(tmpdir(), "eureka-deep-"));
      vi.stubEnv("MEDIA_DIR", mediaDir);
    });

    beforeEach(async () => {
      time = T0.getTime();
      queue = createJobs(db, { now });
      await database?.reset();
      useRoutes();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      setContainerForTests(undefined);
      setJobsForTests(undefined);
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await rm(mediaDir, { recursive: true, force: true });
      await database?.close();
    });

    describe("the pipeline with the real store and queue", () => {
      function pipelineOn(scenarios: Scenario[]) {
        return new Pipeline({
          llm: createFixtureProvider(scenarios),
          store,
          cache: createExplanationCache(db),
          voice: new FakeVoice(),
          newId: nextId,
          now: steppingClock(CLOCK_START),
          shareUrl: (id, language) => `/${language}/e/${id}`,
          enqueueDeep: async (id) => {
            await queue.enqueue(id, "deep");
          },
        });
      }

      async function run(scenarios: Scenario[]) {
        const started = await pipelineOn(scenarios).start(INPUT);
        if (!started.log) throw new Error("Expected a new run");
        return { id: started.id, events: await collectEvents(started.log) };
      }

      it("writes one queued deep job for a maths concept and the route reads it back", async () => {
        const { id, events } = await run([MATHS]);
        expect(typesOf(events).slice(-2)).toEqual(["deep", "done"]);

        expect(await jobRows()).toEqual([
          expect.objectContaining({
            explanation_id: id,
            type: "deep",
            status: "queued",
            attempts: 0,
            result_url: null,
          }),
        ]);
        const response = await requestDeep(id);
        expect(await response.json()).toEqual({ status: "queued", result_url: null });
      });

      it("writes no job for a history concept, and the route answers none", async () => {
        const { id, events } = await run([HISTORY]);
        expect(typesOf(events)).not.toContain("deep");
        expect(await jobRows()).toEqual([]);
        expect(await (await requestDeep(id)).json()).toEqual({ status: "none", result_url: null });
      });

      it("keeps the explanation ready when the queue is unreachable", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const broken = new Pipeline({
          llm: createFixtureProvider([MATHS]),
          store,
          cache: createExplanationCache(db),
          voice: new FakeVoice(),
          newId: nextId,
          now: steppingClock(CLOCK_START),
          shareUrl: (id, language) => `/${language}/e/${id}`,
          enqueueDeep: () => queue.enqueue("kkkkkkkkkkkk", "deep").then(() => undefined),
        });
        const started = await broken.start(INPUT);
        const events = await collectEvents(started.log!);
        expect(typesOf(events)).not.toContain("deep");
        expect(endOf(events)).toMatchObject({ type: "done", status: "ready" });
        expect((await store.get(started.id))?.status).toBe("ready");
        expect(console.error).toHaveBeenCalledTimes(1);
        expect(await jobRows()).toEqual([]);
      });
    });

    describe("GET /api/explanations/{id}/deep", () => {
      it("answers none when no job exists", async () => {
        const { id } = await explanation();
        const response = await requestDeep(id);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ status: "none", result_url: null });
      });

      it("answers queued for a job nobody has taken", async () => {
        const { id } = await explanation();
        await queue.enqueue(id, "deep");
        expect(await (await requestDeep(id)).json()).toEqual({
          status: "queued",
          result_url: null,
        });
      });

      it("answers running for a job a worker holds", async () => {
        const { id } = await explanation();
        await queue.enqueue(id, "deep");
        await queue.reserve("deep");
        const response = await requestDeep(id);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ status: "running", result_url: null });
      });

      it("answers queued again for a job sent back after a failed attempt", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "deep");
        await queue.reserve("deep");
        await queue.fail(job.id, SECRET);
        expect(await (await requestDeep(id)).json()).toEqual({
          status: "queued",
          result_url: null,
        });
      });

      it("answers ready with the address of the video once the job succeeded and the file exists", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "deep");
        await queue.reserve("deep");
        await queue.succeed(job.id, `/media/${id}/deep.mp4`);
        await writeDeep(id);
        const response = await requestDeep(id);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          status: "ready",
          result_url: `/media/${id}/deep.mp4`,
        });
      });

      it("keeps running while the job runs, even if the file is already there", async () => {
        const { id } = await explanation();
        await queue.enqueue(id, "deep");
        await queue.reserve("deep");
        await writeDeep(id);
        expect(await (await requestDeep(id)).json()).toEqual({
          status: "running",
          result_url: null,
        });
      });

      it("keeps queued while the job waits, even if a file is already there", async () => {
        const { id } = await explanation();
        await queue.enqueue(id, "deep");
        await writeDeep(id);
        expect(await (await requestDeep(id)).json()).toEqual({
          status: "queued",
          result_url: null,
        });
      });

      it("answers none, not ready, when the job succeeded but the file is gone", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "deep");
        await queue.reserve("deep");
        await queue.succeed(job.id, `/media/${id}/deep.mp4`);
        expect(await (await requestDeep(id)).json()).toEqual({ status: "none", result_url: null });
      });

      it("does not take a file of another explanation for its own", async () => {
        const first = await explanation();
        const second = await explanation();
        const job = await queue.enqueue(first.id, "deep");
        await queue.reserve("deep");
        await queue.succeed(job.id, `/media/${first.id}/deep.mp4`);
        await writeDeep(second.id);
        expect(await (await requestDeep(first.id)).json()).toEqual({
          status: "none",
          result_url: null,
        });
      });

      it("answers abandoned once the job gave up, without the error of the job", async () => {
        const { id } = await explanation();
        await giveUp(id);
        const response = await requestDeep(id);
        const text = await response.text();
        expect(response.status).toBe(200);
        expect(JSON.parse(text)).toEqual({ status: "abandoned", result_url: null });
        expect(text).not.toContain("hunter2");
      });

      it("answers abandoned for a job that failed", async () => {
        const { id } = await explanation();
        await db.insert(jobs).values({
          explanation_id: id,
          type: "deep",
          status: "failed",
          attempts: 1,
          error: SECRET,
          created_at: now(),
          finished_at: now(),
        });
        const text = await (await requestDeep(id)).text();
        expect(JSON.parse(text)).toEqual({ status: "abandoned", result_url: null });
        expect(text).not.toContain("hunter2");
      });

      it("answers abandoned even if a video file is there", async () => {
        const { id } = await explanation();
        await giveUp(id);
        await writeDeep(id);
        expect(await (await requestDeep(id)).json()).toEqual({
          status: "abandoned",
          result_url: null,
        });
      });

      it("reads the latest job when an older one was abandoned", async () => {
        const { id } = await explanation();
        await giveUp(id);
        advance(60 * 1000);
        await queue.enqueue(id, "deep");
        expect(await (await requestDeep(id)).json()).toEqual({
          status: "queued",
          result_url: null,
        });
      });

      it("ignores the export job of the same explanation", async () => {
        const { id } = await explanation();
        await queue.enqueue(id, "export");
        expect(await (await requestDeep(id)).json()).toEqual({ status: "none", result_url: null });
      });

      it("answers none for an explanation that is not finished", async () => {
        const { id } = await explanation({ status: "streaming" });
        expect(await (await requestDeep(id)).json()).toEqual({ status: "none", result_url: null });
      });

      it("answers none for a reference explanation without a deep file, with no database", async () => {
        setJobsForTests({
          ...queue,
          latest: () => Promise.reject(new Error(SECRET)),
        });
        const response = await requestDeep(REFERENCE_ID);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ status: "none", result_url: null });
      });

      it("answers ready for a reference explanation that has a deep file", async () => {
        await writeDeep(REFERENCE_ID);
        expect(await (await requestDeep(REFERENCE_ID)).json()).toEqual({
          status: "ready",
          result_url: `/media/${REFERENCE_ID}/deep.mp4`,
        });
        await rm(path.join(mediaDir, REFERENCE_ID), { recursive: true, force: true });
      });

      it.each([
        ["malformed", "not-an-id"],
        ["too short", "kkkk"],
        ["an injection attempt", "' or 1=1 --"],
      ])("answers 404 for an id that is %s", async (_label, id) => {
        const response = await requestDeep(id, { "accept-language": "en" });
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: { code: "not_found", message: errorMessage("en", "not_found") },
        });
      });

      it("answers 404 for an explanation that does not exist", async () => {
        const response = await requestDeep("kkkkkkkkkkkk", { "accept-language": "fr" });
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
          error: { code: "not_found", message: errorMessage("fr", "not_found") },
        });
      });

      it("answers 410 for an explanation whose link expired", async () => {
        const { id } = await explanation({ expires_at: new Date(Date.now() - DAY) });
        await queue.enqueue(id, "deep");
        const response = await requestDeep(id, { "accept-language": "en" });
        expect(response.status).toBe(410);
        expect(await response.json()).toEqual({
          error: { code: "expired", message: errorMessage("en", "expired") },
        });
      });

      it("hides the details of an unexpected failure", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { id } = await explanation();
        setJobsForTests({ ...queue, latest: () => Promise.reject(new Error(SECRET)) });
        const response = await requestDeep(id);
        const text = await response.text();
        expect(response.status).toBe(500);
        expect(text).not.toContain("hunter2");
        expect(error).toHaveBeenCalled();
      });
    });

    describe("replaying a finished explanation", () => {
      it("announces a deep version that is queued, right before done", async () => {
        const { id } = await explanation();
        await queue.enqueue(id, "deep");
        const events = await replayed(id);
        expect(events.map((event) => event.type).slice(-2)).toEqual(["deep", "done"]);
        expect(events.filter((event) => event.type === "deep")).toEqual([
          { type: "deep", status: "queued" },
        ]);
      });

      it("announces the running and the ready states", async () => {
        const { id } = await explanation();
        const job = await queue.enqueue(id, "deep");
        await queue.reserve("deep");
        expect((await replayed(id)).filter((event) => event.type === "deep")).toEqual([
          { type: "deep", status: "running" },
        ]);

        await queue.succeed(job.id, `/media/${id}/deep.mp4`);
        await writeDeep(id);
        expect((await replayed(id)).filter((event) => event.type === "deep")).toEqual([
          { type: "deep", status: "ready" },
        ]);
      });

      it.each(["none", "abandoned"])("announces nothing when the state is %s", async (state) => {
        const { id } = await explanation();
        if (state === "abandoned") await giveUp(id);
        const events = await replayed(id);
        expect(events.some((event) => event.type === "deep")).toBe(false);
        expect(events.at(-1)?.type).toBe("done");
      });

      it("replays a reference explanation with a deep file as ready, and without one as before", async () => {
        expect((await replayed(REFERENCE_ID)).some((event) => event.type === "deep")).toBe(false);
        await writeDeep(REFERENCE_ID);
        const events = await replayed(REFERENCE_ID);
        expect(events.map((event) => event.type).slice(-2)).toEqual(["deep", "done"]);
        expect(events.at(-2)).toEqual({ type: "deep", status: "ready" });
        await rm(path.join(mediaDir, REFERENCE_ID), { recursive: true, force: true });
      });

      it("replays the explanation without the announcement when the queue does not answer", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { id } = await explanation();
        setJobsForTests({ ...queue, latest: () => Promise.reject(new Error(SECRET)) });
        const events = await replayed(id);
        expect(events.some((event) => event.type === "deep")).toBe(false);
        expect(events.at(-1)).toMatchObject({ type: "done", status: "ready" });
        expect(error).toHaveBeenCalledTimes(1);
      });

      it("keeps the sequence numbers consecutive with the announcement in place", async () => {
        const { id } = await explanation();
        await queue.enqueue(id, "deep");
        const messages = eventsIn(await readSse(await requestEvents(id)));
        expect(messages.map((message) => message.id)).toEqual(messages.map((_, i) => i + 1));
      });
    });
  },
);
