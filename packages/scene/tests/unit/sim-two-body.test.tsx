// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PictogramProps } from "../../src/pictograms";
import {
  ratioOf,
  twoBodyLayout,
  type TwoBodyGeometry,
  type TwoBodyRatios,
} from "../../src/primitives/sim/two-body-layout";
import type { ElementOf, Model, Param, Scene } from "../../src/schema/document";
import type { ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext } from "../helpers/scene";

vi.mock("../../src/pictograms", async () => {
  const { createElement } = await import("react");
  return {
    Pictogram: ({ kind, x, y, size, opacity }: PictogramProps) =>
      createElement("circle", { "data-kind": kind, cx: x, cy: y, r: size / 2, opacity }),
  };
});

const param = (id: string, symbol: string, min: number, max: number, value: number): Param => ({
  id,
  symbol,
  label: id,
  unit: "",
  min,
  max,
  step: min,
  default: value,
  role: "quantity",
});

const PLANETS: Param[] = [
  param("m1", "m₁", 1e24, 1.2e25, 5.97e24),
  param("m2", "m₂", 1e22, 1.5e23, 7.35e22),
  param("r", "r", 1.5e8, 8e8, 3.84e8),
];
const ATOM: Param[] = [
  param("m1", "m₁", 1e-31, 1.2e-30, 9.11e-31),
  param("m2", "m₂", 1e-28, 1.5e-26, 1.67e-27),
  param("r", "r", 1.5e-11, 2e-10, 5.3e-11),
];
const GRAVITATION: Model = {
  constants: [{ id: "G", value: 6.674e-11, unit: "N·m²/kg²", label: "G" }],
  derived: [{ id: "F", expr: "G * m1 * m2 / r^2", unit: "N", label: "Force" }],
};

type TwoBody = ElementOf<"sim.two-body">;
const SYSTEM: TwoBody = {
  id: "sys",
  slot: "figure",
  type: "sim.two-body",
  massA: { expr: "m1" },
  massB: { expr: "m2" },
  distance: { expr: "r" },
  force: { expr: "F" },
  labelA: "Terre",
  labelB: "Lune",
};

const showing = (targets: string[], how: "fade" | "draw" = "fade"): Scene["beats"] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [{ do: "show", targets, how, at: 0 }],
  },
];

interface Setup {
  element?: TwoBody;
  params?: Param[];
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
}

function setup({ element = SYSTEM, params = PLANETS, ...rest }: Setup = {}) {
  const scene = sceneOf([element], { beats: rest.beats });
  const ctx = testContext({
    scene,
    params,
    model: GRAVITATION,
    values: rest.values,
    theme: rest.theme,
    frame: rest.frame,
  });
  return { ctx, ...renderElement(element, ctx) };
}

const num = (element: Element | null | undefined, name: string): number => {
  if (!element) throw new Error(`missing element for ${name}`);
  return Number(element.getAttribute(name));
};
const part = (container: Element, name: string): Element | null =>
  container.querySelector(`[data-part="${name}"]`);
const body = (container: Element, kind: string): Element | null =>
  container.querySelector(`circle[data-kind="${kind}"]`);
const polygonPoints = (group: Element): [number, number][] =>
  (group.querySelector("polygon")?.getAttribute("points") ?? "")
    .split(" ")
    .map((pair) => pair.split(",").map(Number) as [number, number]);

function arrowOf(container: Element, name: string) {
  const group = part(container, name);
  if (!group) throw new Error(`no ${name}`);
  const [tip] = polygonPoints(group);
  const from = num(group.querySelector("line"), "x1");
  return { from, tip: tip![0], length: Math.abs(tip![0] - from) };
}

function dimensionOf(container: Element) {
  const group = part(container, "distance");
  if (!group) throw new Error("no distance");
  const line = [...group.querySelectorAll("line")].find(
    (candidate) => candidate.getAttribute("y1") === candidate.getAttribute("y2"),
  );
  return {
    left: num(line, "x1"),
    right: num(line, "x2"),
    y: num(line, "y1"),
    label: group.querySelector("text"),
  };
}

const unit = { massA: 1, massB: 1, distance: 1, force: 1 };
const SLOTS = [
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
];
const U = 16;
const CAP_HALF_HEIGHT = 1.4 * U;

function inside(geometry: TwoBodyGeometry, slot: { width: number; height: number }) {
  const { a, b, arrowA, arrowB, dimension } = geometry;
  for (const { x, y, radius } of [a, b]) {
    expect(x - radius).toBeGreaterThanOrEqual(0);
    expect(x + radius).toBeLessThanOrEqual(slot.width);
    expect(y - radius).toBeGreaterThanOrEqual(0);
    expect(y + radius).toBeLessThanOrEqual(slot.height);
  }
  for (const arrow of [arrowA, arrowB]) {
    for (const x of [arrow.from[0], arrow.tip[0], arrow.label[0]]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(slot.width);
    }
    expect(arrow.label[1] + 2 * U).toBeLessThanOrEqual(slot.height);
  }
  expect(dimension.left).toBeGreaterThanOrEqual(0);
  expect(dimension.right).toBeLessThanOrEqual(slot.width);
  expect(dimension.label[1] + 2 * U).toBeLessThanOrEqual(slot.height);
  expect(a.name[1] - CAP_HALF_HEIGHT).toBeGreaterThanOrEqual(0);
  expect(b.name[1] - CAP_HALF_HEIGHT).toBeGreaterThanOrEqual(0);
}

describe("two-body layout", () => {
  it("matches the reference proportions at the reference values", () => {
    for (const slot of SLOTS.slice(0, 2)) {
      const layout = twoBodyLayout(slot, U, unit);
      expect(layout.axisY).toBeCloseTo(slot.height / 3, 6);
      expect(layout.a.y).toBe(layout.axisY);
      expect(layout.b.y).toBe(layout.axisY);
      expect(layout.a.radius * 2).toBeCloseTo(0.22 * slot.height, 6);
      expect(layout.b.radius * 2).toBeCloseTo(0.12 * slot.height, 6);
      expect(layout.separation).toBeCloseTo(0.36 * slot.width, 6);
      expect(layout.b.x - layout.a.x).toBeCloseTo(layout.separation, 6);
      expect(layout.a.x + layout.b.x).toBeCloseTo(slot.width, 6);
      expect(layout.arrowA.length).toBeCloseTo(0.11 * slot.width, 6);
      expect(layout.dimension.y).toBeGreaterThan(layout.axisY + layout.a.radius);
      expect(layout.dimension.label[0]).toBeCloseTo(slot.width / 2, 6);
    }
  });

  it("shrinks the bodies in a narrow slot so that the arrows keep their reference length", () => {
    const slot = SLOTS[2]!;
    const layout = twoBodyLayout(slot, U, unit);
    expect(layout.separation).toBeCloseTo(0.36 * slot.width, 6);
    expect(layout.arrowA.length).toBeCloseTo(0.11 * slot.width, 6);
    expect(layout.a.radius * 2).toBeLessThan(0.22 * slot.height);
  });

  it("starts each arrow at the edge of its body, pointing at the other", () => {
    const layout = twoBodyLayout(SLOTS[0]!, U, unit);
    expect(layout.arrowA.from[0]).toBeCloseTo(layout.a.x + layout.a.radius, 6);
    expect(layout.arrowB.from[0]).toBeCloseTo(layout.b.x - layout.b.radius, 6);
    expect(layout.arrowA.direction).toBe(1);
    expect(layout.arrowB.direction).toBe(-1);
    expect(layout.arrowA.tip[0]).toBeGreaterThan(layout.arrowA.from[0]);
    expect(layout.arrowB.tip[0]).toBeLessThan(layout.arrowB.from[0]);
  });

  it("doubles the separation and divides the arrow by four when the distance doubles", () => {
    const [m1, m2, r] = [5.97e24, 7.35e22, 3.84e8];
    const force = (distance: number) => (6.674e-11 * m1 * m2) / distance ** 2;
    const slot = SLOTS[0]!;
    const near = twoBodyLayout(slot, U, { ...unit, force: ratioOf(force(r), force(r)) });
    const far = twoBodyLayout(slot, U, {
      ...unit,
      distance: ratioOf(2 * r, r),
      force: ratioOf(force(2 * r), force(r)),
    });
    expect(far.separation / near.separation).toBeCloseTo(2, 9);
    expect(far.arrowA.length / near.arrowA.length).toBeCloseTo(0.25, 9);
  });

  it("keeps the two arrows equal and opposite for any ratios", () => {
    const values = [0, 1e-6, 0.1, 0.5, 1, 2, 10, 1e6];
    for (const slot of SLOTS) {
      for (const distance of values) {
        for (const force of values) {
          for (const mass of [0, 0.3, 1, 5]) {
            const g = twoBodyLayout(slot, U, {
              massA: mass,
              massB: 1 / (mass || 1),
              distance,
              force,
            });
            expect(g.arrowA.length).toBe(g.arrowB.length);
            expect(g.arrowA.direction).toBe(-g.arrowB.direction);
            expect(g.arrowA.tip[0] - g.arrowA.from[0]).toBeCloseTo(
              g.arrowB.from[0] - g.arrowB.tip[0],
              9,
            );
            expect(g.arrowA.tip[0]).toBeLessThan(g.arrowB.tip[0]);
            expect(g.arrowA.tip[1]).toBe(g.arrowB.tip[1]);
          }
        }
      }
    }
  });

  it("scales each arrow in strict proportion to the force until the arrows would meet", () => {
    const slot = SLOTS[0]!;
    const lengths = [0.1, 0.2, 0.4, 0.8].map(
      (force) => twoBodyLayout(slot, U, { ...unit, force }).arrowA.length,
    );
    expect(lengths[1]! / lengths[0]!).toBeCloseTo(2, 9);
    expect(lengths[2]! / lengths[1]!).toBeCloseTo(2, 9);
    expect(lengths[3]! / lengths[2]!).toBeCloseTo(2, 9);
    const capped = twoBodyLayout(slot, U, { ...unit, force: 1000 });
    expect(capped.arrowA.tip[0]).toBeLessThan(capped.arrowB.tip[0]);
    expect(capped.arrowA.length).toBeLessThan(1000 * 0.11 * slot.width);
  });

  it("draws a larger body for a larger mass, following the cube root", () => {
    const slot = SLOTS[0]!;
    const radiusOf = (massA: number) => twoBodyLayout(slot, U, { ...unit, massA }).a.radius;
    expect(radiusOf(1.728) / radiusOf(0.512)).toBeCloseTo(1.5, 9);
    expect(radiusOf(0.5)).toBeLessThan(radiusOf(1));
    expect(radiusOf(1)).toBeLessThan(radiusOf(2));
    expect(radiusOf(1e-9)).toBeGreaterThan(0);
    expect(radiusOf(1e9)).toBeLessThan(0.22 * slot.height);
    const radiusOfB = (massB: number) => twoBodyLayout(slot, U, { ...unit, massB }).b.radius;
    expect(radiusOfB(2)).toBeGreaterThan(radiusOfB(1));
  });

  it("keeps everything inside the slot for extreme ratios", () => {
    const values = [0, 1e-9, 0.05, 0.4, 1, 2.1, 50, 1e9];
    for (const slot of SLOTS) {
      for (const massA of values) {
        for (const massB of values) {
          for (const distance of values) {
            for (const force of [0, 1, 1e9]) {
              const ratios: TwoBodyRatios = { massA, massB, distance, force };
              const geometry = twoBodyLayout(slot, U, ratios);
              inside(geometry, slot);
              const gap = geometry.b.x - geometry.b.radius - (geometry.a.x + geometry.a.radius);
              expect(gap).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });
});

describe("ratioOf", () => {
  it("compares the current value with the one at the default parameters", () => {
    expect(ratioOf(4, 2)).toBe(2);
    expect(ratioOf(2e-31, 1e-31)).toBeCloseTo(2, 12);
  });

  it("falls back to the reference size when a value cannot be compared", () => {
    expect(ratioOf(3, 0)).toBe(1);
    expect(ratioOf(3, -2)).toBe(1);
    expect(ratioOf(Number.NaN, 2)).toBe(1);
    expect(ratioOf(3, Number.NaN)).toBe(1);
    expect(ratioOf(Number.POSITIVE_INFINITY, 2)).toBe(1);
    expect(ratioOf(-3, 2)).toBe(0);
  });
});

describe("TwoBodySim", () => {
  it("draws every part at the end of the entrance", () => {
    const { container } = setup();
    for (const name of ["body_a", "body_b", "force_a", "force_b", "distance"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect(container.textContent).toContain("Terre");
    expect(container.textContent).toContain("Lune");
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("does not render a part that the state hides, and keeps the others", () => {
    const { container } = setup({
      beats: showing(["sys.body_a", "sys.body_b", "sys.force_a", "sys.force_b"]),
    });
    expect(part(container, "distance")).toBeNull();
    expect(container.querySelector("text[font-style=italic]")?.textContent).toBe("F");
    for (const name of ["body_a", "body_b", "force_a", "force_b"]) {
      expect(part(container, name), name).not.toBeNull();
    }
  });

  it("shows a single part on its own", () => {
    const { container } = setup({ beats: showing(["sys.force_b"]) });
    expect(part(container, "force_b")).not.toBeNull();
    for (const name of ["body_a", "body_b", "force_a", "distance"]) {
      expect(part(container, name), name).toBeNull();
    }
  });

  it("removes a part once it has been hidden", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["sys"], how: "fade", at: 0 },
          { do: "hide", targets: ["sys.force_b"], at: 0.1 },
        ],
      },
    ];
    const { container } = setup({ beats });
    expect(part(container, "force_b")).toBeNull();
    expect(part(container, "force_a")).not.toBeNull();
    expect(part(container, "body_b")).not.toBeNull();
  });

  it("fades the bodies in and traces the arrows with their labels after the stroke", () => {
    const fading = setup({ frame: 4, beats: showing(["sys.body_a"]) });
    const opacity = num(body(fading.container, "planet"), "opacity");
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);

    const drawing = setup({ frame: 9, beats: showing(["sys.force_a", "sys.force_b"], "draw") });
    const group = part(drawing.container, "force_a")!;
    const shaft = group.querySelector("line")!;
    const length = num(shaft, "stroke-dasharray");
    expect(length).toBeGreaterThan(0);
    expect(num(shaft, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(shaft, "stroke-dashoffset")).toBeLessThan(length);
    expect(num(group.querySelector("text"), "opacity")).toBe(0);
    expect(num(group.querySelector("polygon"), "opacity")).toBe(0);

    const done = setup({ beats: showing(["sys.force_a", "sys.force_b"], "draw") });
    const finished = part(done.container, "force_a")!;
    expect(finished.querySelector("line")!.hasAttribute("stroke-dasharray")).toBe(false);
    expect(num(finished.querySelector("text"), "opacity")).toBe(1);
  });

  it("traces the dimension line and its extension lines", () => {
    const { container } = setup({ frame: 9, beats: showing(["sys.distance"], "draw") });
    const lines = [...part(container, "distance")!.querySelectorAll("line")];
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) expect(line.hasAttribute("stroke-dasharray")).toBe(true);
    expect(num(part(container, "distance")!.querySelector("text"), "opacity")).toBe(0);
  });

  it("draws a flat result band behind a highlighted arrow or dimension line", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["sys"], how: "fade", at: 0 },
          { do: "highlight", targets: ["sys.force_a", "sys.distance"], at: 0.1 },
        ],
      },
    ];
    const { container, ctx } = setup({ beats });
    for (const name of ["force_a", "distance"]) {
      const band = part(container, name)!.querySelector("rect")!;
      expect(band.getAttribute("fill")).toBe(ctx.theme.role.result);
      expect(num(band, "width")).toBeGreaterThan(0);
    }
    expect(part(container, "force_b")!.querySelector("rect")).toBeNull();
    const plain = setup();
    expect(plain.container.querySelector("rect")).toBeNull();
  });

  it("places the bodies on a horizontal axis, A on the left, with the default pictograms", () => {
    const { container, ctx } = setup();
    const planet = body(container, "planet");
    const moon = body(container, "moon");
    expect(planet).not.toBeNull();
    expect(moon).not.toBeNull();
    expect(num(planet, "cy")).toBeCloseTo(ctx.size.height / 3, 6);
    expect(num(moon, "cy")).toBeCloseTo(ctx.size.height / 3, 6);
    expect(num(planet, "cx")).toBeLessThan(num(moon, "cx"));
    expect(num(planet, "r") * 2).toBeCloseTo(0.22 * ctx.size.height, 6);
    expect(num(moon, "r") * 2).toBeCloseTo(0.12 * ctx.size.height, 6);
  });

  it("uses the pictograms and labels the element gives", () => {
    const { container } = setup({
      element: {
        ...SYSTEM,
        objectA: "sun",
        objectB: "ball",
        labelA: "Soleil",
        labelB: "Balle",
        forceLabel: "Fg",
        distanceLabel: "d",
      },
    });
    expect(body(container, "sun")).not.toBeNull();
    expect(body(container, "ball")).not.toBeNull();
    expect(body(container, "planet")).toBeNull();
    const texts = [...container.querySelectorAll("text")].map((text) => text.textContent);
    expect(texts).toEqual(expect.arrayContaining(["Soleil", "Balle", "Fg", "d"]));
    expect(texts.filter((text) => text === "Fg")).toHaveLength(2);
  });

  it("falls back to F and r, and names only the bodies that have a name", () => {
    const { container } = setup({ element: { ...SYSTEM, labelA: undefined, labelB: undefined } });
    const texts = [...container.querySelectorAll("text")].map((text) => text.textContent);
    expect(texts.sort()).toEqual(["F", "F", "r"]);
  });

  it("sets the force labels and the distance label in italic", () => {
    const { container } = setup();
    const italic = [...container.querySelectorAll("text")].filter(
      (text) => text.getAttribute("font-style") === "italic",
    );
    expect(italic.map((text) => text.textContent).sort()).toEqual(["F", "F", "r"]);
  });

  it("draws the two arrows with the same length, strokeWidth accent, solid heads", () => {
    const { container, ctx } = setup();
    const a = arrowOf(container, "force_a");
    const b = arrowOf(container, "force_b");
    expect(a.length).toBeCloseTo(b.length, 9);
    expect(a.tip).toBeGreaterThan(a.from);
    expect(b.tip).toBeLessThan(b.from);
    for (const name of ["force_a", "force_b"]) {
      const group = part(container, name)!;
      expect(num(group.querySelector("line"), "stroke-width")).toBeCloseTo(0.5 * ctx.u, 9);
      expect(group.querySelector("polygon")!.getAttribute("fill")).toBe(ctx.theme.role.action);
    }
    const planet = body(container, "planet");
    expect(a.from).toBeCloseTo(num(planet, "cx") + num(planet, "r"), 6);
    const moon = body(container, "moon");
    expect(b.from).toBeCloseTo(num(moon, "cx") - num(moon, "r"), 6);
  });

  it("draws the dimension line under the bodies, between the two centres, labelled at its middle", () => {
    const { container } = setup();
    const planet = body(container, "planet");
    const moon = body(container, "moon");
    const dimension = dimensionOf(container);
    expect(dimension.left).toBeCloseTo(num(planet, "cx"), 6);
    expect(dimension.right).toBeCloseTo(num(moon, "cx"), 6);
    expect(dimension.y).toBeGreaterThan(num(planet, "cy") + num(planet, "r"));
    expect(dimension.y).toBeGreaterThan(num(moon, "cy") + num(moon, "r"));
    expect(num(dimension.label, "x")).toBeCloseTo((dimension.left + dimension.right) / 2, 6);
    expect(dimension.label?.textContent).toBe("r");
  });

  it("doubles the separation and divides the arrows by four when the distance doubles", () => {
    const near = setup();
    const far = setup({ values: { r: 2 * 3.84e8 } });
    const nearDimension = dimensionOf(near.container);
    const farDimension = dimensionOf(far.container);
    const separation = (d: { left: number; right: number }) => d.right - d.left;
    expect(separation(farDimension) / separation(nearDimension)).toBeCloseTo(2, 9);
    for (const name of ["force_a", "force_b"]) {
      const ratio = arrowOf(far.container, name).length / arrowOf(near.container, name).length;
      expect(ratio).toBeCloseTo(0.25, 9);
    }
    expect(far.ctx.scope.F! / near.ctx.scope.F!).toBeCloseTo(0.25, 9);
  });

  it("reads the masses through the scope: a larger mass draws a larger body", () => {
    const base = setup();
    const heavy = setup({ values: { m1: 1.2e25, m2: 1.5e23 } });
    const light = setup({ values: { m1: 1e24, m2: 1e22 } });
    for (const kind of ["planet", "moon"]) {
      const radius = (view: typeof base) => num(body(view.container, kind), "r");
      expect(radius(heavy)).toBeGreaterThan(radius(base));
      expect(radius(base)).toBeGreaterThan(radius(light));
    }
    expect(
      num(body(heavy.container, "planet"), "r") / num(body(base.container, "planet"), "r"),
    ).toBeCloseTo(Math.cbrt(1.2e25 / 5.97e24), 9);
    expect(arrowOf(heavy.container, "force_a").length).toBeGreaterThan(
      arrowOf(base.container, "force_a").length,
    );
  });

  it("draws the same figure for electrons as for planets at their default values", () => {
    const planets = setup();
    const atoms = setup({ params: ATOM });
    expect(arrowOf(atoms.container, "force_a")).toEqual(arrowOf(planets.container, "force_a"));
    expect(arrowOf(atoms.container, "force_b")).toEqual(arrowOf(planets.container, "force_b"));
    expect(dimensionOf(atoms.container).left).toBe(dimensionOf(planets.container).left);
    expect(num(body(atoms.container, "planet"), "r")).toBe(
      num(body(planets.container, "planet"), "r"),
    );
    const stretched = setup({ params: ATOM, values: { r: 2 * 5.3e-11 } });
    expect(
      arrowOf(stretched.container, "force_a").length / arrowOf(atoms.container, "force_a").length,
    ).toBeCloseTo(0.25, 9);
  });

  it("keeps both bodies inside the slot at the extremes of the sliders", () => {
    const corners = [
      { m1: 1e24, m2: 1e22, r: 1.5e8 },
      { m1: 1.2e25, m2: 1.5e23, r: 1.5e8 },
      { m1: 1e24, m2: 1e22, r: 8e8 },
      { m1: 1.2e25, m2: 1.5e23, r: 8e8 },
    ];
    for (const values of corners) {
      const { container, ctx } = setup({ values });
      for (const kind of ["planet", "moon"]) {
        const circle = body(container, kind);
        expect(num(circle, "cx") - num(circle, "r")).toBeGreaterThanOrEqual(0);
        expect(num(circle, "cx") + num(circle, "r")).toBeLessThanOrEqual(ctx.size.width);
      }
      const a = arrowOf(container, "force_a");
      const b = arrowOf(container, "force_b");
      expect(a.length).toBeCloseTo(b.length, 9);
      expect(a.tip).toBeLessThan(b.tip);
    }
  });

  it("shrinks the head of an arrow that is shorter than the head", () => {
    const { container } = setup({ values: { m1: 1e24, m2: 1e22, r: 8e8 } });
    const { length } = arrowOf(container, "force_a");
    const xs = polygonPoints(part(container, "force_a")!).map(([x]) => x);
    expect(length).toBeLessThan(2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(length + 1e-9);
    const shaft = part(container, "force_a")!.querySelector("line");
    expect(Math.abs(num(shaft, "x2") - num(shaft, "x1"))).toBeLessThanOrEqual(length);
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
              { do: "show", targets: ["sys"], how: "fade", at: 0 },
              { do: "highlight", targets: ["sys.force_a", "sys.distance"], at: 0.1 },
            ],
          },
        ],
      });
      const tokens = new Set([
        ctx.theme.ink,
        ctx.theme.surfaceRaised,
        ...Object.values(ctx.theme.role),
      ]);
      const used = new Set<string>();
      for (const element of container.querySelectorAll("[fill], [stroke]")) {
        for (const name of ["fill", "stroke"]) {
          const value = element.getAttribute(name);
          if (value && value !== "none") used.add(value);
        }
      }
      expect(used.size).toBeGreaterThan(0);
      for (const colour of used) expect(tokens.has(colour), colour).toBe(true);
    });

    it("colours the arrows, the dimension and the labels by role", () => {
      const { container, ctx } = setup({ theme });
      const { role } = ctx.theme;
      for (const name of ["force_a", "force_b"]) {
        const group = part(container, name)!;
        expect(group.querySelector("line")!.getAttribute("stroke")).toBe(role.action);
        expect(group.querySelector("polygon")!.getAttribute("fill")).toBe(role.action);
        expect(group.querySelector("text")!.getAttribute("fill")).toBe(role.actionText);
      }
      const distance = part(container, "distance")!;
      for (const line of distance.querySelectorAll("line")) {
        expect(line.getAttribute("stroke")).toBe(role.quantity);
      }
      expect(distance.querySelector("text")!.getAttribute("fill")).toBe(role.quantity);
      for (const name of ["body_a", "body_b"]) {
        expect(part(container, name)!.querySelector("text")!.getAttribute("fill")).toBe(
          ctx.theme.ink,
        );
      }
    });
  });
});
