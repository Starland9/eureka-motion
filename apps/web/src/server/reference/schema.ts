import { createHash } from "node:crypto";
import { LANGUAGES, LEVELS, type Language } from "scene";
import { z } from "zod";
import type { Verdict } from "../pipeline/events";

export const REFERENCE_SUBJECTS = [
  "maths",
  "physics",
  "chemistry",
  "biology",
  "cs",
  "economics",
] as const;
export type ReferenceSubject = (typeof REFERENCE_SUBJECTS)[number];

export const INDEX_FILE = "index.json";
export const AUDIO_DIR = "audio";

// Same alphabet and length as the ids of generated explanations (container.ts).
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const ID_LENGTH = 12;

const SlugSchema = z
  .string()
  .regex(/^[a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);

const VerdictSchema: z.ZodType<Verdict> = z.strictObject({
  target: z.string().min(1),
  status: z.enum(["validated", "corrected", "dropped"]),
  attempts: z.number().int().nonnegative(),
  reason: z.string(),
  checks: z.array(z.string()),
});

const EntryFields = {
  slug: SlugSchema,
  subject: z.enum(REFERENCE_SUBJECTS),
  title: z.string().min(1).max(60),
  reference_level: z.enum(LEVELS),
  language: z.enum(LANGUAGES),
};

export const ReferenceFileSchema = z
  .strictObject({
    ...EntryFields,
    question: z.string().trim().min(1).max(500),
    reviewed_by: z.string().min(1).nullable(),
    reviewed_at: z.iso.date().nullable(),
    verdicts: z.array(VerdictSchema),
    payload: z.unknown().refine((value) => value !== undefined, { message: "required" }),
  })
  .refine((file) => (file.reviewed_by === null) === (file.reviewed_at === null), {
    path: ["reviewed_by"],
    message: "reviewed_by and reviewed_at must be both set or both null",
  });
export type ReferenceFile = z.infer<typeof ReferenceFileSchema>;

export const ReferenceEntrySchema = z.strictObject({
  ...EntryFields,
  explanation_id: z.string().regex(/^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/),
});
export type ReferenceEntry = z.infer<typeof ReferenceEntrySchema>;

export const ReferenceIndexSchema = z.strictObject({
  references: z.array(ReferenceEntrySchema),
});
export type ReferenceIndex = z.infer<typeof ReferenceIndexSchema>;

export function referenceId(slug: string, language: Language): string {
  const digest = createHash("sha256").update(`reference:${slug}:${language}`).digest();
  let id = "";
  for (let i = 0; i < ID_LENGTH; i += 1) id += ID_ALPHABET[digest[i]! % ID_ALPHABET.length];
  return id;
}

export function referenceFileName(slug: string, language: Language): string {
  return `${slug.replace("/", ".")}.${language}.json`;
}

export function isReferenceFileName(name: string): boolean {
  return name.endsWith(".json") && name !== INDEX_FILE;
}

export function entryOf(file: ReferenceFile): ReferenceEntry {
  return {
    slug: file.slug,
    subject: file.subject,
    title: file.title,
    reference_level: file.reference_level,
    language: file.language,
    explanation_id: referenceId(file.slug, file.language),
  };
}

export function parseReferenceFile(name: string, text: string): ReferenceFile {
  const file = ReferenceFileSchema.parse(JSON.parse(text));
  const expected = referenceFileName(file.slug, file.language);
  if (name !== expected) {
    throw new Error(`file name must be ${expected} for slug ${file.slug} in ${file.language}`);
  }
  return file;
}

const SUBJECT_ORDER: ReadonlyMap<string, number> = new Map(
  REFERENCE_SUBJECTS.map((subject, position) => [subject, position]),
);

export function compareEntries(a: ReferenceEntry, b: ReferenceEntry): number {
  return (
    (SUBJECT_ORDER.get(a.subject) ?? 0) - (SUBJECT_ORDER.get(b.subject) ?? 0) ||
    a.slug.localeCompare(b.slug) ||
    a.language.localeCompare(b.language)
  );
}
