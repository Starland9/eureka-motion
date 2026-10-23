import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createVoiceProvider,
  TtsError,
  type SynthesizeRequest,
  type VoiceProvider,
} from "../apps/web/src/server/tts/index";

type Language = SynthesizeRequest["language"];

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPTS, "..");
const PHRASES_FILE = path.join(SCRIPTS, "voice-phrases.json");
const DEFAULT_OUT = path.join(ROOT, "out", "voices");
const FALLBACK_PROVIDERS = ["kokoro", "pocket"];
const ALL_LANGUAGES: readonly Language[] = ["fr", "en"];

const USAGE = "Usage: voices-compare [--providers a,b] [--out <dir>] [--lang fr|en]";

type Env = Readonly<Record<string, string | undefined>>;

export interface Output {
  write(text: string): unknown;
}

export interface CompareRun {
  argv: readonly string[];
  env: Env;
  stdout: Output;
  stderr: Output;
  cwd?: string;
}

export interface CompareRecord {
  provider: string;
  language: Language;
  index: number;
  text: string;
  voice: string;
  durationMs: number;
  elapsedMs: number;
  file: string;
}

export interface CompareFailure {
  provider: string;
  stage: "setup" | "health" | "phrase";
  language?: Language;
  index?: number;
  text?: string;
  message: string;
}

class UsageError extends Error {}

function pad(index: number): string {
  return String(index).padStart(2, "0");
}

function defaultProviders(env: Env): string[] {
  const names = (env.TTS_PROVIDERS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "" && name !== "none");
  return names.length > 0 ? [...new Set(names)] : FALLBACK_PROVIDERS;
}

function parseProviders(value: string): string[] {
  const names = value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) throw new UsageError("--providers must list at least one voice.");
  return [...new Set(names)];
}

function isLanguage(value: string): value is Language {
  return (ALL_LANGUAGES as readonly string[]).includes(value);
}

async function readPhrases(): Promise<Record<Language, string[]>> {
  const data: unknown = JSON.parse(await readFile(PHRASES_FILE, "utf8"));
  const phrases = {} as Record<Language, string[]>;
  for (const language of ALL_LANGUAGES) {
    const list = (data as Record<string, unknown> | null)?.[language];
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) {
      throw new Error(`${PHRASES_FILE}: "${language}" must be a list of texts.`);
    }
    phrases[language] = list as string[];
  }
  return phrases;
}

function describe(error: unknown): string {
  if (error instanceof TtsError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export async function runVoicesCompare(run: CompareRun): Promise<number> {
  try {
    return await compare(run);
  } catch (error) {
    if (error instanceof UsageError) {
      run.stderr.write(`${error.message}\n${USAGE}\n`);
      return 2;
    }
    run.stderr.write(`${describe(error)}\n`);
    return 1;
  }
}

async function compare({ argv, env, stdout, stderr, cwd = process.cwd() }: CompareRun) {
  let options;
  try {
    ({ values: options } = parseArgs({
      args: [...argv],
      options: {
        providers: { type: "string" },
        out: { type: "string" },
        lang: { type: "string" },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError((error as Error).message);
  }

  const names =
    options.providers === undefined ? defaultProviders(env) : parseProviders(options.providers);
  const lang = options.lang;
  if (lang !== undefined && !isLanguage(lang)) {
    throw new UsageError(`--lang must be one of ${ALL_LANGUAGES.join(", ")}.`);
  }
  const languages = lang === undefined ? ALL_LANGUAGES : [lang];
  const outDir = options.out === undefined ? DEFAULT_OUT : path.resolve(cwd, options.out);

  const providers = names.map((name) => {
    try {
      return { name, provider: createVoiceProvider(name, env) };
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
  });
  const phrases = await readPhrases();

  const records: CompareRecord[] = [];
  const failures: CompareFailure[] = [];
  const health: Record<string, boolean> = {};

  stdout.write(`${names.join(", ")} (${languages.join(", ")}) into ${outDir}\n`);
  await mkdir(outDir, { recursive: true });

  for (const { name, provider } of providers) {
    if (provider === null) {
      const message = "not configured (AZURE_SPEECH_KEY is missing)";
      health[name] = false;
      failures.push({ provider: name, stage: "setup", message });
      stderr.write(`${name}: ${message}\n`);
      continue;
    }
    health[name] = await provider.health();
    if (health[name]) {
      stdout.write(`${name}: health ok\n`);
    } else {
      const message = "the service does not answer its health check";
      failures.push({ provider: name, stage: "health", message });
      stderr.write(`${name}: ${message}\n`);
    }
    await synthesizeAll(provider, languages, phrases, outDir, records, failures, {
      stdout,
      stderr,
    });
  }

  const index = { providers: names, languages, health, records, failures };
  await writeFile(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  await writeFile(path.join(outDir, "ecoute.html"), listeningPage(names, languages, records));

  const phraseFailures = failures.filter((failure) => failure.stage === "phrase").length;
  stdout.write(`${records.length} file(s) written, ${phraseFailures} phrase(s) failed.\n`);
  if (failures.length > 0) {
    stderr.write(`Failures (${failures.length}):\n`);
    for (const failure of failures)
      stderr.write(`  ${failureLabel(failure)}: ${failure.message}\n`);
    return 1;
  }
  return 0;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function listeningPage(
  names: string[],
  languages: readonly Language[],
  records: CompareRecord[],
): string {
  const sections = languages.map((language) => {
    const phrases = new Map<number, string>();
    for (const record of records) {
      if (record.language === language) phrases.set(record.index, record.text);
    }
    const rows = [...phrases.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, text]) => {
        const players = names.map((name) => {
          const record = records.find(
            (r) => r.provider === name && r.language === language && r.index === index,
          );
          const player = record
            ? `<audio controls preload="none" src="${escapeHtml(record.file)}"></audio>`
            : "<em>absent</em>";
          return `<div><b>${escapeHtml(name)}</b> ${player}</div>`;
        });
        return `<section><p>${pad(index)} — ${escapeHtml(text)}</p>${players.join("")}</section>`;
      });
    return `<h2>${language}</h2>${rows.join("\n")}`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Écoute comparée</title>
<style>body{font:16px/1.5 serif;max-width:60rem;margin:2rem auto;padding:0 1rem}section{border-top:1px solid #999;padding:.5rem 0}div{display:flex;gap:.75rem;align-items:center}b{min-width:5rem}</style>
<h1>Écoute comparée</h1>${sections.join("\n")}
`;
}

function failureLabel(failure: CompareFailure): string {
  if (failure.stage !== "phrase") return `${failure.provider} ${failure.stage}`;
  return `${failure.provider} ${failure.language} ${pad(failure.index ?? 0)}`;
}

async function synthesizeAll(
  provider: VoiceProvider,
  languages: readonly Language[],
  phrases: Record<Language, string[]>,
  outDir: string,
  records: CompareRecord[],
  failures: CompareFailure[],
  io: { stdout: Output; stderr: Output },
): Promise<void> {
  const folder = path.join(outDir, provider.name);
  await mkdir(folder, { recursive: true });
  for (const language of languages) {
    for (const [position, text] of phrases[language].entries()) {
      const index = position + 1;
      const label = `${provider.name} ${language} ${pad(index)}`;
      const started = performance.now();
      try {
        const audio = await provider.synthesize({ text, language });
        const elapsedMs = Math.round(performance.now() - started);
        const file = `${provider.name}/${language}-${pad(index)}.mp3`;
        await writeFile(path.join(outDir, file), audio.audio);
        records.push({
          provider: provider.name,
          language,
          index,
          text,
          voice: audio.voice,
          durationMs: audio.durationMs,
          elapsedMs,
          file,
        });
        io.stdout.write(`${label} elapsed ${elapsedMs} ms, duration ${audio.durationMs} ms\n`);
      } catch (error) {
        const message = describe(error);
        failures.push({ provider: provider.name, stage: "phrase", language, index, text, message });
        io.stderr.write(`${label} FAILED: ${message}\n`);
      }
    }
  }
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile(path.join(ROOT, ".env"));
  } catch {
    // No root .env: the environment is provided by the host.
  }
  runVoicesCompare({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.env.INIT_CWD ?? process.cwd(),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
