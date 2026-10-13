import { describe, expect, it } from "vitest";
import { describeCatalog, SceneSchema } from "../../src/schema";

const scene = (extra: Record<string, unknown> = {}) => ({
  id: "s1",
  index: 0,
  role: "mechanism",
  title: "Deux causes",
  layout: "figure",
  world: { x: [-5, 5], y: [-3, 3] },
  elements: [
    { id: "dette-royale", slot: "figure", type: "point", at: [0, 0], label: "Dette" },
    { id: "récoltes", slot: "figure", type: "point", at: ["{{a}}", "{{a|fixed:1}}^2"] },
    { id: "lien", slot: "figure", type: "vector", from: "dette-royale", to: "récoltes" },
  ],
  beats: [
    {
      id: "b1",
      narration: "Deux causes se renforcent.",
      actions: [
        { do: "show", targets: ["dette-royale", "récoltes"], at: 1.4 },
        { do: "highlight", targets: "lien.Flèche" },
      ],
    },
  ],
  ...extra,
});

describe("forgiving what a model gets wrong in form", () => {
  const parsed = SceneSchema.parse(scene());

  it("rewrites an id with accents or hyphens the same way wherever it is used", () => {
    expect(parsed.elements.map((element) => element.id)).toEqual([
      "dette_royale",
      "recoltes",
      "lien",
    ]);
    expect(parsed.elements[2]).toMatchObject({ from: "dette_royale", to: "recoltes" });
    expect(parsed.beats[0]!.actions[0]).toMatchObject({ targets: ["dette_royale", "recoltes"] });
  });

  it("accepts a single target as a string and normalises its part", () => {
    expect(parsed.beats[0]!.actions[1]).toMatchObject({ targets: ["lien.fl_che"] });
  });

  it("brings an action offset past the end of the beat back to its end", () => {
    expect(parsed.beats[0]!.actions[0]).toMatchObject({ at: 1 });
  });

  it("reads the names out of text placeholders written in an expression", () => {
    expect(parsed.elements[1]).toMatchObject({ at: [{ expr: "a" }, { expr: "a^2" }] });
  });

  it("still describes ids and targets to the author", () => {
    const catalog = describeCatalog({ types: ["point", "vector"] });
    expect(catalog).toContain("Id = ");
    expect(catalog).toContain("targets: Target[]");
  });
});
