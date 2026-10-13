import type { ExplanationState } from "./types";

export const PREPARATION_STEPS = ["triage", "plan", "verify_plan", "scenes"] as const;

export type PreparationStep = (typeof PREPARATION_STEPS)[number];
export type StepRowState = "done" | "current" | "waiting";

export interface StepRow {
  name: PreparationStep;
  number: number;
  state: StepRowState;
}

type Steps = ExplanationState["steps"];

export function currentStep(steps: Steps): PreparationStep | null {
  return PREPARATION_STEPS.find((name) => steps[name] !== "done") ?? null;
}

export function preparationRows(steps: Steps, sceneCount: number | null): StepRow[] {
  const current = currentStep(steps);
  const names = sceneCount === null ? PREPARATION_STEPS.slice(0, -1) : PREPARATION_STEPS;
  return names.map((name, index) => ({
    name,
    number: index + 1,
    state: steps[name] === "done" ? "done" : name === current ? "current" : "waiting",
  }));
}

export function preparationProgress(steps: Steps): number {
  const done = PREPARATION_STEPS.filter((name) => steps[name] === "done").length;
  const current = currentStep(steps);
  const started = current !== null && steps[current] === "started" ? 0.5 : 0;
  return (done + started) / PREPARATION_STEPS.length;
}
