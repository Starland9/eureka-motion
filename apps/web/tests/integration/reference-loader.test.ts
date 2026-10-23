import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DocumentSchema } from "scene";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";
import { EXPLANATION_ID_PATTERN } from "../../src/server/container";
import {
  getReferenceDir,
  listReferences,
  loadReference,
  referenceAudioDir,
  referenceId,
  resolveReferenceAudio,
} from "../../src/server/reference";

let dir: string;

function variant(overrides: Record<string, unknown>) {
  return { ...structuredClone(reference), ...overrides };
}

async function put(name: string, content: unknown): Promise<void> {
  await writeFile(path.join(dir, name), JSON.stringify(content));
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "reference-loader-"));
  await put("physics.universal-gravitation.fr.json", reference);
  await put(
    "physics.universal-gravitation.en.json",
    variant({ language: "en", title: "Universal gravitation" }),
  );
  await put(
    "maths.pythagoras.fr.json",
    variant({ slug: "maths/pythagoras", subject: "maths", title: "Le théorème de Pythagore" }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listReferences", () => {
  it("lists one language, by subject then slug", async () => {
    const french = await listReferences("fr", dir);
    expect(french.map((entry) => entry.slug)).toEqual([
      "maths/pythagoras",
      "physics/universal-gravitation",
    ]);
    expect(french[1]).toEqual({
      slug: "physics/universal-gravitation",
      subject: "physics",
      title: "La gravitation universelle",
      reference_level: "lycee",
      language: "fr",
      explanation_id: referenceId("physics/universal-gravitation", "fr"),
    });
    const english = await listReferences("en", dir);
    expect(english.map((entry) => entry.title)).toEqual(["Universal gravitation"]);
  });

  it("gives every file a stable id of the same shape as a generated explanation", () => {
    const fr = referenceId("physics/universal-gravitation", "fr");
    expect(fr).toMatch(EXPLANATION_ID_PATTERN);
    expect(referenceId("physics/universal-gravitation", "fr")).toBe(fr);
    expect(referenceId("physics/universal-gravitation", "en")).not.toBe(fr);
    expect(referenceId("maths/pythagoras", "fr")).not.toBe(fr);
  });

  it("reads index.json when it exists and the files when it does not", async () => {
    const indexed = await mkdtemp(path.join(tmpdir(), "reference-index-"));
    try {
      await writeFile(
        path.join(indexed, "index.json"),
        JSON.stringify({
          references: [
            {
              slug: "cs/bubble-sort",
              subject: "cs",
              title: "Le tri à bulles",
              reference_level: "lycee",
              language: "fr",
              explanation_id: referenceId("cs/bubble-sort", "fr"),
            },
          ],
        }),
      );
      expect((await listReferences("fr", indexed)).map((entry) => entry.slug)).toEqual([
        "cs/bubble-sort",
      ]);
    } finally {
      await rm(indexed, { recursive: true, force: true });
    }
  });

  it("ignores a file that does not parse and still lists the others", async () => {
    const mixed = await mkdtemp(path.join(tmpdir(), "reference-mixed-"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await writeFile(path.join(mixed, "physics.universal-gravitation.fr.json"), "{ broken");
      await writeFile(
        path.join(mixed, "maths.pythagoras.fr.json"),
        JSON.stringify(variant({ slug: "maths/pythagoras", subject: "maths" })),
      );
      await writeFile(
        path.join(mixed, "maths.wrong-name.fr.json"),
        JSON.stringify(variant({ slug: "maths/pythagoras", subject: "maths" })),
      );
      expect((await listReferences("fr", mixed)).map((entry) => entry.slug)).toEqual([
        "maths/pythagoras",
      ]);
      expect(logged).toHaveBeenCalledTimes(2);
    } finally {
      await rm(mixed, { recursive: true, force: true });
    }
  });

  it("fails loudly when the directory does not exist", async () => {
    await expect(listReferences("fr", path.join(dir, "missing"))).rejects.toThrow(/ENOENT/);
  });
});

describe("loadReference", () => {
  it("returns the typeset document, ready to play", async () => {
    const id = referenceId("physics/universal-gravitation", "fr");
    const loaded = await loadReference(id, dir);
    expect(loaded).not.toBeNull();
    expect(loaded?.question).toBe(reference.question);
    expect(loaded?.reviewed_by).toBeNull();
    expect(loaded?.verdicts).toEqual([]);
    expect(DocumentSchema.safeParse(loaded?.payload).success).toBe(true);
    expect(loaded?.payload.scenes[0]?.beats[0]?.narration).toBe(
      "Lâche une pomme. La Terre l’attire…",
    );
    expect(loaded?.payload.scenes).toHaveLength(reference.payload.scenes.length);
  });

  it("returns null for an id that is not a reference", async () => {
    expect(await loadReference("kkkkkkkkkkkk", dir)).toBeNull();
  });
});

describe("resolveReferenceAudio", () => {
  const id = referenceId("physics/universal-gravitation", "fr");

  it("resolves the mp3 files of an explanation inside the audio folder", () => {
    expect(resolveReferenceAudio([id, "s1-b1.mp3"], dir)).toBe(
      path.join(referenceAudioDir(dir), id, "s1-b1.mp3"),
    );
  });

  it("refuses traversal, hidden files and other file types", () => {
    expect(resolveReferenceAudio([id, "..", "..", "x.mp3"], dir)).toBeNull();
    expect(resolveReferenceAudio([id, ".hidden.mp3"], dir)).toBeNull();
    expect(resolveReferenceAudio([id, "export.mp4"], dir)).toBeNull();
    expect(resolveReferenceAudio([id, "s1-b1.json"], dir)).toBeNull();
    expect(resolveReferenceAudio([], dir)).toBeNull();
  });
});

describe("getReferenceDir", () => {
  it("honours REFERENCE_DIR and otherwise points at content/reference of the repository", async () => {
    expect(getReferenceDir({ REFERENCE_DIR: "/srv/reference" })).toBe("/srv/reference");
    const fallback = getReferenceDir({});
    expect(fallback.endsWith(path.join("content", "reference"))).toBe(true);
    expect(await listReferences("fr", fallback)).toContainEqual(
      expect.objectContaining({ slug: "physics/universal-gravitation" }),
    );
  });
});
