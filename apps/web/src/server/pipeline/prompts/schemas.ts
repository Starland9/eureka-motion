import { z } from "zod";

export const SUBJECTS = [
  "maths",
  "physics",
  "chemistry",
  "biology",
  "cs",
  "economics",
  "other",
] as const;
export type Subject = (typeof SUBJECTS)[number];

export const TriageSchema = z.strictObject({
  decision: z.enum(["accept", "clarify", "refuse"]),
  reason: z.string().max(240).default(""),
  concept: z
    .strictObject({
      slug: z
        .string()
        .regex(/^[a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(80),
      title: z.string().min(1).max(60),
      subject: z.enum(SUBJECTS),
    })
    .nullable()
    .default(null),
  interpretations: z
    .array(
      z.strictObject({ label: z.string().min(1).max(60), question: z.string().min(1).max(140) }),
    )
    .max(3)
    .default([]),
  detected_language: z.enum(["fr", "en", "other"]).default("other"),
  deep_eligible: z.boolean().default(false),
});
export type Triage = z.infer<typeof TriageSchema>;

export const JudgeSchema = z.strictObject({
  verdict: z.enum(["valid", "invalid"]),
  issues: z
    .array(z.strictObject({ where: z.string().max(120), problem: z.string().max(400) }))
    .max(5)
    .default([]),
  reason: z.string().min(1).max(240),
});
export type Judgement = z.infer<typeof JudgeSchema>;

export const CheckSchema = z.strictObject({
  verdict: z.enum(["valid", "invalid"]),
  problem: z.string().max(400).default(""),
  reason: z.string().min(1).max(240),
});
export type Check = z.infer<typeof CheckSchema>;
