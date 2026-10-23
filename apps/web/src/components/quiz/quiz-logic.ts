import type { Quiz, QuizQuestion } from "scene";

export function letterOf(index: number): string {
  return String.fromCharCode(65 + index);
}

export function isRight(question: QuizQuestion, choiceId: string | undefined): boolean {
  return choiceId === question.answer_id;
}

export function scoreOf(quiz: Quiz, answers: readonly string[]): number {
  return quiz.questions.filter((question, index) => isRight(question, answers[index])).length;
}

export function sceneNumberLabel(number: number): string {
  return String(number).padStart(2, "0");
}
