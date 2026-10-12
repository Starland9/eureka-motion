import { z } from "zod";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  LlmError,
  type GenerateRequest,
  type GenerateResult,
  type LlmMessage,
  type LlmUsage,
  type RawCall,
  type RawCompletion,
} from "./types";

const JSON_REMINDER = "Reply with a single JSON object and nothing else.";

export function withJsonReminder(system: string): string {
  return /json/i.test(system) ? system : `${system}\n\n${JSON_REMINDER}`;
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("the reply was empty");
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("the reply contains no JSON object");
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch (error) {
    throw new Error(`the reply is not valid JSON (${(error as Error).message})`, { cause: error });
  }
}

function rejection(reason: string): string {
  return `Your previous answer was rejected.\n${reason}\nReturn the corrected JSON object only.`;
}

export function dropEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropEmpty);
  if (typeof value !== "object" || value === null) return value;
  const kept: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null || child === "") continue;
    kept[key] = dropEmpty(child);
  }
  return kept;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };

function check<T>(request: GenerateRequest<T>, text: string): Outcome<T> {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  const parsed = request.schema.safeParse(dropEmpty(json));
  if (!parsed.success) {
    return {
      ok: false,
      reason: `It does not match the expected structure:\n${z.prettifyError(parsed.error)}`,
    };
  }
  const reason = request.validate?.(parsed.data) ?? null;
  return reason === null ? { ok: true, value: parsed.data } : { ok: false, reason };
}

export async function generateWithRetries<T>(
  request: GenerateRequest<T>,
  call: (raw: RawCall) => Promise<RawCompletion>,
): Promise<GenerateResult<T>> {
  const started = Date.now();
  const retries = request.retries ?? DEFAULT_RETRIES;
  const messages: LlmMessage[] = [...request.messages];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let lastReason = "";

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const completion = await call({
      role: request.role,
      system: withJsonReminder(request.system),
      messages,
      maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS[request.role],
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS[request.role],
      signal: request.signal,
      traceId: request.traceId,
    });
    usage.inputTokens += completion.usage.inputTokens;
    usage.outputTokens += completion.usage.outputTokens;

    const outcome = check(request, completion.text);
    if (outcome.ok) {
      return {
        value: outcome.value,
        usage,
        latencyMs: Date.now() - started,
        attempts: attempt,
        model: completion.model,
      };
    }
    lastReason = outcome.reason;
    request.onRejected?.(outcome.reason, attempt);
    messages.push(
      {
        role: "assistant",
        content: completion.text.trim() === "" ? "(empty reply)" : completion.text,
      },
      { role: "user", content: rejection(lastReason) },
    );
  }
  throw new LlmError(
    "invalid_output",
    request.role,
    `No valid output after ${retries + 1} attempts: ${lastReason}`,
    retries + 1,
  );
}
