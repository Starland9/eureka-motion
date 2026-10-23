"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { Quiz as QuizDocument } from "scene";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Exercise } from "./Exercise";
import { scoreOf } from "./quiz-logic";
import { Result } from "./Result";

export interface QuizProps {
  quiz: QuizDocument;
  // Ids of the choices already given, in question order; kept by the caller across an exit.
  initialAnswers?: readonly string[];
  // Number each scene carries in the scene list, for "Revoir la scène 03 →".
  sceneNumbers?: Readonly<Record<string, number>>;
  onReviewScene(sceneId: string): void;
  onExit(): void;
  onAnswersChange?(answers: readonly string[]): void;
  onFinish?(score: number): void;
  // Puts the focus on the current question or on the score as soon as the quiz is shown.
  focusOnOpen?: boolean;
  className?: string;
}

export function Quiz({
  quiz,
  initialAnswers = [],
  sceneNumbers,
  onReviewScene,
  onExit,
  onAnswersChange,
  onFinish,
  focusOnOpen = false,
  className,
}: QuizProps) {
  const t = useTranslations("Quiz");
  const captionId = useId();
  const { questions } = quiz;
  const total = questions.length;
  const [answers, setAnswers] = useState<readonly string[]>(() => initialAnswers.slice(0, total));
  const [step, setStep] = useState(() => Math.min(initialAnswers.length, total));
  const [focusContent, setFocusContent] = useState(focusOnOpen);
  const question = questions[step];

  function choose(choiceId: string) {
    if (answers.length > step) return;
    const next = [...answers, choiceId];
    setAnswers(next);
    onAnswersChange?.(next);
    if (next.length === total) onFinish?.(scoreOf(quiz, next));
  }

  function advance() {
    setFocusContent(true);
    setStep(step + 1);
  }

  return (
    <section aria-label={t("label")} data-slot="quiz" className={cn("max-w-prose", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 border-b border-ink pb-1">
        <p id={captionId} className="text-caption">
          {question === undefined
            ? t("score.caption")
            : t("exercise", { current: step + 1, total })}
        </p>
        <Button type="button" variant="link" onClick={onExit}>
          {t(question === undefined ? "close" : "exit")}
        </Button>
      </div>
      {question === undefined ? (
        <Result
          quiz={quiz}
          answers={answers}
          score={scoreOf(quiz, answers)}
          captionId={captionId}
          sceneNumbers={sceneNumbers}
          focusOnMount={focusContent}
          onReview={onReviewScene}
        />
      ) : (
        <Exercise
          key={step}
          question={question}
          chosen={answers[step]}
          last={step === total - 1}
          captionId={captionId}
          sceneNumber={sceneNumbers?.[question.scene_id]}
          focusOnMount={focusContent}
          onChoose={choose}
          onReview={() => onReviewScene(question.scene_id)}
          onNext={advance}
        />
      )}
    </section>
  );
}
