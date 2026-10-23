import { mkdtemp, readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "@/server/db/client";
import { explanations } from "@/server/db/schema";
import type { ExplanationRecord } from "@/server/pipeline/ports";
import { loadReferenceRecord, referenceId } from "@/server/reference";

export const REFERENCE_DIR = fileURLToPath(
  new URL("../../../../content/reference", import.meta.url),
);
export const DATABASE = "eureka_render_test";

const SHELL_GLOB = /^chromium_headless_shell-\d+$/;

export function scratchDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `${prefix}-`));
}

// Remotion renders several times faster with a headless shell than with a full Chromium.
export async function findBrowser(): Promise<string | undefined> {
  if (process.env.BROWSER_EXECUTABLE) return process.env.BROWSER_EXECUTABLE;
  const cache = path.join(homedir(), ".cache", "ms-playwright");
  const names = await readdir(cache).catch(() => [] as string[]);
  const found = names
    .filter((name) => SHELL_GLOB.test(name))
    .sort()
    .at(-1);
  if (!found) return undefined;
  const folders = await readdir(path.join(cache, found));
  const folder = folders.find((name) => name.startsWith("chrome-headless-shell"));
  return folder ? path.join(cache, found, folder, "chrome-headless-shell") : undefined;
}

export async function loadGravity(): Promise<ExplanationRecord> {
  const record = await loadReferenceRecord(
    referenceId("physics/universal-gravitation", "fr"),
    REFERENCE_DIR,
  );
  if (!record) throw new Error("The gravitation reference is missing from the repository");
  return record;
}

const LETTERS = "abcdefghjkmnpqrstuvwxyz";
let counter = 0;

export function nextId(): string {
  counter += 1;
  return (
    "r".repeat(10) +
    LETTERS[Math.floor(counter / LETTERS.length)]! +
    LETTERS[counter % LETTERS.length]!
  );
}

export async function storeExplanation(
  db: Database,
  base: ExplanationRecord,
  patch: Partial<ExplanationRecord> = {},
): Promise<ExplanationRecord> {
  const id = nextId();
  const record: ExplanationRecord = { ...base, id, root_id: id, ...patch };
  await db.insert(explanations).values(record);
  return record;
}

export async function waitFor<T>(
  read: () => Promise<T | null | undefined | false>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("Timed out while waiting for a condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
