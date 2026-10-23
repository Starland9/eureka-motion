import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { checkReferences, referenceId, type CheckedReference } from "../../src/server/reference";

const run = promisify(execFile);
const WEB = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../../../../scripts/reference-build.ts", import.meta.url));
const NAME = "physics.universal-gravitation.fr.json";
const ID = referenceId(reference.slug, "fr");

type Reference = typeof reference;
type Beat = Reference["payload"]["scenes"][number]["beats"][number];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reference-build-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function copy(change: (draft: Reference) => void = () => undefined): Reference {
  const draft = structuredClone(reference);
  change(draft);
  return draft;
}

async function put(name: string, content: unknown): Promise<void> {
  await writeFile(path.join(dir, name), JSON.stringify(content));
}

function onlyResult(results: CheckedReference[]): CheckedReference {
  expect(results).toHaveLength(1);
  return results[0]!;
}

function pointAtGhost(draft: Reference): void {
  Object.assign(draft.payload.scenes[0]!.beats[0]!.actions[0]!, { targets: ["ghost_element"] });
}

function voice(draft: Reference, skip: (beat: Beat) => boolean = () => false): void {
  for (const scene of draft.payload.scenes) {
    for (const beat of scene.beats as (Beat & { audio?: unknown })[]) {
      if (skip(beat)) continue;
      beat.audio = { url: `/media/${ID}/${scene.id}-${beat.id}.mp3`, duration_ms: 3500 };
    }
  }
}

async function writeAudio(draft: Reference, missing?: string): Promise<void> {
  await mkdir(path.join(dir, "audio", ID), { recursive: true });
  for (const scene of draft.payload.scenes) {
    for (const beat of scene.beats) {
      const name = `${scene.id}-${beat.id}.mp3`;
      if (name !== missing) await writeFile(path.join(dir, "audio", ID, name), "mp3");
    }
  }
}

describe("checkReferences", () => {
  it("accepts the hand-written reference document", async () => {
    await put(NAME, reference);
    const result = onlyResult(await checkReferences(dir));
    expect(result.problems).toEqual([]);
    expect(result.entry).toMatchObject({ slug: reference.slug, explanation_id: ID });
    expect(result.voiced).toBe(0);
    expect(result.beats).toBe(19);
  });

  it("rejects a document that breaks one of the six rules", async () => {
    await put(
      NAME,
      copy((draft) => {
        pointAtGhost(draft);
      }),
    );
    const { problems } = onlyResult(await checkReferences(dir));
    expect(problems.join("\n")).toMatch(/Rule 2 \(references\) failed/);
    expect(problems.join("\n")).toContain("ghost_element");
  });

  it("rejects a file that is not valid JSON", async () => {
    await writeFile(path.join(dir, NAME), "{ not json");
    expect(onlyResult(await checkReferences(dir)).problems).toHaveLength(1);
  });

  it("rejects a subject outside the six, an unknown level and an unknown field", async () => {
    await put(
      NAME,
      copy((draft) => {
        Object.assign(draft, { subject: "other", reference_level: "cm2", note: "x" });
      }),
    );
    const text = onlyResult(await checkReferences(dir)).problems.join("\n");
    expect(text).toContain("subject:");
    expect(text).toContain("reference_level:");
    expect(text).toContain('Unrecognized key: "note"');
  });

  it("rejects a file whose name does not match its slug and language", async () => {
    await put("physics.universal-gravitation.en.json", reference);
    const text = onlyResult(await checkReferences(dir)).problems.join("\n");
    expect(text).toContain("file name must be physics.universal-gravitation.fr.json");
  });

  it("requires the review trace to be complete or absent", async () => {
    await put(
      NAME,
      copy((draft) => {
        Object.assign(draft, { reviewed_by: "Ines", reviewed_at: null });
      }),
    );
    expect(onlyResult(await checkReferences(dir)).problems.join("\n")).toContain("reviewed_by");
    await put(
      NAME,
      copy((draft) => {
        Object.assign(draft, { reviewed_by: "Ines", reviewed_at: "2026-10-23" });
      }),
    );
    expect(onlyResult(await checkReferences(dir)).problems).toEqual([]);
  });

  it("rejects two languages of one concept that disagree on subject or level", async () => {
    await put(NAME, reference);
    await put(
      "physics.universal-gravitation.en.json",
      copy((draft) => {
        Object.assign(draft, { language: "en", subject: "maths", reference_level: "college" });
      }),
    );
    const results = await checkReferences(dir);
    const text = results.flatMap((result) => result.problems).join("\n");
    expect(text).toMatch(/subject is \w+ but the \w+ file of physics\/universal-gravitation says/);
    expect(text).toMatch(
      /reference_level is \w+ but the \w+ file of physics\/universal-gravitation/,
    );
    expect(results.filter((result) => result.problems.length > 0)).toHaveLength(1);
  });

  describe("audio", () => {
    it("accepts a document whose every beat has its file", async () => {
      const voiced = copy((draft) => voice(draft));
      await put(NAME, voiced);
      await writeAudio(voiced);
      const result = onlyResult(await checkReferences(dir));
      expect(result.problems).toEqual([]);
      expect(result.voiced).toBe(result.beats);
    });

    it("rejects a beat whose file is missing", async () => {
      const voiced = copy((draft) => voice(draft));
      await put(NAME, voiced);
      await writeAudio(voiced, "s2-b1.mp3");
      const { problems } = onlyResult(await checkReferences(dir));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("s2.b1");
      expect(problems[0]).toContain("missing or empty");
    });

    it("rejects an audio address that does not match the explanation", async () => {
      const voiced = copy((draft) => voice(draft));
      (voiced.payload.scenes[0]!.beats[0] as Beat & { audio?: { url: string } }).audio!.url =
        "/media/aaaaaaaaaaaa/s1-b1.mp3";
      await put(NAME, voiced);
      await writeAudio(voiced);
      const { problems } = onlyResult(await checkReferences(dir));
      expect(problems.join("\n")).toContain(`audio url must be /media/${ID}/s1-b1.mp3`);
    });

    it("rejects a document where only some beats have audio", async () => {
      const voiced = copy((draft) => voice(draft, (beat) => beat.id === "b2"));
      await put(NAME, voiced);
      await writeAudio(voiced);
      const text = onlyResult(await checkReferences(dir)).problems.join("\n");
      expect(text).toMatch(/audio on \d+ of 19 beats: every beat or none/);
    });
  });
});

describe("reference-build script", () => {
  function build(...args: string[]) {
    return run(
      process.execPath,
      [
        path.join(WEB, "node_modules/tsx/dist/cli.mjs"),
        "--tsconfig",
        path.join(WEB, "scripts/tsconfig.json"),
        SCRIPT,
        ...args,
      ],
      { cwd: WEB, env: { ...process.env, INIT_CWD: dir } },
    ).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => ({
        code: error.code,
        stdout: error.stdout,
        stderr: error.stderr,
      }),
    );
  }

  it("exits 0 and writes the index when every file is valid", async () => {
    await put(NAME, reference);
    const result = await build("--dir=.", "--out=built/index.json");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 reference files valid");
    const index = JSON.parse(await readFile(path.join(dir, "built/index.json"), "utf8"));
    expect(index).toEqual({
      references: [
        {
          slug: reference.slug,
          subject: reference.subject,
          title: reference.title,
          reference_level: reference.reference_level,
          language: "fr",
          explanation_id: ID,
        },
      ],
    });
  }, 30_000);

  it("exits 1, names the file and the rule, and writes no index when a file is not valid", async () => {
    await put(NAME, reference);
    await put(
      "physics.broken.fr.json",
      copy((draft) => {
        draft.slug = "physics/broken";
        pointAtGhost(draft);
      }),
    );
    const result = await build("--dir=.", "--out=built/index.json");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("physics.broken.fr.json");
    expect(result.stderr).toContain("Rule 2 (references) failed");
    expect(result.stderr).toContain("1 of 2 reference files rejected");
    expect(await stat(path.join(dir, "built/index.json")).catch(() => null)).toBeNull();
  }, 30_000);

  it("exits 1 when the folder holds no reference file", async () => {
    const result = await build("--dir=.");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No reference file");
  }, 30_000);
});
