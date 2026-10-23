import {
  DocumentSchema,
  QuizSchema,
  typesetTexts,
  validateDocument,
  type Language,
  type Outline,
  type Quiz,
  type QuizQuestion,
  type Scene,
} from "scene";
import { describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import {
  LlmError,
  type GenerateRequest,
  type GenerateResult,
  type LlmErrorCode,
  type LlmProvider,
  type RawCall,
} from "../../src/server/llm";
import { generateWithRetries } from "../../src/server/llm/generate";
import type { LlmTrace } from "../../src/server/pipeline/ports";
import {
  arrangeChoices,
  assembleQuiz,
  createQuizWriter,
  curateQuestions,
} from "../../src/server/pipeline/quiz";
import {
  buildQuizPrompt,
  LANGUAGE_NAME,
  LEVEL_GUIDE,
  OUTLINE_MARKER,
  QUIZ_MARKER,
} from "../../src/server/pipeline/prompts";

const document = DocumentSchema.parse(reference.payload);
const OUTLINE: Outline = { plan: document.plan, params: document.params, model: document.model };
const SCENES: Scene[] = document.scenes;
const REFERENCE_QUIZ = document.quiz as Quiz;
const SCENE_IDS = new Set(SCENES.map((scene) => scene.id));
const WITHOUT_S4 = SCENES.filter((scene) => scene.id !== "s4");
const TRACE_ID = "t00000000001";

function question(sceneId: string, answerAt: number, size = 3, tag = ""): QuizQuestion {
  return {
    prompt: `Que se passe-t-il ${tag}${sceneId} ?`,
    choices: Array.from({ length: size }, (_, index) => ({
      id: "abcd".charAt(index),
      text: `Réponse ${tag}${sceneId}${index}`,
    })),
    answer_id: "abcd".charAt(answerAt),
    explanation: "Parce que la scène le montre.",
    scene_id: sceneId,
  };
}

const answerAt = (item: QuizQuestion): number =>
  item.choices.findIndex((choice) => choice.id === item.answer_id);
const rightText = (item: QuizQuestion): string | undefined =>
  item.choices.find((choice) => choice.id === item.answer_id)?.text;

function scripted(...replies: unknown[]) {
  const calls: RawCall[] = [];
  const provider: LlmProvider = {
    name: "scripted",
    modelFor: () => "scripted",
    health: async () => ({ ok: true, latencyMs: 0 }),
    generateObject: <T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> =>
      generateWithRetries(request, async (raw) => {
        calls.push(raw);
        const reply = replies[calls.length - 1];
        if (reply === undefined) throw new LlmError("unavailable", raw.role, "No more replies.");
        if (reply instanceof LlmError) throw reply;
        const text = typeof reply === "string" ? reply : JSON.stringify(reply);
        return { text, usage: { inputTokens: 1, outputTokens: 1 }, model: "scripted" };
      }),
  };
  return { provider, calls };
}

function writer(
  provider: LlmProvider,
  options: { scenes?: Scene[]; language?: Language; trace?: (entry: LlmTrace) => void } = {},
) {
  const write = createQuizWriter(provider, options.trace);
  return () =>
    write({
      outline: OUTLINE,
      scenes: options.scenes ?? SCENES,
      language: options.language ?? "fr",
      level: "lycee",
      traceId: TRACE_ID,
    });
}

const reply = (...questions: unknown[]): { questions: unknown[] } => ({ questions });
const failure = (code: LlmErrorCode): LlmError => new LlmError(code, "author", `failed: ${code}`);

describe("buildQuizPrompt", () => {
  const prompt = buildQuizPrompt({
    outline: OUTLINE,
    scenes: SCENES,
    language: "fr",
    level: "lycee",
  });
  const user = prompt.messages.map((message) => message.content).join("\n");

  it("keeps the system instructions free of the explanation it is about", () => {
    const other = buildQuizPrompt({
      outline: OUTLINE,
      scenes: WITHOUT_S4,
      language: "fr",
      level: "lycee",
    });
    expect(other.system).toBe(prompt.system);
    expect(prompt.system).not.toContain(document.plan.objective);
    expect(prompt.system).not.toContain((SCENES[0] as Scene).beats[0]?.narration);
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.messages[0]?.role).toBe("user");
  });

  it("gives the writer what the scenes showed: narration, titles, labels and the ids to cite", () => {
    expect(user).toContain((SCENES[0] as Scene).beats[0]?.narration);
    expect(user).toContain((SCENES[3] as Scene).title);
    expect(user).toContain('"Lune"');
    expect(user).toContain("the only valid scene_id values: s1, s2, s3, s4, s5, s6");
    expect(user).toContain(document.plan.key_rule.statement);
    expect(user).not.toContain("not shown");
  });

  it("leaves out a dropped scene and names it so that nothing is asked about it", () => {
    const partial = buildQuizPrompt({
      outline: OUTLINE,
      scenes: WITHOUT_S4,
      language: "fr",
      level: "lycee",
    }).messages[0]?.content as string;
    expect(partial).toContain("the only valid scene_id values: s1, s2, s3, s5, s6");
    expect(partial).toContain("Scenes not shown, do not ask about them: s4");
    expect(partial).not.toContain('"id":"s4"');
    expect(partial).not.toContain((SCENES[3] as Scene).title);
  });

  it("states the audience, the counts and the shape of the answer", () => {
    expect(prompt.system).toContain(LANGUAGE_NAME.fr);
    expect(prompt.system).toContain(LEVEL_GUIDE.lycee);
    const english = buildQuizPrompt({
      outline: OUTLINE,
      scenes: SCENES,
      language: "en",
      level: "college",
    });
    expect(english.system).toContain(LANGUAGE_NAME.en);
    expect(english.system).toContain(LEVEL_GUIDE.college);
    expect(prompt.system).toMatch(/3 questions .* otherwise 2/);
    expect(prompt.system).toMatch(/3 or 4 choices/);
    expect(prompt.system).toMatch(/Exactly one choice is right/);
    expect(prompt.system).toMatch(/ONE sentence/);
    expect(prompt.system).toMatch(/plausible mistake/);
    expect(prompt.system).toMatch(/same form and about the same length/);
    expect(prompt.system).toMatch(/"answer_id"/);
  });

  it("starts with a marker that no other step of the pipeline looks for", () => {
    expect(user.startsWith(`${QUIZ_MARKER}\n`)).toBe(true);
    expect(user).not.toContain(OUTLINE_MARKER);
    expect(user).not.toMatch(/SCENE \d/);
  });
});

describe("createQuizWriter", () => {
  it("returns a well-formed quiz as it was written, apart from the typography", async () => {
    const { provider, calls } = scripted(reply(...REFERENCE_QUIZ.questions));
    const quiz = await writer(provider)();
    expect(quiz).toEqual(typesetTexts(REFERENCE_QUIZ, "fr"));
    expect(QuizSchema.safeParse(quiz).success).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("produces a quiz that the validation of a whole explanation accepts", async () => {
    const { provider } = scripted(reply(...REFERENCE_QUIZ.questions));
    const quiz = await writer(provider)();
    expect(validateDocument({ ...(reference.payload as object), quiz }).ok).toBe(true);
  });

  it("gives 2 or 3 questions, 3 or 4 choices, one right answer and a scene that exists", async () => {
    const { provider } = scripted(
      reply(question("s2", 1, 4), question("s3", 2), question("s5", 0)),
    );
    const quiz = (await writer(provider)()) as Quiz;
    expect(quiz.questions.length).toBeGreaterThanOrEqual(2);
    expect(quiz.questions.length).toBeLessThanOrEqual(3);
    for (const item of quiz.questions) {
      const ids = item.choices.map((choice) => choice.id);
      expect(item.choices.length).toBeGreaterThanOrEqual(3);
      expect(item.choices.length).toBeLessThanOrEqual(4);
      expect(new Set(ids).size).toBe(ids.length);
      expect(item.choices.filter((choice) => choice.id === item.answer_id)).toHaveLength(1);
      expect(SCENE_IDS.has(item.scene_id)).toBe(true);
      expect(item.explanation.length).toBeGreaterThan(0);
    }
  });

  it("asks the author role for a short answer, with one new attempt at most", async () => {
    const { provider, calls } = scripted(reply(...REFERENCE_QUIZ.questions));
    await writer(provider)();
    const [call] = calls;
    expect(call?.role).toBe("author");
    expect(call?.traceId).toBe(TRACE_ID);
    expect(call?.timeoutMs).toBeLessThanOrEqual(15_000);
    expect(call?.maxTokens).toBeLessThanOrEqual(2_000);
    expect(call?.messages[0]?.content.startsWith(QUIZ_MARKER)).toBe(true);
  });

  it("removes the question whose scene was dropped and keeps the others", async () => {
    const { provider, calls } = scripted(reply(...REFERENCE_QUIZ.questions));
    const quiz = await writer(provider, { scenes: WITHOUT_S4 })();
    expect(quiz?.questions.map((item) => item.scene_id)).toEqual(["s3", "s3"]);
    expect(calls).toHaveLength(1);
  });

  it("removes a question whose answer is not among its choices, with too few choices or with twin choices", async () => {
    const lost = { ...question("s1", 0), answer_id: "z" };
    const short = { ...question("s2", 0), choices: question("s2", 0).choices.slice(0, 2) };
    const twins = question("s3", 0);
    twins.choices[1] = { id: "b", text: ` ${twins.choices[0]?.text.toUpperCase()} ` };
    const unknown = question("s9", 0);
    const kept = [question("s4", 1), question("s5", 2)];
    const { provider, calls } = scripted(reply(lost, short, twins, unknown, ...kept));
    const quiz = await writer(provider)();
    expect(quiz?.questions.map((item) => item.scene_id)).toEqual(["s4", "s5"]);
    expect(calls).toHaveLength(1);
  });

  it("keeps three questions at most", async () => {
    const many = ["s1", "s2", "s3", "s4"].map((id, index) => question(id, index % 3));
    const { provider } = scripted(reply(...many));
    const quiz = await writer(provider)();
    expect(quiz?.questions.map((item) => item.scene_id)).toEqual(["s1", "s2", "s3"]);
  });

  it("emits no quiz under two valid questions, after a single new attempt that names the problem", async () => {
    const bad = reply(question("s3", 1), question("s9", 0));
    const { provider, calls } = scripted(bad, bad, reply(...REFERENCE_QUIZ.questions));
    const traces: LlmTrace[] = [];
    const quiz = await writer(provider, {
      scenes: WITHOUT_S4,
      trace: (entry) => traces.push(entry),
    })();
    expect(quiz).toBeNull();
    expect(calls).toHaveLength(2);
    const retry = calls[1]?.messages.at(-1)?.content as string;
    expect(retry).toContain("Only 1 question(s) can be used");
    expect(retry).toContain('scene_id "s9"');
    expect(traces).toMatchObject([{ label: "quiz", role: "author", ok: false, attempts: 2 }]);
    expect(traces[0]?.rejections).toHaveLength(2);
  });

  it("accepts the quiz of the new attempt when the first answer was unusable", async () => {
    const { provider, calls } = scripted(
      reply(question("s9", 0), question("s8", 0)),
      reply(...REFERENCE_QUIZ.questions),
    );
    const traces: LlmTrace[] = [];
    const quiz = await writer(provider, { trace: (entry) => traces.push(entry) })();
    expect(quiz?.questions).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(traces).toMatchObject([{ label: "quiz", ok: true, attempts: 2 }]);
  });

  it("returns null after a single new attempt when the output is not JSON", async () => {
    const { provider, calls } = scripted(
      "Voici ton quiz !",
      "Toujours pas de JSON.",
      reply(...REFERENCE_QUIZ.questions),
    );
    expect(await writer(provider)()).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it.each<LlmErrorCode>(["timeout", "unavailable", "rate_limited", "refused", "invalid_output"])(
    "returns null instead of failing when the provider answers %s",
    async (code) => {
      const { provider, calls } = scripted(failure(code));
      const traces: LlmTrace[] = [];
      await expect(
        writer(provider, { trace: (entry) => traces.push(entry) })(),
      ).resolves.toBeNull();
      expect(calls).toHaveLength(1);
      expect(traces).toMatchObject([{ label: "quiz", ok: false }]);
    },
  );

  it("returns null when the provider breaks in a way it did not announce", async () => {
    const provider: LlmProvider = {
      name: "broken",
      modelFor: () => "broken",
      health: async () => ({ ok: false, latencyMs: 0 }),
      generateObject: () => Promise.reject(new TypeError("fetch failed")),
    };
    await expect(writer(provider)()).resolves.toBeNull();
  });

  it("reports one successful call to the trace", async () => {
    const { provider } = scripted(reply(...REFERENCE_QUIZ.questions));
    const traces: LlmTrace[] = [];
    await writer(provider, { trace: (entry) => traces.push(entry) })();
    expect(traces).toMatchObject([{ label: "quiz", role: "author", ok: true, attempts: 1 }]);
  });
});

describe("curateQuestions", () => {
  it("separates the usable questions from the problems found, numbered from 1", () => {
    const { questions, problems } = curateQuestions(
      [question("s1", 0), { prompt: "Sans choix" }, question("s7", 1), "texte"],
      SCENE_IDS,
    );
    expect(questions.map((item) => item.scene_id)).toEqual(["s1"]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^question 2 is unusable/);
    expect(problems[1]).toContain('scene_id "s7"');
    expect(problems[2]).toMatch(/^question 4 is unusable/);
  });
});

describe("arrangeChoices", () => {
  const alwaysFirst = [question("s1", 0), question("s2", 0), question("s3", 0)];

  it("moves a right answer that the model always puts at the same place, differently for each question", () => {
    const arranged = arrangeChoices(alwaysFirst, TRACE_ID);
    expect(new Set(arranged.map(answerAt)).size).toBe(3);
    arranged.forEach((item, index) => {
      expect(rightText(item)).toBe(rightText(alwaysFirst[index] as QuizQuestion));
      expect(item.choices.map((choice) => choice.id)).toEqual(["a", "b", "c"]);
      const wrong = item.choices.filter((choice) => choice.id !== item.answer_id);
      const before = (alwaysFirst[index] as QuizQuestion).choices.slice(1);
      expect(wrong.map((choice) => choice.text)).toEqual(before.map((choice) => choice.text));
    });
  });

  it("gives the same arrangement for the same explanation and varies it from one explanation to another", () => {
    expect(arrangeChoices(alwaysFirst, "abc")).toEqual(arrangeChoices(alwaysFirst, "abc"));
    const starts = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9", "j0"].map((seed) =>
      answerAt(arrangeChoices(alwaysFirst, seed)[0] as QuizQuestion),
    );
    expect(new Set(starts).size).toBeGreaterThan(1);
  });

  it("moves two questions of different sizes to different places", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const arranged = arrangeChoices([question("s1", 0, 4), question("s2", 0, 3)], seed);
      expect(answerAt(arranged[0] as QuizQuestion)).not.toBe(answerAt(arranged[1] as QuizQuestion));
    }
  });

  it("leaves the order alone when the model already varied the right answer", () => {
    const varied = [question("s1", 1), question("s2", 0), question("s3", 2)];
    expect(arrangeChoices(varied, TRACE_ID)).toEqual(varied);
  });

  it("gives the choices the identifiers a, b, c, d in their final order", () => {
    const odd: QuizQuestion = {
      ...question("s1", 1, 4),
      choices: [
        { id: "x", text: "Premier" },
        { id: "y", text: "Deuxième" },
        { id: "z", text: "Troisième" },
        { id: "w", text: "Quatrième" },
      ],
      answer_id: "y",
    };
    const [arranged] = arrangeChoices([odd, question("s2", 2)], TRACE_ID);
    expect(arranged?.choices.map((choice) => choice.id)).toEqual(["a", "b", "c", "d"]);
    expect(rightText(arranged as QuizQuestion)).toBe("Deuxième");
  });
});

describe("assembleQuiz", () => {
  it("is not a quiz under two questions", () => {
    expect(assembleQuiz([question("s1", 0)], "fr", TRACE_ID)).toBeNull();
    expect(assembleQuiz([], "fr", TRACE_ID)).toBeNull();
  });

  it("sets the French typography on the questions and leaves English alone", () => {
    const asking = [question("s1", 1), question("s2", 0)].map((item) => ({
      ...item,
      prompt: "Que devient la force ?",
    }));
    const french = assembleQuiz(asking, "fr", TRACE_ID);
    const english = assembleQuiz(asking, "en", TRACE_ID);
    expect(french?.questions[0]?.prompt).toBe("Que devient la force ?");
    expect(english?.questions[0]?.prompt).toBe("Que devient la force ?");
  });
});
