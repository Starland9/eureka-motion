"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { LEVELS, type Language, type Level } from "scene";
import { describeRejection } from "@/components/ask/Rejection";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { LevelRequestView } from "./level-request";
import { Notice } from "./Notice";
import type { ExplanationState } from "./types";
import { useLevelRequest } from "./useLevelRequest";

interface LevelChoiceProps {
  state: Pick<ExplanationState, "reference" | "language" | "level">;
  className?: string;
}

function Progress({ view, language }: { view: LevelRequestView; language: Language }) {
  const t = useTranslations("Explanation.levelChange");
  const tLevel = useTranslations("Level");
  if (view.kind === "idle" || view.kind === "rejected") return null;

  const level = tLevel(view.level);
  const sentence =
    view.kind === "ready"
      ? t("ready", { level })
      : view.total === null
        ? t("preparing", { level })
        : t("progress", { level, done: view.done, total: view.total });
  const openId = view.openId;

  return (
    <>
      <p className="text-body text-ink-soft">{sentence}</p>
      {openId === null ? null : (
        <Link
          href={`/e/${openId}`}
          locale={language}
          className={cn(buttonVariants({ variant: "link" }), "self-start")}
        >
          {t("open", { level })}
        </Link>
      )}
    </>
  );
}

interface PanelProps {
  language: Language;
  referenceLevel: Level;
  view: LevelRequestView;
  onChoose: (level: Level) => void;
  className?: string;
}

export function LevelChoicePanel({
  language,
  referenceLevel,
  view,
  onChoose,
  className,
}: PanelProps) {
  const legendId = useId();
  const t = useTranslations("Explanation.levelChange");
  const tLevel = useTranslations("Level");
  const tAsk = useTranslations("Ask");
  const shown = view.kind === "preparing" || view.kind === "ready" ? view.level : referenceLevel;

  return (
    <div data-slot="level-choice" className={cn("flex flex-col gap-3", className)}>
      <div>
        <p id={legendId} className="text-caption mb-1 text-ink-faint">
          {t("legend")}
        </p>
        <div role="group" aria-labelledby={legendId} className="-ml-2 flex flex-wrap gap-x-2">
          {LEVELS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={shown === value}
              onClick={() => onChoose(value)}
              className="touch-target text-caption inline-flex cursor-pointer items-center gap-2 px-2 text-ink-soft hover:text-ink aria-pressed:text-ink"
            >
              <span
                className={cn("underline-offset-8", shown === value && "underline decoration-2")}
              >
                {tLevel(value)}
              </span>
              {value === referenceLevel ? (
                <span className="text-ink-faint">{t("reference")}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div role="status" className="flex flex-col">
        <Progress view={view} language={language} />
      </div>
      <div role="alert">
        {view.kind === "rejected" ? (
          <Notice tone="alert">
            <p>{describeRejection(tAsk, view.rejection).message}</p>
          </Notice>
        ) : null}
      </div>
    </div>
  );
}

function ReferenceLevelChoice({
  question,
  language,
  level,
  className,
}: {
  question: string;
  language: Language;
  level: Level;
  className?: string;
}) {
  const { view, request } = useLevelRequest();

  function choose(next: Level) {
    void request(next, { question, language, level });
  }

  return (
    <LevelChoicePanel
      language={language}
      referenceLevel={level}
      view={view}
      onChoose={choose}
      className={className}
    />
  );
}

export function LevelChoice({ state, className }: LevelChoiceProps) {
  if (state.reference === null) return null;
  return (
    <ReferenceLevelChoice
      question={state.reference.question}
      language={state.language}
      level={state.level}
      className={className}
    />
  );
}
