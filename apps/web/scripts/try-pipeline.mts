import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateDocument, formatIssues, type Language, type Level, type Scene } from "scene";
import { createProvider } from "../src/server/llm";
import type {
  ExplanationRecord,
  ExplanationStore,
  PipelineDeps,
} from "../src/server/pipeline/ports";
import { Pipeline } from "../src/server/pipeline/run";

const [question = "la loi de la gravité", language = "fr", level = "lycee"] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "../../..");
const out = path.join(root, ".snapshots", "try");

const started = Date.now();
const records = new Map<string, ExplanationRecord>();
const store: ExplanationStore = {
  create: async (record) => void records.set(record.id, record),
  update: async (id, patch) =>
    void records.set(id, { ...(records.get(id) as ExplanationRecord), ...patch }),
  get: async (id) => records.get(id) ?? null,
  remove: async (id) => void records.delete(id),
};

const deps: PipelineDeps = {
  llm: createProvider(),
  store,
  cache: {
    findByQuestion: async () => null,
    findByConcept: async () => null,
    remember: async () => undefined,
  },
  voice: { narrate: async (_id, scene: Scene) => scene },
  newId: () => `try${Date.now().toString(36)}`,
  now: () => new Date(),
  shareUrl: (id, lang) => `/${lang}/e/${id}`,
  trace: (entry) => {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
    const status = entry.ok ? "ok" : "FAILED";
    console.log(
      `${elapsed}s      · ${entry.label.padEnd(9)} ${entry.role.padEnd(7)} ${String(entry.ms).padStart(6)} ms x${entry.attempts} ${status}`,
    );
    for (const reason of entry.rejections)
      console.log(`             rejected: ${reason.replace(/\n/g, " | ").slice(0, 400)}`);
  },
};

const { id, log } = await new Pipeline(deps).start({
  question,
  language: language as Language,
  level: level as Level,
});
if (!log) throw new Error("no log");

for await (const { seq, event } of log.stream()) {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
  let detail: string;
  if (event.type === "step") detail = `${event.name} ${event.status}`;
  else if (event.type === "verdict")
    detail = `${event.target} ${event.status} x${event.attempts} — ${event.reason}`;
  else if (event.type === "scene")
    detail = `${event.index} "${event.scene.title}" (${event.scene.layout}: ${event.scene.elements.map((e) => e.type).join(", ")})`;
  else if (event.type === "plan")
    detail = `${event.scene_count} scenes, params: ${event.params.map((p) => p.id).join(", ") || "none"}; analogy: ${event.plan.analogy.name}`;
  else if (event.type === "meta") detail = `${event.concept_slug} — ${event.title}`;
  else detail = JSON.stringify(event).slice(0, 220);
  console.log(`${elapsed}s #${String(seq).padStart(2)} ${event.type.padEnd(13)} ${detail}`);
}

const record = records.get(id);
if (record && record.payload.plan) {
  mkdirSync(out, { recursive: true });
  const file = path.join(out, `${(record.concept_slug ?? id).replace("/", ".")}.${language}.json`);
  writeFileSync(
    file,
    JSON.stringify({ language, payload: { ...record.payload, quiz: undefined } }, null, 2),
  );
  const check = validateDocument({ ...record.payload, quiz: undefined }, { allowPartial: true });
  console.log(`\nstatus: ${record.status} | timings: ${JSON.stringify(record.timings)}`);
  console.log(`document: ${file}`);
  console.log(`validation: ${check.ok ? "OK" : formatIssues(check.issues)}`);
}
