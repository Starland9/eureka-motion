import { describe, expect, it } from "vitest";
import type { SceneElement } from "../../src/schema";
import { objectLabelSides } from "../../src/schema/object-labels";

const U = 16;
const object = (id: string, x: number, label?: string): SceneElement => ({
  id,
  slot: "figure",
  type: "object",
  kind: "block",
  at: [x, 0],
  size: 1,
  ...(label ? { label } : {}),
});

function sides(elements: SceneElement[], pxPerUnit = 140) {
  return objectLabelSides({
    lookup: new Map(elements.map((element) => [element.id, element])),
    scope: {},
    slot: "figure",
    toPx: ([x, y]) => [x * pxPerUnit, -y * pxPerUnit],
    length: (world) => world * pxPerUnit,
    u: U,
    labelSize: 4 * U,
  });
}

describe("where an object writes its label", () => {
  it("writes it below its pictogram by default", () => {
    expect([...sides([object("a", 0, "Lampe"), object("b", 5, "1 m")]).values()]).toEqual([1, 1]);
  });

  it("moves the earlier of two labels that would touch above its pictogram", () => {
    const found = sides([
      object("lamp", 0, "Lampe"),
      object("s1", 1, "1 m"),
      object("s2", 2.6, "2 m"),
      object("s3", 4.2, "3 m"),
    ]);
    expect(found.get("lamp")).toBe(-1);
    expect(found.get("s1")).toBe(1);
    expect(found.get("s2")).toBe(1);
    expect(found.get("s3")).toBe(1);
  });

  it("ignores objects without a label and objects of another slot", () => {
    const other = { ...object("far", 0.2, "Écran"), slot: "figure_b" } as SceneElement;
    const found = sides([object("a", 0, "Lampe"), object("bare", 0.3), other]);
    expect(found.get("a")).toBe(1);
    expect(found.has("bare")).toBe(false);
    expect(found.has("far")).toBe(false);
  });

  it("writes the label above when a vector leaves the object downwards", () => {
    const pull: SceneElement = {
      id: "pull",
      slot: "figure",
      type: "vector",
      from: "a",
      to: [0, -3],
    };
    expect(sides([object("a", 0, "Pomme"), pull]).get("a")).toBe(-1);
  });
});
