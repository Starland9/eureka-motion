import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DocumentSchema,
  formatIssues,
  repairOutline,
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

  it("draws an arrow given only a target all the way to it", () => {
    const broken = scene("s1");
    const pull = broken.elements.find((element) => element.id === "moon_pull");
    if (pull?.type !== "vector") throw new Error("fixture changed");
    delete pull.length;
    expect(validateScene(broken, outline).ok).toBe(false);
    const repaired = repairScene(broken, outline);
    expect(repaired.elements.find((element) => element.id === "moon_pull")).toMatchObject({
      to: "earth",
    });
    expect(repaired.elements.find((element) => element.id === "moon_pull")).not.toHaveProperty(
      "toward",
    );
    const result = validateScene(repaired, outline);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("falls back to the element when a target names a part it does not have", () => {
    const broken = scene("s1");
    broken.beats[2]!.actions = [
      { do: "highlight", targets: ["apple_pull.label", "moon_pull.tip", "moon_pull"] },
    ];
    expect(validateScene(broken, outline).ok).toBe(false);
    const repaired = repairScene(broken, outline);
    expect(repaired.beats[2]!.actions).toEqual([
      { do: "highlight", targets: ["apple_pull", "moon_pull"] },
    ]);
    const result = validateScene(repaired, outline);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("keeps a target that names a real part", () => {
    const recap = scene("s6");
    expect(repairScene(recap, outline).beats[2]!.actions).toEqual([
      { do: "highlight", targets: ["recap.i3"] },
    ]);
  });

  it("drops the later of two labels that would sit on the same spot", () => {
    const broken = scene("s1");
    broken.elements.push({
      id: "twin",
      slot: "figure_b",
      type: "object",
      kind: "moon",
      at: [3, 0.5],
      size: 0.8,
      label: "Satellite",
    });
    broken.beats[1]!.actions.push({ do: "show", targets: ["twin"], how: "fade" });
    const before = validateScene(broken, outline);
    expect(before.ok ? "" : formatIssues(before.issues)).toContain("overlap");
    const repaired = repairScene(broken, outline);
    expect(repaired.elements.find((element) => element.id === "twin")).not.toHaveProperty("label");
    expect(repaired.elements.find((element) => element.id === "moon")).toMatchObject({
      label: "Lune",
    });
    const result = validateScene(repaired, outline);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("moves an element out of a slot that cannot hold it", () => {
    const broken = scene("s5");
    const note = broken.elements.find((element) => element.type === "text");
    if (!note) throw new Error("fixture changed");
    const home = note.slot;
    (note as { slot: string }).slot = "figure";
    expect(validateScene(broken, outline).ok).toBe(false);
    const repaired = repairScene(broken, outline);
    expect(repaired.elements.find((element) => element.id === note.id)?.slot).toBe(home);
    const result = validateScene(repaired, outline);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("sends the least used colour back to ink past three colour codes", () => {
    const broken = scene("s1");
    const roleOf = (id: string) =>
      broken.elements.find((element) => element.id === id) as { role?: string };
    roleOf("apple").role = "quantity";
    roleOf("earth").role = "quantity";
    roleOf("moon").role = "valid";
    roleOf("ground").role = "result";
    expect(validateScene(broken, outline).ok).toBe(false);
    const repaired = repairScene(broken, outline);
    const roles = new Set(
      repaired.elements.flatMap((element) =>
        "role" in element && element.role ? [element.role] : [],
      ),
    );
    expect(roles.size).toBe(3);
    expect(roles.has("action")).toBe(true);
    const result = validateScene(repaired, outline);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("stops a sweep at the end of the range of its parameter", () => {
    const withSweep = document.scenes.find((candidate) =>
      candidate.beats.some((beat) => beat.actions.some((action) => action.do === "sweep")),
    );
    if (!withSweep) throw new Error("fixture changed");
    const broken = structuredClone(withSweep);
    let param = "";
    for (const beat of broken.beats) {
      for (const action of beat.actions) {
        if (action.do === "sweep") {
          action.to = 1e40;
          param = action.param;
        }
      }
    }
    expect(validateScene(broken, outline).ok).toBe(false);
    const repaired = repairScene(broken, outline);
    const max = outline.params.find((candidate) => candidate.id === param)!.max;
    const sweeps = repaired.beats.flatMap((beat) =>
      beat.actions.filter((action) => action.do === "sweep"),
    );
    expect(sweeps.every((action) => action.to === max)).toBe(true);
    const result = validateScene(repaired, outline);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });

  it("does not touch a scene without positioned elements", () => {
    expect(repairScene(scene("s3"), outline).world).toBeUndefined();
  });
});

describe("repairing an outline before validation", () => {
  it("leaves a valid outline untouched", () => {
    expect(repairOutline(outline)).toBe(outline);
  });

  it("widens a step too fine for a slider and brings the default back in range", () => {
    const first = outline.params[0]!;
    const broken = {
      ...outline,
      params: [
        { ...first, step: (first.max - first.min) / 1e6, default: first.max * 2 },
        ...outline.params.slice(1),
      ],
    };
    expect(validateOutline(broken).ok).toBe(false);
    const repaired = repairOutline(broken);
    expect(repaired.params[0]!.default).toBe(first.max);
    expect((first.max - first.min) / repaired.params[0]!.step).toBeLessThanOrEqual(400);
    const result = validateOutline(repaired);
    expect(result.ok, result.ok ? "" : formatIssues(result.issues)).toBe(true);
  });
});
