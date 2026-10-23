import path from "node:path";
import { z } from "zod";
import type { LlmError, LlmProvider } from "../../../../apps/web/src/server/llm/types";
import { isSafeSegment } from "../../../../apps/web/src/server/media";
import type { ExplanationRecord } from "../../../../apps/web/src/server/pipeline/ports";
import {
  buildRepairPrompt,
  buildWritePrompt,
  checkCode,
  cleanCode,
  MAX_CODE_BYTES,
  type SandboxFailure,
} from "./prompt";
import { SandboxError, type Sandbox } from "./sandbox";

export const DEEP_ATTEMPTS = 3;
export const DEEP_TIME_LIMIT_MS = 6 * 60 * 1000;
export const AUTHOR_TIMEOUT_MS = 90_000;
export const AUTHOR_MAX_TOKENS = 8_000;
export const AUTHOR_RETRIES = 1;
export const RENDER_PROGRESS_SPAN_MS = 150_000;
export const PROGRESS = { received: 5, written: 20, rendering: 25, rendered: 90, moved: 95 };

const CodeSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(MAX_CODE_BYTES * 2),
});
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g;

export type DeepOutcome =
  | { status: "succeeded"; file: string; attempts: number }
  | { status: "abandoned"; reason: string; attempts: number }
  | { status: "cancelled"; attempts: number };

export interface DeepRequest {
  record: ExplanationRecord;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export type DeepRenderer = (request: DeepRequest) => Promise<DeepOutcome>;

export interface DeepDependencies {
  llm: LlmProvider;
  sandbox: Sandbox;
  mediaDir: string;
  now?: () => number;
  timeLimitMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

// The web modules load as CommonJS outside Vitest, so LlmError may come from another copy.
function llmFailure(error: unknown): string {
  const code = error instanceof Error && error.name === "LlmError" && (error as LlmError).code;
  return typeof code === "string" ? code : "error";
}

function firstLine(text: string): string {
  const line = text.split("\n").find((part) => part.trim() !== "") ?? "";
  return line.replace(CONTROL, "").trim().slice(0, 100);
}

export async function renderDeepVersion(
  options: DeepRequest & DeepDependencies,
): Promise<DeepOutcome> {
  const { record, llm, sandbox, signal } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.info(line));
  const started = now();
  const deadline = started + (options.timeLimitMs ?? DEEP_TIME_LIMIT_MS);
  const target = path.join(options.mediaDir, record.id, "deep.mp4");
  const summary: string[] = [];
  let attempts = 0;
  let reached = 0;

  const report = (percent: number) => {
    const whole = Math.floor(percent);
    if (whole <= reached) return;
    reached = whole;
    options.onProgress?.(whole);
  };
  const finish = (outcome: DeepOutcome): DeepOutcome => {
    const head = outcome.status === "abandoned" ? `abandoned (${outcome.reason})` : outcome.status;
    const steps = summary.length > 0 ? `: ${summary.join("; ")}` : "";
    log(
      `Deep version of ${record.id}: ${head} after ${attempts} attempt(s) in ${seconds(now() - started)}${steps}`,
    );
    return outcome;
  };
  const abandoned = (reason: string) => finish({ status: "abandoned", reason, attempts });
  const cancelled = () => finish({ status: "cancelled", attempts });

  report(PROGRESS.received);
  if (!isSafeSegment(record.id) || !record.payload.plan) return abandoned("invalid_explanation");
  await sandbox.sweep().catch(() => 0);
  if (!(await sandbox.alive())) return abandoned("sandbox_unavailable");

  let previous: { code: string; failure: SandboxFailure } | null = null;
  let lastFailure = "none";

  while (attempts < DEEP_ATTEMPTS) {
    if (signal?.aborted) return cancelled();
    const remaining = deadline - now();
    if (remaining <= 0) return abandoned("time_limit");
    attempts += 1;
    const step = `#${attempts} ${previous ? "repair" : "write"}`;

    const prompt = previous
      ? buildRepairPrompt({ record, ...previous })
      : buildWritePrompt({ record });
    const writing = now();
    const limit = AbortSignal.timeout(remaining);
    let code: string;
    try {
      const result = await llm.generateObject({
        role: "author",
        system: prompt.system,
        messages: prompt.messages,
        schema: CodeSchema,
        validate: (value) => checkCode(value.code),
        maxTokens: AUTHOR_MAX_TOKENS,
        timeoutMs: Math.max(1, Math.min(AUTHOR_TIMEOUT_MS, remaining)),
        retries: AUTHOR_RETRIES,
        signal: signal ? AbortSignal.any([signal, limit]) : limit,
        traceId: `deep:${record.id}`,
      });
      code = cleanCode(result.value.code);
    } catch (error) {
      if (signal?.aborted) return cancelled();
      const reason = llmFailure(error);
      summary.push(`${step} failed (${reason}) ${seconds(now() - writing)}`);
      if (limit.aborted || now() >= deadline) return abandoned("time_limit");
      lastFailure = `author_${reason}`;
      continue;
    }
    const wrote = `${step} ${seconds(now() - writing)}`;
    report(PROGRESS.written);
    if (signal?.aborted) return cancelled();
    if (now() >= deadline) {
      summary.push(wrote);
      return abandoned("time_limit");
    }

    let id: string;
    try {
      ({ id } = await sandbox.submit(code));
    } catch (error) {
      summary.push(wrote);
      return abandoned(error instanceof SandboxError ? error.code : "sandbox_unavailable");
    }
    report(PROGRESS.rendering);
    const waiting = now();
    const span = PROGRESS.rendered - PROGRESS.rendering;
    try {
      const result = await sandbox.awaitResult(id, {
        deadline,
        signal,
        pollMs: options.pollMs,
        onPoll: () =>
          report(
            PROGRESS.rendering + span * Math.min(1, (now() - waiting) / RENDER_PROGRESS_SPAN_MS),
          ),
      });
      if (result.ok) {
        await sandbox.collect(id, target);
        summary.push(`${wrote}, render ${seconds(now() - waiting)}`);
        report(PROGRESS.moved);
        return finish({ status: "succeeded", file: target, attempts });
      }
      summary.push(
        `${wrote}, ${result.stage} failed ${seconds(now() - waiting)} (${firstLine(result.error)})`,
      );
      previous = { code, failure: result };
      lastFailure = result.stage;
    } catch (error) {
      summary.push(`${wrote}, wait ended ${seconds(now() - waiting)}`);
      if (signal?.aborted) return cancelled();
      if (!(error instanceof SandboxError)) throw error;
      if (error.code === "cancelled") return cancelled();
      return abandoned(error.code === "timeout" ? "time_limit" : error.code);
    } finally {
      await sandbox.cleanup(id).catch(() => undefined);
    }
  }
  return abandoned(`attempts_exhausted (${lastFailure})`);
}

export function createDeepRenderer(dependencies: DeepDependencies): DeepRenderer {
  return (request) => renderDeepVersion({ ...dependencies, ...request });
}
