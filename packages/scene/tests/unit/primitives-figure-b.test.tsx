// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ARROW_HEAD_U, hatchId } from "../../src/primitives/shared";
import type { Action, ElementOf, Param, Scene, SceneElement } from "../../src/schema/document";
import { DIMENSION_OFFSET } from "../../src/schema/geometry";
import { fontStacks, getTheme, sceneMetrics, THEME_NAMES } from "../../src/tokens";
import { renderElement, sceneOf, testContext, type ContextOptions } from "../helpers/scene";

type P = readonly [number, number];

const world: Scene["world"] = { x: [-5, 5], y: [-3, 3] };
const NUMBER = "(-?[\\d.]+(?:e[+-]?\\d+)?)";

const num = (el: Element | null | undefined, name: string): number =>
  Number(el?.getAttribute(name));
const ends = (el: Element): [P, P] => [
  [num(el, "x1"), num(el, "y1")],
  [num(el, "x2"), num(el, "y2")],
];
const pointsOf = (el: Element): P[] =>
  (el.getAttribute("points") ?? "")
    .split(" ")
    .map((pair) => pair.split(",").map(Number) as unknown as P);
const dist = (a: P, b: P): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleBetween = (a: P, b: P): number =>
  Math.acos((a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)));
const expectPoint = (actual: P | undefined, expected: P, digits = 2): void => {
  expect(actual).toBeDefined();
  expect(actual?.[0]).toBeCloseTo(expected[0], digits);
  expect(actual?.[1]).toBeCloseTo(expected[1], digits);
};

function arcOf(d: string | null) {
  const match = new RegExp(
    `^M ${NUMBER} ${NUMBER} A ${NUMBER} ${NUMBER} 0 (\\d) (\\d) ${NUMBER} ${NUMBER}$`,
  ).exec(d ?? "");
  if (!match) throw new Error(`not an arc path: ${d}`);
  const [, sx, sy, radius, , large, sweep, ex, ey] = match.map(Number);
  return {
    start: [sx, sy] as unknown as P,
    end: [ex, ey] as unknown as P,
    radius: radius as number,
    large: large as number,
    sweep: sweep as number,
  };
}

const show = (targets: string[], how: "fade" | "draw" = "fade", at = 0): Action => ({
  do: "show",
  targets,
  how,
  at,
});
const pair = <T,>(items: readonly T[]): [T, T] => {
  expect(items).toHaveLength(2);
  return [items[0] as T, items[1] as T];
};
const beatOf = (actions: Action[]): Scene["beats"] => [
  { id: "b1", narration: "Test.", duration_ms: 4000, actions },
];

interface Setup extends Partial<Omit<ContextOptions, "scene">> {
  others?: SceneElement[];
  actions?: Action[];
  how?: "fade" | "draw";
}

function draw(element: SceneElement, setup: Setup = {}) {
  const { others = [], actions = [], how = "fade", ...context } = setup;
  const elements = [...others, element];
  const scene = sceneOf(elements, {
    world,
    beats: beatOf([
      show(
        elements.map((e) => e.id),
        how,
      ),
      ...actions,
    ]),
  });
  const ctx = testContext({ scene, ...context });
  const rendered = renderElement(element, ctx);
  return { ...rendered, ctx, toPx: ctx.projection!.toPx, scale: ctx.projection!.scale };
}

const vector = (extra: Partial<ElementOf<"vector">> = {}): ElementOf<"vector"> => ({
  id: "v",
  slot: "figure",
  type: "vector",
  from: [0, 0],
  to: [2, 1],
  ...extra,
});
const segment = (extra: Partial<ElementOf<"segment">> = {}): ElementOf<"segment"> => ({
  id: "s",
  slot: "figure",
  type: "segment",
  from: [-2, 0],
  to: [2, 0],
  ...extra,
});
const dimension = (extra: Partial<ElementOf<"dimension">> = {}): ElementOf<"dimension"> => ({
  id: "d",
  slot: "figure",
  type: "dimension",
  from: [-2, 0],
  to: [2, 0],
  label: "ab",
  ...extra,
});
const angle = (extra: Partial<ElementOf<"angle">> = {}): ElementOf<"angle"> => ({
  id: "a",
  slot: "figure",
  type: "angle",
  vertex: [0, 0],
  from: [2, 0],
  to: [0, 2],
  ...extra,
});
const shape = (extra: Partial<ElementOf<"shape">> = {}): ElementOf<"shape"> => ({
  id: "f",
  slot: "figure",
  type: "shape",
  kind: "circle",
  center: [0, 0],
  radius: 1.5,
  ...extra,
});
const ball: ElementOf<"object"> = {
  id: "o",
  slot: "figure",
  type: "object",
  kind: "ball",
  at: [0, 0],
  size: 1,
};

const param = (id: string, value: number): Param => ({
  id,
  symbol: id,
  label: id,
  unit: "",
  min: 0,
  max: 10,
  step: 0.1,
  default: value,
  role: "quantity",
});

const moveBall: Action = { do: "move", target: "o", to: [1, 1], at: 0 };
const highlight = (id: string): Action => ({ do: "highlight", targets: [id], at: 0 });
const MIDWAY = 9;
const HIGHLIGHTING = 3;
const MOVING = 6;

describe("vector", () => {
  it("ends at the point given by `to`", () => {
    const { container, toPx, ctx } = draw(vector());
    const tip = pointsOf(container.querySelector("polygon")!)[0]!;
    expectPoint(tip, toPx([2, 1]));
    const [start, shaftEnd] = ends(container.querySelector("line")!);
    expectPoint(start, toPx([0, 0]));
    const stop = dist(tip, shaftEnd);
    expect(stop).toBeLessThanOrEqual(ARROW_HEAD_U * ctx.u);
    expect(stop).toBeGreaterThan(0.9 * ARROW_HEAD_U * ctx.u);
  });

  it("ends at the expected pixel with `toward` and `length`", () => {
    const { container, toPx } = draw(vector({ to: undefined, toward: [0, 3], length: 1.5 }));
    expectPoint(pointsOf(container.querySelector("polygon")!)[0], toPx([0, 1.5]));
  });

  it("uses the shaft width of an accent stroke and a solid head", () => {
    const { container, ctx } = draw(vector());
    const shaft = container.querySelector("line")!;
    expect(num(shaft, "stroke-width")).toBeCloseTo(sceneMetrics.stroke.accent * ctx.u);
    const head = container.querySelector("polygon")!;
    expect(head.getAttribute("fill")).toBe(shaft.getAttribute("stroke"));
  });

  it("changes length when a bound parameter changes", () => {
    const bound = vector({ to: undefined, toward: [1, 0], length: { expr: "k" } });
    const tipFor = (k: number) => {
      const { container, scale } = draw(bound, { params: [param("k", 1)], values: { k } });
      return { tip: pointsOf(container.querySelector("polygon")!)[0]!, scale };
    };
    const [short, long] = [tipFor(1), tipFor(3)];
    expect(long.tip[0] - short.tip[0]).toBeCloseTo(2 * short.scale);
  });

  it("starts at the edge of the object it is attached to, and follows it", () => {
    const attached = vector({ from: "o", to: [3, 0] });
    const edgeFrom = (run: ReturnType<typeof draw>, centre: [number, number]) => {
      const clear = run.scale * 0.58 + 0.4 * run.ctx.u;
      const from = run.toPx(centre);
      const to = run.toPx([3, 0]);
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      return [
        from[0] + ((to[0] - from[0]) / length) * clear,
        from[1] + ((to[1] - from[1]) / length) * clear,
      ] as const;
    };
    const first = draw(attached, { others: [ball], frame: 0 });
    expectPoint(ends(first.container.querySelector("line")!)[0], edgeFrom(first, [0, 0]));
    const last = draw(attached, { others: [ball], actions: [moveBall], frame: "end" });
    expectPoint(ends(last.container.querySelector("line")!)[0], edgeFrom(last, [1, 1]));
    const between = draw(attached, { others: [ball], actions: [moveBall], frame: MOVING });
    const origin = ends(between.container.querySelector("line")!)[0];
    expect(origin[0]).toBeGreaterThan(edgeFrom(between, [0, 0])[0]);
    expect(origin[0]).toBeLessThan(edgeFrom(between, [1, 1])[0]);
  });

  it("keeps its tip where the document puts it when it leaves an object", () => {
    const { container, toPx } = draw(vector({ from: "o", to: [3, 0] }), { others: [ball] });
    expectPoint(pointsOf(container.querySelector("polygon")!)[0], toPx([3, 0]));
  });

  it("aims at an object for `toward` and follows it too", () => {
    const aimed = vector({ to: undefined, toward: "o", length: 2 });
    const { container, toPx } = draw(aimed, { others: [{ ...ball, at: [0, 3] }] });
    expectPoint(pointsOf(container.querySelector("polygon")!)[0], toPx([0, 2]));
  });

  it("draws the head alone when shorter than the head", () => {
    const { container, toPx } = draw(vector({ to: [0.05, 0] }));
    expect(container.querySelector("line")).toBeNull();
    expectPoint(pointsOf(container.querySelector("polygon")!)[0], toPx([0.05, 0]));
  });

  it("puts the label beside the tip, off the shaft", () => {
    const { container, ctx, toPx } = draw(vector({ to: [3, 0], label: "F" }));
    const [from] = ends(container.querySelector("line")!);
    const tip = toPx([3, 0]);
    const text = container.querySelector("text")!;
    const centre: P = [num(text, "x"), num(text, "y")];
    const halfHeight = (0.8 * 4 * ctx.u) / 2;
    expect(centre[1] + halfHeight).toBeLessThan(from[1] - ctx.u * sceneMetrics.stroke.accent);
    expect(Math.abs(centre[0] - tip[0])).toBeLessThan(ctx.u * 3);
    expect(text.textContent).toBe("F");
  });

  it("keeps the label clear of a vertical shaft", () => {
    const { container, ctx } = draw(vector({ to: [0, -2], label: "P" }));
    const text = container.querySelector("text")!;
    expect(Math.abs(num(text, "x") - num(container.querySelector("line"), "x1"))).toBeGreaterThan(
      ctx.u * 2,
    );
  });

  it("is traced midway through a draw, head and label last", () => {
    const mid = draw(vector({ label: "F" }), { how: "draw", frame: MIDWAY });
    const shaft = mid.container.querySelector("line")!;
    const [from, to] = ends(shaft);
    const length = num(shaft, "stroke-dasharray");
    expect(length).toBeCloseTo(dist(from, to));
    expect(num(shaft, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(shaft, "stroke-dashoffset")).toBeLessThan(length);
    expect(Number(mid.container.querySelector("polygon")?.getAttribute("opacity"))).toBe(0);
    expect(Number(mid.container.querySelector("text")?.getAttribute("opacity"))).toBe(0);

    const done = draw(vector(), { how: "draw", frame: "end" });
    expect(done.container.querySelector("line")?.getAttribute("stroke-dasharray")).toBeNull();
    expect(done.container.querySelector("polygon")?.getAttribute("opacity")).toBe("1");
  });

  it("is hidden before its `show` action and shown after", () => {
    const element = vector();
    const scene = sceneOf([element], {
      world,
      beats: beatOf([show(["v"], "fade", 0.5)]),
    });
    const before = renderElement(element, testContext({ scene, frame: 0 }));
    expect(before.container.querySelector("g g")?.getAttribute("opacity")).toBe("0");
    const after = renderElement(element, testContext({ scene, frame: "end" }));
    expect(after.container.querySelector("g g")?.getAttribute("opacity")).toBe("1");
  });

  it("adds a result band behind the stroke when highlighted", () => {
    const plain = draw(vector(), { frame: "end" });
    expect(plain.container.querySelectorAll("line")).toHaveLength(1);

    const { container, ctx } = draw(vector(), { actions: [highlight("v")], frame: "end" });
    const lines = [...container.querySelectorAll("line")];
    expect(lines).toHaveLength(2);
    const [band, shaft] = pair(lines);
    expect(band.getAttribute("stroke")).toBe(ctx.theme.role.result);
    expect(num(band, "stroke-width")).toBeCloseTo(1.6 * ctx.u);
    expect(band.getAttribute("stroke-linecap")).toBe("square");
    expect(num(band, "stroke-dashoffset")).toBe(0);
    expect(shaft.getAttribute("stroke")).toBe(ctx.theme.ink);

    const growing = draw(vector(), { actions: [highlight("v")], frame: HIGHLIGHTING });
    const grown = growing.container.querySelector("line")!;
    expect(num(grown, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(grown, "stroke-dashoffset")).toBeLessThan(num(grown, "stroke-dasharray"));
  });

  describe.each(THEME_NAMES)("in the %s theme", (theme) => {
    it("takes its colours from the tokens", () => {
      const tokens = getTheme(theme);
      const ink = draw(vector({ label: "F" }), { theme });
      expect(ink.container.querySelector("line")?.getAttribute("stroke")).toBe(tokens.ink);
      expect(ink.container.querySelector("polygon")?.getAttribute("fill")).toBe(tokens.ink);
      expect(ink.container.querySelector("text")?.getAttribute("fill")).toBe(tokens.ink);

      const action = draw(vector({ role: "action", label: "F" }), { theme });
      expect(action.container.querySelector("line")?.getAttribute("stroke")).toBe(
        tokens.role.action,
      );
      expect(action.container.querySelector("polygon")?.getAttribute("fill")).toBe(
        tokens.role.action,
      );
      expect(action.container.querySelector("text")?.getAttribute("fill")).toBe(
        tokens.role.actionText,
      );
    });
  });
});

describe("segment", () => {
  it("joins its two ends with a regular stroke", () => {
    const { container, toPx, ctx } = draw(segment({ from: [-2, -1], to: [1, 2] }));
    const line = container.querySelector("line")!;
    const [from, to] = ends(line);
    expectPoint(from, toPx([-2, -1]));
    expectPoint(to, toPx([1, 2]));
    expect(num(line, "stroke-width")).toBeCloseTo(sceneMetrics.stroke.regular * ctx.u);
  });

  it("follows an anchor that is being moved", () => {
    const { container, toPx } = draw(segment({ from: "o", to: [3, 0] }), {
      others: [ball],
      actions: [moveBall],
      frame: "end",
    });
    expectPoint(ends(container.querySelector("line")!)[0], toPx([1, 1]));
  });

  it("is dashed on request, with dashes at both ends", () => {
    const { container } = draw(segment({ style: "dashed" }));
    const line = container.querySelector("line")!;
    const [dash, gap] = (line.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number) as [
      number,
      number,
    ];
    const [from, to] = ends(line);
    const count = Math.round((dist(from, to) + gap) / (dash + gap));
    expect(count * dash + (count - 1) * gap).toBeCloseTo(dist(from, to));
    expect(
      draw(segment()).container.querySelector("line")?.getAttribute("stroke-dasharray"),
    ).toBeNull();
  });

  it("sets the label at the midpoint, perpendicular to the line", () => {
    const { container, ctx } = draw(segment({ label: "AB" }));
    const text = container.querySelector("text")!;
    const [from, to] = ends(container.querySelector("line")!);
    expect(num(text, "x")).toBeCloseTo((from[0] + to[0]) / 2);
    expect(from[1] - num(text, "y")).toBeGreaterThanOrEqual(1.6 * ctx.u);
  });

  it("offsets the label of a sloped line perpendicular to it", () => {
    const { container, ctx } = draw(segment({ from: [-2, -1], to: [2, 1], label: "x" }));
    const text = container.querySelector("text")!;
    const [from, to] = ends(container.querySelector("line")!);
    const mid: P = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const offset: P = [num(text, "x") - mid[0], num(text, "y") - mid[1]];
    expect(offset[0] * (to[0] - from[0]) + offset[1] * (to[1] - from[1])).toBeCloseTo(0, 3);
    expect(Math.hypot(...offset)).toBeGreaterThanOrEqual(1.6 * ctx.u);
  });

  it("traces a solid line and clips a dashed one midway through a draw", () => {
    const solid = draw(segment(), { how: "draw", frame: MIDWAY });
    const line = solid.container.querySelector("line")!;
    const length = num(line, "stroke-dasharray");
    expect(num(line, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(line, "stroke-dashoffset")).toBeLessThan(length);

    const dashed = draw(segment({ style: "dashed" }), { how: "draw", frame: MIDWAY });
    const clip = dashed.container.querySelector("clipPath polygon")!;
    const xs = pointsOf(clip).map((point) => point[0]);
    const [from, to] = ends(dashed.container.querySelector("line")!);
    expect(Math.min(...xs)).toBeCloseTo(from[0]);
    expect(Math.max(...xs)).toBeGreaterThan(from[0]);
    expect(Math.max(...xs)).toBeLessThan(to[0]);
    const id = dashed.container.querySelector("clipPath")!.id;
    expect(dashed.container.querySelector("line")?.getAttribute("clip-path")).toBe(`url(#${id})`);
  });

  it("is hidden at the start and complete at the end", () => {
    expect(
      draw(segment(), { frame: 0 }).container.querySelector("g g")?.getAttribute("opacity"),
    ).toBe("0");
    expect(
      draw(segment(), { frame: "end" }).container.querySelector("g g")?.getAttribute("opacity"),
    ).toBe("1");
  });

  it("adds a band behind the stroke when highlighted", () => {
    const { container, ctx } = draw(segment(), { actions: [highlight("s")], frame: "end" });
    const [band, line] = pair([...container.querySelectorAll("line")]);
    expect(band.getAttribute("stroke")).toBe(ctx.theme.role.result);
    expect(num(band, "stroke-width")).toBeCloseTo(1.6 * ctx.u);
    expect(line.getAttribute("stroke")).toBe(ctx.theme.ink);
  });

  describe.each(THEME_NAMES)("in the %s theme", (theme) => {
    it("takes its colours from the tokens", () => {
      const tokens = getTheme(theme);
      const ink = draw(segment({ label: "x" }), { theme });
      expect(ink.container.querySelector("line")?.getAttribute("stroke")).toBe(tokens.ink);
      const valid = draw(segment({ role: "valid", label: "x" }), { theme });
      expect(valid.container.querySelector("line")?.getAttribute("stroke")).toBe(tokens.role.valid);
      expect(valid.container.querySelector("text")?.getAttribute("fill")).toBe(tokens.role.valid);
    });
  });
});

describe("dimension", () => {
  const rules = (container: HTMLElement) => [...container.querySelectorAll("line")].map(ends);
  const parallelTo = (a: P, b: P) => (line: [P, P]) =>
    Math.abs(
      (line[1][0] - line[0][0]) * (b[1] - a[1]) - (line[1][1] - line[0][1]) * (b[0] - a[0]),
    ) < 1e-6;

  it("draws a line parallel to the measured segment, below by default", () => {
    const { container, toPx, scale } = draw(dimension());
    const [a, b] = [toPx([-2, 0]), toPx([2, 0])];
    const pieces = rules(container).filter(parallelTo(a, b));
    expect(pieces).toHaveLength(2);
    const expected = Math.abs(DIMENSION_OFFSET) * 6 * scale;
    for (const [from, to] of pieces) {
      expect(from[1]).toBeCloseTo(a[1] + expected);
      expect(to[1]).toBeCloseTo(a[1] + expected);
    }
  });

  it("stays parallel and offset by the same distance on a sloped segment", () => {
    const { container, toPx, scale } = draw(dimension({ from: [-2, -1], to: [2, 1] }));
    const [a, b] = [toPx([-2, -1]), toPx([2, 1])];
    const pieces = rules(container).filter(parallelTo(a, b));
    expect(pieces).toHaveLength(2);
    const length = dist(a, b);
    const normal: P = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
    for (const [from, to] of pieces) {
      for (const end of [from, to]) {
        const away = (end[0] - a[0]) * normal[0] + (end[1] - a[1]) * normal[1];
        expect(Math.abs(away)).toBeCloseTo(Math.abs(DIMENSION_OFFSET) * 6 * scale);
      }
      const lineY = (x: number) => a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
      expect(from[1]).toBeGreaterThan(lineY(from[0]));
    }
  });

  it("goes above for a positive offset and to the right of a vertical segment by default", () => {
    const above = draw(dimension({ offset: 1 }));
    const a = above.toPx([-2, 0]);
    const piece = rules(above.container).find(parallelTo(a, above.toPx([2, 0])))!;
    expect(piece[0][1]).toBeCloseTo(a[1] - above.scale);

    const vertical = draw(dimension({ from: [0, -2], to: [0, 2] }));
    const bottom = vertical.toPx([0, -2]);
    const upright = rules(vertical.container).find(parallelTo(bottom, vertical.toPx([0, 2])))!;
    expect(upright[0][0]).toBeGreaterThan(bottom[0]);
    const reversed = draw(dimension({ from: [0, 2], to: [0, -2] }));
    const flipped = rules(reversed.container).find(parallelTo(bottom, reversed.toPx([0, 2])))!;
    expect(flipped[0][0]).toBeGreaterThan(bottom[0]);
  });

  it("measures from an anchor that is being moved", () => {
    const { container, toPx } = draw(dimension({ from: "o", to: [4, 0] }), {
      others: [ball],
      actions: [moveBall],
      frame: "end",
    });
    const pieces = rules(container).filter(parallelTo(toPx([1, 1]), toPx([4, 0])));
    expect(pieces).toHaveLength(2);
  });

  it("draws two extension lines from the measured points and two end ticks", () => {
    const { container, toPx, ctx, scale } = draw(dimension());
    const [a, b] = [toPx([-2, 0]), toPx([2, 0])];
    const all = rules(container);
    const extensions = all.filter(([from, to]) => Math.abs(from[0] - to[0]) < 1e-6);
    expect(extensions).toHaveLength(2);
    for (const point of [a, b]) {
      const line = extensions.find(([from]) => Math.abs(from[0] - point[0]) < 1e-6)!;
      expect(dist(line[0], point)).toBeLessThanOrEqual(ctx.u);
      expect(line[1][1]).toBeGreaterThan(a[1] + Math.abs(DIMENSION_OFFSET) * 6 * scale - 1);
    }
    const ticks = all.filter(
      ([from, to]) => Math.abs(Math.abs(to[0] - from[0]) - Math.abs(to[1] - from[1])) < 1e-6,
    );
    expect(ticks).toHaveLength(2);
    expect(dist(...(ticks[0] as [P, P]))).toBeLessThan(3 * ctx.u);
  });

  it("centres an italic label on the line and interrupts the line behind it", () => {
    const { container, toPx, ctx } = draw(dimension({ label: "ab" }));
    const [a, b] = [toPx([-2, 0]), toPx([2, 0])];
    const text = container.querySelector("text")!;
    const pieces = rules(container).filter(parallelTo(a, b));
    expect(num(text, "x")).toBeCloseTo((a[0] + b[0]) / 2);
    expect(num(text, "y")).toBeCloseTo(pieces[0]![0][1]);
    expect(text.getAttribute("font-style")).toBe("italic");
    expect(text.getAttribute("font-family")).toBe(fontStacks.text);
    const [first, second] = pieces as [[P, P], [P, P]];
    const inner = Math.abs(second[0][0] - first[1][0]);
    expect(inner).toBeGreaterThan(2 * 0.5 * 4 * ctx.u);
    expect(first[0][0]).toBeCloseTo(a[0]);
    expect(second[1][0]).toBeCloseTo(b[0]);
  });

  it("keeps the line whole and moves the label beside it when it does not fit", () => {
    const { container, toPx } = draw(dimension({ from: [0, 0], to: [0.3, 0], label: "abcd" }));
    const [a, b] = [toPx([0, 0]), toPx([0.3, 0])];
    const pieces = rules(container).filter(parallelTo(a, b));
    expect(pieces).toHaveLength(1);
    expect(num(container.querySelector("text"), "y")).toBeGreaterThan(pieces[0]![0][1]);
  });

  it("is drawn without label or gap when there is no label", () => {
    const { container, toPx } = draw(dimension({ label: undefined }));
    expect(container.querySelector("text")).toBeNull();
    const pieces = rules(container).filter(parallelTo(toPx([-2, 0]), toPx([2, 0])));
    expect(pieces).toHaveLength(1);
  });

  it("traces its lines midway through a draw and shows the label afterwards", () => {
    const mid = draw(dimension(), { how: "draw", frame: MIDWAY });
    const dashed = [...mid.container.querySelectorAll("line")].filter((line) =>
      line.hasAttribute("stroke-dasharray"),
    );
    expect(dashed.length).toBeGreaterThan(0);
    expect(Number(mid.container.querySelector("text")?.getAttribute("opacity"))).toBe(0);
    const done = draw(dimension(), { how: "draw", frame: "end" });
    expect(done.container.querySelectorAll("line[stroke-dasharray]")).toHaveLength(0);
    expect(done.container.querySelector("text")?.getAttribute("opacity")).toBe("1");
  });

  it("is hidden at the start", () => {
    const { container } = draw(dimension(), { frame: 0 });
    expect(container.querySelector("g g")?.getAttribute("opacity")).toBe("0");
  });

  it("adds a band on each side of the label when highlighted", () => {
    const { container, ctx } = draw(dimension(), { actions: [highlight("d")], frame: "end" });
    const bands = [...container.querySelectorAll("line")].filter(
      (line) => line.getAttribute("stroke") === ctx.theme.role.result,
    );
    expect(bands).toHaveLength(2);
    expect(num(bands[0], "stroke-width")).toBeCloseTo(1.6 * ctx.u);
  });

  describe.each(THEME_NAMES)("in the %s theme", (theme) => {
    it("takes its colours from the tokens", () => {
      const tokens = getTheme(theme);
      const quantity = draw(dimension(), { theme });
      for (const line of quantity.container.querySelectorAll("line")) {
        expect(line.getAttribute("stroke")).toBe(tokens.role.quantity);
      }
      expect(quantity.container.querySelector("text")?.getAttribute("fill")).toBe(
        tokens.role.quantity,
      );
      const ink = draw(dimension({ role: "ink" }), { theme });
      expect(ink.container.querySelector("line")?.getAttribute("stroke")).toBe(tokens.ink);
    });
  });
});

describe("angle", () => {
  const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

  it("spans the angle between its two directions with an arc of about 3 units", () => {
    const sixty: P = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)];
    const { container, toPx, ctx } = draw(
      angle({ from: [2, 0], to: [2 * sixty[0], 2 * sixty[1]] }),
    );
    const arc = arcOf(container.querySelector("path")!.getAttribute("d"));
    const vertex = toPx([0, 0]);
    const spoke = (p: P): P => [p[0] - vertex[0], p[1] - vertex[1]];
    expect(toDegrees(angleBetween(spoke(arc.start), spoke(arc.end)))).toBeCloseTo(60);
    expect(arc.radius).toBeCloseTo(3 * ctx.u);
    expect(dist(arc.start, vertex)).toBeCloseTo(3 * ctx.u);
    expect(dist(arc.end, vertex)).toBeCloseTo(3 * ctx.u);
    expect(arc.large).toBe(0);
    expectPoint(arc.start, [vertex[0] + 3 * ctx.u, vertex[1]]);
  });

  it("opens the arc wider on a narrow angle", () => {
    const thirty = (Math.PI * 30) / 180;
    const { container, ctx } = draw(
      angle({ from: [4, 0], to: [4 * Math.cos(thirty), 4 * Math.sin(thirty)] }),
    );
    const arc = arcOf(container.querySelector("path")!.getAttribute("d"));
    expect(arc.radius).toBeGreaterThan(3 * ctx.u);
    expect(arc.radius).toBeLessThanOrEqual(5 * ctx.u);
  });

  it("sweeps the other way when the directions are swapped", () => {
    const forward = arcOf(
      draw(angle({ from: [2, 0], to: [1, 1] }))
        .container.querySelector("path")!
        .getAttribute("d"),
    );
    const backward = arcOf(
      draw(angle({ from: [1, 1], to: [2, 0] }))
        .container.querySelector("path")!
        .getAttribute("d"),
    );
    expect(forward.sweep).not.toBe(backward.sweep);
  });

  it("takes the smaller angle across the horizontal axis", () => {
    const ten = (Math.PI * 10) / 180;
    const { container, toPx } = draw(
      angle({
        from: [2 * Math.cos(ten), 2 * Math.sin(ten)],
        to: [2 * Math.cos(-ten), 2 * Math.sin(-ten)],
      }),
    );
    const arc = arcOf(container.querySelector("path")!.getAttribute("d"));
    const vertex = toPx([0, 0]);
    const spoke = (p: P): P => [p[0] - vertex[0], p[1] - vertex[1]];
    expect(toDegrees(angleBetween(spoke(arc.start), spoke(arc.end)))).toBeCloseTo(20);
    expect(arc.large).toBe(0);
  });

  it("draws a small square for a right angle", () => {
    const { container, toPx, ctx } = draw(angle());
    const d = container.querySelector("path")!.getAttribute("d")!;
    expect(d).not.toContain("A");
    const [first, corner, last] = d
      .replace("M ", "")
      .split(" L ")
      .map((pair) => pair.split(" ").map(Number) as unknown as P) as [P, P, P];
    const vertex = toPx([0, 0]);
    const side = dist(first, corner);
    expect(side).toBeGreaterThan(ctx.u);
    expect(side).toBeLessThan(3 * ctx.u);
    expect(dist(corner, last)).toBeCloseTo(side);
    expectPoint(first, [vertex[0] + side, vertex[1]]);
    expectPoint(last, [vertex[0], vertex[1] - side]);
    expectPoint(corner, [vertex[0] + side, vertex[1] - side]);
  });

  it("recognises a right angle between any two directions", () => {
    const { container } = draw(angle({ from: [2, 2], to: [-2, 2] }));
    expect(container.querySelector("path")?.getAttribute("d")).not.toContain("A");
  });

  it("puts the label on the bisector, outside the arc", () => {
    const { container, toPx, ctx } = draw(angle({ from: [2, 0], to: [0, 2], label: "x" }));
    const vertex = toPx([0, 0]);
    const text = container.querySelector("text")!;
    const offset: P = [num(text, "x") - vertex[0], num(text, "y") - vertex[1]];
    expect(offset[0]).toBeCloseTo(-offset[1]);
    expect(Math.hypot(...offset)).toBeGreaterThan(3 * ctx.u);

    const sixty = draw(angle({ from: [2, 0], to: [1, 1.7320508], label: "α" }));
    const apex = sixty.toPx([0, 0]);
    const label = sixty.container.querySelector("text")!;
    const direction: P = [num(label, "x") - apex[0], num(label, "y") - apex[1]];
    expect(toDegrees(Math.atan2(-direction[1], direction[0]))).toBeCloseTo(30, 0);
    expect(Math.hypot(...direction)).toBeGreaterThan(3 * ctx.u);
  });

  it("keeps the label of a narrow angle clear of both legs", () => {
    const ten = (Math.PI * 10) / 180;
    const { container, toPx, ctx } = draw(
      angle({ from: [4, 0], to: [4 * Math.cos(ten), 4 * Math.sin(ten)], label: "α" }),
    );
    const vertex = toPx([0, 0]);
    const text = container.querySelector("text")!;
    const centre: P = [num(text, "x") - vertex[0], num(text, "y") - vertex[1]];
    const nearLeg = Math.abs(centre[1]);
    const farLeg = Math.abs(centre[0] * Math.sin(ten) + centre[1] * Math.cos(ten));
    const half = (0.5 * 4 * ctx.u * 0.8) / 2;
    expect(nearLeg).toBeGreaterThan(half);
    expect(farLeg).toBeGreaterThan(half);
  });

  it("follows its vertex when it is moved", () => {
    const { container, toPx, ctx } = draw(angle({ vertex: "o", from: [3, 0], to: [0, 3] }), {
      others: [ball],
      actions: [moveBall],
      frame: "end",
    });
    const arc = arcOf(container.querySelector("path")!.getAttribute("d"));
    const vertex = toPx([1, 1]);
    expect(dist(arc.start, vertex)).toBeCloseTo(3 * ctx.u);
    expect(dist(arc.end, vertex)).toBeCloseTo(3 * ctx.u);
    const toward = toPx([3, 0]);
    expect(
      angleBetween(
        [arc.start[0] - vertex[0], arc.start[1] - vertex[1]],
        [toward[0] - vertex[0], toward[1] - vertex[1]],
      ),
    ).toBeCloseTo(0);
  });

  it("traces the arc midway through a draw and hides at the start", () => {
    const mid = draw(angle({ to: [1, 1] }), { how: "draw", frame: MIDWAY });
    const path = mid.container.querySelector("path")!;
    expect(num(path, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(path, "stroke-dashoffset")).toBeLessThan(num(path, "stroke-dasharray"));
    expect(
      draw(angle(), { frame: 0 }).container.querySelector("path")?.getAttribute("opacity"),
    ).toBe("0");
  });

  describe.each(THEME_NAMES)("in the %s theme", (theme) => {
    it("takes its colours from the tokens", () => {
      const tokens = getTheme(theme);
      const ink = draw(angle({ label: "x" }), { theme });
      expect(ink.container.querySelector("path")?.getAttribute("stroke")).toBe(tokens.ink);
      const quantity = draw(angle({ role: "quantity", label: "x" }), { theme });
      expect(quantity.container.querySelector("path")?.getAttribute("stroke")).toBe(
        tokens.role.quantity,
      );
      expect(quantity.container.querySelector("text")?.getAttribute("fill")).toBe(
        tokens.role.quantity,
      );
    });
  });
});

describe("shape", () => {
  it("draws a circle at its centre with its radius", () => {
    const { container, toPx, scale, ctx } = draw(shape({ center: [1, -1], radius: 1.5 }));
    const circle = container.querySelector("circle")!;
    expectPoint([num(circle, "cx"), num(circle, "cy")], toPx([1, -1]));
    expect(num(circle, "r")).toBeCloseTo(1.5 * scale);
    expect(circle.getAttribute("fill")).toBe("none");
    expect(circle.getAttribute("stroke")).toBe(ctx.theme.ink);
    expect(num(circle, "stroke-width")).toBeCloseTo(sceneMetrics.stroke.regular * ctx.u);
  });

  it("draws a rectangle from its centre, width and height", () => {
    const { container, toPx, scale } = draw(
      shape({ kind: "rect", center: [0, 1], width: 3, height: 1, radius: undefined }),
    );
    const rect = container.querySelector("rect")!;
    expectPoint([num(rect, "x"), num(rect, "y")], toPx([-1.5, 1.5]));
    expect(num(rect, "width")).toBeCloseTo(3 * scale);
    expect(num(rect, "height")).toBeCloseTo(1 * scale);
  });

  it("draws a polygon through its points", () => {
    const points: [number, number][] = [
      [-2, -1],
      [2, -1],
      [2, 1],
    ];
    const { container, toPx } = draw(
      shape({ kind: "polygon", points, center: undefined, radius: undefined }),
    );
    const drawn = pointsOf(container.querySelector("polygon")!);
    expect(drawn).toHaveLength(3);
    points.forEach((point, i) => expectPoint(drawn[i], toPx(point)));
  });

  it("evaluates bound dimensions", () => {
    const bound = shape({ radius: { expr: "k" } });
    const small = draw(bound, { params: [param("k", 1)], values: { k: 1 } });
    const large = draw(bound, { params: [param("k", 1)], values: { k: 2 } });
    expect(num(large.container.querySelector("circle"), "r")).toBeCloseTo(
      2 * num(small.container.querySelector("circle"), "r"),
    );
  });

  it("draws an arc counter-clockwise from its start angle to its end angle", () => {
    const { container, toPx, scale } = draw(
      shape({ kind: "arc", center: [0, 0], radius: 2, startDeg: 30, endDeg: 120 }),
    );
    const arc = arcOf(container.querySelector("path")!.getAttribute("d"));
    const at = (deg: number): [number, number] => [
      2 * Math.cos((deg * Math.PI) / 180),
      2 * Math.sin((deg * Math.PI) / 180),
    ];
    expectPoint(arc.start, toPx(at(30)));
    expectPoint(arc.end, toPx(at(120)));
    expect(arc.radius).toBeCloseTo(2 * scale);
    expect(arc.sweep).toBe(0);
    expect(arc.large).toBe(0);
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("none");
  });

  it("wraps an arc across zero and flags a large arc", () => {
    const wrapped = draw(
      shape({ kind: "arc", center: [0, 0], radius: 2, startDeg: 300, endDeg: 100 }),
    );
    const arc = arcOf(wrapped.container.querySelector("path")!.getAttribute("d"));
    expect(arc.large).toBe(0);
    const rad = (deg: number): number => (deg * Math.PI) / 180;
    expectPoint(arc.start, wrapped.toPx([2 * Math.cos(rad(300)), 2 * Math.sin(rad(300))]));
    expectPoint(arc.end, wrapped.toPx([2 * Math.cos(rad(100)), 2 * Math.sin(rad(100))]));

    const wide = draw(shape({ kind: "arc", center: [0, 0], radius: 2, startDeg: 10, endDeg: 250 }));
    expect(arcOf(wide.container.querySelector("path")!.getAttribute("d")).large).toBe(1);
  });

  it("closes a filled arc into a sector and draws a full turn as a circle", () => {
    const sector = draw(
      shape({ kind: "arc", center: [0, 0], radius: 2, startDeg: 0, endDeg: 60, fill: "hatch" }),
    );
    const paths = [...sector.container.querySelectorAll("path")];
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const d = path.getAttribute("d")!;
      expect(d.startsWith(`M ${sector.toPx([0, 0]).join(" ")} L`)).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
    }
    const full = draw(shape({ kind: "arc", center: [0, 0], radius: 2, startDeg: 0, endDeg: 360 }));
    expect(full.container.querySelector("path")).toBeNull();
    expect(num(full.container.querySelector("circle"), "r")).toBeCloseTo(2 * full.scale);
  });

  it("references a hatch pattern declared in its own group", () => {
    const { container, ctx } = draw(shape({ id: "disc", fill: "hatch" }));
    const pattern = container.querySelector("pattern")!;
    expect(pattern.id).toBe(hatchId("disc"));
    const group = pattern.closest("g")!;
    const filled = group.querySelectorAll(`[fill="url(#${hatchId("disc")})"]`);
    expect(filled).toHaveLength(1);
    expect(group.querySelector("defs")?.contains(pattern)).toBe(true);
    const stroke = group.querySelector("circle:not([fill^='url'])")!;
    expect(stroke.getAttribute("fill")).toBe("none");
    expect(stroke.getAttribute("stroke")).toBe(ctx.theme.ink);
  });

  it("fills with a flat role colour behind an ink outline", () => {
    const { container, ctx } = draw(shape({ fill: "valid" }));
    const [fill, outline] = pair([...container.querySelectorAll("circle")]);
    expect(fill.getAttribute("fill")).toBe(ctx.theme.role.valid);
    expect(fill.getAttribute("stroke")).toBeNull();
    expect(outline.getAttribute("fill")).toBe("none");
    expect(outline.getAttribute("stroke")).toBe(ctx.theme.ink);
  });

  it("keeps the outline in ink for a result fill", () => {
    const { container, ctx } = draw(shape({ fill: "result" }));
    const [fill, outline] = pair([...container.querySelectorAll("circle")]);
    expect(fill.getAttribute("fill")).toBe(ctx.theme.role.result);
    expect(outline.getAttribute("stroke")).toBe(ctx.theme.ink);
    const asRole = draw(shape({ role: "result" }));
    expect(asRole.container.querySelector("circle[stroke]")?.getAttribute("stroke")).toBe(
      asRole.ctx.theme.ink,
    );
    expect(asRole.container.querySelector("circle:not([stroke])")?.getAttribute("fill")).toBe(
      asRole.ctx.theme.role.result,
    );
  });

  it("fills with result when highlighted, wiping across the shape", () => {
    const plain = draw(shape(), { frame: "end" });
    expect(plain.container.querySelectorAll("circle")).toHaveLength(1);

    const { container, ctx, scale } = draw(shape(), { actions: [highlight("f")], frame: "end" });
    const circles = [...container.querySelectorAll("circle")];
    expect(circles).toHaveLength(2);
    expect(circles[0]?.getAttribute("fill")).toBe(ctx.theme.role.result);
    expect(circles[1]?.getAttribute("fill")).toBe("none");
    expect(num(container.querySelector("clipPath rect"), "width")).toBeCloseTo(3 * scale);

    const growing = draw(shape(), { actions: [highlight("f")], frame: HIGHLIGHTING });
    const wipe = num(growing.container.querySelector("clipPath rect"), "width");
    expect(wipe).toBeGreaterThan(0);
    expect(wipe).toBeLessThan(3 * scale);
  });

  it("puts the label at the centre of a filled shape", () => {
    const { container, toPx } = draw(shape({ center: [1, 0], fill: "hatch", label: "S" }));
    const text = container.querySelector("text")!;
    expectPoint([num(text, "x"), num(text, "y")], toPx([1, 0]));
  });

  it("puts the label of an outline just outside it", () => {
    const circle = draw(shape({ label: "C" }));
    const top = circle.toPx([0, 1.5])[1];
    const text = circle.container.querySelector("text")!;
    expect(num(text, "y")).toBeLessThan(top);
    expect(num(text, "x")).toBeCloseTo(circle.toPx([0, 0])[0]);

    const rect = draw(
      shape({ kind: "rect", center: [0, 0], width: 2, height: 1, radius: undefined, label: "R" }),
    );
    expect(num(rect.container.querySelector("text"), "y")).toBeLessThan(rect.toPx([0, 0.5])[1]);

    const triangle = draw(
      shape({
        kind: "polygon",
        points: [
          [-1, -1],
          [1, -1],
          [0, 1],
        ],
        center: undefined,
        radius: undefined,
        label: "T",
      }),
    );
    const apex = triangle.toPx([0, 1]);
    const label = triangle.container.querySelector("text")!;
    expect(num(label, "y")).toBeLessThan(apex[1]);
    expect(num(label, "x")).toBeCloseTo(apex[0]);

    const arc = draw(
      shape({ kind: "arc", center: [0, 0], radius: 2, startDeg: 0, endDeg: 90, label: "A" }),
    );
    const outside = arc.container.querySelector("text")!;
    expect(
      Math.hypot(num(outside, "x") - arc.toPx([0, 0])[0], num(outside, "y") - arc.toPx([0, 0])[1]),
    ).toBeGreaterThan(2 * arc.scale);
  });

  it("follows a move of its own", () => {
    const { container, toPx } = draw(shape({ id: "o", center: [0, 0] }), {
      actions: [moveBall],
      frame: "end",
    });
    const circle = container.querySelector("circle")!;
    expectPoint([num(circle, "cx"), num(circle, "cy")], toPx([1, 1]));
  });

  it("is an anchor that segments follow while it moves", () => {
    const block = shape({
      id: "o",
      kind: "rect",
      center: [0, 0],
      width: 1,
      height: 1,
      radius: undefined,
    });
    const { container, toPx } = draw(segment({ from: "o", to: [3, 0] }), {
      others: [block],
      actions: [moveBall],
      frame: "end",
    });
    expectPoint(ends(container.querySelector("line")!)[0], toPx([1, 1]));
  });

  it("traces the outline midway through a draw, then shows the fill", () => {
    const mid = draw(shape({ fill: "hatch" }), { how: "draw", frame: MIDWAY });
    const outline = [...mid.container.querySelectorAll("circle")].find(
      (c) => c.getAttribute("fill") === "none",
    )!;
    expect(num(outline, "stroke-dasharray")).toBeCloseTo(2 * Math.PI * 1.5 * mid.scale);
    expect(num(outline, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(outline, "stroke-dashoffset")).toBeLessThan(num(outline, "stroke-dasharray"));
    const hatched = mid.container.querySelector("circle[fill^='url']")!;
    expect(Number(hatched.getAttribute("fill-opacity"))).toBeLessThan(1);

    const done = draw(shape({ fill: "hatch" }), { how: "draw", frame: "end" });
    expect(done.container.querySelector("circle[stroke-dasharray]")).toBeNull();
    expect(done.container.querySelector("circle[fill^='url']")?.getAttribute("fill-opacity")).toBe(
      "1",
    );
  });

  it("is hidden at the start", () => {
    expect(
      draw(shape(), { frame: 0 }).container.querySelector("g g")?.getAttribute("opacity"),
    ).toBe("0");
  });

  describe.each(THEME_NAMES)("in the %s theme", (theme) => {
    it("takes its colours from the tokens", () => {
      const tokens = getTheme(theme);
      const outline = draw(shape({ role: "quantity", label: "C" }), { theme });
      expect(outline.container.querySelector("circle")?.getAttribute("stroke")).toBe(
        tokens.role.quantity,
      );
      expect(outline.container.querySelector("text")?.getAttribute("fill")).toBe(
        tokens.role.quantity,
      );
      const hatch = draw(shape({ fill: "hatch" }), { theme });
      expect(hatch.container.querySelector("pattern line")?.getAttribute("stroke")).toBe(
        tokens.inkSoft,
      );
      const flat = draw(shape({ fill: "action" }), { theme });
      expect(flat.container.querySelector("circle")?.getAttribute("fill")).toBe(tokens.role.action);
    });
  });
});

describe("unresolved geometry", () => {
  it("draws nothing for an anchor that does not exist", () => {
    for (const element of [
      segment({ from: "ghost" }),
      vector({ from: "ghost" }),
      vector({ to: undefined, toward: "ghost", length: 1 }),
      dimension({ to: "ghost" }),
      angle({ vertex: "ghost" }),
    ]) {
      expect(draw(element).container.querySelector("svg")?.childElementCount).toBe(0);
    }
  });

  it("draws nothing for a shape without its dimensions", () => {
    const { container } = draw(shape({ radius: undefined }));
    expect(container.querySelector("svg")?.childElementCount).toBe(0);
  });

  it("draws nothing without a world frame", () => {
    const element = segment();
    const scene = sceneOf([element]);
    const { container } = renderElement(element, testContext({ scene }));
    expect(container.querySelector("svg")?.childElementCount).toBe(0);
  });
});
