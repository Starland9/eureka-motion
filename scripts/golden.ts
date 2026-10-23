import { randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const base = process.env.INIT_CWD ?? process.cwd();
const DEFAULT_SET = fileURLToPath(new URL("./golden-set.json", import.meta.url));

const USAGE =
  "Usage : golden [--base-url=<url>] [--limit=<n>] [--lang=fr|en|both] [--only=<id>] [--kind=core|other] [--concurrency=<n>] [--timeout=<s>] [--deep-timeout=<s>] [--deep-poll=<s>] [--set=<fichier>] [--out=<fichier.json>]";

const LANGUAGES = ["fr", "en"] as const;
const LEVELS = ["college", "lycee", "superieur"] as const;
const CORE_SUBJECTS: readonly string[] = [
  "maths",
  "physics",
  "chemistry",
  "biology",
  "cs",
  "economics",
];
const KINDS = ["core", "other"] as const;
const OUTCOMES = ["ready", "partial", "refused", "clarify", "failed", "timeout"] as const;
const CONCEPT_KEYS = new Set(["id", "subject", "kind", "level", "questions"]);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BLOCK_END = /\r?\n\r?\n/;
const RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_S = 5;

export const THRESHOLDS = {
  successPercent: { core: 90, other: 80 },
  firstSceneP90Ms: 15_000,
  deepPercent: 80,
  deepLimitMs: 300_000,
} as const;

type Language = (typeof LANGUAGES)[number];
type Level = (typeof LEVELS)[number];
export type Kind = (typeof KINDS)[number];
export type Outcome = (typeof OUTCOMES)[number];

export interface Concept {
  id: string;
  subject: string;
  kind: Kind;
  level: Level;
  questions: Record<Language, string>;
}

export interface DeepResult {
  status: "ready" | "abandoned" | "timeout";
  ms: number | null;
}

export interface QuestionResult {
  id: string;
  kind: Kind;
  subject: string;
  level: Level;
  language: Language;
  question: string;
  outcome: Outcome;
  detail: string | null;
  explanation_id: string | null;
  cached: boolean;
  redirected: boolean;
  first_scene_ms: number | null;
  total_ms: number;
  planned_scenes: number | null;
  scenes: { validated: number; corrected: number; dropped: number };
  rate_limited: number;
  waited_ms: number;
  deep: DeepResult | null;
}

export interface KindSummary {
  total: number;
  succeeded: number;
  cached: number;
  counts: Record<Outcome, number>;
}

export interface Summary {
  kinds: Record<Kind, KindSummary>;
  first_scene: { count: number; without: number; median_ms: number | null; p90_ms: number | null };
  scenes: { validated: number; corrected: number; dropped: number };
  deep: {
    announced: number;
    ready: number;
    within_limit: number;
    median_ms: number | null;
    p90_ms: number | null;
  };
}

interface Job {
  concept: Concept;
  language: Language;
  label: string;
}

interface Settings {
  baseUrl: string;
  timeoutMs: number;
  deepTimeoutMs: number;
  deepPollMs: number;
}

interface End {
  outcome: Outcome;
  detail: string | null;
}

interface Attempt {
  explanationId: string | null;
  cached: boolean;
  redirected: boolean;
  plannedScenes: number | null;
  shown: number;
  corrected: number;
  dropped: number;
  firstSceneMs: number | null;
  deepAt: number | null;
}

type Data = Record<string, unknown>;

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
  need(isRecord(raw), "doit être un objet");
  for (const key of Object.keys(raw)) need(CONCEPT_KEYS.has(key), `champ inconnu « ${key} »`);
  const { id, subject, kind, level, questions } = raw;
  need(typeof id === "string" && ID.test(id), "id : minuscules et tirets attendus");
  need(typeof subject === "string" && subject !== "", "subject : texte non vide attendu");
  need(isOneOf(KINDS, kind), `kind doit valoir ${KINDS.join(" ou ")}`);
  need(
    CORE_SUBJECTS.includes(subject) === (kind === "core"),
    kind === "core"
      ? `subject doit être l'une des six matières (${CORE_SUBJECTS.join(", ")})`
      : "un sujet « other » ne doit pas être l'une des six matières",
  );
  need(isOneOf(LEVELS, level), `level doit valoir ${LEVELS.join(", ")}`);
  need(isRecord(questions), "questions doit porter une question par langue");
  const asked = {} as Record<Language, string>;
  for (const language of LANGUAGES) {
    const question = questions[language];
    need(
      typeof question === "string" && question.trim() !== "" && question.trim().length <= 500,
      `questions.${language} : texte de 1 à 500 caractères attendu`,
    );
    asked[language] = question.trim();
  }
  return { id, subject, kind, level, questions: asked };
}

export function parseSet(text: string): Concept[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`JSON invalide : ${(error as Error).message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new UsageError("le jeu doit être un tableau non vide");
  }
  const problems: string[] = [];
  const concepts: Concept[] = [];
  data.forEach((raw: unknown, position) => {
    try {
      const concept = readConcept(raw);
      need(!concepts.some((other) => other.id === concept.id), `id ${concept.id} en double`);
      concepts.push(concept);
    } catch (error) {
      problems.push(`concept ${position + 1} : ${(error as Error).message}`);
    }
  });
  if (problems.length > 0) throw new UsageError(problems.join("\n"));
  return concepts;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// Nearest rank: the p-th percentile is under a limit exactly when at least p % of the values are.
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p * sorted.length) / 100) - 1)]!;
}

function emptyCounts(): Record<Outcome, number> {
  return { ready: 0, partial: 0, refused: 0, clarify: 0, failed: 0, timeout: 0 };
}

export function summarize(results: readonly QuestionResult[]): Summary {
  const kinds = {} as Record<Kind, KindSummary>;
  for (const kind of KINDS) {
    const own = results.filter((result) => result.kind === kind);
    const counts = emptyCounts();
    for (const result of own) counts[result.outcome] += 1;
    kinds[kind] = {
      total: own.length,
      succeeded: counts.ready + counts.partial,
      cached: own.filter((result) => result.cached).length,
      counts,
    };
  }

  const generated = results.filter((result) => !result.cached);
  const delays = generated.flatMap((result) =>
    result.first_scene_ms === null ? [] : [result.first_scene_ms],
  );
  const announced = results.flatMap((result) => (result.deep ? [result.deep] : []));
  const ready = announced.flatMap((deep) =>
    deep.status === "ready" && deep.ms !== null ? [deep.ms] : [],
  );

  return {
    kinds,
    first_scene: {
      count: delays.length,
      without: generated.length - delays.length,
      median_ms: median(delays),
      p90_ms: percentile(delays, 90),
    },
    scenes: {
      validated: results.reduce((sum, result) => sum + result.scenes.validated, 0),
      corrected: results.reduce((sum, result) => sum + result.scenes.corrected, 0),
      dropped: results.reduce((sum, result) => sum + result.scenes.dropped, 0),
    },
    deep: {
      announced: announced.length,
      ready: ready.length,
      within_limit: ready.filter((ms) => ms < THRESHOLDS.deepLimitMs).length,
      median_ms: median(ready),
      p90_ms: percentile(ready, 90),
    },
  };
}

function percent(part: number, whole: number): string {
  return `${((100 * part) / whole).toFixed(1).replace(".", ",")} %`;
}

function seconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

function reaches(part: number, whole: number, minimumPercent: number): boolean {
  return part * 100 >= minimumPercent * whole;
}

export function thresholdFailures(summary: Summary): string[] {
  const failures: string[] = [];
  for (const kind of KINDS) {
    const { total, succeeded } = summary.kinds[kind];
    const minimum = THRESHOLDS.successPercent[kind];
    if (total > 0 && !reaches(succeeded, total, minimum)) {
      failures.push(
        `aboutissement ${kind} : ${succeeded}/${total} (${percent(succeeded, total)}), au moins ${minimum} % attendus`,
      );
    }
  }
  const { p90_ms: p90 } = summary.first_scene;
  if (p90 !== null && p90 >= THRESHOLDS.firstSceneP90Ms) {
    failures.push(
      `première scène : 90ᵉ centile à ${seconds(p90)}, moins de ${seconds(THRESHOLDS.firstSceneP90Ms)} attendues`,
    );
  }
  const { announced, within_limit: within } = summary.deep;
  if (announced > 0 && !reaches(within, announced, THRESHOLDS.deepPercent)) {
    failures.push(
      `version approfondie : ${within}/${announced} prêtes en moins de ${seconds(THRESHOLDS.deepLimitMs)} (${percent(within, announced)}), au moins ${THRESHOLDS.deepPercent} % attendus`,
    );
  }
  return failures;
}

function asData(value: unknown): Data {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseBlock(block: string): { name: string; data: unknown } | null {
  let name = "";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const content = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") name = content;
    else if (field === "data") data.push(content);
  }
  return name === "" || data.length === 0 ? null : { name, data: JSON.parse(data.join("\n")) };
}

async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ name: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      for (let found = BLOCK_END.exec(buffer); found; found = BLOCK_END.exec(buffer)) {
        const event = parseBlock(buffer.slice(0, found.index));
        buffer = buffer.slice(found.index + found[0].length);
        if (event) yield event;
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function apply(state: Attempt, name: string, data: Data, sent: number): End | null {
  switch (name) {
    case "accepted":
      state.explanationId = text(data.explanation_id);
      state.cached = data.cached === true;
      return null;
    case "redirected":
      state.redirected = true;
      return null;
    case "plan":
      state.plannedScenes = typeof data.scene_count === "number" ? data.scene_count : null;
      return null;
    case "verdict":
      if (data.target !== "plan" && data.status === "corrected") state.corrected += 1;
      return null;
    case "scene":
      state.shown += 1;
      state.firstSceneMs ??= performance.now() - sent;
      return null;
    case "scene_dropped":
      state.dropped += 1;
      return null;
    case "deep":
      if (data.status === "queued") state.deepAt ??= performance.now();
      return null;
    case "cached":
      state.cached = true;
      state.explanationId = text(data.explanation_id) ?? state.explanationId;
      return { outcome: "ready", detail: null };
    case "done":
      return { outcome: data.status === "partial" ? "partial" : "ready", detail: null };
    case "refused":
      return { outcome: "refused", detail: text(data.reason) };
    case "clarify":
      return { outcome: "clarify", detail: text(data.reason) };
    case "error":
      return { outcome: "failed", detail: text(data.code) ?? "error" };
    default:
      return null;
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  if (typeof cause?.code === "string") return cause.code;
  return typeof cause?.message === "string" ? cause.message : error.message;
}

function retryAfterMs(header: string | null): number {
  const value = header === null || header.trim() === "" ? NaN : Number(header);
  return (Number.isFinite(value) && value >= 0 ? value : DEFAULT_RETRY_AFTER_S) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomAddress(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

async function failureCode(response: Response): Promise<string> {
  try {
    const code = asData(asData(await response.json()).error).code;
    if (typeof code === "string") return code;
  } catch {
    // The body is not the documented error shape.
  }
  return `http_${response.status}`;
}

async function exchange(
  job: Job,
  settings: Settings,
  address: string,
  state: Attempt,
  signal: AbortSignal,
  sent: number,
): Promise<End | { limitedMs: number }> {
  const { concept, language } = job;
  const response = await fetch(`${settings.baseUrl}/api/explanations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Accept-Language": language,
      "X-Forwarded-For": address,
    },
    body: JSON.stringify({
      question: concept.questions[language],
      language,
      level: concept.level,
    }),
    signal,
  });
  if (response.status === 429) {
    await response.body?.cancel();
    return { limitedMs: retryAfterMs(response.headers.get("retry-after")) };
  }
  if (!response.ok || !response.body) {
    return { outcome: "failed", detail: await failureCode(response) };
  }
  for await (const { name, data } of readEvents(response.body)) {
    const end = apply(state, name, asData(data), sent);
    if (end) return end;
  }
  return state.redirected
    ? { outcome: "ready", detail: null }
    : { outcome: "failed", detail: "connection_lost" };
}

async function runQuestion(
  job: Job,
  settings: Settings,
): Promise<{ result: QuestionResult; deepAt: number | null }> {
  const address = randomAddress();
  const state: Attempt = {
    explanationId: null,
    cached: false,
    redirected: false,
    plannedScenes: null,
    shown: 0,
    corrected: 0,
    dropped: 0,
    firstSceneMs: null,
    deepAt: null,
  };
  let rateLimited = 0;
  let waitedMs = 0;
  let sent: number;
  let end: End;

  for (;;) {
    sent = performance.now();
    const signal = AbortSignal.timeout(settings.timeoutMs);
    try {
      const outcome = await exchange(job, settings, address, state, signal, sent);
      if (!("limitedMs" in outcome)) {
        end = outcome;
        break;
      }
      rateLimited += 1;
      if (rateLimited > RATE_LIMIT_RETRIES || outcome.limitedMs > settings.timeoutMs) {
        end = { outcome: "failed", detail: "rate_limited" };
        break;
      }
      await sleep(outcome.limitedMs);
      waitedMs += outcome.limitedMs;
    } catch (error) {
      end = signal.aborted
        ? { outcome: "timeout", detail: null }
        : { outcome: "failed", detail: describe(error) };
      break;
    }
  }

  const { concept, language } = job;
  return {
    deepAt: state.deepAt,
    result: {
      id: concept.id,
      kind: concept.kind,
      subject: concept.subject,
      level: concept.level,
      language,
      question: concept.questions[language],
      outcome: end.outcome,
      detail: end.detail,
      explanation_id: state.explanationId,
      cached: state.cached,
      redirected: state.redirected,
      first_scene_ms: state.firstSceneMs,
      total_ms: performance.now() - sent,
      planned_scenes: state.plannedScenes,
      scenes: {
        validated: Math.max(0, state.shown - state.corrected),
        corrected: state.corrected,
        dropped: state.dropped,
      },
      rate_limited: rateLimited,
      waited_ms: waitedMs,
      deep: null,
    },
  };
}

async function pollDeep(id: string, announcedAt: number, settings: Settings): Promise<DeepResult> {
  const deadline = announcedAt + settings.deepTimeoutMs;
  for (;;) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return { status: "timeout", ms: null };
    try {
      const response = await fetch(
        `${settings.baseUrl}/api/explanations/${encodeURIComponent(id)}/deep`,
        { signal: AbortSignal.timeout(Math.ceil(remaining)) },
      );
      const status = response.ok ? asData(await response.json()).status : null;
      if (status === "ready") return { status: "ready", ms: performance.now() - announcedAt };
      if (status === "abandoned") return { status: "abandoned", ms: null };
    } catch {
      // A failed poll is retried until the deadline.
    }
    await sleep(Math.min(settings.deepPollMs, Math.max(0, deadline - performance.now())));
  }
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

function clip(value: string, length: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

function noteOf(result: QuestionResult): string {
  const notes: string[] = [];
  if (result.cached) notes.push("cache");
  if (result.redirected) notes.push("redirigée");
  if (result.rate_limited > 0) notes.push(`429×${result.rate_limited}`);
  if (result.detail && result.outcome !== "ready" && result.outcome !== "partial") {
    notes.push(clip(result.detail, 48));
  }
  if (result.deep) {
    const { status, ms } = result.deep;
    notes.push(
      status === "ready"
        ? `approfondie ${seconds(ms)}`
        : `approfondie ${status === "abandoned" ? "abandonnée" : "hors délai"}`,
    );
  }
  return notes.join(", ");
}

function renderTable(rows: string[][], rightAligned: ReadonlySet<number>): string[] {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) =>
        rightAligned.has(column) ? cell.padStart(widths[column]!) : cell.padEnd(widths[column]!),
      )
      .join("  ")
      .trimEnd(),
  );
}

function verdictOf(ok: boolean): string {
  return ok ? "tenu" : "NON TENU";
}

export function formatReport(
  results: readonly QuestionResult[],
  summary: Summary,
  failures: readonly string[],
  context: { baseUrl: string; languages: readonly Language[]; concurrency: number },
): string {
  const lines: string[] = [
    `Jeu de référence : ${results.length} question(s) en ${context.languages.join(" + ")}, ${context.baseUrl}, concurrence ${context.concurrency}`,
    "",
  ];

  const rows = [
    ["id", "langue", "issue", "1re scène", "V/C/É", "durée", "note"],
    ...results.map((result) => [
      result.id,
      result.language,
      result.outcome,
      seconds(result.first_scene_ms),
      `${result.scenes.validated}/${result.scenes.corrected}/${result.scenes.dropped}`,
      seconds(result.total_ms),
      noteOf(result),
    ]),
  ];
  lines.push(...renderTable(rows, new Set([3, 4, 5])));
  lines.push("", "V/C/É : scènes validées / corrigées / écartées.", "");

  lines.push("Aboutissement (explication affichée dès la première demande, prête ou partielle)");
  for (const kind of KINDS) {
    const { total, succeeded, cached, counts } = summary.kinds[kind];
    if (total === 0) continue;
    const minimum = THRESHOLDS.successPercent[kind];
    const detail = OUTCOMES.map((outcome) => `${outcome} ${counts[outcome]}`).join(", ");
    lines.push(
      `  ${kind.padEnd(5)} : ${succeeded}/${total} = ${percent(succeeded, total)} (seuil ${minimum} %) ${verdictOf(reaches(succeeded, total, minimum))}`,
      `          ${detail}${cached > 0 ? `, dont ${cached} servie(s) par le cache` : ""}`,
    );
  }

  const { first_scene: first } = summary;
  lines.push("", "Délai jusqu'à la première scène (questions nouvelles, cache exclu)");
  if (first.count === 0) {
    lines.push("  aucune première scène reçue");
  } else {
    const held = first.p90_ms !== null && first.p90_ms < THRESHOLDS.firstSceneP90Ms;
    lines.push(
      `  médiane ${seconds(first.median_ms)}, 90ᵉ centile ${seconds(first.p90_ms)} (seuil < ${seconds(THRESHOLDS.firstSceneP90Ms)}) ${verdictOf(held)}`,
      `  sur ${first.count} question(s)${first.without > 0 ? `, ${first.without} sans aucune scène` : ""}`,
    );
  }

  const { scenes } = summary;
  lines.push(
    "",
    `Scènes : validées ${scenes.validated}, corrigées ${scenes.corrected}, écartées ${scenes.dropped}`,
    "Coût : non disponible (le serveur n'indique ni jetons ni tarif dans ses événements)",
  );

  const { deep } = summary;
  if (deep.announced === 0) {
    lines.push("Version approfondie : aucune annoncée");
  } else {
    const held = reaches(deep.within_limit, deep.announced, THRESHOLDS.deepPercent);
    lines.push(
      `Version approfondie : ${deep.announced} annoncée(s), ${deep.ready} prête(s), dont ${deep.within_limit} en moins de ${seconds(THRESHOLDS.deepLimitMs)} (seuil ${THRESHOLDS.deepPercent} %) ${verdictOf(held)}`,
      `  durée médiane ${seconds(deep.median_ms)}, 90ᵉ centile ${seconds(deep.p90_ms)}`,
    );
  }

  lines.push("");
  if (failures.length === 0) {
    lines.push("Seuils : tous tenus.");
  } else {
    lines.push("Seuils non tenus :", ...failures.map((failure) => `  - ${failure}`));
  }
  return lines.join("\n");
}

function parseOptions() {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: {
        "base-url": { type: "string", default: "http://localhost:3000" },
        limit: { type: "string" },
        lang: { type: "string", default: "fr" },
        only: { type: "string" },
        kind: { type: "string" },
        concurrency: { type: "string", default: "1" },
        timeout: { type: "string", default: "240" },
        "deep-timeout": { type: "string", default: String(THRESHOLDS.deepLimitMs / 1000) },
        "deep-poll": { type: "string", default: "2" },
        set: { type: "string" },
        out: { type: "string" },
      },
      allowPositionals: false,
    }).values;
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\n${USAGE}`);
  }
}

function positive(name: string, value: string, integer: boolean): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isInteger(number))) {
    throw new UsageError(
      `--${name} doit être un nombre${integer ? " entier" : ""} positif\n${USAGE}`,
    );
  }
  return number;
}

function parseBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href.replace(/\/$/, "");
  } catch {
    // Reported below.
  }
  throw new UsageError(`--base-url doit être une adresse http(s)\n${USAGE}`);
}

async function main(): Promise<number> {
  const options = parseOptions();
  const baseUrl = parseBaseUrl(options["base-url"]);
  const languages: Language[] =
    options.lang === "both" ? [...LANGUAGES] : LANGUAGES.filter((item) => item === options.lang);
  if (languages.length === 0) throw new UsageError(`--lang doit valoir fr, en ou both\n${USAGE}`);
  if (options.kind !== undefined && !isOneOf(KINDS, options.kind)) {
    throw new UsageError(`--kind doit valoir core ou other\n${USAGE}`);
  }
  const concurrency = positive("concurrency", options.concurrency, true);
  const limit = options.limit === undefined ? Infinity : positive("limit", options.limit, true);
  const settings: Settings = {
    baseUrl,
    timeoutMs: Math.round(positive("timeout", options.timeout, false) * 1000),
    deepTimeoutMs: positive("deep-timeout", options["deep-timeout"], false) * 1000,
    deepPollMs: positive("deep-poll", options["deep-poll"], false) * 1000,
  };

  const setFile = options.set ? path.resolve(base, options.set) : DEFAULT_SET;
  let concepts: Concept[];
  try {
    concepts = parseSet(await readFile(setFile, "utf8"));
  } catch (error) {
    throw new UsageError(`${setFile} : ${(error as Error).message}`);
  }
  concepts = concepts.filter(
    (concept) =>
      (options.only === undefined || concept.id === options.only) &&
      (options.kind === undefined || concept.kind === options.kind),
  );
  const jobs = concepts
    .flatMap((concept) =>
      languages.map((language): Job => ({ concept, language, label: `${concept.id} ${language}` })),
    )
    .slice(0, limit);
  if (jobs.length === 0) throw new UsageError("Aucune question ne correspond aux filtres.");

  let finished = 0;
  const deepPolls: Promise<void>[] = [];
  const results = await pool(jobs, concurrency, async (job) => {
    const { result, deepAt } = await runQuestion(job, settings);
    if (deepAt !== null && result.explanation_id !== null) {
      deepPolls.push(
        pollDeep(result.explanation_id, deepAt, settings).then((deep) => {
          result.deep = deep;
        }),
      );
    }
    finished += 1;
    console.error(`[${finished}/${jobs.length}] ${job.label} : ${result.outcome}`);
    return result;
  });
  if (deepPolls.length > 0) {
    console.error(
      `En attente de ${deepPolls.length} version(s) approfondie(s), ${settings.deepTimeoutMs / 1000} s au plus.`,
    );
    await Promise.all(deepPolls);
  }

  const summary = summarize(results);
  const failures = thresholdFailures(summary);
  console.log(formatReport(results, summary, failures, { baseUrl, languages, concurrency }));

  if (options.out !== undefined) {
    const target = path.resolve(base, options.out);
    await writeFile(
      target,
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          base_url: baseUrl,
          languages,
          concurrency,
          timeout_s: settings.timeoutMs / 1000,
          results,
          summary,
          threshold_failures: failures,
        },
        null,
        2,
      )}\n`,
    );
    console.error(`Rapport brut écrit dans ${target}`);
  }
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
