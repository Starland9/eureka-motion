import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { DocumentSchema, type Language } from "scene";
import { isDevRouteEnabled } from "@/lib/dev-reference";
import { Gallery, type GalleryEntry } from "./Gallery";

export const dynamic = "force-dynamic";

const FIXTURES_DIR = path.resolve(process.cwd(), "../../packages/scene/tests/fixtures");
const REFERENCE_FILE = path.resolve(
  process.cwd(),
  "../../content/reference/physics.universal-gravitation.fr.json",
);

function missing(what: string, location: string): Error {
  return new Error(
    `Gallery: ${what} not found at ${location} (working directory ${process.cwd()})`,
  );
}

function parseEntry(name: string, text: string): GalleryEntry {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, name, issues: [`JSON: ${(error as Error).message}`] };
  }
  const envelope = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const parsed = DocumentSchema.safeParse(envelope.payload ?? raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return { ok: false, name, issues };
  }
  const language: Language = envelope.language === "en" ? "en" : "fr";
  return { ok: true, name, language, document: parsed.data };
}

async function loadEntries(): Promise<GalleryEntry[]> {
  const names = await readdir(FIXTURES_DIR).catch(() => {
    throw missing("fixtures folder", FIXTURES_DIR);
  });
  const files = names.filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw missing("fixture documents (*.json)", FIXTURES_DIR);
  const reference = await readFile(REFERENCE_FILE, "utf8").catch(() => {
    throw missing("reference document", REFERENCE_FILE);
  });
  const fixtures = await Promise.all(
    files.map(async (name) =>
      parseEntry(name, await readFile(path.join(FIXTURES_DIR, name), "utf8")),
    ),
  );
  return [...fixtures, parseEntry(path.basename(REFERENCE_FILE), reference)];
}

export default async function DevGalleryPage() {
  if (!isDevRouteEnabled()) notFound();
  return <Gallery entries={await loadEntries()} />;
}
