// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  areasOf,
  rightTriangleLayout,
  SIDES,
  type Box,
  type LabelBoxes,
  type RightTriangleGeometry,
  type Side,
} from "../../src/primitives/sim/right-triangle-layout";
import type { ElementOf, Param, Scene } from "../../src/schema/document";
import type { ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext } from "../helpers/scene";

type Point = readonly [number, number];

const param = (id: string, default_: number): Param => ({
  id,
  symbol: id,
  label: id,
  unit: "cm",
  min: 1,
  max: 20,
  step: 0.1,
  default: default_,
  role: "quantity",
});
const PARAMS: Param[] = [param("a", 3), param("b", 4)];

type Triangle = ElementOf<"sim.right-triangle">;
const TRIANGLE: Triangle = {
  id: "tri",
  slot: "figure",
  type: "sim.right-triangle",
  a: { expr: "a" },
  b: { expr: "b" },
};

const showing = (targets: string[], how: "fade" | "draw" | "type" = "fade"): Scene["beats"] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [{ do: "show", targets, how, at: 0 }],
  },
];

interface Setup {
  element?: Triangle;
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
  language?: "fr" | "en";
}

function setup({ element = TRIANGLE, ...rest }: Setup = {}) {
  const scene = sceneOf([element], { beats: rest.beats });
  const ctx = testContext({
    scene,
    params: PARAMS,
    values: rest.values,
    theme: rest.theme,
    frame: rest.frame,
    language: rest.language,
  });
  return { ctx, ...renderElement(element, ctx) };
}

const num = (element: Element | null | undefined, name: string): number => {
  if (!element) throw new Error(`missing element for ${name}`);
  return Number(element.getAttribute(name));
};
const part = (container: Element, name: string): Element | null =>
  container.querySelector(`[data-part="${name}"]`);
const pointsOf = (polygon: Element | null | undefined): Point[] =>
  (polygon?.getAttribute("points") ?? "")
    .split(" ")
    .map((pair) => pair.split(",").map(Number) as unknown as Point);
const shoelace = (points: readonly Point[]): number =>
  Math.abs(
    points.reduce((sum, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length]!;
      return sum + x * ny - nx * y;
    }, 0),
  ) / 2;
const areaShown = (container: Element, name: string): number => {
  const texts = [...part(container, name)!.querySelectorAll("text")];
  const value = texts.at(-1)!.textContent!;
  return Number(value.replace(/\s/g, "").replace(",", "."));
};

const SIDE_SETS: [number, number][] = [
  [3, 4],
  [5, 12],
  [1.5, 2],
];
const SLOTS = [
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
  { width: 1792, height: 648 },
];
const U = 16;
const STACKED: Box = { width: 6 * U, height: 7.6 * U };
const VALUE: Box = { width: 4 * U, height: 3.2 * U };
const ROW: Box = { width: 9 * U, height: 3.2 * U };
const BOXES: LabelBoxes = { stacked: STACKED, value: VALUE, row: ROW };
const LABELS: Record<Side, LabelBoxes> = { a: BOXES, b: BOXES, c: BOXES };

const layoutOf = (a: number, b: number, slot = SLOTS[0]!, squares = true, ref = [3, 4]) =>
  rightTriangleLayout(slot, U, {
    a,
    b,
    refA: ref[0]!,
    refB: ref[1]!,
    squares,
    labels: LABELS,
  });

const boxOf = (g: RightTriangleGeometry, side: Side): Point[] => {
  const { x, y, form } = g.labels[side];
  const { width, height } = LABELS[side][form];
  return [
    [x - width / 2, y - height / 2],
    [x + width / 2, y - height / 2],
    [x + width / 2, y + height / 2],
    [x - width / 2, y + height / 2],
  ];
};

function overlap(first: readonly Point[], second: readonly Point[]): boolean {
  for (const polygon of [first, second]) {
    for (let i = 0; i < polygon.length; i += 1) {
      const [x1, y1] = polygon[i]!;
      const [x2, y2] = polygon[(i + 1) % polygon.length]!;
      const axis: Point = [y1 - y2, x2 - x1];
      const project = (points: readonly Point[]) =>
        points.map((p) => p[0] * axis[0] + p[1] * axis[1]);
      const [one, two] = [project(first), project(second)];
      const gap = 1e-6 * Math.hypot(axis[0], axis[1]);
      if (
        Math.max(...one) <= Math.min(...two) + gap ||
        Math.max(...two) <= Math.min(...one) + gap
      ) {
        return false;
      }
    }
  }
  return true;
}

function inside(g: RightTriangleGeometry, slot: Box) {
  const points: Point[] = [g.corner, g.apex, g.foot];
  if (g.squares) for (const side of SIDES) points.push(...g.squares[side].corners);
  for (const side of SIDES) points.push(...boxOf(g, side));
  for (const [x, y] of points) {
    expect(x).toBeGreaterThanOrEqual(-1e-6);
    expect(x).toBeLessThanOrEqual(slot.width + 1e-6);
    expect(y).toBeGreaterThanOrEqual(-1e-6);
    expect(y).toBeLessThanOrEqual(slot.height + 1e-6);
  }
}

describe("right-triangle layout", () => {
  it.each(SIDE_SETS)("builds squares whose areas add up: a=%s, b=%s", (a, b) => {
    const g = layoutOf(a, b);
    const px = (side: Side) => shoelace(g.squares![side].corners) / g.scale ** 2;
    expect(g.lengths.c).toBeCloseTo(Math.hypot(a, b), 12);
    expect(px("a")).toBeCloseTo(a * a, 6);
    expect(px("b")).toBeCloseTo(b * b, 6);
    expect(px("c")).toBeCloseTo(a * a + b * b, 6);
    expect(px("a") + px("b")).toBeCloseTo(px("c"), 6);
    const areas = areasOf(a, b);
    expect(areas.a + areas.b).toBeCloseTo(areas.c, 12);
  });

  it("builds each square on its own side, outside the triangle, with right angles", () => {
    const g = layoutOf(3, 4);
    const ends: Record<Side, [Point, Point]> = {
      a: [g.corner, g.apex],
      b: [g.foot, g.corner],
      c: [g.apex, g.foot],
    };
    const third: Record<Side, Point> = { a: g.foot, b: g.apex, c: g.corner };
    for (const side of SIDES) {
      const [p0, p1, p2, p3] = g.squares![side].corners;
      expect(p0).toEqual(ends[side][0]);
      expect(p1).toEqual(ends[side][1]);
      const edge = [p1[0] - p0[0], p1[1] - p0[1]];
      const step = [p3[0] - p0[0], p3[1] - p0[1]];
      expect(edge[0]! * step[0]! + edge[1]! * step[1]!).toBeCloseTo(0, 6);
      expect(Math.hypot(...(edge as [number, number]))).toBeCloseTo(
        Math.hypot(...(step as [number, number])),
        9,
      );
      expect(p2[0] - p1[0]).toBeCloseTo(step[0]!, 9);
      expect(p2[1] - p1[1]).toBeCloseTo(step[1]!, 9);
      const sideOf = (p: Point) =>
        (p1[0] - p0[0]) * (p[1] - p0[1]) - (p1[1] - p0[1]) * (p[0] - p0[0]);
      expect(Math.sign(sideOf(p3))).toBe(-Math.sign(sideOf(third[side])));
    }
  });

  it("draws a right angle at the corner, the legs along the axes", () => {
    const g = layoutOf(3, 4);
    expect(g.apex[0]).toBeCloseTo(g.corner[0], 9);
    expect(g.foot[1]).toBeCloseTo(g.corner[1], 9);
    expect(g.corner[1] - g.apex[1]).toBeCloseTo(3 * g.scale, 9);
    expect(g.foot[0] - g.corner[0]).toBeCloseTo(4 * g.scale, 9);
    expect(g.markSize).toBeGreaterThan(0);
    expect(g.markSize).toBeLessThanOrEqual(0.3 * 3 * g.scale + 1e-9);
  });

  it("keeps the figure inside the slot for very unequal sides", () => {
    const values = [0.05, 0.3, 1, 3, 4, 12, 20, 100];
    for (const slot of SLOTS) {
      for (const squares of [true, false]) {
        for (const a of values) {
          for (const b of values) {
            inside(layoutOf(a, b, slot, squares), slot);
          }
        }
      }
    }
  });

  it("never lets a label run into another label or into a square it does not describe", () => {
    const values = [1, 1.5, 2.5, 3, 4, 7, 12, 20];
    for (const slot of SLOTS) {
      for (const a of values) {
        for (const b of values) {
          const g = layoutOf(a, b, slot);
          for (const side of SIDES) {
            for (const other of SIDES) {
              if (other === side) continue;
              expect(overlap(boxOf(g, side), g.squares![other].corners), `${side}/${other}`).toBe(
                false,
              );
              if (side < other) {
                expect(overlap(boxOf(g, side), boxOf(g, other)), `${side}/${other}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it("keeps the labels of the triangle alone away from the sides", () => {
    for (const [a, b] of [...SIDE_SETS, [1, 20] as [number, number], [20, 1] as [number, number]]) {
      const g = layoutOf(a, b, SLOTS[0]!, false);
      const triangle: Point[] = [g.corner, g.apex, g.foot];
      for (const side of SIDES) expect(overlap(boxOf(g, side), triangle)).toBe(false);
      expect(g.squares).toBeNull();
    }
  });

  it("puts a label inside its square when it fits, in a row beside it when it does not", () => {
    const roomy = layoutOf(3, 4);
    for (const side of SIDES) expect(roomy.labels[side].form).toBe("stacked");
    const thin = layoutOf(1, 20);
    expect(thin.labels.a.form).toBe("row");
    expect(thin.labels.b.form).toBe("stacked");
    expect(thin.labels.c.form).toBe("stacked");
    const tiny = thin.squares!.a;
    expect(boxOf(thin, "a").every(([x]) => x < Math.min(...tiny.corners.map((p) => p[0])))).toBe(
      true,
    );
  });

  it("falls back to the value alone before sending a label outside", () => {
    const narrow = rightTriangleLayout({ width: 1088, height: 648 }, U, {
      a: 3,
      b: 4,
      refA: 3,
      refB: 4,
      squares: true,
      labels: {
        a: { ...BOXES, stacked: { width: 12 * U, height: 7.6 * U } },
        b: BOXES,
        c: BOXES,
      },
    });
    expect(narrow.labels.a.form).toBe("value");
    expect(narrow.labels.b.form).toBe("stacked");
  });

  it("keeps the scale of the default sides, shrinks the drawing only when it would overflow", () => {
    const slot = SLOTS[0]!;
    const reference = layoutOf(3, 4, slot);
    expect(reference.scale).toBeGreaterThan(0);
    const smaller = layoutOf(1.5, 2, slot);
    expect(smaller.scale).toBeCloseTo(reference.scale, 9);
    expect(smaller.lengths.c / reference.lengths.c).toBeCloseTo(0.5, 9);
    const larger = layoutOf(12, 16, slot);
    expect(larger.scale).toBeLessThan(reference.scale);
    const grown = layoutOf(3, 8, slot);
    expect(grown.scale).toBeLessThanOrEqual(reference.scale + 1e-9);
  });

  it("treats a missing or invalid reference as the current sides", () => {
    const fitted = layoutOf(5, 12, SLOTS[0]!, true, [0, Number.NaN]);
    const same = layoutOf(5, 12, SLOTS[0]!, true, [5, 12]);
    expect(fitted.scale).toBeCloseTo(same.scale, 9);
  });

  it("stays finite for zero, negative and non-numeric sides", () => {
    const bad = [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1e-12];
    for (const a of bad) {
      for (const b of [...bad, 4]) {
        const g = layoutOf(a, b);
        for (const [x, y] of [g.corner, g.apex, g.foot, ...g.squares!.c.corners]) {
          expect(Number.isFinite(x)).toBe(true);
          expect(Number.isFinite(y)).toBe(true);
        }
        expect(Number.isFinite(g.scale)).toBe(true);
      }
    }
  });
});

describe("RightTriangleSim", () => {
  it.each(SIDE_SETS)("shows areas whose two small ones add up to the large one: %s, %s", (a, b) => {
    const { container } = setup({ values: { a, b } });
    const shown = {
      a: areaShown(container, "square_a"),
      b: areaShown(container, "square_b"),
      c: areaShown(container, "square_c"),
    };
    expect(shown.a).toBeCloseTo(a * a, 9);
    expect(shown.b).toBeCloseTo(b * b, 9);
    expect(shown.a + shown.b).toBeCloseTo(shown.c, 9);

    const drawn = (name: string) =>
      shoelace(pointsOf(part(container, name)!.querySelector("polygon")));
    expect(drawn("square_a") + drawn("square_b")).toBeCloseTo(drawn("square_c"), 6);
    expect(drawn("square_a") / drawn("square_b")).toBeCloseTo((a / b) ** 2, 9);
  });

  it("writes whole areas without decimals and others with at most two", () => {
    const whole = setup({ values: { a: 5, b: 12 } });
    expect(whole.container.textContent).toContain("25");
    expect(whole.container.textContent).toContain("144");
    expect(whole.container.textContent).toContain("169");
    const decimal = setup({ values: { a: 1.5, b: 2 } });
    expect(areaShown(decimal.container, "square_a")).toBeCloseTo(2.25, 9);
    const texts = [...decimal.container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("2,25");
    expect(texts).toContain("4");
    expect(texts).toContain("6,25");
    const english = setup({ values: { a: 1.5, b: 2 }, language: "en" });
    const englishTexts = [...english.container.querySelectorAll("text")].map((t) => t.textContent);
    expect(englishTexts).toContain("2.25");
    expect(englishTexts).toContain("6.25");
    const tenth = setup({ values: { a: 2.5, b: 4.3 } });
    const tenthTexts = [...tenth.container.querySelectorAll("text")].map((t) => t.textContent);
    expect(tenthTexts).toEqual(expect.arrayContaining(["6,25", "18,49", "24,74"]));
  });

  it("draws every part at the end of the entrance", () => {
    const { container } = setup();
    for (const name of [
      "triangle",
      "side_a",
      "side_b",
      "side_c",
      "square_a",
      "square_b",
      "square_c",
      "right_angle",
    ]) {
      expect(part(container, name), name).not.toBeNull();
    }
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("does not render a part that the state hides, and keeps the others", () => {
    const { container } = setup({ beats: showing(["tri.triangle", "tri.square_a", "tri.side_a"]) });
    expect(part(container, "square_b")).toBeNull();
    expect(part(container, "square_c")).toBeNull();
    expect(part(container, "right_angle")).toBeNull();
    for (const name of ["triangle", "square_a", "side_a"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect(container.querySelectorAll("text").length).toBeGreaterThan(0);
  });

  it("removes a part once it has been hidden", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["tri"], how: "fade", at: 0 },
          { do: "hide", targets: ["tri.square_c"], at: 0.1 },
        ],
      },
    ];
    const { container } = setup({ beats });
    expect(part(container, "square_c")).toBeNull();
    expect(part(container, "square_a")).not.toBeNull();
  });

  it("draws the squares on the sides of the triangle that it shows", () => {
    const { container, ctx } = setup();
    const corners = (name: string) => pointsOf(part(container, name)!.querySelector("polygon"));
    const triangle = pointsOf(part(container, "triangle")!.querySelector("polygon"));
    const [corner, apex, foot] = triangle as [Point, Point, Point];
    expect(corners("square_a").slice(0, 2)).toEqual([corner, apex]);
    expect(corners("square_b").slice(0, 2)).toEqual([foot, corner]);
    expect(corners("square_c").slice(0, 2)).toEqual([apex, foot]);
    const leg = (name: string) => {
      const line = part(container, name)!.querySelector("line")!;
      return Math.hypot(num(line, "x2") - num(line, "x1"), num(line, "y2") - num(line, "y1"));
    };
    expect(leg("side_c") ** 2).toBeCloseTo(
      (corner[1] - apex[1]) ** 2 + (foot[0] - corner[0]) ** 2,
      3,
    );
    expect(leg("side_a")).toBeCloseTo(corner[1] - apex[1] + 0.25 * ctx.u, 6);
  });

  it("gives the squares and labels the names the element sets, 'a', 'b', 'c' otherwise", () => {
    const plain = setup();
    const symbols = (view: ReturnType<typeof setup>) =>
      [...view.container.querySelectorAll("text[font-style=italic]")].map((t) => t.textContent);
    expect(symbols(plain)).toEqual(["a²", "b²", "c²"]);
    const named = setup({ element: { ...TRIANGLE, labelA: "AB", labelB: "BC", labelC: "AC" } });
    expect(symbols(named)).toEqual(["AB²", "BC²", "AC²"]);
  });

  it("names the sides instead of showing areas when the squares are off", () => {
    const { container } = setup({
      element: { ...TRIANGLE, showSquares: false, labelA: "AB", labelB: "BC", labelC: "AC" },
    });
    for (const name of ["square_a", "square_b", "square_c"])
      expect(part(container, name)).toBeNull();
    for (const name of ["triangle", "side_a", "side_b", "side_c", "right_angle"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toEqual(["AB", "BC", "AC"]);
    expect(container.querySelector("pattern")).toBeNull();
  });

  it("scales the whole figure as the sides change", () => {
    const base = setup();
    const half = setup({ values: { a: 1.5, b: 2 } });
    const side = (view: ReturnType<typeof setup>, name: string) => {
      const [first, second] = pointsOf(part(view.container, name)!.querySelector("polygon"));
      return Math.hypot(second![0] - first![0], second![1] - first![1]);
    };
    expect(side(half, "square_a") / side(base, "square_a")).toBeCloseTo(0.5, 9);
    expect(side(half, "square_c") / side(base, "square_c")).toBeCloseTo(0.5, 9);
    const double = setup({ values: { a: 6, b: 8 } });
    expect(side(double, "square_c")).toBeCloseTo(side(base, "square_c"), 6);
    const wider = setup({ values: { a: 6, b: 4 } });
    expect(side(wider, "square_c") / side(wider, "square_b")).toBeCloseTo(Math.hypot(6, 4) / 4, 9);
    expect(side(wider, "square_b")).toBeLessThan(side(base, "square_b"));
    const slot = base.ctx.size;
    for (const view of [base, half, double]) {
      for (const name of ["square_a", "square_b", "square_c"]) {
        for (const [x, y] of pointsOf(part(view.container, name)!.querySelector("polygon"))) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(slot.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(slot.height);
        }
      }
    }
  });

  it("keeps every square and text inside the slot for very unequal sides", () => {
    for (const values of [
      { a: 1, b: 20 },
      { a: 20, b: 1 },
      { a: 20, b: 20 },
      { a: 1, b: 1 },
    ]) {
      const { container, ctx } = setup({ values });
      for (const polygon of container.querySelectorAll("polygon")) {
        for (const [x, y] of pointsOf(polygon)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(ctx.size.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(ctx.size.height);
        }
      }
      for (const text of container.querySelectorAll("text")) {
        expect(num(text, "x")).toBeGreaterThan(0);
        expect(num(text, "x")).toBeLessThan(ctx.size.width);
        expect(num(text, "y")).toBeGreaterThan(0);
        expect(num(text, "y")).toBeLessThan(ctx.size.height);
      }
    }
  });

  it("sets the symbols in italic and the areas in mono", () => {
    const { container } = setup();
    const texts = [...container.querySelectorAll("text")];
    expect(texts).toHaveLength(6);
    expect(texts.filter((t) => t.getAttribute("font-style") === "italic")).toHaveLength(3);
  });

  it("draws a flat result wash behind a highlighted square, side, triangle or right angle", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["tri"], how: "fade", at: 0 },
          {
            do: "highlight",
            targets: ["tri.square_c", "tri.side_a", "tri.triangle", "tri.right_angle"],
            at: 0.1,
          },
        ],
      },
    ];
    const { container, ctx } = setup({ beats });
    const result = ctx.theme.role.result;
    const washes = (name: string) =>
      [...part(container, name)!.querySelectorAll("polygon, rect")].filter(
        (el) => el.getAttribute("fill") === result,
      );
    for (const name of ["square_c", "side_a", "triangle", "right_angle"]) {
      expect(washes(name), name).toHaveLength(1);
    }
    for (const name of ["square_a", "square_b", "side_b", "side_c"]) {
      expect(washes(name), name).toHaveLength(0);
    }
  });

  it("grows the wash with the highlight", () => {
    const beats = (at: number): Scene["beats"] => [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["tri"], how: "fade", at: 0 },
          { do: "highlight", targets: ["tri.side_c"], at },
        ],
      },
    ];
    const start = setup({ beats: beats(0.5), frame: 66 });
    const end = setup({ beats: beats(0.1) });
    const length = (view: ReturnType<typeof setup>) => {
      const band = [...part(view.container, "side_c")!.querySelectorAll("polygon")][0];
      const [p0, p1] = pointsOf(band);
      return Math.hypot(p1![0] - p0![0], p1![1] - p0![1]);
    };
    expect(length(start)).toBeGreaterThan(0);
    expect(length(start)).toBeLessThan(length(end));
  });

  it("fades the parts in, and traces the outlines with the labels after the stroke", () => {
    const fading = setup({ frame: 4, beats: showing(["tri.square_a"]) });
    const label = part(fading.container, "square_a")!.querySelector("text")!;
    expect(num(label, "opacity")).toBeGreaterThan(0);
    expect(num(label, "opacity")).toBeLessThan(1);

    const drawing = setup({ frame: 9, beats: showing(["tri"], "draw") });
    for (const name of ["square_a", "square_c", "triangle"]) {
      const outline = [...part(drawing.container, name)!.querySelectorAll("polygon")].find(
        (p) => p.getAttribute("fill") === "none",
      )!;
      const length = num(outline, "stroke-dasharray");
      expect(length, name).toBeGreaterThan(0);
      expect(num(outline, "stroke-dashoffset"), name).toBeGreaterThan(0);
      expect(num(outline, "stroke-dashoffset"), name).toBeLessThan(length);
    }
    expect(num(part(drawing.container, "square_a")!.querySelector("text"), "opacity")).toBe(0);
    for (const name of ["side_a", "side_c", "right_angle"]) {
      const stroke = part(drawing.container, name)!.querySelector("line, polyline")!;
      expect(stroke.hasAttribute("stroke-dasharray"), name).toBe(true);
    }

    const done = setup({ beats: showing(["tri"], "draw") });
    const finished = part(done.container, "square_a")!;
    expect(finished.querySelector("polygon[fill=none]")!.hasAttribute("stroke-dasharray")).toBe(
      false,
    );
    expect(num(finished.querySelector("text"), "opacity")).toBe(1);
  });

  it("fades in a part that is shown with the type effect", () => {
    const { container } = setup({
      frame: 4,
      beats: showing(["tri.square_a", "tri.side_a"], "type"),
    });
    const label = part(container, "square_a")!.querySelector("text")!;
    expect(num(label, "opacity")).toBeGreaterThan(0);
    expect(num(label, "opacity")).toBeLessThan(1);
    const group = part(container, "square_a")!.querySelector("g")!;
    expect(num(group, "opacity")).toBeLessThan(1);
    expect(part(container, "side_a")!.querySelector("line")!.hasAttribute("stroke-dasharray")).toBe(
      false,
    );
  });

  describe.each<ThemeName>(["paper", "board"])("in the %s theme", (theme) => {
    it("takes every colour from the theme tokens", () => {
      const { container, ctx } = setup({
        theme,
        beats: [
          {
            id: "b1",
            narration: "Test.",
            duration_ms: 4000,
            actions: [
              { do: "show", targets: ["tri"], how: "fade", at: 0 },
              { do: "highlight", targets: ["tri.square_c", "tri.side_c"], at: 0.1 },
            ],
          },
        ],
      });
      const tokens = new Set([
        ctx.theme.ink,
        ctx.theme.inkSoft,
        ctx.theme.surfaceRaised,
        ...Object.values(ctx.theme.role),
      ]);
      const used = new Set<string>();
      for (const element of container.querySelectorAll("[fill], [stroke]")) {
        for (const name of ["fill", "stroke"]) {
          const value = element.getAttribute(name);
          if (value && value !== "none" && !value.startsWith("url(")) used.add(value);
        }
      }
      expect(used.size).toBeGreaterThan(0);
      for (const colour of used) expect(tokens.has(colour), colour).toBe(true);
    });

    it("colours the legs and their squares as quantities, the hypotenuse and its square in ink", () => {
      const { container, ctx } = setup({ theme });
      const { role } = ctx.theme;
      const outline = (name: string) =>
        part(container, name)!.querySelector("polygon[fill=none]")!.getAttribute("stroke");
      expect(outline("square_a")).toBe(role.quantity);
      expect(outline("square_b")).toBe(role.quantity);
      expect(outline("square_c")).toBe(ctx.theme.ink);
      expect(outline("triangle")).toBe(ctx.theme.ink);
      const line = (name: string) =>
        part(container, name)!.querySelector("line")!.getAttribute("stroke");
      expect(line("side_a")).toBe(role.quantity);
      expect(line("side_b")).toBe(role.quantity);
      expect(line("side_c")).toBe(ctx.theme.ink);
      const fill = (name: string) =>
        part(container, name)!.querySelector("text")!.getAttribute("fill");
      expect(fill("square_a")).toBe(role.quantity);
      expect(fill("square_b")).toBe(role.quantity);
      expect(fill("square_c")).toBe(ctx.theme.ink);
      expect(
        part(container, "right_angle")!.querySelector("polyline")!.getAttribute("stroke"),
      ).toBe(ctx.theme.ink);
    });

    it("hatches the squares instead of filling them", () => {
      const { container } = setup({ theme });
      expect(container.querySelectorAll("pattern")).toHaveLength(3);
      for (const name of ["square_a", "square_b", "square_c"]) {
        const fills = [...part(container, name)!.querySelectorAll("polygon")].map((p) =>
          p.getAttribute("fill"),
        );
        expect(fills.some((fill) => fill?.startsWith("url(#hatch-"))).toBe(true);
      }
    });
  });

  it("uses one stroke width per kind: regular outlines, accent sides", () => {
    const { container, ctx } = setup();
    const width = (el: Element | null) => num(el, "stroke-width");
    expect(width(part(container, "square_a")!.querySelector("polygon[fill=none]"))).toBeCloseTo(
      0.25 * ctx.u,
      9,
    );
    expect(width(part(container, "triangle")!.querySelector("polygon"))).toBeCloseTo(
      0.25 * ctx.u,
      9,
    );
    for (const name of ["side_a", "side_b", "side_c"]) {
      expect(width(part(container, name)!.querySelector("line"))).toBeCloseTo(0.5 * ctx.u, 9);
    }
  });
});
