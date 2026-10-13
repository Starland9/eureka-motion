"use client";

import { useTranslations } from "next-intl";
import { formatFigureNumber } from "@/components/player/scene-list-entries";
import { cn } from "@/lib/utils";
import {
  currentStep,
  preparationProgress,
  preparationRows,
  type PreparationStep,
} from "./preparation-steps";
import type { ExplanationState } from "./types";

const STATE_STYLE = {
  done: "border-transparent text-ink-soft",
  current: "border-ink text-ink",
  waiting: "border-transparent text-ink-faint",
} as const;

interface PreparationProps {
  steps: ExplanationState["steps"];
}

export function PreparationRule({ steps }: PreparationProps) {
  const progress = preparationProgress(steps);
  return (
    <div aria-hidden="true" className="h-0.5 w-full bg-rule">
      <div
        className="h-full origin-left bg-ink transition-transform duration-slow ease-trace"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}

export function PreparationSteps({
  steps,
  sceneCount,
  className,
}: PreparationProps & { sceneCount: number | null; className?: string }) {
  const t = useTranslations("Explanation.preparation");
  const rows = preparationRows(steps, sceneCount);
  const current = currentStep(steps);

  const sentence = (name: PreparationStep): string => {
    switch (name) {
      case "triage":
        return t("now.triage");
      case "plan":
        return t("now.plan");
      case "verify_plan":
        return t("now.verify_plan");
      case "scenes":
        return sceneCount === null ? t("now.firstScene") : t("now.scenes", { total: sceneCount });
    }
  };

  const label = (name: PreparationStep): string => {
    switch (name) {
      case "triage":
        return t("steps.triage");
      case "plan":
        return t("steps.plan");
      case "verify_plan":
        return t("steps.verify_plan");
      case "scenes":
        return t("steps.scenes", { total: sceneCount ?? 0 });
    }
  };

  return (
    <div data-slot="preparation" className={cn("flex flex-col gap-3", className)}>
      <p className="text-caption text-ink-soft">{t("label")}</p>
      <div aria-live="polite" aria-atomic="true">
        <p className="sr-only">{sentence(current ?? "scenes")}</p>
        <ol aria-hidden="true" className="border-t border-ink">
          {rows.map((row) => (
            <li key={row.name} data-state={row.state} className="border-b border-rule">
              <div
                className={cn(
                  "text-caption flex min-h-11 items-baseline gap-3 border-l-2 px-3 py-2",
                  STATE_STYLE[row.state],
                )}
              >
                <span>{formatFigureNumber(row.number)}</span>
                <span className="min-w-0 flex-1 break-words">{label(row.name)}</span>
                {row.state === "waiting" ? null : (
                  <span className="shrink-0">{t(`state.${row.state}`)}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
