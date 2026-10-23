import { DocumentSchema, QuizSchema, typesetTexts, type Scene } from "scene";
import { describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import {
  createFixtureProvider,
  type LlmErrorCode,
  type Scenario,
  type ScenarioStep,
} from "../../src/server/llm";
import type { PipelineEvent, SequencedEvent } from "../../src/server/pipeline/events";
import { QUIZ_MARKER, sceneMarker } from "../../src/server/pipeline/prompts";
import { createQuizWriter } from "../../src/server/pipeline/quiz";
import { Pipeline } from "../../src/server/pipeline/run";
import {
  collectEvents,
  FakeVoice,
  MemoryCache,
  MemoryStore,
  sequentialIds,
  spyOn,
  steppingClock,
  traceCollector,
} from "../helpers/fakes";
import { brokenScene, scenarioFromReference } from "../helpers/scenario";

const document = DocumentSchema.parse(reference.payload);
const SCENES = document.scenes;
const SET = typesetTexts(document, "fr");
const WRITTEN = SET.quiz;
const INPUT = { question: reference.question, language: "fr", level: "lycee" } as const;

function harness(scenario: Scenario) {
  const store = new MemoryStore();
  const cache = new MemoryCache();
  const llm = spyOn(createFixtureProvider([scenario]));
  const traces = traceCollector();
  const pipeline = new Pipeline({
    llm,
    store,
    cache,
    voice: new FakeVoice(),
    newId: sequentialIds(),
    now: steppingClock(),
    shareUrl: (id, language) => `https://eureka.test/${language}/e/${id}`,
    writeQuiz: createQuizWriter(llm, traces.trace),
    trace: traces.trace,
  });

  async function run() {
    const started = await pipeline.start(INPUT);
    if (!started.log) throw new Error("Expected a new run, got a cached explanation");
    const events = await collectEvents(started.log);
    return { events, record: await store.get(started.id) };
  }

  const quizCalls = () => llm.calls.filter((call) => call.user.startsWith(QUIZ_MARKER));
  const quizTrace = () => traces.entries.find((entry) => entry.label === "quiz");
  return { cache, run, quizCalls, quizTrace };
}

const eventsOf = <T extends PipelineEvent["type"]>(events: SequencedEvent[], type: T) =>
  events
    .map((item) => item.event)
    .filter((event): event is Extract<PipelineEvent, { type: T }> => event.type === type);

const names = (events: SequencedEvent[]): string[] =>
  events.map(({ event }) => (event.type === "step" ? `${event.name}:${event.status}` : event.type));

const dropping = (index: number): ScenarioStep => ({
  role: "author",
  when: sceneMarker(index),
  repeat: true,
  response: brokenScene(SCENES[index] as Scene),
});

describe("the quiz step of the pipeline", () => {
  it("emits the quiz after the scenes and keeps it in the record", async () => {
    const h = harness(scenarioFromReference(reference, { quiz: {} }));
    const { events, record } = await h.run();

    const tail = names(events).slice(names(events).indexOf("scenes:done"));
    expect(tail).toEqual(["scenes:done", "quiz:started", "quiz", "quiz:done", "done"]);

    const [emitted] = eventsOf(events, "quiz");
    expect(emitted?.quiz).toEqual(WRITTEN);
    expect(record?.payload.quiz).toEqual(WRITTEN);
    expect(QuizSchema.safeParse(record?.payload.quiz).success).toBe(true);
    expect(record?.status).toBe("ready");
    expect(eventsOf(events, "done")[0]?.status).toBe("ready");
    expect(h.quizCalls()).toHaveLength(1);
    expect(h.quizTrace()).toMatchObject({ role: "author", ok: true, attempts: 1 });
  });

  it("asks about the scenes that were kept, with the data in the user message only", async () => {
    const h = harness(scenarioFromReference(reference, { quiz: {} }));
    await h.run();
    const [call] = h.quizCalls();
    expect(call?.role).toBe("author");
    const narration = (SET.scenes[0] as Scene).beats[0]?.narration;
    expect(call?.system).not.toContain(narration);
    expect(call?.user).toContain(narration);
    expect(call?.user).toContain(SET.plan.key_rule.statement);
  });

  it("removes the question about a scene that was dropped and keeps the quiz of the others", async () => {
    const h = harness(scenarioFromReference(reference, { quiz: {}, prepend: [dropping(3)] }));
    const { events, record } = await h.run();

    expect(eventsOf(events, "scene_dropped").map((event) => event.index)).toEqual([3]);
    const quiz = eventsOf(events, "quiz")[0]?.quiz;
    expect(quiz?.questions.map((item) => item.scene_id)).toEqual(["s3", "s3"]);
    expect(record?.payload.quiz).toEqual(quiz);
    expect(record?.status).toBe("partial");
    const [call] = h.quizCalls();
    expect(call?.user).toContain("Scenes not shown, do not ask about them: s4");
    expect(h.quizCalls()).toHaveLength(1);
  });

  it("does not emit a quiz of fewer than two questions, after one new attempt", async () => {
    const h = harness(
      scenarioFromReference(reference, { quiz: { repeat: true }, prepend: [dropping(2)] }),
    );
    const { events, record } = await h.run();

    expect(eventsOf(events, "quiz")).toHaveLength(0);
    expect(names(events).slice(-3)).toEqual(["quiz:started", "quiz:done", "done"]);
    expect(record?.payload.quiz).toBeNull();
    expect(record?.payload.scenes).toHaveLength(5);
    expect(record?.status).toBe("partial");
    expect(h.quizTrace()).toMatchObject({ ok: false, attempts: 2 });
    expect(h.quizTrace()?.rejections).toHaveLength(2);
  });

  it.each<LlmErrorCode>(["timeout", "unavailable", "rate_limited"])(
    "ends with a complete explanation and no quiz when the provider answers %s",
    async (error) => {
      const h = harness(scenarioFromReference(reference, { quiz: { error } }));
      const { events, record } = await h.run();

      expect(eventsOf(events, "error")).toHaveLength(0);
      expect(eventsOf(events, "quiz")).toHaveLength(0);
      expect(eventsOf(events, "scene")).toHaveLength(6);
      expect(eventsOf(events, "done")[0]?.status).toBe("ready");
      expect(record?.status).toBe("ready");
      expect(record?.payload.quiz).toBeNull();
      expect(record?.payload.scenes).toHaveLength(6);
      expect(h.cache.calls.some((call) => call.method === "remember")).toBe(true);
    },
  );

  it("ends with a complete explanation when the scenario has no quiz at all", async () => {
    const h = harness(scenarioFromReference(reference));
    const { events, record } = await h.run();

    expect(eventsOf(events, "quiz")).toHaveLength(0);
    expect(eventsOf(events, "done")[0]?.status).toBe("ready");
    expect(record?.status).toBe("ready");
    expect(record?.payload.quiz).toBeNull();
  });

  it("tries again once when the quiz is not valid JSON, then goes on without it", async () => {
    const h = harness(
      scenarioFromReference(reference, { quiz: { text: "Voici le quiz !", repeat: true } }),
    );
    const { events, record } = await h.run();

    expect(h.quizTrace()).toMatchObject({ ok: false, attempts: 2 });
    expect(eventsOf(events, "quiz")).toHaveLength(0);
    expect(eventsOf(events, "done")[0]?.status).toBe("ready");
    expect(record?.payload.quiz).toBeNull();
  });

  it("keeps the quiz that the second attempt writes", async () => {
    const h = harness(
      scenarioFromReference(reference, {
        prepend: [{ role: "author", when: QUIZ_MARKER, text: "pas de JSON" }],
        quiz: {},
      }),
    );
    const { events, record } = await h.run();

    expect(h.quizTrace()).toMatchObject({ ok: true, attempts: 2 });
    expect(eventsOf(events, "quiz")[0]?.quiz).toEqual(WRITTEN);
    expect(record?.payload.quiz).toEqual(WRITTEN);
  });
});
