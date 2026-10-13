import { LANGUAGES, LEVELS, type Language, type Level } from "scene";
import { z } from "zod";
import type { ErrorCode } from "./errors";

const MODES = ["initial", "another_analogy", "simpler", "zoom", "followup"] as const;

const CreateSchema = z.object({
  question: z.string().trim().min(1).max(500),
  language: z.enum(LANGUAGES),
  level: z.enum(LEVELS),
  mode: z.enum(MODES).default("initial"),
  interpretation: z
    .string()
    .trim()
    .max(140)
    .transform((text) => text || undefined)
    .optional(),
});

export interface CreateRequest {
  question: string;
  language: Language;
  level: Level;
  interpretation?: string | undefined;
}

export type ParsedCreate =
  | { ok: true; value: CreateRequest }
  | { ok: false; code: Extract<ErrorCode, "invalid_request" | "mode_not_supported"> };

export function parseCreateRequest(body: unknown): ParsedCreate {
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: "invalid_request" };
  const { mode, ...value } = parsed.data;
  if (mode !== "initial") return { ok: false, code: "mode_not_supported" };
  return { ok: true, value };
}

export function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined);
}

// Used for the rate limit only: never logged, never stored. Each proxy appends the address
// it saw: with one trusted proxy the last entry is the visitor, and anything before it was
// written by the visitor.
export function clientAddress(
  headers: Headers,
  trustedHops: number = Number(process.env.TRUSTED_PROXY_HOPS) || 1,
): string {
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const forwarded = chain[Math.max(0, chain.length - trustedHops)];
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

export function parseAfter(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) return null;
  const after = Number(value);
  return Number.isSafeInteger(after) ? after : null;
}
