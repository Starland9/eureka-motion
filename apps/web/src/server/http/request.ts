import { LANGUAGES, LEVELS } from "scene";
import { z } from "zod";
import { EXPLANATION_ID_PATTERN } from "../container";
import type { ModeInput, StartInput } from "../pipeline/run";

const language = z.enum(LANGUAGES);
const level = z.enum(LEVELS);
const question = z.string().trim().min(1).max(500);
const parent = { language, level, parent_id: z.string().regex(EXPLANATION_ID_PATTERN) };

const InitialSchema = z.object({
  mode: z.literal("initial"),
  question,
  language,
  level,
  interpretation: z
    .string()
    .trim()
    .max(140)
    .transform((text) => text || undefined)
    .optional(),
});

const CreateSchema = z.discriminatedUnion("mode", [
  InitialSchema,
  z.strictObject({ mode: z.enum(["another_analogy", "simpler"]), ...parent }),
  z.strictObject({
    mode: z.literal("zoom"),
    ...parent,
    scene_id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/),
  }),
  z.strictObject({ mode: z.literal("followup"), ...parent, question }),
]);

export type CreateRequest = (StartInput & { mode: "initial" }) | ModeInput;

export type ParsedCreate =
  { ok: true; value: CreateRequest } | { ok: false; code: "invalid_request" };

export function parseCreateRequest(body: unknown): ParsedCreate {
  const withMode =
    typeof body === "object" && body !== null && !Array.isArray(body) && !("mode" in body)
      ? { ...body, mode: "initial" }
      : body;
  const parsed = CreateSchema.safeParse(withMode);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "invalid_request" };
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
