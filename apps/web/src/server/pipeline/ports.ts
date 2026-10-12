import type { Language, Level, Model, Outline, Param, Quiz, Scene } from "scene";
import type { LlmProvider } from "../llm";
import type { Verdict } from "./events";
import type { Subject } from "./prompts/schemas";

export const EXPLANATION_KINDS = [
  "initial",
  "another_analogy",
  "simpler",
  "zoom",
  "followup",
  "reference",
] as const;
export type ExplanationKind = (typeof EXPLANATION_KINDS)[number];

export const EXPLANATION_STATUSES = [
  "triaging",
  "planning",
  "streaming",
  "ready",
  "partial",
  "failed",
  "needs_clarification",
  "refused",
] as const;
export type ExplanationStatus = (typeof EXPLANATION_STATUSES)[number];

export interface ExplanationPayload {
  version: 1;
  plan: Outline["plan"] | null;
  params: Param[];
  model: Model;
  scenes: Scene[];
  quiz: Quiz | null;
}

export interface ExplanationRecord {
  id: string;
  kind: ExplanationKind;
  parent_id: string | null;
  root_id: string;
  focus_scene_id: string | null;
  question: string;
  language: Language;
  level: Level;
  concept_slug: string | null;
  subject: Subject | null;
  title: string | null;
  status: ExplanationStatus;
  payload: ExplanationPayload;
  verdicts: Verdict[];
  scene_count_planned: number | null;
  provider: string;
  model: string;
  timings: Record<string, number>;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
}

export interface ExplanationStore {
  create(record: ExplanationRecord): Promise<void>;
  update(id: string, patch: Partial<Omit<ExplanationRecord, "id">>): Promise<void>;
  get(id: string): Promise<ExplanationRecord | null>;
  remove(id: string): Promise<void>;
}

export interface CacheKey {
  language: Language;
  level: Level;
}

export interface ExplanationCache {
  findByQuestion(question: string, key: CacheKey): Promise<string | null>;
  findByConcept(slug: string, key: CacheKey): Promise<string | null>;
  remember(id: string, entry: CacheKey & { question: string; slug: string }): Promise<void>;
}

export interface VoiceService {
  narrate(explanationId: string, scene: Scene, language: Language): Promise<Scene>;
}

export interface PipelineDeps {
  llm: LlmProvider;
  store: ExplanationStore;
  cache: ExplanationCache;
  voice: VoiceService;
  newId(): string;
  now(): Date;
  shareUrl(id: string, language: Language): string;
  writeQuiz?: (input: {
    outline: Outline;
    scenes: Scene[];
    language: Language;
    level: Level;
    traceId: string;
  }) => Promise<Quiz | null>;
  enqueueDeep?: (explanationId: string) => Promise<void>;
}

export const SHARE_RETENTION_DAYS = 90;
