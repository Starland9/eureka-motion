import { fileURLToPath } from "node:url";
import { typeset } from "scene";
import { describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { createFixtureProvider, loadScenarios } from "../../src/server/llm";
import type { PipelineEvent, SequencedEvent } from "../../src/server/pipeline/events";
import { Pipeline, type PipelineRequest } from "../../src/server/pipeline/run";
import {
  collectEvents,
  FakeVoice,
  MemoryCache,
  MemoryStore,
  sequentialIds,
  steppingClock,
} from "../helpers/fakes";
import {
  FOLLOWUP_QUESTION,
  modeScenarios,
  UNRELATED_QUESTION,
  type ReferenceFile,
} from "../helpers/scenario";

const DIRECTORY = fileURLToPath(new URL("../fixtures/scenarios", import.meta.url));
const BASE = { language: "fr", level: "lycee" } as const;

function session() {
  const store = new MemoryStore();
  const cache = new MemoryCache();
  const pipeline = new Pipeline({
    llm: createFixtureProvider(loadScenarios(DIRECTORY)),
    store,
    cache,
    voice: new FakeVoice(),
    newId: sequentialIds(),
    now: steppingClock(),
    shareUrl: (id, language) => `https://eureka.test/${language}/e/${id}`,
    writeQuiz: async () => null,
  });

  async function run(input: PipelineRequest) {
    const started = await pipeline.start(input);
    if (!started.log) throw new Error("Expected a new run");
    const events = await collectEvents(started.log);
    return { id: started.id, events, record: await store.get(started.id) };
  }

  return { run };
}

function names(events: SequencedEvent[]): PipelineEvent["type"][] {
  return events.map(({ event }) => event.type);
}

function titles(events: SequencedEvent[]): string[] {
  return events.flatMap(({ event }) => (event.type === "scene" ? [event.scene.title] : []));
}

describe("committed scenarios of the four modes", () => {
  it("are the ones the build script writes", () => {
    const committed = loadScenarios(DIRECTORY);
    for (const scenario of modeScenarios(reference as ReferenceFile)) {
      expect(committed).toContainEqual(JSON.parse(JSON.stringify(scenario)));
    }
    expect(committed.map((scenario) => scenario.name)).toContain("gravity.fr");
  });

  it("replay as a chain of five versions, each derived from the one displayed", async () => {
    const h = session();
    const first = await h.run({ question: reference.question, ...BASE });
    expect(first.record).toMatchObject({ kind: "initial", status: "ready" });

    const another = await h.run({ mode: "another_analogy", parent_id: first.id, ...BASE });
    expect(another.record).toMatchObject({ kind: "another_analogy", status: "ready" });
    expect(another.record?.payload.plan?.analogy.name).toContain("haut-parleur");
    expect(another.record?.payload.scenes).toHaveLength(6);

    const simpler = await h.run({ mode: "simpler", parent_id: another.id, ...BASE });
    expect(simpler.record).toMatchObject({ kind: "simpler", level: "college", status: "ready" });
    expect(simpler.record?.payload.scenes).toHaveLength(5);

    const zoom = await h.run({
      mode: "zoom",
      parent_id: simpler.id,
      scene_id: "s3",
      language: "fr",
      level: "college",
    });
    expect(zoom.record).toMatchObject({ kind: "zoom", focus_scene_id: "s3", status: "ready" });
    expect(titles(zoom.events)).toEqual([
      "Deux flèches égales",
      "La distance change les deux flèches",
    ]);

    const followup = await h.run({
      mode: "followup",
      parent_id: zoom.id,
      question: FOLLOWUP_QUESTION,
      language: "fr",
      level: "college",
    });
    expect(followup.record).toMatchObject({ kind: "followup", status: "ready" });
    expect(followup.record?.payload.scenes).toHaveLength(2);
    expect(followup.record?.title).toBe(typeset("Et si la distance double ?", "fr"));

    const chain = [first, another, simpler, zoom, followup];
    expect(chain.map(({ record }) => record?.root_id)).toEqual(chain.map(() => first.id));
    expect(chain.map(({ record }) => record?.parent_id)).toEqual([
      null,
      ...chain.slice(0, -1).map(({ id }) => id),
    ]);
  });

  it("replay an unrelated follow-up as a free question of its own", async () => {
    const h = session();
    const first = await h.run({ question: reference.question, ...BASE });
    const { id, events, record } = await h.run({
      mode: "followup",
      parent_id: first.id,
      question: UNRELATED_QUESTION,
      ...BASE,
    });
    expect(names(events)).toContain("redirected");
    expect(names(events).at(-1)).toBe("done");
    expect(record).toMatchObject({
      kind: "initial",
      root_id: id,
      parent_id: null,
      question: UNRELATED_QUESTION,
      status: "ready",
    });
    expect(record?.payload.scenes).toHaveLength(6);
  });
});
