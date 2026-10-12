import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DocumentSchema,
  formatIssues,
  repairScene,
  validateOutline,
  validateScene,
  type Outline,
  type Scene,
} from "../../src/schema";

const REFERENCE = fileURLToPath(
  new URL("../../../../content/reference/physics.universal-gravitation.fr.json", import.meta.url),
);
const document = DocumentSchema.parse(JSON.parse(readFileSync(REFERENCE, "utf8")).payload);
const checked = validateOutline({
  plan: document.plan,
  params: document.params,
  model: document.model,
});
if (!checked.ok) throw new Error(formatIssues(checked.issues));
const outline: Outline = checked.value;
const scene = (id: string): Scene =>
  structuredClone(document.scenes.find((s) => s.id === id) as Scene);

describe("repairing a scene before validation", () => {
  it("leaves a valid scene untouched", () => {
    for (const original of document.scenes)
      expect(repairScene(original, outline)).toEqual(original);
  });

  it("shows an element the author forgot to show", () => {
    const broken = scene("s2");
    broken.beats[2]!.actions = [];
    expect(validateScene(broken, outline).ok).toBe(false);
    const repaired = repairScene(broken, outline);
    expect(repaired.beats[0]!.actions.at(-1)).toEqual({
      do: "show",
      targets: ["thrice"],
      how: "fade",
    });
    expect(validateScene(repaired, outline).ok).toBe(true);
  });

  it("widens the frame to hold an element at every parameter value", () => {
    const broken = scene("s1");
    const moon = broken.elements.find((element) => element.id === "moon");
    if (moon?.type !== "object") throw new Error("fixture changed");
    moon.at = [9, 0.5];
    expect(validateScene(broken, outline).ok).toBe(false);
    const repaired = repairScene(broken, outline);
    expect(repaired.world!.x[1]).toBeGreaterThan(9);
    expect(repaired.world!.x[0]).toBe(-5);
    expect(repaired.world!.y).toEqual([-3, 3]);
    const result = validateScene(repaired, outline);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("gives a frame to a scene that positions elements without declaring one", () => {
    const broken = scene("s1");
    delete broken.world;
    const repaired = repairScene(broken, outline);
    expect(repaired.world).toBeDefined();
    const result = validateScene(repaired, outline);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("does not touch a scene without positioned elements", () => {
    expect(repairScene(scene("s3"), outline).world).toBeUndefined();
  });
});
