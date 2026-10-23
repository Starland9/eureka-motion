import type { Language } from "scene";
import type { VersionEntry, VersionKind } from "@/components/controls/Versions";

const KINDS: readonly VersionKind[] = ["initial", "another_analogy", "simpler", "zoom", "followup"];

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function parseVersions(body: unknown): VersionEntry[] {
  if (!Array.isArray(body)) return [];
  const entries: VersionEntry[] = [];
  for (const item of body as unknown[]) {
    const id = field(item, "id");
    const raw = field(item, "kind");
    const kind = raw === "reference" ? "initial" : KINDS.find((candidate) => candidate === raw);
    if (typeof id !== "string" || kind === undefined) continue;
    const scene = field(item, "scene_title");
    entries.push(typeof scene === "string" && scene !== "" ? { id, kind, scene } : { id, kind });
  }
  return entries;
}

export async function fetchVersions(
  id: string,
  language: Language,
  signal: AbortSignal,
): Promise<VersionEntry[]> {
  const response = await fetch(`/api/explanations/${encodeURIComponent(id)}/versions`, {
    headers: { "Accept-Language": language },
    signal,
  });
  return response.ok ? parseVersions(await response.json()) : [];
}
