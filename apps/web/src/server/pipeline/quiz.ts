import {
  QuizQuestionSchema,
  QuizSchema,
  typesetTexts,
  type Language,
  type Quiz,
  type QuizQuestion,
} from "scene";
import { z } from "zod";
import { LlmError, type LlmProvider } from "../llm";
import type { LlmTrace, PipelineDeps } from "./ports";
import { buildQuizPrompt } from "./prompts";

export type QuizWriter = NonNullable<PipelineDeps["writeQuiz"]>;

const MIN_QUESTIONS = 2;
const MAX_QUESTIONS = 3;
const QUIZ_TIMEOUT_MS = 15_000;
const QUIZ_MAX_TOKENS = 1_500;
const QUIZ_RETRIES = 1;
const CHOICE_IDS = "abcd";

interface Curated {
  questions: QuizQuestion[];
  problems: string[];
}

const RawQuiz = z.object({ questions: z.array(z.unknown()) });

function problemWith(question: QuizQuestion, sceneIds: ReadonlySet<string>): string | null {
  const ids = question.choices.map((choice) => choice.id);
  const texts = question.choices.map((choice) => choice.text.trim().toLowerCase());
  if (new Set(ids).size !== ids.length) return "two choices share the same id";
  if (!ids.includes(question.answer_id)) return `answer_id "${question.answer_id}" is not a choice`;
  if (new Set(texts).size !== texts.length) return "two choices have the same text";
  if (!sceneIds.has(question.scene_id)) {
    return `scene_id "${question.scene_id}" is not a scene shown (${[...sceneIds].join(", ")})`;
  }
  return null;
}

function checkQuestion(item: unknown, sceneIds: ReadonlySet<string>): QuizQuestion | string {
  const parsed = QuizQuestionSchema.safeParse(item);
  if (!parsed.success) {
    return parsed.error.issues
      .map(({ path, message }) => `${path.join(".")}: ${message}`)
      .join("; ");
  }
  return problemWith(parsed.data, sceneIds) ?? parsed.data;
}

export function curateQuestions(raw: readonly unknown[], sceneIds: ReadonlySet<string>): Curated {
  const questions: QuizQuestion[] = [];
  const problems: string[] = [];
  raw.forEach((item, index) => {
    const checked = checkQuestion(item, sceneIds);
    if (typeof checked === "string") problems.push(`question ${index + 1} is unusable: ${checked}`);
    else if (questions.length < MAX_QUESTIONS) questions.push(checked);
  });
  return { questions, problems };
}

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return value;
}

function place(question: QuizQuestion, position: number): QuizQuestion {
  const rightAt = question.choices.findIndex((choice) => choice.id === question.answer_id);
  const others = question.choices.filter((_, index) => index !== rightAt);
  const ordered = [
    ...others.slice(0, position),
    ...question.choices.slice(rightAt, rightAt + 1),
    ...others.slice(position),
  ];
  return {
    ...question,
    choices: ordered.map((choice, index) => ({ id: CHOICE_IDS.charAt(index), text: choice.text })),
    answer_id: CHOICE_IDS.charAt(position),
  };
}

// A right answer always at the same place is moved, differently for each question.
export function arrangeChoices(questions: readonly QuizQuestion[], seed: string): QuizQuestion[] {
  const positions = questions.map((question) =>
    question.choices.findIndex((choice) => choice.id === question.answer_id),
  );
  const fixed = positions.every((position) => position === positions[0]);
  const span = Math.min(...questions.map((question) => question.choices.length));
  const start = hash(seed) % span;
  return questions.map((question, index) =>
    place(question, fixed ? (start + index) % span : (positions[index] ?? 0)),
  );
}

export function assembleQuiz(
  questions: readonly QuizQuestion[],
  language: Language,
  seed: string,
): Quiz | null {
  if (questions.length < MIN_QUESTIONS) return null;
  const quiz = QuizSchema.safeParse(
    typesetTexts({ questions: arrangeChoices(questions, seed) }, language),
  );
  return quiz.success ? quiz.data : null;
}

export function createQuizWriter(llm: LlmProvider, trace?: (entry: LlmTrace) => void): QuizWriter {
  return async ({ outline, scenes, language, level, traceId }) => {
    const sceneIds = new Set(scenes.map((scene) => scene.id));
    const started = Date.now();
    const rejections: string[] = [];
    const report = (ok: boolean, attempts: number): void =>
      trace?.({
        label: "quiz",
        role: "author",
        ms: Date.now() - started,
        attempts,
        ok,
        rejections,
      });
    try {
      const result = await llm.generateObject({
        role: "author",
        ...buildQuizPrompt({ outline, scenes, language, level }),
        schema: RawQuiz.transform((raw) => curateQuestions(raw.questions, sceneIds)),
        validate: ({ questions, problems }) =>
          questions.length >= MIN_QUESTIONS
            ? null
            : `Only ${questions.length} question(s) can be used, ${MIN_QUESTIONS} to ${MAX_QUESTIONS} are needed.\n${problems.join("\n")}`,
        onRejected: (reason) => rejections.push(reason),
        maxTokens: QUIZ_MAX_TOKENS,
        timeoutMs: QUIZ_TIMEOUT_MS,
        retries: QUIZ_RETRIES,
        traceId,
      });
      report(true, result.attempts);
      return assembleQuiz(result.value.questions, language, traceId);
    } catch (error) {
      report(false, error instanceof LlmError ? error.attempts : 1);
      return null;
    }
  };
}
