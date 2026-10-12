import type { z } from "zod";

export const LLM_ROLES = ["triage", "author", "judge", "checker"] as const;
export type LlmRole = (typeof LLM_ROLES)[number];

export type LlmErrorCode =
  "invalid_output" | "timeout" | "rate_limited" | "unavailable" | "refused";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly role: LlmRole;
  readonly attempts: number;

  constructor(code: LlmErrorCode, role: LlmRole, message: string, attempts = 1) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.role = role;
    this.attempts = attempts;
  }
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest<T> {
  role: LlmRole;
  system: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
  validate?: (value: T) => string | null;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  traceId?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult<T> {
  value: T;
  usage: LlmUsage;
  latencyMs: number;
  attempts: number;
  model: string;
}

export interface LlmHealth {
  ok: boolean;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  modelFor(role: LlmRole): string;
  generateObject<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>>;
  health(): Promise<LlmHealth>;
}

export interface RawCompletion {
  text: string;
  usage: LlmUsage;
  model: string;
}

export interface RawCall {
  role: LlmRole;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  traceId: string | undefined;
}

export const DEFAULT_TIMEOUT_MS: Readonly<Record<LlmRole, number>> = {
  triage: 8_000,
  author: 30_000,
  judge: 20_000,
  checker: 10_000,
};

export const DEFAULT_MAX_TOKENS: Readonly<Record<LlmRole, number>> = {
  triage: 600,
  author: 4_000,
  judge: 4_000,
  checker: 800,
};

export const DEFAULT_RETRIES = 2;
