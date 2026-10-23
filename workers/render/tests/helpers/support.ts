import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

export function derivativeRecord(base: ExplanationRecord): ExplanationRecord {
  const scene = base.payload.scenes.find((candidate) => candidate.role === "formula");
  if (!scene) throw new Error("The base explanation has no formula scene");
  const narration = [
    "Zoome sur la courbe : près d'un point, elle ressemble à une droite.",
    "Sa pente, c'est la dérivée. Fais glisser le point et regarde-la changer.",
    "Pour f(x) = x², la pente vaut toujours le double de l'abscisse.",
  ];
  return {
    ...base,
    title: "La dérivée d'une fonction",
    question: "c'est quoi la dérivée d'une fonction ?",
    concept_slug: "maths/derivative",
    subject: "maths",
    payload: {
      ...base.payload,
      plan: {
        objective:
          "Savoir que la dérivée de f en a est la pente de la tangente à la courbe au point d'abscisse a.",
        prerequisites: ["Lire un graphique", "Calculer la pente d'une droite"],
        analogy: {
          name: "La pente d'une route",
          mapping:
            "La route joue le rôle de la courbe ; sa pente sous la roue, celui de la dérivée.",
        },
        key_rule: {
          statement:
            "La dérivée de f en a est la limite du taux d'accroissement quand h tend vers 0.",
          formula: "\\res{f'(a)} = \\lim_{h \\to 0} \\dfrac{f(a+\\q{h}) - f(a)}{\\q{h}}",
        },
        steps: [
          {
            role: "hook",
            intent: "Se demander comment mesurer la pente d'une courbe.",
            visual: "Une route qui monte de plus en plus.",
          },
          {
            role: "mechanism",
            intent: "Voir la sécante devenir la tangente.",
            visual: "h rétrécit, la sécante pivote.",
          },
          {
            role: "formula",
            intent: "Écrire la limite du taux d'accroissement.",
            visual: "La formule s'écrit terme à terme.",
          },
          {
            role: "example",
            intent: "Calculer la dérivée de x².",
            visual: "Le point glisse, la pente vaut 2a.",
          },
          {
            role: "recap",
            intent: "Retenir que la dérivée est une pente.",
            visual: "Trois idées, la dernière surlignée.",
          },
        ],
      },
      params: [
        {
          id: "a",
          symbol: "a",
          label: "Abscisse du point",
          unit: "",
          min: -2,
          max: 2,
          step: 0.1,
          default: 1,
          role: "quantity",
        },
      ],
      model: {
        constants: [],
        derived: [
          {
            id: "slope",
            expr: "2 * a",
            unit: "",
            label: "Pente de la tangente",
            symbol: "f'(a)",
            format: "fixed:1",
          },
        ],
      },
      scenes: [
        {
          ...scene,
          title: "La pente de la tangente",
          beats: scene.beats.map((beat, index) => ({
            ...beat,
            narration: narration[index] ?? beat.narration,
          })),
          elements: scene.elements.map((element) =>
            element.type === "formula" ? { ...element, tex: "\\res{f'(a)} = 2\\q{a}" } : element,
          ),
        },
      ],
      quiz: null,
    },
  };
}

export const FAKE_MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom", "latin1"),
  Buffer.from("a fake video of the deep version"),
]);

export type FakeAnswer =
  | { ok: true; video?: Buffer }
  | { ok: false; stage: "static_check" | "render"; error: string; stderr_tail?: string }
  | "silent";

export interface FakeSandboxOptions {
  dir: string;
  answer: (code: string, id: string) => FakeAnswer | Promise<FakeAnswer>;
  now?: () => number;
  intervalMs?: number;
}

export interface FakeSandbox {
  seen: { id: string; code: string }[];
  beating: boolean;
  stop(): Promise<void>;
}

const JOB_FILE = /^([A-Za-z0-9_-]{1,64})\.py$/;

async function publish(file: string, data: string | Buffer): Promise<void> {
  const partial = path.join(path.dirname(file), `.${path.basename(file)}.part`);
  await writeFile(partial, data);
  await rename(partial, file);
}

// Plays the file protocol of workers/manim/sandbox/runner.py on a directory.
export async function startFakeSandbox(options: FakeSandboxOptions): Promise<FakeSandbox> {
  const inbox = path.join(options.dir, "in");
  const outbox = path.join(options.dir, "out");
  const now = options.now ?? Date.now;
  const interval = options.intervalMs ?? 10;
  await mkdir(inbox, { recursive: true });
  await mkdir(outbox, { recursive: true });
  const handled = new Set<string>();
  const sandbox: FakeSandbox = { seen: [], beating: true, stop: async () => undefined };

  const beat = async () => {
    if (sandbox.beating) {
      await publish(path.join(outbox, ".heartbeat"), String(Math.floor(now() / 1000)));
    }
  };

  const serve = async (id: string, name: string) => {
    const code = await readFile(path.join(inbox, name), "utf8");
    sandbox.seen.push({ id, code });
    const answer = await options.answer(code, id);
    if (answer === "silent") return;
    if (answer.ok) await publish(path.join(outbox, `${id}.mp4`), answer.video ?? FAKE_MP4);
    const result = answer.ok
      ? { ok: true, stage: "render", duration_ms: 12, error: "", stderr_tail: "" }
      : {
          ok: false,
          stage: answer.stage,
          duration_ms: 12,
          error: answer.error,
          stderr_tail: answer.stderr_tail ?? "",
        };
    await publish(path.join(outbox, `${id}.json`), JSON.stringify(result));
    await rm(path.join(inbox, name), { force: true });
  };

  let busy = false;
  const scan = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const name of await readdir(inbox)) {
        const id = JOB_FILE.exec(name)?.[1];
        if (!id || handled.has(id)) continue;
        handled.add(id);
        await serve(id, name);
      }
    } finally {
      busy = false;
    }
  };

  await beat();
  const beatTimer = setInterval(() => void beat().catch(() => undefined), interval);
  const scanTimer = setInterval(() => void scan().catch(() => undefined), interval);
  sandbox.stop = async () => {
    clearInterval(beatTimer);
    clearInterval(scanTimer);
    await waitFor(async () => !busy, 5_000);
  };
  return sandbox;
}
