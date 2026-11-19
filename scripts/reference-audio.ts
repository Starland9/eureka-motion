import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createVoiceProvider, mp3DurationMs } from "../apps/web/src/server/tts";
import { checkReferences, referenceId } from "../apps/web/src/server/reference";
import {
  AUDIO_DIR,
  isReferenceFileName,
  parseReferenceFile,
} from "../apps/web/src/server/reference/schema";

const USAGE =
  "Usage: reference-audio [--dir=<dir>] [--only=<slug>] [--lang=fr|en] [--force] [--dry-run] [--concurrency=<n>]";

const root = path.resolve(import.meta.dirname, "..");
const base = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2);
const value = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string): boolean => args.includes(`--${name}`);

const dir = value("dir") ? path.resolve(base, value("dir")!) : path.join(root, "content/reference");
const only = value("only");
const lang = value("lang");
const force = flag("force");
const dryRun = flag("dry-run");
const concurrency = Number(value("concurrency") ?? "6");

interface Beat {
  id: string;
  narration: string;
  audio?: { url: string; duration_ms: number };
}
interface Job {
  file: string;
  id: string;
  language: "fr" | "en";
  scene: string;
  beat: Beat;
}

async function exists(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  return Boolean(info?.isFile() && info.size > 0);
}

async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Edits the text in place so that the rest of each file keeps its exact form.
function withAudio(text: string, beats: readonly Beat[]): string {
  let index = 0;
  const narration =
    /^([ \t]*)"narration": ("(?:[^"\\]|\\.)*")(,?)\n(?:\1"audio": \{[^\n]*\},?\n)?/gm;
  const result = text.replace(narration, (_match, indent: string, value: string, comma: string) => {
    const audio = beats[index++]?.audio;
    if (!audio) return `${indent}"narration": ${value}${comma}\n`;
    const line = `${indent}"audio": { "url": "${audio.url}", "duration_ms": ${audio.duration_ms} }`;
    return comma
      ? `${indent}"narration": ${value},\n${line},\n`
      : `${indent}"narration": ${value},\n${line}\n`;
  });
  if (index !== beats.length)
    throw new Error(`found ${index} narrations for ${beats.length} beats`);
  return result;
}

async function main(): Promise<number> {
  if (args.includes("--help") || !Number.isInteger(concurrency) || concurrency < 1) {
    console.log(USAGE);
    return args.includes("--help") ? 0 : 2;
  }
  await stat(path.join(root, ".env")).then(
    () => process.loadEnvFile(path.join(root, ".env")),
    () => undefined,
  );

  const names = (await readdir(dir)).filter(isReferenceFileName).sort();
  const documents = new Map<string, { text: string; beats: Beat[] }>();
  const jobs: Job[] = [];
  for (const name of names) {
    const text = await readFile(path.join(dir, name), "utf8");
    const file = parseReferenceFile(name, text);
    if (only && file.slug !== only) continue;
    if (lang && file.language !== lang) continue;
    const raw = JSON.parse(text) as {
      payload: { scenes: { id: string; beats: Beat[] }[] };
    };
    const beats = raw.payload.scenes.flatMap((scene) => scene.beats);
    documents.set(name, { text, beats });
    const id = referenceId(file.slug, file.language);
    for (const scene of raw.payload.scenes) {
      for (const beat of scene.beats) {
        const audioName = `${scene.id}-${beat.id}.mp3`;
        const target = path.join(dir, AUDIO_DIR, id, audioName);
        if (!force && (await exists(target))) {
          const durationMs = mp3DurationMs(new Uint8Array(await readFile(target)));
          if (durationMs > 0) {
            beat.audio = { url: `/media/${id}/${audioName}`, duration_ms: durationMs };
            continue;
          }
        }
        jobs.push({ file: name, id, language: file.language, scene: scene.id, beat });
      }
    }
  }

  const characters = jobs.reduce((sum, job) => sum + job.beat.narration.length, 0);
  console.log(
    `${documents.size} reference file(s), ${jobs.length} beat(s) to speak, ${characters} characters.`,
  );
  if (dryRun) return 0;

  const voice = createVoiceProvider("deepgram", process.env);
  if (!voice && jobs.length > 0) {
    console.error("DEEPGRAM_API_KEY is not set: no voice to speak with.");
    return 1;
  }

  let done = 0;
  const failures: string[] = [];
  await pool(jobs, concurrency, async (job) => {
    const name = `${job.scene}-${job.beat.id}.mp3`;
    try {
      const spoken = await voice!.synthesize({ text: job.beat.narration, language: job.language });
      await mkdir(path.join(dir, AUDIO_DIR, job.id), { recursive: true });
      await writeFile(path.join(dir, AUDIO_DIR, job.id, name), spoken.audio);
      job.beat.audio = { url: `/media/${job.id}/${name}`, duration_ms: spoken.durationMs };
    } catch (error) {
      failures.push(`${job.id}/${name}: ${(error as Error).message}`);
    }
    done += 1;
    if (done % 25 === 0 || done === jobs.length) console.log(`${done}/${jobs.length}`);
  });

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(`${failures.length} beat(s) not spoken: reference files left unchanged.`);
    return 1;
  }
  for (const [name, { text, beats }] of documents) {
    await writeFile(path.join(dir, name), withAudio(text, beats));
  }

  const problems = (await checkReferences(dir)).filter((result) => result.problems.length > 0);
  for (const { file, problems: list } of problems) console.error(`${file}: ${list.join("; ")}`);
  console.log(
    problems.length === 0
      ? "All reference files pass the check."
      : `${problems.length} reference file(s) fail the check.`,
  );
  return problems.length === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
