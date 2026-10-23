import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import type { Quiz } from "scene";
import { isRight } from "./quiz-logic";
import { ReviewLink, VerdictIcon } from "./quiz-parts";

interface ResultProps {
  quiz: Quiz;
  answers: readonly string[];
  score: number;
  captionId: string;
  sceneNumbers: Readonly<Record<string, number>> | undefined;
  focusOnMount: boolean;
  onReview(sceneId: string): void;
}

export function Result({
  quiz,
  answers,
  score,
  captionId,
  sceneNumbers,
  focusOnMount,
  onReview,
}: ResultProps) {
  const t = useTranslations("Quiz");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const missed = quiz.questions.length - score;

  useEffect(() => {
    if (focusOnMount) titleRef.current?.focus();
  }, [focusOnMount]);

  return (
    <div>
      <h2 ref={titleRef} tabIndex={-1} aria-describedby={captionId} className="text-display-l">
        {t("score.value", { score, total: quiz.questions.length })}
      </h2>
      <p className="text-body-l mt-4">
        {missed === 0 ? t("score.perfect") : t("score.missed", { count: missed })}
      </p>
      <ol role="list" aria-label={t("score.details")} className="mt-6 border-t border-ink">
        {quiz.questions.map((question, index) => {
          const right = isRight(question, answers[index]);
          return (
            <li key={index} className="border-b border-rule py-3">
              <p className="flex flex-wrap items-center gap-x-4">
                <span className="text-caption">
                  {t("score.exerciseNumber", { number: index + 1 })}
                </span>
                <span className="text-control flex items-center gap-2">
                  <VerdictIcon right={right} />
                  {t(right ? "verdict.correct" : "verdict.incorrect")}
                </span>
              </p>
              <p className="text-body mt-1 text-ink-soft">{question.prompt}</p>
              {right ? null : (
                <ReviewLink
                  sceneNumber={sceneNumbers?.[question.scene_id]}
                  onReview={() => onReview(question.scene_id)}
                />
              )}
            </li>
          );
        })}
      </ol>
      {missed === 0 ? null : (
        <p className="text-body mt-6 max-w-prose border-l-2 border-ink pl-3">{t("score.again")}</p>
      )}
    </div>
  );
}
