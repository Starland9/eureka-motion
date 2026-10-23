import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";
import type { QuizQuestion } from "scene";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isRight, letterOf } from "./quiz-logic";
import { ReviewLink, VerdictIcon } from "./quiz-parts";

type Mark = "right" | "yours" | null;

function choiceClass(answered: boolean, mark: Mark): string {
  if (!answered) return "cursor-pointer hover:bg-surface-sunk";
  if (mark === "right") return "cursor-default bg-role-result text-ink dark:text-surface";
  if (mark === "yours") return "cursor-default border-role-action text-ink";
  return "cursor-default text-ink-soft";
}

interface ExerciseProps {
  question: QuizQuestion;
  chosen: string | undefined;
  last: boolean;
  captionId: string;
  sceneNumber: number | undefined;
  focusOnMount: boolean;
  onChoose(choiceId: string): void;
  onReview(): void;
  onNext(): void;
}

export function Exercise({
  question,
  chosen,
  last,
  captionId,
  sceneNumber,
  focusOnMount,
  onChoose,
  onReview,
  onNext,
}: ExerciseProps) {
  const t = useTranslations("Quiz");
  const promptId = useId();
  const promptRef = useRef<HTMLParagraphElement>(null);
  const answered = chosen !== undefined;
  const right = isRight(question, chosen);
  const rightIndex = question.choices.findIndex((choice) => choice.id === question.answer_id);

  useEffect(() => {
    if (focusOnMount) promptRef.current?.focus();
  }, [focusOnMount]);

  return (
    <div>
      <p
        ref={promptRef}
        id={promptId}
        tabIndex={-1}
        aria-describedby={captionId}
        className="text-body-l max-w-prose"
      >
        {question.prompt}
      </p>
      <ol role="list" aria-labelledby={promptId} className="mt-6 border-t border-ink">
        {question.choices.map((choice, index) => {
          const mark: Mark = !answered
            ? null
            : choice.id === question.answer_id
              ? "right"
              : choice.id === chosen
                ? "yours"
                : null;
          return (
            <li key={choice.id} className="border-b border-ink">
              <button
                type="button"
                // Stays focusable once answered, so keyboard focus is not lost.
                aria-disabled={answered || undefined}
                onClick={(event) => {
                  if (answered) return;
                  event.currentTarget.focus();
                  onChoose(choice.id);
                }}
                className={cn(
                  "touch-target text-body flex w-full items-start gap-4 border-l-2 border-transparent px-3 py-3 text-left",
                  choiceClass(answered, mark),
                )}
              >
                <span className="text-body w-5 shrink-0 font-mono font-medium">
                  {letterOf(index)}
                </span>
                <span className="min-w-0 flex-1">
                  {choice.text}
                  {mark === null ? null : (
                    <span className="text-caption mt-1 flex items-center gap-2">
                      {mark === "right" ? (
                        <Check aria-hidden="true" className="size-5 shrink-0" />
                      ) : (
                        <X aria-hidden="true" className="size-5 shrink-0 text-role-action-text" />
                      )}
                      {t(mark === "right" ? "tag.right" : "tag.yours")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div
        className={cn(
          "flex items-start gap-3",
          answered && [
            "mt-6 border-l-2 py-1 pl-3",
            right ? "border-role-valid" : "border-role-action",
          ],
        )}
      >
        {answered ? <VerdictIcon right={right} className="mt-0.5" /> : null}
        <div className="min-w-0 flex-1">
          <div role="status">
            {answered ? (
              <>
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-control">
                    {t(right ? "verdict.correct" : "verdict.incorrect")}
                  </span>
                  {right ? null : (
                    <span className="text-body">
                      {t("rightAnswer", { letter: letterOf(rightIndex) })}
                    </span>
                  )}
                </p>
                <p className="text-body mt-1">{question.explanation}</p>
              </>
            ) : null}
          </div>
          {answered && !right ? (
            <ReviewLink sceneNumber={sceneNumber} onReview={onReview} className="mt-1" />
          ) : null}
        </div>
      </div>
      {answered ? (
        <Button type="button" onClick={onNext} className="mt-6">
          {t(last ? "seeScore" : "next")}
        </Button>
      ) : null}
    </div>
  );
}
