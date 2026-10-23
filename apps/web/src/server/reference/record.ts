import { stat } from "node:fs/promises";
import type { ExplanationRecord } from "../pipeline/ports";
import { getReferenceDir, listReferences, loadReference } from "./load";

interface KnownIds {
  dir: string;
  mtimeMs: number;
  ids: ReadonlySet<string>;
}

let known: KnownIds | null = null;

// The directory changes when a file is added or removed, so ids are re-read only then.
async function referenceIds(dir: string): Promise<ReadonlySet<string>> {
  const { mtimeMs } = await stat(dir);
  if (known?.dir === dir && known.mtimeMs === mtimeMs) return known.ids;
  const entries = [...(await listReferences("fr", dir)), ...(await listReferences("en", dir))];
  known = { dir, mtimeMs, ids: new Set(entries.map((entry) => entry.explanation_id)) };
  return known.ids;
}

export async function loadReferenceRecord(
  id: string,
  dir: string = getReferenceDir(),
): Promise<ExplanationRecord | null> {
  let ids: ReadonlySet<string>;
  try {
    ids = await referenceIds(dir);
  } catch (error) {
    console.error("Reference explanations are unreadable.", error);
    return null;
  }
  if (!ids.has(id)) return null;

  const reference = await loadReference(id, dir);
  if (!reference) return null;
  const { payload } = reference;
  return {
    id,
    kind: "reference",
    parent_id: null,
    root_id: id,
    focus_scene_id: null,
    question: reference.question,
    language: reference.language,
    level: reference.reference_level,
    concept_slug: reference.slug,
    subject: reference.subject,
    title: reference.title,
    status: "ready",
    payload: {
      version: payload.version,
      plan: payload.plan,
      params: payload.params,
      model: payload.model,
      scenes: payload.scenes,
      quiz: payload.quiz ?? null,
    },
    verdicts: reference.verdicts,
    scene_count_planned: payload.scenes.length,
    provider: "reference",
    model: "reference",
    timings: {},
    created_at: new Date(0),
    completed_at: new Date(0),
    expires_at: null,
  };
}
