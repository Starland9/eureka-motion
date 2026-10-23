import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LANGUAGES, LEVELS } from "scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import type { ScenarioStep } from "../../src/server/llm";
import { sceneMarker } from "../../src/server/pipeline/prompts";
import { checkReferences } from "../../src/server/reference";
import { brokenScene, scenarioFromReference, scenesOf } from "../helpers/scenario";

const run = promisify(execFile);
const WEB = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPTS = fileURLToPath(new URL("../../../../scripts/", import.meta.url));
const GENERATE = path.join(SCRIPTS, "reference-generate.ts");
const BUILD = path.join(SCRIPTS, "reference-build.ts");
const SET_FILE = path.join(SCRIPTS, "reference-set.json");
const SUBJECTS = ["maths", "physics", "chemistry", "biology", "cs", "economics"];

const QUESTIONS = {
  fr: "Question de test numéro un sur la gravitation",
  en: "Test question number one about gravitation",
};
const FR_NAME = "physics.universal-gravitation.fr.json";
const EN_NAME = "physics.universal-gravitation.en.json";

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
}

let work: string;
let out: string;
let scenarios: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "reference-generate-"));
  out = path.join(work, "out");
  scenarios = path.join(work, "scenarios");
  await mkdir(scenarios);
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

function entry(extra: object = {}, slug = reference.slug, questions = QUESTIONS): object {
  return {
    slug,
    subject: slug.split("/")[0],
    reference_level: reference.reference_level,
    questions,
    ...extra,
  };
}

async function putSet(...entries: object[]): Promise<void> {
  await writeFile(path.join(work, "set.json"), JSON.stringify(entries));
}

async function putScenarios(prepend: ScenarioStep[] = []): Promise<void> {
  for (const language of LANGUAGES) {
    const scenario = scenarioFromReference(reference, {
      name: `test.${language}`,
      question: QUESTIONS[language],
      prepend,
    });
    await writeFile(path.join(scenarios, `${scenario.name}.json`), JSON.stringify(scenario));
  }
}

const FILLER = "Regarde bien la figure et suis ce qui bouge sous tes yeux.";

type SceneOfReference = ReturnType<typeof scenesOf>[number];

function stretched(scene: SceneOfReference): SceneOfReference {
  return {
    ...scene,
    beats: scene.beats.map((beat) => ({ ...beat, narration: `${beat.narration} ${FILLER}` })),
  };
}

async function putStretchedScenarios(): Promise<void> {
  for (const language of LANGUAGES) {
    const scenario = scenarioFromReference(reference, {
      name: `test.${language}`,
      question: QUESTIONS[language],
      replace: {
        triage: { repeat: true },
        outline: { repeat: true },
        judge: { repeat: true },
        scenes: Object.fromEntries(
          scenesOf(reference).map((scene) => [
            scene.index,
            { response: stretched(scene), repeat: true },
          ]),
        ),
      },
    });
    await writeFile(path.join(scenarios, `${scenario.name}.json`), JSON.stringify(scenario));
  }
}

function tsx(script: string, args: string[], env: Record<string, string> = {}): Promise<Outcome> {
  return run(
    process.execPath,
    [
      path.join(WEB, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      path.join(WEB, "scripts/tsconfig.json"),
      script,
      ...args,
    ],
    { cwd: WEB, env: { ...process.env, INIT_CWD: work, ...env } },
  ).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );
}

// The dead address and empty key make sure a mistake can never reach a real provider.
function generate(args: string[], env: Record<string, string> = {}): Promise<Outcome> {
  return tsx(GENERATE, ["--set=set.json", "--out-dir=out", ...args], {
    LLM_PROVIDER: "fixture",
    LLM_FIXTURE_DIR: scenarios,
    LLM_BASE_URL: "http://127.0.0.1:9",
    LLM_API_KEY: "",
    REFERENCE_DIR: "",
    ...env,
  });
}

async function files(): Promise<string[]> {
  return (await readdir(out).catch(() => [])).sort();
}

async function readJson(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(out, name), "utf8")) as Record<string, unknown>;
}

async function problems(): Promise<string[]> {
  return (await checkReferences(out)).flatMap((result) => result.problems);
}

describe("reference-set.json", () => {
  it("lists twelve concepts over six subjects, two at least per subject, in both languages", async () => {
    const set = JSON.parse(await readFile(SET_FILE, "utf8")) as {
      slug: string;
      subject: string;
      reference_level: string;
      questions: Record<string, string>;
      hand_written?: string[];
    }[];
    expect(set).toHaveLength(12);
    expect(new Set(set.map((item) => item.slug)).size).toBe(12);
    for (const subject of SUBJECTS) {
      expect(set.filter((item) => item.subject === subject).length).toBeGreaterThanOrEqual(2);
    }
    for (const item of set) {
      expect(SUBJECTS).toContain(item.subject);
      expect(item.slug.startsWith(`${item.subject}/`)).toBe(true);
      expect(LEVELS).toContain(item.reference_level);
      for (const language of LANGUAGES) {
        expect(item.questions[language]?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("matches the hand-written document and protects it from regeneration", async () => {
    const set = JSON.parse(await readFile(SET_FILE, "utf8")) as {
      slug: string;
      subject: string;
      reference_level: string;
      questions: { fr: string };
      hand_written?: string[];
    }[];
    const gravitation = set.find((item) => item.slug === reference.slug);
    expect(gravitation).toMatchObject({
      subject: reference.subject,
      reference_level: reference.reference_level,
      hand_written: ["fr"],
    });
    expect(gravitation?.questions.fr).toBe(reference.question);
  });
});

describe("reference-generate script", () => {
  it("writes one document per language, each accepted by reference:build", async () => {
    await putSet(entry());
    await putScenarios();
    const result = await generate([]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(await files()).toEqual([EN_NAME, FR_NAME]);
    expect(await problems()).toEqual([]);

    for (const [name, language] of [
      [FR_NAME, "fr"],
      [EN_NAME, "en"],
    ] as const) {
      const file = await readJson(name);
      expect(file).toMatchObject({
        slug: reference.slug,
        subject: "physics",
        reference_level: "lycee",
        language,
        question: QUESTIONS[language],
        reviewed_by: null,
        reviewed_at: null,
      });
      const verdicts = file.verdicts as { target: string; status: string }[];
      expect(verdicts.map((verdict) => verdict.target)).toEqual([
        "plan",
        ...Array.from({ length: 6 }, (_, index) => `s${index + 1}`),
      ]);
      expect(typeof file.title).toBe("string");
    }

    const built = await tsx(BUILD, ["--dir=out", "--out=out-built/index.json"]);
    expect(built.stderr).toBe("");
    expect(built.code).toBe(0);
    expect(built.stdout).toContain("2 reference files valid");
  }, 90_000);

  it("keeps an existing file without --force, then replaces it with --force", async () => {
    await putSet(entry());
    await putScenarios();
    await mkdir(out);
    await writeFile(path.join(out, FR_NAME), "do not touch");

    const kept = await generate(["--lang=fr"]);
    expect(kept.code).toBe(0);
    expect(kept.stdout).toContain("use --force");
    expect(kept.stdout).not.toContain("asking");
    expect(await readFile(path.join(out, FR_NAME), "utf8")).toBe("do not touch");

    const forced = await generate(["--lang=fr", "--force"]);
    expect(forced.code).toBe(0);
    expect(await files()).toEqual([FR_NAME]);
    expect((await readJson(FR_NAME)).language).toBe("fr");
    expect(await problems()).toEqual([]);
  }, 90_000);

  it("never regenerates a language listed as hand-written, even with --force", async () => {
    await putSet(entry({ hand_written: ["fr"] }));
    await putScenarios();
    await mkdir(out);
    await writeFile(path.join(out, FR_NAME), "hand-written");

    const result = await generate(["--force"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hand-written");
    expect(await readFile(path.join(out, FR_NAME), "utf8")).toBe("hand-written");
    expect((await readJson(EN_NAME)).language).toBe("en");
  }, 90_000);

  it("lists what it would do on --dry-run without calling the provider or writing", async () => {
    const empty = path.join(work, "empty");
    await mkdir(empty);
    await putSet(entry());
    const result = await generate(["--dry-run"], { LLM_FIXTURE_DIR: empty });
    expect(result.code).toBe(0);
    expect(result.stdout.match(/would generate/g)).toHaveLength(2);
    expect(await files()).toEqual([]);

    const viaEnvironment = await tsx(
      GENERATE,
      ["--set=set.json", "--dry-run", "--lang=en", `--only=${reference.slug}`],
      { LLM_PROVIDER: "fixture", LLM_FIXTURE_DIR: empty, REFERENCE_DIR: out },
    );
    expect(viaEnvironment.code).toBe(0);
    expect(viaEnvironment.stdout).toContain(path.join("out", EN_NAME));
    expect(viaEnvironment.stdout.match(/would generate/g)).toHaveLength(1);
  }, 90_000);

  it("reports a concept that fails, writes the others and exits with 1", async () => {
    await putSet(
      entry({}, "maths/derivative", {
        fr: "Une question sans aucun scénario",
        en: "A question without any scenario",
      }),
      entry(),
    );
    await putScenarios();
    const result = await generate(["--lang=fr", "--concurrency=1"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("[maths/derivative fr] FAILED, nothing written");
    expect(result.stderr).toContain("generation_unavailable");
    expect(result.stderr).toContain("Failed: maths/derivative fr.");
    expect(result.stdout).toContain("1 written");
    expect(await files()).toEqual([FR_NAME]);
    expect(await problems()).toEqual([]);
  }, 90_000);

  it("does not write a partial explanation unless --allow-partial is given", async () => {
    await putSet(entry());
    const broken: ScenarioStep[] = [
      {
        role: "author",
        when: sceneMarker(2),
        repeat: true,
        response: brokenScene(scenesOf(reference)[2]!),
      },
    ];
    await putScenarios(broken);

    const refused = await generate(["--lang=fr", "--attempts=1"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("partial explanation, scenes dropped: s3");
    expect(await files()).toEqual([]);

    const allowed = await generate(["--lang=fr", "--allow-partial"]);
    expect(allowed.code).toBe(0);
    expect(allowed.stdout).toContain("PARTIAL");
    expect(await files()).toEqual([FR_NAME]);
    const document = (await readJson(FR_NAME)).payload as { scenes: unknown[] };
    expect(document.scenes).toHaveLength(5);
    expect((await problems()).join("\n")).toContain("5 scenes for 6 steps");
  }, 90_000);

  it("tries again when only the duration is out of range, then keeps it with --allow-long", async () => {
    await putSet(entry());
    await putStretchedScenarios();

    const once = await generate(["--lang=fr", "--attempts=1"]);
    expect(once.code).toBe(1);
    expect(once.stdout).not.toContain("attempt 2");
    expect(once.stderr).toContain("the explanation lasts about");
    expect(await files()).toEqual([]);

    const twice = await generate(["--lang=fr", "--attempts=2"]);
    expect(twice.code).toBe(1);
    expect(twice.stdout).toContain("too long");
    expect(twice.stdout).toContain("attempt 2 of 2");
    expect(twice.stdout.match(/tokens:/g)).toHaveLength(2);
    expect(twice.stderr).toContain("the explanation lasts about");
    expect(await files()).toEqual([]);

    const kept = await generate(["--lang=fr", "--attempts=2", "--allow-long"]);
    expect(kept.code).toBe(0);
    expect(kept.stdout).toContain("LONG");
    expect(await files()).toEqual([FR_NAME]);
    expect((await problems()).join("\n")).toContain("the explanation lasts about");
  }, 120_000);

  it("rejects wrong options and a set that does not parse, with exit code 2", async () => {
    await putSet(entry());
    const language = await generate(["--lang=de"]);
    expect(language.code).toBe(2);
    expect(language.stderr).toContain("--lang must be one of fr, en");

    const concept = await generate(["--only=maths/unknown"]);
    expect(concept.code).toBe(2);
    expect(concept.stderr).toContain("no concept maths/unknown");

    await writeFile(path.join(work, "set.json"), JSON.stringify([entry({ level: "x" })]));
    const unknown = await generate([]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('unknown field "level"');
    expect(await files()).toEqual([]);
  }, 90_000);
});
