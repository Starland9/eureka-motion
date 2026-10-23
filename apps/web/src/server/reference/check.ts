import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { formatIssues, validateDocument, type ExplanationDocument } from "scene";
import { ZodError } from "zod";
import { referenceAudioDir } from "./load";
import {
  entryOf,
  isReferenceFileName,
  parseReferenceFile,
  referenceId,
  type ReferenceEntry,
  type ReferenceFile,
} from "./schema";

export interface CheckedReference {
  file: string;
  entry: ReferenceEntry | null;
  beats: number;
  voiced: number;
  problems: string[];
}

function describe(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`)
      .join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

async function audioProblems(
  file: ReferenceFile,
  document: ExplanationDocument,
  audioDir: string,
): Promise<{ beats: number; voiced: number; problems: string[] }> {
  const id = referenceId(file.slug, file.language);
  const beats = document.scenes.flatMap((scene) =>
    scene.beats.map((beat) => ({ scene: scene.id, beat })),
  );
  const voiced = beats.filter(({ beat }) => beat.audio);
  const problems: string[] = [];
  if (voiced.length > 0 && voiced.length < beats.length) {
    problems.push(`audio on ${voiced.length} of ${beats.length} beats: every beat or none`);
  }
  for (const { scene, beat } of voiced) {
    const name = `${scene}-${beat.id}.mp3`;
    const expected = `/media/${id}/${name}`;
    if (beat.audio!.url !== expected) {
      problems.push(`${scene}.${beat.id}: audio url must be ${expected}`);
      continue;
    }
    const info = await stat(path.join(audioDir, id, name)).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      problems.push(`${scene}.${beat.id}: audio file audio/${id}/${name} is missing or empty`);
    }
  }
  return { beats: beats.length, voiced: voiced.length, problems };
}

async function checkFile(dir: string, name: string): Promise<CheckedReference> {
  const result: CheckedReference = { file: name, entry: null, beats: 0, voiced: 0, problems: [] };
  let file: ReferenceFile;
  try {
    file = parseReferenceFile(name, await readFile(path.join(dir, name), "utf8"));
  } catch (error) {
    result.problems.push(describe(error));
    return result;
  }
  result.entry = entryOf(file);

  const checked = validateDocument(file.payload);
  if (!checked.ok) {
    result.problems.push(formatIssues(checked.issues));
    return result;
  }
  Object.assign(result, await audioProblems(file, checked.value, referenceAudioDir(dir)));
  return result;
}

function crossLanguageProblems(results: readonly CheckedReference[]): void {
  const firstBySlug = new Map<string, ReferenceEntry>();
  for (const { entry, problems } of results) {
    if (!entry) continue;
    const first = firstBySlug.get(entry.slug);
    if (!first) {
      firstBySlug.set(entry.slug, entry);
      continue;
    }
    for (const field of ["subject", "reference_level"] as const) {
      if (entry[field] !== first[field]) {
        problems.push(
          `${field} is ${entry[field]} but the ${first.language} file of ${entry.slug} says ${first[field]}`,
        );
      }
    }
  }
}

export async function checkReferences(dir: string): Promise<CheckedReference[]> {
  const names = (await readdir(dir)).filter(isReferenceFileName).sort();
  const results = await Promise.all(names.map((name) => checkFile(dir, name)));
  crossLanguageProblems(results);
  return results;
}
