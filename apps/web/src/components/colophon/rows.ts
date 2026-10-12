import type { Scene, SceneRole } from "scene";
import type { ExplanationState } from "@/components/explanation/types";

export type RowStatus = "validated" | "corrected" | "dropped" | "pending";

export interface VerificationRow {
  target: string;
  index: number | null;
  title: string | null;
  role: SceneRole | null;
  status: RowStatus;
  attempts: number;
  reason: string | null;
}

interface RowInput {
  plan: NonNullable<ExplanationState["plan"]>;
  scenes: readonly Scene[];
  verdicts: ExplanationState["verdicts"];
  sceneCount: number | null;
  dropped: readonly number[];
}

const SCENE_TARGET = /^s(\d+)$/;

function sceneIndexOf(target: string): number | null {
  const match = SCENE_TARGET.exec(target);
  return match ? Number(match[1]) - 1 : null;
}

function lastVerdicts(verdicts: ExplanationState["verdicts"]) {
  return new Map(verdicts.map((verdict) => [verdict.target, verdict]));
}

function plannedScenes({ scenes, verdicts, sceneCount, dropped }: RowInput): number {
  if (sceneCount !== null) return sceneCount;
  const known = [
    scenes.length,
    ...dropped.map((index) => index + 1),
    ...verdicts.map((verdict) => (sceneIndexOf(verdict.target) ?? -1) + 1),
  ];
  return Math.max(...known);
}

export function verificationRows(input: RowInput): VerificationRow[] {
  const byTarget = lastVerdicts(input.verdicts);
  const planVerdict = byTarget.get("plan");
  const rows: VerificationRow[] = [
    {
      target: "plan",
      index: null,
      title: null,
      role: null,
      status: planVerdict?.status ?? "pending",
      attempts: planVerdict?.attempts ?? 0,
      reason: planVerdict && planVerdict.status !== "validated" ? planVerdict.reason : null,
    },
  ];
  for (let index = 0; index < plannedScenes(input); index += 1) {
    const target = `s${index + 1}`;
    const verdict = byTarget.get(target);
    const scene = input.scenes.find((candidate) => candidate.index === index);
    const removed = input.dropped.includes(index) || verdict?.status === "dropped";
    const status: RowStatus = removed ? "dropped" : (verdict?.status ?? "pending");
    rows.push({
      target,
      index,
      title: scene?.title ?? null,
      role: scene?.role ?? input.plan.steps[index]?.role ?? null,
      status,
      attempts: verdict?.attempts ?? 0,
      reason: verdict && status !== "validated" && status !== "pending" ? verdict.reason : null,
    });
  }
  return rows;
}

export interface CheckSets {
  plan: string[];
  scenes: string[];
}

export function checkSets(verdicts: ExplanationState["verdicts"]): CheckSets {
  const sets: CheckSets = { plan: [], scenes: [] };
  for (const verdict of verdicts) {
    const set = verdict.target === "plan" ? sets.plan : sets.scenes;
    for (const check of verdict.checks) if (!set.includes(check)) set.push(check);
  }
  return sets;
}

const CHECK_KEYS = {
  structure: "structure",
  references: "references",
  model: "model",
  readability: "readability",
  framing: "framing",
  pedagogy: "pedagogy",
  accuracy: "accuracy",
  "accuracy:fallback": "accuracyFallback",
} as const;

export type CheckKey = (typeof CHECK_KEYS)[keyof typeof CHECK_KEYS];

export function checkKey(check: string): CheckKey | null {
  return Object.hasOwn(CHECK_KEYS, check) ? CHECK_KEYS[check as keyof typeof CHECK_KEYS] : null;
}

export function narrationOf(scene: Scene): string {
  return scene.beats.map((beat) => beat.narration).join(" ");
}

export function secondsOf(timings: ExplanationState["timings"], name: string): number | null {
  const milliseconds = timings[name];
  return typeof milliseconds === "number" && Number.isFinite(milliseconds)
    ? milliseconds / 1000
    : null;
}
