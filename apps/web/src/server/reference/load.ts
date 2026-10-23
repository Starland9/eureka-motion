import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DocumentSchema, typesetTexts, type ExplanationDocument, type Language } from "scene";
import { resolveMediaPath } from "../media";
import {
  AUDIO_DIR,
  compareEntries,
  entryOf,
  INDEX_FILE,
  isReferenceFileName,
  parseReferenceFile,
  referenceFileName,
  ReferenceIndexSchema,
  type ReferenceEntry,
  type ReferenceFile,
} from "./schema";

export interface ReferenceDocument extends ReferenceEntry {
  question: string;
  reviewed_by: ReferenceFile["reviewed_by"];
  reviewed_at: ReferenceFile["reviewed_at"];
  verdicts: ReferenceFile["verdicts"];
  payload: ExplanationDocument;
}

// Relative to the working directory, apps/web, as in next.config.ts.
export function getReferenceDir(env: Readonly<Record<string, string | undefined>> = process.env) {
  return path.resolve(/* turbopackIgnore: true */ env.REFERENCE_DIR || "../../content/reference");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function scanEntries(dir: string): Promise<ReferenceEntry[]> {
  const names = (await readdir(dir)).filter(isReferenceFileName).sort();
  const entries: ReferenceEntry[] = [];
  for (const name of names) {
    try {
      entries.push(entryOf(parseReferenceFile(name, await readFile(path.join(dir, name), "utf8"))));
    } catch (error) {
      console.error(`Reference file ${name} ignored.`, error);
    }
  }
  return entries;
}

// The index written by reference:build; without it the files themselves are read.
async function readEntries(dir: string): Promise<ReferenceEntry[]> {
  let text: string;
  try {
    text = await readFile(path.join(dir, INDEX_FILE), "utf8");
  } catch (error) {
    if (isMissing(error)) return scanEntries(dir);
    throw error;
  }
  return ReferenceIndexSchema.parse(JSON.parse(text)).references;
}

export async function listReferences(
  language: Language,
  dir: string = getReferenceDir(),
): Promise<ReferenceEntry[]> {
  return (await readEntries(dir))
    .filter((entry) => entry.language === language)
    .sort(compareEntries);
}

export async function loadReference(
  explanationId: string,
  dir: string = getReferenceDir(),
): Promise<ReferenceDocument | null> {
  const entry = (await readEntries(dir)).find((item) => item.explanation_id === explanationId);
  if (!entry) return null;
  const name = referenceFileName(entry.slug, entry.language);
  const file = parseReferenceFile(name, await readFile(path.join(dir, name), "utf8"));
  return {
    ...entry,
    question: file.question,
    reviewed_by: file.reviewed_by,
    reviewed_at: file.reviewed_at,
    verdicts: file.verdicts,
    payload: typesetTexts(DocumentSchema.parse(file.payload), file.language),
  };
}

export function referenceAudioDir(dir: string = getReferenceDir()): string {
  return path.join(dir, AUDIO_DIR);
}

// Segments are those of /media/{explanation_id}/{file}.
export function resolveReferenceAudio(
  segments: readonly string[],
  dir: string = getReferenceDir(),
): string | null {
  const file = resolveMediaPath(segments, referenceAudioDir(dir));
  return file && path.extname(file).toLowerCase() === ".mp3" ? file : null;
}
