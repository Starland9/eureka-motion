import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  formatIssues,
  LANGUAGES,
  LEVELS,
  validateDocument,
  type Language,
  type Level,
} from "scene";
import { createProvider, type LlmProvider } from "../apps/web/src/server/llm";
import type { PipelineEvent } from "../apps/web/src/server/pipeline/events";
import type {
  ExplanationRecord,
  ExplanationStore,
  LlmTrace,
  PipelineDeps,
} from "../apps/web/src/server/pipeline/ports";
import { createQuizWriter } from "../apps/web/src/server/pipeline/quiz";
import { Pipeline } from "../apps/web/src/server/pipeline/run";
import { checkReferences, referenceFileName, referenceId } from "../apps/web/src/server/reference";
import {
  REFERENCE_SUBJECTS,
  ReferenceFileSchema,
  type ReferenceFile,
  type ReferenceSubject,
} from "../apps/web/src/server/reference/schema";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.INIT_CWD ?? process.cwd();

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No root .env: the environment is provided by the host.
}

const USAGE =
  "Usage: reference-generate [--only=<slug>] [--lang=fr|en] [--force] [--allow-partial] [--dry-run] [--concurrency=<n>] [--set=<file>] [--out-dir=<dir>]";
const SLUG = /^[a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONCEPT_KEYS = new Set(["slug", "subject", "reference_level", "questions", "hand_written"]);

interface Concept {
  slug: string;
  subject: ReferenceSubject;
  reference_level: Level;
  questions: Record<Language, string>;
  hand_written: Language[];
}

interface Job {
  concept: Concept;
  language: Language;
  id: string;
  target: string;
  label: string;
}

interface Settings {
  outDir: string;
  force: boolean;
  allowPartial: boolean;
}

type Disposition = "generate" | "exists" | "hand-written";
type Status = "written" | "partial" | "exists" | "hand-written" | "failed";

interface Result {
  job: Job;
  status: Status;
}

class UsageError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readConcept(raw: unknown): Concept {
  need(isRecord(raw), "must be an object");
  for (const key of Object.keys(raw)) need(CONCEPT_KEYS.has(key), `unknown field "${key}"`);
  const { slug, subject, reference_level: level, questions, hand_written: handWritten = [] } = raw;
  need(isOneOf(REFERENCE_SUBJECTS, subject), `subject must be one of ${REFERENCE_SUBJECTS}`);
  need(
    typeof slug === "string" && SLUG.test(slug) && slug.length <= 80,
    "slug must look like subject/kebab-case-name",
  );
  need(slug.startsWith(`${subject}/`), `slug must start with "${subject}/"`);
  need(isOneOf(LEVELS, level), `reference_level must be one of ${LEVELS}`);
  need(isRecord(questions), "questions must hold one question per language");
  const asked = {} as Record<Language, string>;
  for (const language of LANGUAGES) {
    const question = questions[language];
    need(
      typeof question === "string" && question.trim() !== "" && question.trim().length <= 500,
      `questions.${language} must be a text of 1 to 500 characters`,
    );
    asked[language] = question.trim();
  }
  need(
    Array.isArray(handWritten) && handWritten.every((item) => isOneOf(LANGUAGES, item)),
    "hand_written must list languages",
  );
  return {
    slug,
    subject,
    reference_level: level,
    questions: asked,
    hand_written: handWritten as Language[],
  };
}

function parseSet(text: string): Concept[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new UsageError("must be a non-empty array of concepts");
  }
  const problems: string[] = [];
  const concepts: Concept[] = [];
  data.forEach((raw: unknown, position) => {
    try {
      const concept = readConcept(raw);
      if (concepts.some((other) => other.slug === concept.slug)) {
        throw new Error(`slug ${concept.slug} is listed twice`);
      }
      concepts.push(concept);
    } catch (error) {
      problems.push(`concept ${position + 1}: ${(error as Error).message}`);
    }
  });
  if (problems.length > 0) throw new UsageError(problems.join("\n"));
  return concepts;
}

function shown(target: string): string {
  const relative = path.relative(base, target);
  return relative.startsWith("..") ? target : relative || ".";
}

function indent(text: string): string {
  return text.replace(/^/gm, "  ");
}

function serialize(file: ReferenceFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

async function exists(target: string): Promise<boolean> {
  return (await stat(target).catch(() => null)) !== null;
}

async function disposition(job: Job, settings: Settings): Promise<Disposition> {
  if (job.concept.hand_written.includes(job.language)) return "hand-written";
  if (!settings.force && (await exists(job.target))) return "exists";
  return "generate";
}

function memoryStore(): ExplanationStore {
  const records = new Map<string, ExplanationRecord>();
  return {
    create: async (record) => void records.set(record.id, record),
    update: async (id, patch) => {
      const current = records.get(id);
      if (!current) throw new Error(`No record ${id} to update`);
      records.set(id, { ...current, ...patch });
    },
    get: async (id) => records.get(id) ?? null,
    isExpired: async () => false,
    remove: async (id) => void records.delete(id),
    listByRoot: async (rootId) =>
      [...records.values()].filter((record) => record.root_id === rootId),
  };
}

interface Played {
  end: PipelineEvent | null;
  record: ExplanationRecord | null;
  traces: LlmTrace[];
}

async function play(job: Job, llm: LlmProvider, say: (message: string) => void): Promise<Played> {
  const traces: LlmTrace[] = [];
  const store = memoryStore();
  const deps: PipelineDeps = {
    llm,
    store,
    cache: {
      findByQuestion: async () => null,
      findByConcept: async () => null,
      remember: async () => undefined,
    },
    voice: { narrate: async (_id, scene) => scene },
    newId: () => job.id,
    now: () => new Date(),
    shareUrl: (id, language) => `/${language}/e/${id}`,
    trace: (entry) => traces.push(entry),
    writeQuiz: createQuizWriter(llm, (entry) => traces.push(entry)),
  };
  const { concept, language } = job;
  const { id, log } = await new Pipeline(deps).start({
    question: concept.questions[language],
    language,
    level: concept.reference_level,
  });
  let end: PipelineEvent | null = null;
  for await (const { event } of log?.stream() ?? []) {
    if (event.type === "plan") say(`plan of ${event.scene_count} scenes`);
    else if (event.type === "scene") say(`scene ${event.index + 1} written`);
    else if (event.type === "scene_dropped") say(`scene ${event.index + 1} dropped`);
    end = event;
  }
  return { end, record: await store.get(id), traces };
}

function failures(traces: readonly LlmTrace[]): string[] {
  return traces
    .filter((entry) => !entry.ok)
    .map((entry) => {
      const last = entry.rejections.at(-1)?.replace(/\s+/g, " ").slice(0, 300);
      return `${entry.label} (${entry.role}) failed after ${entry.attempts} attempt(s)${last ? `: ${last}` : ""}`;
    });
}

function whyNotDone(end: PipelineEvent | null, traces: readonly LlmTrace[]): string {
  if (end?.type === "error") return [`${end.code}: ${end.message}`, ...failures(traces)].join("\n");
  if (end?.type === "refused") return `the triage refused the question: ${end.reason}`;
  if (end?.type === "clarify") return `the triage found the question ambiguous: ${end.reason}`;
  return `the pipeline ended with ${end ? `"${end.type}"` : "no event"}`;
}

function toFile(job: Job, record: ExplanationRecord): ReferenceFile {
  const { plan, params, model, scenes, quiz, version } = record.payload;
  need(plan && record.title, "the pipeline left no plan or title");
  const { concept, language } = job;
  return {
    slug: concept.slug,
    subject: concept.subject,
    reference_level: concept.reference_level,
    language,
    title: record.title,
    question: concept.questions[language],
    reviewed_by: null,
    reviewed_at: null,
    verdicts: record.verdicts,
    payload: { version, plan, params, model, scenes, ...(quiz ? { quiz } : {}) },
  };
}

async function problemsOfComplete(file: ReferenceFile): Promise<string[]> {
  const staging = await mkdtemp(path.join(tmpdir(), "reference-generate-"));
  try {
    await writeFile(
      path.join(staging, referenceFileName(file.slug, file.language)),
      serialize(file),
    );
    return (await checkReferences(staging)).flatMap((result) => result.problems);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function problemsOfPartial(file: ReferenceFile): string[] {
  const parsed = ReferenceFileSchema.safeParse(file);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`,
    );
  }
  const checked = validateDocument(file.payload, { allowPartial: true });
  return checked.ok ? [] : [formatIssues(checked.issues)];
}

function verdictSummary(record: ExplanationRecord): string {
  const scenes = record.verdicts.filter((verdict) => verdict.target !== "plan");
  const count = (status: string): number => scenes.filter((v) => v.status === status).length;
  return `${record.payload.scenes.length} of ${record.scene_count_planned ?? "?"} scenes (${count("validated")} validated, ${count("corrected")} corrected, ${count("dropped")} dropped)`;
}

async function generate(job: Job, llm: LlmProvider, settings: Settings): Promise<Result> {
  const say = (message: string): void => console.log(`[${job.label}] ${message}`);
  const fail = (reason: string): Result => {
    console.error(`[${job.label}] FAILED, nothing written:\n${indent(reason)}`);
    return { job, status: "failed" };
  };

  const started = Date.now();
  say(`asking: ${job.concept.questions[job.language]}`);
  const { end, record, traces } = await play(job, llm, say);
  if (end?.type !== "done" || !record) return fail(whyNotDone(end, traces));

  const partial = end.status === "partial";
  const dropped = record.verdicts
    .filter((verdict) => verdict.status === "dropped" && verdict.target !== "plan")
    .map((verdict) => verdict.target);
  if (partial && !settings.allowPartial) {
    return fail(
      `partial explanation, scenes dropped: ${dropped.join(", ")}; use --allow-partial to keep it for hand repair`,
    );
  }

  const file = toFile(job, record);
  const problems = partial ? problemsOfPartial(file) : await problemsOfComplete(file);
  if (problems.length > 0) return fail(`the document is not valid:\n${problems.join("\n")}`);

  if (record.concept_slug !== job.concept.slug || record.subject !== job.concept.subject) {
    say(
      `warning: the pipeline named the concept ${record.concept_slug} (${record.subject}), the file keeps ${job.concept.slug}`,
    );
  }

  await mkdir(settings.outDir, { recursive: true });
  try {
    await writeFile(job.target, serialize(file), { flag: settings.force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    say("kept, the file appeared in the meantime (use --force to replace it)");
    return { job, status: "exists" };
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  say(`written ${shown(job.target)}: ${verdictSummary(record)} in ${seconds} s`);
  if (partial) {
    say(
      `PARTIAL: reference:build rejects it until the dropped scenes (${dropped.join(", ")}) are fixed by hand`,
    );
  }
  return { job, status: partial ? "partial" : "written" };
}

async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function skipReason(status: Disposition): string {
  return status === "hand-written"
    ? "the file is hand-written and never regenerated"
    : "the file exists, use --force to replace it";
}

function parseOptions() {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: {
        only: { type: "string" },
        lang: { type: "string" },
        force: { type: "boolean", default: false },
        "allow-partial": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        concurrency: { type: "string", default: "2" },
        set: { type: "string" },
        "out-dir": { type: "string" },
      },
      allowPositionals: false,
    }).values;
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${USAGE}`);
  }
}

async function main(): Promise<number> {
  const options = parseOptions();
  const language = options.lang;
  if (language !== undefined && !isOneOf(LANGUAGES, language)) {
    throw new UsageError(`--lang must be one of ${LANGUAGES.join(", ")}\n${USAGE}`);
  }
  const concurrency = Number(options.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new UsageError(`--concurrency must be a positive integer\n${USAGE}`);
  }

  const setFile = options.set
    ? path.resolve(base, options.set)
    : path.join(root, "scripts/reference-set.json");
  const outDir = options["out-dir"]
    ? path.resolve(base, options["out-dir"])
    : process.env.REFERENCE_DIR
      ? path.resolve(process.env.REFERENCE_DIR)
      : path.join(root, "content/reference");
  const settings: Settings = {
    outDir,
    force: options.force,
    allowPartial: options["allow-partial"],
  };

  let concepts: Concept[];
  try {
    concepts = parseSet(await readFile(setFile, "utf8"));
  } catch (error) {
    throw new UsageError(`${shown(setFile)}: ${(error as Error).message}`);
  }
  if (options.only !== undefined) {
    concepts = concepts.filter((concept) => concept.slug === options.only);
    if (concepts.length === 0)
      throw new UsageError(`--only: no concept ${options.only} in the set`);
  }

  const jobs = concepts.flatMap((concept) =>
    LANGUAGES.filter((item) => language === undefined || item === language).map((item): Job => {
      const id = referenceId(concept.slug, item);
      return {
        concept,
        language: item,
        id,
        target: path.join(outDir, referenceFileName(concept.slug, item)),
        label: `${concept.slug} ${item}`,
      };
    }),
  );

  const provider = process.env.LLM_PROVIDER || "deepseek";
  console.log(
    `${jobs.length} document(s) from ${shown(setFile)} into ${shown(outDir)}, provider ${provider}`,
  );

  if (options["dry-run"]) {
    for (const job of jobs) {
      const status = await disposition(job, settings);
      const { concept, language: lang } = job;
      const detail =
        status === "generate"
          ? `would generate ${shown(job.target)} at level ${concept.reference_level}: ${concept.questions[lang]}`
          : `would keep, ${skipReason(status)}`;
      console.log(`[${job.label}] ${detail}`);
    }
    return 0;
  }

  const llm = createProvider();
  const results = await pool(jobs, concurrency, async (job): Promise<Result> => {
    const status = await disposition(job, settings);
    if (status !== "generate") {
      console.log(`[${job.label}] kept, ${skipReason(status)}`);
      return { job, status };
    }
    try {
      return await generate(job, llm, settings);
    } catch (error) {
      console.error(`[${job.label}] FAILED, nothing written: ${(error as Error).message}`);
      return { job, status: "failed" };
    }
  });

  const count = (status: Status): number => results.filter((item) => item.status === status).length;
  const failed = results.filter((item) => item.status === "failed");
  console.log(
    `${count("written")} written, ${count("partial")} partial, ${count("exists") + count("hand-written")} kept, ${failed.length} failed.`,
  );
  if (count("partial") > 0) {
    console.log("Partial documents are rejected by reference:build until they are repaired.");
  }
  if (failed.length > 0) {
    console.error(`Failed: ${failed.map((item) => item.job.label).join(", ")}.`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  },
);
