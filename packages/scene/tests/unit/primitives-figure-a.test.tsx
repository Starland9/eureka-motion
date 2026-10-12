// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SceneContext } from "../../src/composition/context";
import {
  DocumentSchema,
  formatIssues,
  validateScene,
  type Beat,
  type ElementOf,
  type Param,
  type Scene,
  type SceneElement,
} from "../../src/schema";
import { niceTicks } from "../../src/primitives/figure/a-ticks";
import { getTheme, sceneMetrics, THEME_NAMES, type ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext, type ContextOptions } from "../helpers/scene";

type Point = readonly [number, number];

const WORLD = { x: [-5, 5], y: [-2, 10] } as Scene["world"];

const plotOf = (extra: Partial<ElementOf<"plot">> = {}): ElementOf<"plot"> => ({
  id: "f",
  slot: "figure",
  type: "plot",
  fn: "x^2",
  ...extra,
});

const axesOf = (extra: Partial<ElementOf<"axes">> = {}): ElementOf<"axes"> => ({
  id: "ax",
  slot: "figure",
  type: "axes",
  ...extra,
});

const pointOf = (extra: Partial<ElementOf<"point">> = {}): ElementOf<"point"> => ({
  id: "p",
  slot: "figure",
  type: "point",
  at: [1, 1],
  ...extra,
});

const areaOf = (extra: Partial<ElementOf<"area">> = {}): ElementOf<"area"> => ({
  id: "ar",
  slot: "figure",
  type: "area",
  plot: "f",
  from: 0,
  to: 2,
  ...extra,
});

const tangentOf = (extra: Partial<ElementOf<"tangent">> = {}): ElementOf<"tangent"> => ({
  id: "t",
  slot: "figure",
  type: "tangent",
  plot: "f",
  at: 1,
  ...extra,
});

const barsOf = (extra: Partial<ElementOf<"bars">> = {}): ElementOf<"bars"> => ({
  id: "b",
  slot: "figure",
  type: "bars",
  items: [
    { label: "Lyon", value: 2 },
    { label: "Nice", value: 4 },
    { label: "Paris", value: 8 },
  ],
  ...extra,
});

const param = (id: string, value: number, max = 10): Param => ({
  id,
  symbol: id,
  label: id,
  unit: "",
  min: 0,
  max,
  step: 0.1,
  default: value,
  role: "quantity",
});

const showBeats = (
  targets: string[],
  how: "fade" | "draw" = "fade",
  extra: Beat["actions"] = [],
): Beat[] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [{ do: "show", targets, how, at: 0 }, ...extra],
  },
];

interface DrawOptions extends Partial<Omit<ContextOptions, "scene">> {
  others?: SceneElement[];
  beats?: Beat[];
  world?: Scene["world"];
}

function draw(element: SceneElement, options: DrawOptions = {}) {
  const { others = [], beats, world = WORLD, ...context } = options;
  const elements = [...others, element];
  const scene = sceneOf(elements, {
    world: element.type === "bars" ? undefined : world,
    beats: beats ?? showBeats(elements.map((e) => e.id)),
  });
  const ctx = testContext({ scene, slot: "figure", ...context });
  return { ctx, scene, ...renderElement(element, ctx) };
}

const numbers = (text: string | null): number[] =>
  (text ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];

const attr = (element: Element | null, name: string): string => {
  if (!element) throw new Error(`missing element for ${name}`);
  return element.getAttribute(name) ?? "";
};

const part = (container: Element, name: string): Element[] => [
  ...container.querySelectorAll(`[data-part="${name}"]`),
];

const one = (container: Element, name: string): Element => {
  const found = part(container, name);
  if (found.length !== 1) throw new Error(`expected one "${name}", found ${found.length}`);
  return found[0] as Element;
};

function runsOf(path: Element): Point[][] {
  return attr(path, "d")
    .split("M")
    .filter(Boolean)
    .map((run) => {
      const values = numbers(run);
      const points: Point[] = [];
      for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i]!, values[i + 1]!]);
      return points;
    });
}

function distanceToPolyline(points: readonly Point[], target: Point): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t =
      length === 0
        ? 0
        : Math.min(1, Math.max(0, ((target[0] - ax) * dx + (target[1] - ay) * dy) / length));
    best = Math.min(best, Math.hypot(ax + t * dx - target[0], ay + t * dy - target[1]));
  }
  return best;
}

function curvePasses(container: Element, ctx: SceneContext, world: Point): boolean {
  const target = ctx.projection!.toPx(world);
  return part(container, "curve").some((path) =>
    runsOf(path).some((run) => distanceToPolyline(run, target) < 1),
  );
}

function effectiveOpacity(element: Element): number {
  let value = 1;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const own = node.getAttribute("opacity");
    if (own !== null) value *= Number(own);
  }
  return value;
}

const painted = (container: Element): Element[] =>
  [...container.querySelectorAll("path, line, rect, circle, polygon, text")].filter(
    (element) => !element.closest("defs"),
  );

const textsOf = (container: Element, name: string): string[] =>
  part(container, name).map((element) => element.textContent ?? "");

const angleOf = (line: Element): number => {
  const dx = Number(attr(line, "x2")) - Number(attr(line, "x1"));
  const dy = Number(attr(line, "y2")) - Number(attr(line, "y1"));
  return (Math.atan2(-dy, dx) * 180) / Math.PI;
};

const heightOf = (bar: Element): number => Number(attr(bar, "height"));

describe("plot", () => {
  it("passes through the pixel position of (2, 4) for x^2", () => {
    const { container, ctx } = draw(plotOf());
    expect(curvePasses(container, ctx, [2, 4])).toBe(true);
    expect(curvePasses(container, ctx, [-3, 9])).toBe(true);
    expect(curvePasses(container, ctx, [2, 5])).toBe(false);
  });

  it("is clipped to the frame of the world", () => {
    const { container, ctx } = draw(plotOf());
    const clip = container.querySelector("clipPath rect");
    const { fitted } = ctx.projection!;
    expect(Number(attr(clip, "x"))).toBeCloseTo(fitted.x);
    expect(Number(attr(clip, "width"))).toBeCloseTo(fitted.width);
    expect(Number(attr(clip, "height"))).toBeCloseTo(fitted.height);
    expect(container.querySelector('g[clip-path^="url(#"]')).not.toBeNull();
  });

  it("starts where the function is defined", () => {
    const { container, ctx } = draw(plotOf({ fn: "sqrt(x)" }));
    const runs = part(container, "curve").flatMap(runsOf);
    expect(runs).toHaveLength(1);
    const zero = ctx.projection!.toPx([0, 0])[0];
    expect(Math.min(...runs[0]!.map(([x]) => x))).toBeGreaterThanOrEqual(zero - 0.5);
    expect(curvePasses(container, ctx, [4, 2])).toBe(true);
  });

  it("breaks the path where the value is not finite", () => {
    const { container, ctx } = draw(plotOf({ fn: "1/x", domain: [-1, 1] }));
    const paths = part(container, "curve");
    expect(paths).toHaveLength(2);
    const [left, right] = paths.map((path) => runsOf(path)[0]!);
    const zero = ctx.projection!.toPx([0, 0])[0];
    expect(Math.max(...left!.map(([x]) => x))).toBeLessThan(zero);
    expect(Math.min(...right!.map(([x]) => x))).toBeGreaterThan(zero);
  });

  it("does not join the two branches of an asymptote", () => {
    const { container } = draw(plotOf({ fn: "1/(x - 1)" }));
    expect(part(container, "curve")).toHaveLength(2);
  });

  it("follows a parameter value", () => {
    const params = [param("a", 1, 4)];
    const element = plotOf({ fn: "a * x^2" });
    const one = draw(element, { params, values: { a: 1 } });
    expect(curvePasses(one.container, one.ctx, [2, 4])).toBe(true);
    const two = draw(element, { params, values: { a: 2 } });
    expect(curvePasses(two.container, two.ctx, [2, 8])).toBe(true);
    expect(curvePasses(two.container, two.ctx, [2, 4])).toBe(false);
  });

  it("follows the simulated time", () => {
    const element = plotOf({ fn: "x + t" });
    const beats = showBeats(["f"], "fade", [{ do: "play", target: "f", to: 2, at: 0 }]);
    const start = draw(element, { beats, frame: 0 });
    expect(start.ctx.state.simTime("f")).toBe(0);
    expect(curvePasses(start.container, start.ctx, [0, 0])).toBe(true);
    const end = draw(element, { beats, frame: "end" });
    const t = end.ctx.state.simTime("f");
    expect(t).toBeGreaterThan(1.5);
    expect(curvePasses(end.container, end.ctx, [0, t])).toBe(true);
    expect(curvePasses(end.container, end.ctx, [0, 0])).toBe(false);
  });

  it("draws a dashed line when asked", () => {
    const { container, ctx } = draw(plotOf({ style: "dashed" }));
    const dash = attr(one(container, "curve"), "stroke-dasharray");
    expect(numbers(dash)).toEqual([2.5 * ctx.u, 1.25 * ctx.u]);
    expect(attr(one(draw(plotOf()).container, "curve"), "stroke-dasharray")).toBe("");
  });

  it("strokes with the accent width in the role colour, ink by default", () => {
    const { container, ctx } = draw(plotOf());
    expect(attr(one(container, "curve"), "stroke")).toBe(ctx.theme.ink);
    expect(Number(attr(one(container, "curve"), "stroke-width"))).toBeCloseTo(
      sceneMetrics.stroke.accent * ctx.u,
    );
    const role = draw(plotOf({ role: "valid" }));
    expect(attr(one(role.container, "curve"), "stroke")).toBe(role.ctx.theme.role.valid);
  });

  it("puts its label to the right of a curve that ends inside the frame", () => {
    const { container, ctx } = draw(plotOf({ label: "f", domain: [-5, 2] }));
    const label = [...container.querySelectorAll("text")].find((t) => t.textContent === "f")!;
    const end = ctx.projection!.toPx([2, 4]);
    const dx = Number(attr(label, "x")) - end[0];
    expect(dx).toBeGreaterThan(0);
    expect(dx).toBeLessThan(3 * ctx.u);
    expect(Number(attr(label, "y"))).toBeCloseTo(end[1], 0);
    expect(attr(label, "text-anchor")).toBe("start");
  });

  it("keeps its label inside the frame when the curve runs to the right edge", () => {
    const { container, ctx } = draw(plotOf({ label: "y = x²" }));
    const label = [...container.querySelectorAll("text")].find((t) => t.textContent === "y = x²")!;
    const { fitted } = ctx.projection!;
    expect(attr(label, "text-anchor")).toBe("end");
    expect(Number(attr(label, "x"))).toBeLessThanOrEqual(fitted.x + fitted.width);
    const end = ctx.projection!.toPx([Math.sqrt(10), 10]);
    expect(Math.abs(Number(attr(label, "x")) - end[0])).toBeLessThan(3 * ctx.u);
    expect(Math.abs(Number(attr(label, "y")) - end[1])).toBeLessThan(6 * ctx.u);
  });
});

describe("axes", () => {
  it("crosses at the origin and spans the world frame", () => {
    const { container, ctx } = draw(axesOf());
    const [ox, oy] = ctx.projection!.toPx([0, 0]);
    const { fitted } = ctx.projection!;
    const halves = part(container, "axes")[0]!.querySelectorAll("path");
    expect(halves).toHaveLength(4);
    for (const path of halves) {
      const [x, y] = numbers(attr(path, "d"));
      expect(x).toBeCloseTo(ox, 1);
      expect(y).toBeCloseTo(oy, 1);
    }
    const ends = [...halves].map((path) => numbers(attr(path, "d")).slice(2));
    expect(ends.some(([x]) => Math.abs(x! - fitted.x) < 0.1)).toBe(true);
    expect(ends.some(([, y]) => Math.abs(y! - (fitted.y + fitted.height)) < 0.1)).toBe(true);
  });

  it("moves to the nearest edge when zero is outside the frame", () => {
    const { container, ctx } = draw(axesOf(), { world: { x: [2, 10], y: [1, 6] } });
    const { fitted } = ctx.projection!;
    const starts = [...part(container, "axes")[0]!.querySelectorAll("path")].map((path) =>
      numbers(attr(path, "d")).slice(0, 2),
    );
    for (const [x, y] of starts) {
      expect(x).toBeCloseTo(fitted.x, 1);
      expect(y).toBeCloseTo(fitted.y + fitted.height, 1);
    }
  });

  it("strokes the axes in ink with the regular width and a solid arrowhead on each", () => {
    const { container, ctx } = draw(axesOf());
    const group = part(container, "axes")[0]!;
    expect(attr(group, "stroke")).toBe(ctx.theme.ink);
    expect(Number(attr(group, "stroke-width"))).toBeCloseTo(sceneMetrics.stroke.regular * ctx.u);
    const arrows = container.querySelectorAll("polygon");
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) expect(attr(arrow, "fill")).toBe(ctx.theme.ink);
  });

  it("puts ticks about 0.8 unit long at nice values, about five per axis", () => {
    const { container, ctx } = draw(axesOf());
    const ticks = [...part(container, "ticks")[0]!.querySelectorAll("line")];
    for (const tick of ticks) {
      const length = Math.hypot(
        Number(attr(tick, "x2")) - Number(attr(tick, "x1")),
        Number(attr(tick, "y2")) - Number(attr(tick, "y1")),
      );
      expect(length).toBeCloseTo(0.8 * ctx.u);
    }
    const x = textsOf(container, "tick-label-x");
    const y = textsOf(container, "tick-label-y");
    expect(x.length).toBeGreaterThanOrEqual(3);
    expect(x.length).toBeLessThanOrEqual(7);
    expect(y.length).toBeGreaterThanOrEqual(2);
    expect(y.length).toBeLessThanOrEqual(7);
    expect(ticks).toHaveLength(x.length + y.length);
  });

  it("lets xTicks and yTicks override the count, and 0 disable the ticks", () => {
    const some = draw(axesOf({ xTicks: 0, yTicks: 3 }), { world: { x: [-10, 10], y: [-6, 6] } });
    expect(part(some.container, "tick-label-x")).toHaveLength(0);
    expect(part(some.container, "tick-label-y").length).toBeGreaterThan(0);
    const none = draw(axesOf({ xTicks: 0, yTicks: 0 }));
    expect(part(none.container, "ticks")[0]!.querySelectorAll("line")).toHaveLength(0);
  });

  it("writes tick values in mono with a decimal comma in French and a point in English", () => {
    const world = { x: [-1, 1], y: [-0.5, 0.5] } as Scene["world"];
    const element = axesOf({ xTicks: 4 });
    const fr = draw(element, { world, language: "fr" });
    expect(textsOf(fr.container, "tick-label-x")).toEqual(expect.arrayContaining(["−0,5", "0,5"]));
    expect(attr(part(fr.container, "tick-label-x")[0] ?? null, "font-family")).toContain(
      "IBM Plex Mono",
    );
    expect(Number(attr(part(fr.container, "tick-label-x")[0] ?? null, "font-size"))).toBeCloseTo(
      sceneMetrics.text.min * fr.ctx.u,
    );
    const en = draw(element, { world, language: "en" });
    expect(textsOf(en.container, "tick-label-x")).toEqual(expect.arrayContaining(["−0.5", "0.5"]));
  });

  it("typesets large tick values with a real superscript", () => {
    const { container } = draw(axesOf({ xTicks: 3 }), { world: { x: [0, 8e8], y: [-1e8, 4e8] } });
    const exponents = [...container.querySelectorAll("tspan")].map((t) => t.textContent);
    expect(exponents).toContain("8");
  });

  it("draws the names in italic text face", () => {
    const { container } = draw(axesOf({ xLabel: "t", yLabel: "v" }));
    const names = [...container.querySelectorAll('text[font-style="italic"]')];
    expect(names.map((name) => name.textContent).sort()).toEqual(["t", "v"]);
  });

  it("adds construction lines at the ticks with grid", () => {
    const plain = draw(axesOf());
    expect(part(plain.container, "grid")).toHaveLength(0);
    const { container, ctx } = draw(axesOf({ grid: true }));
    const grid = part(container, "grid")[0]!;
    expect(attr(grid, "stroke")).toBe(ctx.theme.rule);
    expect(Number(attr(grid, "stroke-width"))).toBeCloseTo(
      sceneMetrics.stroke.construction * ctx.u,
    );
    expect(grid.querySelectorAll("line").length).toBeGreaterThanOrEqual(3);
  });

  it("traces from the origin outward with a draw entrance", () => {
    const beats = showBeats(["ax"], "draw");
    const { container } = draw(axesOf(), { beats, frame: 9 });
    for (const path of part(container, "axes")[0]!.querySelectorAll("path")) {
      const length = Number(attr(path, "stroke-dasharray"));
      const offset = Number(attr(path, "stroke-dashoffset"));
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThan(length);
    }
    const done = draw(axesOf(), { beats, frame: "end" });
    expect(
      part(done.container, "axes")[0]!.querySelector("path")?.hasAttribute("stroke-dasharray"),
    ).toBe(false);
  });
});

describe("point", () => {
  it("is a dot of 0.6 unit in the role colour inside a surfaceRaised ring", () => {
    const { container, ctx } = draw(pointOf({ role: "quantity" }));
    const dot = one(container, "dot");
    expect(Number(attr(dot, "r"))).toBeCloseTo(0.6 * ctx.u);
    expect(attr(dot, "fill")).toBe(ctx.theme.role.quantity);
    const ring = dot.previousElementSibling!;
    expect(attr(ring, "fill")).toBe(ctx.theme.surfaceRaised);
    expect(Number(attr(ring, "r"))).toBeGreaterThan(0.6 * ctx.u);
    const [x, y] = ctx.projection!.toPx([1, 1]);
    expect(Number(attr(dot, "cx"))).toBeCloseTo(x);
    expect(Number(attr(dot, "cy"))).toBeCloseTo(y);
  });

  it("is ink by default and puts its label up and to the right", () => {
    const { container, ctx } = draw(pointOf({ label: "P" }));
    expect(attr(one(container, "dot"), "fill")).toBe(ctx.theme.ink);
    const label = container.querySelector("text")!;
    expect(Number(attr(label, "x"))).toBeGreaterThan(Number(attr(one(container, "dot"), "cx")));
    expect(Number(attr(label, "y"))).toBeLessThan(Number(attr(one(container, "dot"), "cy")));
  });

  it("follows a bound coordinate", () => {
    const element = pointOf({ at: [{ expr: "a" }, { expr: "a^2" }] });
    const params = [param("a", 1, 4)];
    for (const a of [1, 2.5]) {
      const { container, ctx } = draw(element, { params, values: { a } });
      const [x, y] = ctx.projection!.toPx([a, a * a]);
      expect(Number(attr(one(container, "dot"), "cx"))).toBeCloseTo(x);
      expect(Number(attr(one(container, "dot"), "cy"))).toBeCloseTo(y);
    }
  });

  it("moves from its position toward the target of a move action", () => {
    const beats = showBeats(["p"], "fade", [{ do: "move", target: "p", to: [4, 6], at: 0 }]);
    const start = draw(pointOf(), { beats, frame: 0 });
    expect(Number(attr(one(start.container, "dot"), "cx"))).toBeCloseTo(
      start.ctx.projection!.toPx([1, 1])[0],
    );
    const middle = draw(pointOf(), { beats, frame: 5 });
    const progress = middle.ctx.state.of("p").move!.progress;
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
    const expected = middle.ctx.projection!.toPx([1 + 3 * progress, 1 + 5 * progress]);
    expect(Number(attr(one(middle.container, "dot"), "cx"))).toBeCloseTo(expected[0]);
    expect(Number(attr(one(middle.container, "dot"), "cy"))).toBeCloseTo(expected[1]);
    const end = draw(pointOf(), { beats, frame: "end" });
    const target = end.ctx.projection!.toPx([4, 6]);
    expect(Number(attr(one(end.container, "dot"), "cx"))).toBeCloseTo(target[0]);
    expect(Number(attr(one(end.container, "dot"), "cy"))).toBeCloseTo(target[1]);
  });
});

describe("area", () => {
  const others = [plotOf()];

  it("is bounded by from and to", () => {
    const { container, ctx } = draw(areaOf({ from: 0.5, to: 2 }), { others });
    const xs = runsOf(one(container, "region"))[0]!.map(([x]) => x);
    const base = ctx.projection!.toPx([0, 0])[1];
    expect(Math.min(...xs)).toBeCloseTo(ctx.projection!.toPx([0.5, 0])[0], 1);
    expect(Math.max(...xs)).toBeCloseTo(ctx.projection!.toPx([2, 0])[0], 1);
    const ys = runsOf(one(container, "region"))[0]!.map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(base, 1);
    expect(Number(attr(one(container, "side-from"), "x1"))).toBeCloseTo(
      ctx.projection!.toPx([0.5, 0])[0],
      1,
    );
    expect(Number(attr(one(container, "side-to"), "x1"))).toBeCloseTo(
      ctx.projection!.toPx([2, 0])[0],
      1,
    );
    expect(
      distanceToPolyline(runsOf(one(container, "region"))[0]!, ctx.projection!.toPx([1, 1])),
    ).toBeLessThan(1);
  });

  it("follows bound bounds", () => {
    const params = [param("a", 1, 4), param("b", 3, 4)];
    const element = areaOf({ from: { expr: "a" }, to: { expr: "b" } });
    const { container, ctx } = draw(element, { others, params, values: { a: 1.5, b: 3.5 } });
    const xs = runsOf(one(container, "region"))[0]!.map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(ctx.projection!.toPx([1.5, 0])[0], 1);
    expect(Math.max(...xs)).toBeCloseTo(ctx.projection!.toPx([3.5, 0])[0], 1);
  });

  it("is filled with the hatch pattern in the role colour, with no translucent fill", () => {
    const { container, ctx } = draw(areaOf({ role: "valid" }), { others });
    const region = one(container, "region");
    const pattern = container.querySelector("pattern")!;
    expect(attr(region, "fill")).toBe(`url(#${attr(pattern, "id")})`);
    expect(attr(pattern.querySelector("line"), "stroke")).toBe(ctx.theme.role.valid);
    expect(region.hasAttribute("fill-opacity")).toBe(false);
    expect(effectiveOpacity(region)).toBe(1);
    expect(attr(one(container, "side-from").parentElement, "stroke")).toBe(ctx.theme.role.valid);
  });

  it("takes the colour of its plot, or ink", () => {
    const withRole = draw(areaOf(), { others: [plotOf({ role: "quantity" })] });
    expect(attr(withRole.container.querySelector("pattern line"), "stroke")).toBe(
      withRole.ctx.theme.role.quantity,
    );
    const plain = draw(areaOf(), { others });
    expect(attr(plain.container.querySelector("pattern line"), "stroke")).toBe(plain.ctx.theme.ink);
  });

  it("is a flat fill behind ink for the result role", () => {
    const { container, ctx } = draw(areaOf({ role: "result" }), { others });
    expect(attr(one(container, "region"), "fill")).toBe(ctx.theme.role.result);
    expect(container.querySelector("pattern")).toBeNull();
    expect(attr(one(container, "side-from").parentElement, "stroke")).toBe(ctx.theme.ink);
  });

  it("reads the time of the plot it refers to", () => {
    const plot = plotOf({ fn: "1 + t" });
    const beats = showBeats(["f", "ar"], "fade", [{ do: "play", target: "f", to: 3, at: 0 }]);
    const { container, ctx } = draw(areaOf({ from: 1, to: 2 }), { others: [plot], beats });
    const t = ctx.state.simTime("f");
    expect(t).toBeGreaterThan(2);
    const top = Math.min(...runsOf(one(container, "region"))[0]!.map(([, y]) => y));
    expect(top).toBeCloseTo(ctx.projection!.toPx([1, 1 + t])[1], 0);
  });
});

describe("tangent", () => {
  const others = [plotOf()];

  it("has the slope 2 to x^2 at x = 1, through the point of tangency", () => {
    const { container, ctx } = draw(tangentOf({ showSlope: true }), { others });
    const line = one(container, "line");
    expect(angleOf(line)).toBeCloseTo((Math.atan(2) * 180) / Math.PI, 2);
    const [x, y] = ctx.projection!.toPx([1, 1]);
    const mid = [
      (Number(attr(line, "x1")) + Number(attr(line, "x2"))) / 2,
      (Number(attr(line, "y1")) + Number(attr(line, "y2"))) / 2,
    ];
    expect(mid[0]).toBeCloseTo(x, 1);
    expect(mid[1]).toBeCloseTo(y, 1);
    expect(container.querySelector("text")?.textContent).toBe("2");
    expect(Number(attr(one(container, "contact"), "cx"))).toBeCloseTo(x, 1);
    expect(Number(attr(one(container, "contact"), "cy"))).toBeCloseTo(y, 1);
  });

  it("spans about a third of the frame width in the role colour, action by default", () => {
    const { container, ctx } = draw(tangentOf(), { others });
    const line = one(container, "line");
    const length = Math.hypot(
      Number(attr(line, "x2")) - Number(attr(line, "x1")),
      Number(attr(line, "y2")) - Number(attr(line, "y1")),
    );
    expect(length).toBeCloseTo(ctx.projection!.fitted.width / 3, 0);
    expect(attr(line, "stroke")).toBe(ctx.theme.role.action);
    expect(attr(one(container, "contact"), "fill")).toBe(ctx.theme.role.action);
    const blue = draw(tangentOf({ role: "quantity" }), { others });
    expect(attr(one(blue.container, "line"), "stroke")).toBe(blue.ctx.theme.role.quantity);
  });

  it("shows the label followed by the slope, with a decimal comma in French", () => {
    const half = plotOf({ fn: "x / 2" });
    const element = tangentOf({ showSlope: true, label: "m" });
    const fr = draw(element, { others: [half], language: "fr" });
    expect(fr.container.querySelector("text")?.textContent).toBe("m = 0,5");
    const en = draw(element, { others: [half], language: "en" });
    expect(en.container.querySelector("text")?.textContent).toBe("m = 0.5");
    const negative = draw(tangentOf({ showSlope: true, at: -1 }), { others });
    expect(negative.container.querySelector("text")?.textContent).toBe("−2");
  });

  it("formats the slope with two significant digits", () => {
    const cubic = plotOf({ fn: "x^3" });
    const { container } = draw(tangentOf({ showSlope: true, at: 1.1 }), { others: [cubic] });
    expect(container.querySelector("text")?.textContent).toBe("3,6");
  });

  it("shows only its label without showSlope, and nothing without either", () => {
    expect(
      draw(tangentOf({ label: "t" }), { others }).container.querySelector("text")?.textContent,
    ).toBe("t");
    expect(draw(tangentOf(), { others }).container.querySelector("text")).toBeNull();
  });

  it("follows a bound abscissa and the time of its plot", () => {
    const params = [param("a", 1, 3)];
    const bound = draw(tangentOf({ at: { expr: "a" } }), { others, params, values: { a: 2 } });
    expect(angleOf(one(bound.container, "line"))).toBeCloseTo((Math.atan(4) * 180) / Math.PI, 2);
    const moving = plotOf({ fn: "x^2 + t * x" });
    const beats = showBeats(["f", "t"], "fade", [{ do: "play", target: "f", to: 2, at: 0 }]);
    const timed = draw(tangentOf(), { others: [moving], beats });
    const t = timed.ctx.state.simTime("f");
    expect(angleOf(one(timed.container, "line"))).toBeCloseTo(
      (Math.atan(2 + t) * 180) / Math.PI,
      1,
    );
  });
});

describe("bars", () => {
  it("makes heights proportional to the values, growing from one baseline", () => {
    const { container } = draw(barsOf());
    const bars = part(container, "bar");
    const [a, b, c] = bars.map(heightOf);
    expect(b! / a!).toBeCloseTo(2, 5);
    expect(c! / a!).toBeCloseTo(4, 5);
    const baseline = Number(attr(one(container, "baseline"), "y1"));
    for (const bar of bars) {
      expect(Number(attr(bar, "y")) + heightOf(bar)).toBeCloseTo(baseline, 5);
    }
  });

  it("fills the slot by itself, inside its width", () => {
    const { container, ctx } = draw(barsOf());
    const baseline = one(container, "baseline");
    expect(Number(attr(baseline, "x1"))).toBeGreaterThanOrEqual(0);
    expect(Number(attr(baseline, "x2"))).toBeLessThanOrEqual(ctx.size.width);
    expect(Number(attr(baseline, "y1"))).toBeLessThan(ctx.size.height);
    const tallest = Math.max(...part(container, "bar").map(heightOf));
    expect(tallest).toBeGreaterThan(ctx.size.height * 0.4);
  });

  it("reacts to a parameter", () => {
    const element = barsOf({
      items: [
        { label: "a", value: 1 },
        { label: "b", value: { expr: "p" } },
      ],
    });
    const params = [param("p", 1, 5)];
    const same = draw(element, { params, values: { p: 1 } });
    const [one1, two1] = part(same.container, "bar").map(heightOf);
    expect(two1).toBeCloseTo(one1!, 5);
    const tall = draw(element, { params, values: { p: 4 } });
    const [one4, two4] = part(tall.container, "bar").map(heightOf);
    expect(two4! / one4!).toBeCloseTo(4, 5);
    expect(one4).toBeLessThan(one1!);
  });

  it("fills each bar with the item role colour, quantity by default, with an ink outline", () => {
    const element = barsOf({
      items: [
        { label: "a", value: 1 },
        { label: "b", value: 2, role: "valid" },
        { label: "c", value: 3, role: "result" },
      ],
    });
    const { container, ctx } = draw(element);
    const bars = part(container, "bar");
    expect(bars.map((bar) => attr(bar, "fill"))).toEqual([
      ctx.theme.role.quantity,
      ctx.theme.role.valid,
      ctx.theme.role.result,
    ]);
    for (const bar of bars) {
      expect(attr(bar, "stroke")).toBe(ctx.theme.ink);
      expect(Number(attr(bar, "stroke-width"))).toBeCloseTo(sceneMetrics.stroke.regular * ctx.u);
    }
    expect(attr(one(container, "baseline"), "stroke")).toBe(ctx.theme.ink);
  });

  it("writes the category in mono under the baseline, in its own case", () => {
    const { container } = draw(barsOf());
    expect(textsOf(container, "caption")).toEqual(["Lyon", "Nice", "Paris"]);
    const caption = part(container, "caption")[0]!;
    expect(attr(caption, "font-family")).toContain("IBM Plex Mono");
    const baseline = Number(attr(one(container, "baseline"), "y1"));
    expect(Number(attr(caption.querySelector("tspan"), "y"))).toBeGreaterThan(baseline);
  });

  it("writes each value above its bar with the unit, and a real superscript for powers of ten", () => {
    const element = barsOf({
      unit: "kg",
      items: [
        { label: "Terre", value: 5.97e24 },
        { label: "Lune", value: 7.35e22 },
      ],
    });
    const { container } = draw(element, { language: "fr" });
    const values = part(container, "value");
    expect(values).toHaveLength(2);
    expect(values[0]!.textContent).toContain("5,97");
    expect(values[0]!.querySelector('tspan[data-part="exponent"]')?.textContent).toBe("24");
    expect(values[1]!.querySelector('tspan[data-part="exponent"]')?.textContent).toBe("22");
    expect(textsOf(container, "value").join(" ") + textsOf(container, "unit").join(" ")).toContain(
      "kg",
    );
    const bar = part(container, "bar")[0]!;
    expect(Number(attr(values[0]!, "y"))).toBeLessThan(Number(attr(bar, "y")));
    const en = draw(element, { language: "en" });
    expect(part(en.container, "value")[0]!.textContent).toContain("5.97");
  });

  it("uses plain numbers with the French separator", () => {
    const element = barsOf({
      items: [
        { label: "a", value: 0.25 },
        { label: "b", value: 12 },
      ],
    });
    const { container } = draw(element, { language: "fr" });
    expect(textsOf(container, "value")).toEqual(["0,25", "12"]);
  });

  it("grows from the baseline and shows the values once the bars are done", () => {
    const beats = showBeats(["b"], "draw");
    const full = draw(barsOf(), { beats, frame: "end" });
    const half = draw(barsOf(), { beats, frame: 9 });
    const fullHeights = part(full.container, "bar").map(heightOf);
    const halfHeights = part(half.container, "bar").map(heightOf);
    halfHeights.forEach((height, i) => {
      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThan(fullHeights[i]!);
    });
    expect(halfHeights[2]! / halfHeights[0]!).toBeCloseTo(4, 5);
    for (const value of part(half.container, "value")) expect(effectiveOpacity(value)).toBe(0);
    for (const value of part(full.container, "value")) expect(effectiveOpacity(value)).toBe(1);
    const baseline = Number(attr(one(half.container, "baseline"), "y1"));
    for (const bar of part(half.container, "bar")) {
      expect(Number(attr(bar, "y")) + heightOf(bar)).toBeCloseTo(baseline, 5);
    }
  });
});

describe("entrance", () => {
  const plot = plotOf();
  const cases: [string, SceneElement, SceneElement[]][] = [
    ["axes", axesOf({ xLabel: "x", yLabel: "y", grid: true }), []],
    ["plot", plotOf({ label: "f" }), []],
    ["point", pointOf({ label: "P" }), []],
    ["area", areaOf({ from: 0.5, label: "A" }), [plot]],
    ["tangent", tangentOf({ showSlope: true }), [plot]],
    ["bars", barsOf({ unit: "m" }), []],
  ];
  const hiddenBeats = (id: string): Beat[] => [
    { id: "b0", narration: "Wait.", duration_ms: 2000, actions: [] },
    {
      id: "b1",
      narration: "Show.",
      duration_ms: 2000,
      actions: [{ do: "show", targets: [id], how: "fade", at: 0 }],
    },
  ];

  it.each(cases)("%s is hidden before its show action", (_name, element, others) => {
    const { container, ctx } = draw(element, {
      others,
      beats: hiddenBeats(element.id),
      frame: 0,
    });
    expect(ctx.state.of(element.id).visible).toBe(false);
    const shapes = painted(container);
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) expect(effectiveOpacity(shape)).toBe(0);
  });

  it.each(cases)("%s is fully shown at the end of a fade", (_name, element, others) => {
    const { container, ctx } = draw(element, { others, frame: "end" });
    expect(ctx.state.of(element.id).visible).toBe(true);
    for (const shape of painted(container)) expect(effectiveOpacity(shape)).toBe(1);
  });

  it.each(cases.filter(([name]) => !["point", "bars"].includes(name)))(
    "%s is partly drawn midway through a draw",
    (_name, element, others) => {
      const beats = showBeats(
        [...others, element].map((e) => e.id),
        "draw",
      );
      const { container, ctx } = draw(element, { others, beats, frame: 9 });
      const state = ctx.state.of(element.id);
      expect(state.progress).toBeGreaterThan(0.2);
      expect(state.progress).toBeLessThan(0.8);
      const traced = painted(container).filter((shape) => shape.hasAttribute("stroke-dasharray"));
      expect(traced.length).toBeGreaterThan(0);
      for (const shape of traced) {
        const length = Number(attr(shape, "stroke-dasharray"));
        const offset = Number(attr(shape, "stroke-dashoffset"));
        expect(offset).toBeGreaterThan(0);
        expect(offset).toBeLessThanOrEqual(length);
      }
      const labels = painted(container).filter((shape) => shape.tagName === "text");
      for (const label of labels) expect(effectiveOpacity(label)).toBe(0);
    },
  );

  it("traces a dashed plot by revealing it from left to right", () => {
    const element = plotOf({ style: "dashed" });
    const beats = showBeats(["f"], "draw");
    const half = draw(element, { beats, frame: 9 });
    const reveal = half.container.querySelector('clipPath[id^="reveal-"] rect')!;
    expect(Number(attr(reveal, "width"))).toBeGreaterThan(0);
    expect(Number(attr(reveal, "width"))).toBeLessThan(half.ctx.projection!.fitted.width);
    expect(half.container.querySelector('clipPath[id^="reveal-"]')).not.toBeNull();
    const done = draw(element, { beats, frame: "end" });
    expect(done.container.querySelector('clipPath[id^="reveal-"]')).toBeNull();
  });

  it("reveals the area from left to right", () => {
    const beats = showBeats(["f", "ar"], "draw");
    const half = draw(areaOf(), { others: [plot], beats, frame: 9 });
    const reveal = half.container.querySelector('clipPath[id^="reveal-"] rect')!;
    const { toPx } = half.ctx.projection!;
    expect(Number(attr(reveal, "x")) + Number(attr(reveal, "width"))).toBeGreaterThan(
      toPx([0, 0])[0],
    );
    expect(Number(attr(reveal, "x")) + Number(attr(reveal, "width"))).toBeLessThan(toPx([2, 0])[0]);
  });
});

describe.each(THEME_NAMES)("token colours in the %s theme", (name: ThemeName) => {
  const theme = getTheme(name);
  const tokens = new Set([
    theme.ink,
    theme.inkSoft,
    theme.inkFaint,
    theme.surfaceRaised,
    theme.rule,
    ...Object.values(theme.role),
  ]);
  const plot = plotOf({ role: "quantity", label: "f" });
  const scenes: [string, SceneElement, SceneElement[]][] = [
    ["axes", axesOf({ xLabel: "x", yLabel: "y", grid: true }), []],
    ["plot", plot, []],
    ["point", pointOf({ role: "action", label: "P" }), []],
    ["area", areaOf({ role: "valid", label: "A" }), [plot]],
    ["tangent", tangentOf({ showSlope: true, label: "m" }), [plot]],
    [
      "bars",
      barsOf({
        unit: "m",
        items: [
          { label: "a", value: 1 },
          { label: "b", value: 2, role: "action" },
        ],
      }),
      [],
    ],
  ];

  it.each(scenes)("%s uses only token colours", (_name, element, others) => {
    const { container } = draw(element, { others, theme: name });
    const used = [...container.querySelectorAll("[fill], [stroke]")].flatMap((node) => [
      node.getAttribute("fill"),
      node.getAttribute("stroke"),
    ]);
    const colours = used.filter(
      (value): value is string => value !== null && value !== "none" && !value.startsWith("url("),
    );
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) expect(tokens.has(colour), colour).toBe(true);
  });

  it("uses the role colour of the theme for the plot, the point and the tangent", () => {
    const set = [plot];
    expect(attr(one(draw(plot, { theme: name }).container, "curve"), "stroke")).toBe(
      theme.role.quantity,
    );
    expect(
      attr(one(draw(pointOf({ role: "action" }), { theme: name }).container, "dot"), "fill"),
    ).toBe(theme.role.action);
    expect(
      attr(one(draw(tangentOf(), { others: set, theme: name }).container, "line"), "stroke"),
    ).toBe(theme.role.action);
    expect(
      attr(
        draw(areaOf({ role: "valid" }), { others: set, theme: name }).container.querySelector(
          "pattern line",
        ),
        "stroke",
      ),
    ).toBe(theme.role.valid);
    expect(attr(part(draw(barsOf(), { theme: name }).container, "bar")[0] ?? null, "fill")).toBe(
      theme.role.quantity,
    );
  });
});

describe("degenerate input", () => {
  it("shows a flat tangent as 0, not as rounding noise", () => {
    const { container } = draw(tangentOf({ showSlope: true, at: { expr: "pi / 2" } }), {
      others: [plotOf({ fn: "sin(x)" })],
    });
    expect(container.querySelector("text")?.textContent).toBe("0");
    expect(angleOf(one(container, "line"))).toBeCloseTo(0, 5);
  });

  it("draws nothing for an area or a tangent whose plot does not exist", () => {
    for (const element of [areaOf({ plot: "missing" }), tangentOf({ plot: "missing" })]) {
      expect(draw(element).container.querySelector("path, line, circle, text")).toBeNull();
    }
  });

  it("never writes NaN or Infinity for awkward curves, and draws nothing outside the domain", () => {
    const wild = [
      plotOf({ fn: "tan(x)" }),
      plotOf({ fn: "ln(x)" }),
      plotOf({ fn: "1 / (x * x)", domain: [-1, 1] }),
      plotOf({ fn: "x", domain: [20, 30] }),
      plotOf({ fn: "x", domain: [3, 3] }),
    ];
    for (const element of wild) {
      const { container } = draw(element);
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    }
    expect(part(draw(plotOf({ fn: "x", domain: [20, 30] })).container, "curve")).toHaveLength(0);
  });

  it("keeps zero, negative and non-finite bars at height 0", () => {
    const element = barsOf({
      items: [
        { label: "a", value: 0 },
        { label: "b", value: -3 },
        { label: "c", value: 5 },
        { label: "d", value: { expr: "1 / 0" } },
      ],
    });
    const { container } = draw(element);
    expect(part(container, "bar").map(heightOf).slice(0, 2)).toEqual([0, 0]);
    expect(part(container, "bar").map(heightOf)[3]).toBe(0);
    expect(heightOf(part(container, "bar")[2]!)).toBeGreaterThan(0);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("wraps long captions instead of letting them run together", () => {
    const element = barsOf({
      items: [
        { label: "Mars du nord", value: 1 },
        { label: "Jupiter", value: 2 },
        { label: "Lune", value: 3 },
        { label: "Terre", value: 4 },
        { label: "Venus", value: 5 },
        { label: "Soleil", value: 6 },
      ],
    });
    const { container } = draw(element);
    const [first] = part(container, "caption");
    expect(first!.querySelectorAll("tspan").length).toBeGreaterThan(1);
  });
});

describe("tick values", () => {
  it.each([
    [-5, 5, 5, [-4, -2, 0, 2, 4]],
    [0, 1, 4, [0, 0.2, 0.4, 0.6, 0.8, 1]],
    [0, 100, 5, [0, 20, 40, 60, 80, 100]],
    [-1, 1, 4, [-1, -0.5, 0, 0.5, 1]],
  ])("picks nice steps for %s to %s", (min, max, count, expected) => {
    const set = niceTicks(min, max, count);
    expect(set.values.length).toBeGreaterThan(0);
    expect(set.values.every((value) => value >= min && value <= max)).toBe(true);
    const mantissa = set.step / 10 ** Math.floor(Math.log10(set.step) + 1e-9);
    expect([1, 2, 5]).toContain(Math.round(mantissa));
    expect(set.values).toEqual(expected);
  });

  it("returns nothing when asked for no tick", () => {
    expect(niceTicks(0, 10, 0).values).toEqual([]);
  });
});

describe("reference figures", () => {
  const document = DocumentSchema.parse(
    JSON.parse(readFileSync(path.join(import.meta.dirname, "../fixtures/figure-a.json"), "utf8"))
      .payload,
  );
  const outline = { plan: document.plan, params: document.params, model: document.model };

  it.each(document.scenes.map((scene) => [scene.id, scene] as const))(
    "scene %s passes the scene rules",
    (_id, scene) => {
      const result = validateScene(scene, outline);
      if (!result.ok) throw new Error(formatIssues(result.issues));
      expect(result.ok).toBe(true);
    },
  );

  const svgTypes = new Set(["axes", "plot", "point", "area", "tangent", "bars"]);
  const frames: (number | "end")[] = [0, 9, 40, 112, "end"];
  const cases = document.scenes.flatMap((scene) =>
    THEME_NAMES.flatMap((theme) => frames.map((frame) => [scene.id, theme, frame] as const)),
  );

  it.each(cases)("scene %s renders in %s at frame %s inside its slot", (id, theme, frame) => {
    const scene = document.scenes.find((candidate) => candidate.id === id)!;
    for (const element of scene.elements.filter((e) => svgTypes.has(e.type))) {
      const ctx = testContext({
        scene,
        slot: element.slot,
        frame,
        theme,
        language: "fr",
        params: document.params,
        model: document.model,
      });
      const { container } = renderElement(element, ctx);
      expect(painted(container).length).toBeGreaterThan(0);
      for (const point of anchorsOf(container)) {
        expect(point[0], `${element.id} x`).toBeGreaterThanOrEqual(-1);
        expect(point[0], `${element.id} x`).toBeLessThanOrEqual(ctx.size.width + 1);
        expect(point[1], `${element.id} y`).toBeGreaterThanOrEqual(-1);
        expect(point[1], `${element.id} y`).toBeLessThanOrEqual(ctx.size.height + 1);
      }
    }
  });
});

function anchorsOf(container: Element): Point[] {
  const points: Point[] = [];
  for (const shape of container.querySelectorAll(
    "path, line, rect, circle, polygon, text, tspan",
  )) {
    if (shape.closest("defs, [clip-path]") || shape.getAttribute("data-part") === "plate") continue;
    const n = (name: string): number => Number(shape.getAttribute(name));
    switch (shape.tagName.toLowerCase()) {
      case "line":
        points.push([n("x1"), n("y1")], [n("x2"), n("y2")]);
        break;
      case "rect":
        points.push([n("x"), n("y")], [n("x") + n("width"), n("y") + n("height")]);
        break;
      case "circle":
        points.push([n("cx") - n("r"), n("cy") - n("r")], [n("cx") + n("r"), n("cy") + n("r")]);
        break;
      case "polygon":
      case "path": {
        const values = numbers(shape.getAttribute(shape.tagName === "path" ? "d" : "points"));
        for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i]!, values[i + 1]!]);
        break;
      }
      default:
        if (shape.hasAttribute("x") && shape.hasAttribute("y")) points.push([n("x"), n("y")]);
    }
  }
  return points;
}
