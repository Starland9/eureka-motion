import type { Language, Level, Model, Outline, Param, Quiz, Scene } from "scene";
import type { StepName, Verdict } from "@/server/pipeline/events";
import type { Subject } from "@/server/pipeline/prompts/schemas";

export type ExplanationStatus =
  | "connecting"
  | "preparing"
  | "streaming"
  | "ready"
  | "partial"
  | "clarify"
  | "refused"
  | "failed"
  | "missing"
  | "expired";

export interface ExplanationMeta {
  title: string;
  subject: Subject;
  conceptSlug: string;
  deepEligible: boolean;
  detectedLanguage: Language | "other";
}

export interface Interpretation {
  label: string;
  question: string;
}

export interface ExplanationState {
  id: string | null;
  status: ExplanationStatus;
  cached: boolean;
  redirectTo: string | null;
  question: string;
  language: Language;
  level: Level;
  steps: Partial<Record<StepName, "started" | "done">>;
  meta: ExplanationMeta | null;
  plan: Outline["plan"] | null;
  params: Param[];
  model: Model;
  sceneCount: number | null;
  scenes: Scene[];
  dropped: number[];
  verdicts: Verdict[];
  quiz: Quiz | null;
  clarify: { reason: string; interpretations: Interpretation[] } | null;
  refusal: string | null;
  error: { code: string; message: string; retryAfterSeconds?: number } | null;
  shareUrl: string | null;
  generator: { provider: string; model: string } | null;
  timings: Record<string, number>;
  lastSeq: number;
}

export interface StartRequest {
  question: string;
  language: Language;
  level: Level;
  interpretation?: string;
}

export const FINAL_STATUSES: ReadonlySet<ExplanationStatus> = new Set([
  "ready",
  "partial",
  "clarify",
  "refused",
  "failed",
  "missing",
  "expired",
]);

export function initialExplanationState(
  request: Pick<StartRequest, "question" | "language" | "level">,
): ExplanationState {
  return {
    id: null,
    status: "connecting",
    cached: false,
    redirectTo: null,
    question: request.question,
    language: request.language,
    level: request.level,
    steps: {},
    meta: null,
    plan: null,
    params: [],
    model: { constants: [], derived: [] },
    sceneCount: null,
    scenes: [],
    dropped: [],
    verdicts: [],
    quiz: null,
    clarify: null,
    refusal: null,
    error: null,
    shareUrl: null,
    generator: null,
    timings: {},
    lastSeq: 0,
  };
}

export function isComplete(state: Pick<ExplanationState, "status">): boolean {
  return FINAL_STATUSES.has(state.status);
}

export type StartOutcome =
  | { kind: "accepted"; id: string }
  | { kind: "rejected"; code: string; message: string; retryAfterSeconds?: number };

export interface ExplanationStream {
  state: ExplanationState | null;
  startedHere: boolean;
  start(request: StartRequest): Promise<StartOutcome>;
  open(id: string): void;
  reset(): void;
}
