// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PictogramProps } from "../../src/pictograms";
import {
  LABEL_HEIGHT_U,
  MIN_ARROW_U,
  orbitAngle,
  orbitLayout,
  orbitRatios,
  symbolWidth,
  type OrbitGeometry,
  type OrbitRatios,
} from "../../src/primitives/sim/orbit-layout";
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

const PERIOD = 4;
const PARAMS: Param[] = [param("r", "r", 0.3, 4, 1), param("T", "T", 1, 12, PERIOD)];
const MODEL: Model = { constants: [], derived: [] };
const TAU = 2 * Math.PI;

type Orbit = ElementOf<"sim.orbit">;
const ORBIT: Orbit = {
  id: "orb",
  slot: "figure",
  type: "sim.orbit",
  radius: { expr: "r" },
  period: { expr: "T" },
};
const WITH_FORCE: Orbit = { ...ORBIT, showForce: true };

const showing = (targets: string[], how: "fade" | "draw" = "fade"): Scene["beats"] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [{ do: "show", targets, how, at: 0 }],
  },
];

const playing = (from: number, to: number, extra: Scene["beats"][number]["actions"] = []) => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [
      { do: "show" as const, targets: ["orb"], how: "fade" as const, at: 0 },
      { do: "play" as const, target: "orb", from, to, at: 0 },
      ...extra,
    ],
  },
];

interface Setup {
  element?: Orbit;
  params?: Param[];
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
  reducedMotion?: boolean;
  time?: number;
}

function setup({ element = ORBIT, params = PARAMS, time, ...rest }: Setup = {}) {
  const beats = rest.beats ?? (time === undefined ? undefined : playing(time, time));
  const scene = sceneOf([element], { beats });
  const ctx = testContext({
    scene,
    params,
    model: MODEL,
    values: rest.values,
    theme: rest.theme,
    frame: rest.frame,
    reducedMotion: rest.reducedMotion,
  });
  return { ctx, ...renderElement(element, ctx) };
}

const num = (element: Element | null | undefined, name: string): number => {
  if (!element) throw new Error(`missing element for ${name}`);
  return Number(element.getAttribute(name));
};
const part = (container: Element, name: string): Element | null =>
  container.querySelector(`[data-part="${name}"]`);
const disc = (container: Element, kind: string): Element | null =>
  container.querySelector(`circle[data-kind="${kind}"]`);
const polygonPoints = (group: Element): [number, number][] =>
  (group.querySelector("polygon")?.getAttribute("points") ?? "")
    .split(" ")
    .map((pair) => pair.split(",").map(Number) as [number, number]);
const mod = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const circular = (a: number, b: number): number => {
  const gap = mod(a - b);
  return Math.min(gap, TAU - gap);
};

function pose(container: Element) {
  const centre = disc(container, "planet");
  const moon = disc(container, "moon");
  const [cx, cy] = [num(centre, "cx"), num(centre, "cy")];
  const [bx, by] = [num(moon, "cx"), num(moon, "cy")];
  return {
    centre: [cx, cy] as const,
    body: [bx, by] as const,
    distance: Math.hypot(bx - cx, by - cy),
    angle: mod(Math.atan2(cy - by, bx - cx)),
  };
}

function pathRadius(container: Element): number {
  const d = part(container, "path")?.getAttribute("d") ?? "";
  return Number(/A ([\d.]+) /.exec(d)?.[1]);
}

function arrowOf(container: Element, name: string) {
  const group = part(container, name);
  if (!group) throw new Error(`no ${name}`);
  const shaft = group.querySelector("line")!;
  const tip = polygonPoints(group)[0]!;
  const from: [number, number] = [num(shaft, "x1"), num(shaft, "y1")];
  return {
    from,
    tip,
    length: Math.hypot(tip[0] - from[0], tip[1] - from[1]),
    angle: mod(Math.atan2(-(tip[1] - from[1]), tip[0] - from[0])),
  };
}

const U = 16;
const CAP_HALF_HEIGHT = LABEL_HEIGHT_U * U * 0.5;
const SLOTS = [
  { width: 1728, height: 648 },
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
];
const RATIOS = [0, 1e-6, 0.1, 0.5, 1, 2, 10, 1e9];
const ANGLES = Array.from({ length: 48 }, (_, k) => (k * TAU) / 48 + 0.013);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (box: Box, slot: { width: number; height: number }): boolean =>
  box.x >= 0 && box.y >= 0 && box.x + box.width <= slot.width && box.y + box.height <= slot.height;
const discBox = (x: number, y: number, radius: number): Box => ({
  x: x - radius,
  y: y - radius,
  width: 2 * radius,
  height: 2 * radius,
});
const hitsDisc = (box: Box, x: number, y: number, radius: number): boolean =>
  Math.hypot(
    Math.max(box.x - x, 0, x - (box.x + box.width)),
    Math.max(box.y - y, 0, y - (box.y + box.height)),
  ) < radius;
const centred = (centre: readonly [number, number], text: string): Box => {
  const width = symbolWidth(text, 4 * U);
  return {
    x: centre[0] - width / 2,
    y: centre[1] - CAP_HALF_HEIGHT,
    width,
    height: 2 * CAP_HALF_HEIGHT,
  };
};
const grown = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  width: box.width + 2 * by,
  height: box.height + 2 * by,
});
const touches = (
  box: Box,
  from: readonly [number, number],
  to: readonly [number, number],
  clearance: number,
): boolean => {
  const padded = grown(box, clearance);
  return Array.from({ length: 41 }, (_, k) => k / 40).some((s) => {
    const x = from[0] + s * (to[0] - from[0]);
    const y = from[1] + s * (to[1] - from[1]);
    return (
      x > padded.x && x < padded.x + padded.width && y > padded.y && y < padded.y + padded.height
    );
  });
};
const boxDistances = (box: Box, centre: readonly [number, number]) => {
  const dx = Math.max(box.x - centre[0], 0, centre[0] - (box.x + box.width));
  const dy = Math.max(box.y - centre[1], 0, centre[1] - (box.y + box.height));
  const far = Math.hypot(
    Math.max(Math.abs(box.x - centre[0]), Math.abs(box.x + box.width - centre[0])),
    Math.max(Math.abs(box.y - centre[1]), Math.abs(box.y + box.height - centre[1])),
  );
  return { near: Math.hypot(dx, dy), far };
};

const WIDTHS = {
  radius: symbolWidth("r", 4 * U),
  velocity: symbolWidth("v", 4 * U),
  force: symbolWidth("F", 4 * U),
};

function layoutFor(
  slot: { width: number; height: number },
  ratios: OrbitRatios,
  angle: number,
): OrbitGeometry {
  return orbitLayout(slot, U, ratios, WIDTHS, angle);
}

function labelsOf(geometry: OrbitGeometry) {
  return {
    r: centred(geometry.radius.label, "r"),
    ...(geometry.velocity ? { v: centred(geometry.velocity.label, "v") } : {}),
    ...(geometry.force ? { F: centred(geometry.force.label, "F") } : {}),
  };
}

function textBoxes(container: Element, u: number): (Box & { text: string })[] {
  return [...container.querySelectorAll("text")].map((text) => {
    const content = text.textContent ?? "";
    const width = symbolWidth(content, 4 * u);
    const x = num(text, "x");
    const anchor = text.getAttribute("text-anchor");
    return {
      text: content,
      x: anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2,
      y: num(text, "y") - CAP_HALF_HEIGHT,
      width,
      height: 2 * CAP_HALF_HEIGHT,
    };
  });
}

describe("orbit motion", () => {
  it("sweeps θ = 2π·t/T at three instants", () => {
    for (const period of [4, 27.3, 0.8]) {
      for (const share of [0.13, 0.4, 0.77]) {
        const time = share * period;
        expect(orbitAngle(period, time)).toBeCloseTo(TAU * share, 12);
        expect(orbitAngle(period, time)).toBeCloseTo((TAU * time) / period, 12);
      }
    }
  });

  it("comes back to the start after a period, and doubles the angle when the period halves", () => {
    expect(orbitAngle(5, 5)).toBeCloseTo(TAU, 12);
    expect(orbitAngle(5, 12.5)).toBeCloseTo(5 * Math.PI, 12);
    expect(orbitAngle(2.5, 1) / orbitAngle(5, 1)).toBeCloseTo(2, 12);
    expect(orbitAngle(5, 0)).toBe(0);
  });

  it("does not turn when the period or the time cannot be used", () => {
    for (const period of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(orbitAngle(period, 2)).toBe(0);
    }
    expect(orbitAngle(4, Number.NaN)).toBe(0);
  });

  it("makes the speed go as r/T and the centripetal force as r/T²", () => {
    const reference = { radius: 1, period: 4 };
    const base = orbitRatios(reference, reference);
    expect(base).toEqual({ radius: 1, velocity: 1, force: 1 });
    const wide = orbitRatios({ radius: 2, period: 4 }, reference);
    expect(wide).toEqual({ radius: 2, velocity: 2, force: 2 });
    const quick = orbitRatios({ radius: 1, period: 2 }, reference);
    expect(quick).toEqual({ radius: 1, velocity: 2, force: 4 });
    const slow = orbitRatios({ radius: 3, period: 12 }, reference);
    expect(slow.velocity).toBeCloseTo(1, 12);
    expect(slow.force).toBeCloseTo(1 / 3, 12);
  });

  it("has no speed and no force when the period is unusable", () => {
    const reference = { radius: 1, period: 4 };
    for (const period of [0, -2, Number.POSITIVE_INFINITY]) {
      const ratios = orbitRatios({ radius: 2, period }, reference);
      expect(ratios.velocity).toBe(0);
      expect(ratios.force).toBe(0);
    }
    expect(orbitRatios({ radius: 0, period: 1e-9 }, reference).velocity).toBe(0);
  });
});

describe("orbit layout", () => {
  const unit: OrbitRatios = { radius: 1, velocity: 1, force: 1 };

  it("keeps the body on a circle around the centre, whatever the angle", () => {
    for (const slot of SLOTS) {
      for (const ratio of [0.1, 1, 10]) {
        const radii = ANGLES.map((angle) => {
          const geometry = layoutFor(slot, { ...unit, radius: ratio }, angle);
          const { x, y } = geometry.body;
          expect(Math.atan2(geometry.centre[1] - y, x - geometry.centre[0])).toSatisfy(
            (found: number) => circular(found, angle) < 1e-9,
          );
          return Math.hypot(x - geometry.centre[0], y - geometry.centre[1]);
        });
        const expected = layoutFor(slot, { ...unit, radius: ratio }, 0).orbitRadius;
        for (const radius of radii) expect(radius).toBeCloseTo(expected, 9);
      }
    }
  });

  it("moves counter-clockwise on the screen, starting at the right of the centre", () => {
    const start = layoutFor(SLOTS[0]!, unit, 0);
    expect(start.body.x).toBeCloseTo(start.centre[0] + start.orbitRadius, 9);
    expect(start.body.y).toBeCloseTo(start.centre[1], 9);
    const quarter = layoutFor(SLOTS[0]!, unit, Math.PI / 2);
    expect(quarter.body.x).toBeCloseTo(quarter.centre[0], 9);
    expect(quarter.body.y).toBeCloseTo(quarter.centre[1] - quarter.orbitRadius, 9);
    const half = layoutFor(SLOTS[0]!, unit, Math.PI);
    expect(half.body.x).toBeCloseTo(half.centre[0] - half.orbitRadius, 9);
  });

  it("draws the default orbit at the same size whatever the slot's width", () => {
    const sizes = [SLOTS[0]!, SLOTS[1]!].map((slot) => layoutFor(slot, unit, 0).orbitRadius);
    expect(sizes[0]).toBe(sizes[1]);
    for (const slot of SLOTS) {
      const geometry = layoutFor(slot, unit, 0);
      expect(geometry.centre).toEqual([slot.width / 2, slot.height / 2]);
    }
  });

  it("draws a larger orbit for a larger radius, with no dead zone at either end", () => {
    for (const slot of SLOTS) {
      const sizes = [0, 0.05, 0.2, 0.5, 1, 2, 5, 20, 1000].map(
        (radius) => layoutFor(slot, { ...unit, radius }, 0).orbitRadius,
      );
      for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
      const geometry = layoutFor(slot, unit, 0);
      expect(geometry.orbitRadius).toBeGreaterThan(geometry.centreRadius + geometry.body.radius);
    }
  });

  it("draws the velocity arrow tangent to the orbit, counter-clockwise, at a constant length", () => {
    for (const slot of SLOTS) {
      const reference = layoutFor(slot, { ...unit, velocity: 1 }, 0).velocity!;
      for (const angle of ANGLES) {
        const geometry = layoutFor(slot, { ...unit, velocity: 1 }, angle);
        const arrow = geometry.velocity!;
        expect(arrow.length).toBeCloseTo(reference.length, 9);
        const radial = [geometry.body.x - geometry.centre[0], geometry.body.y - geometry.centre[1]];
        const along = [arrow.tip[0] - arrow.from[0], arrow.tip[1] - arrow.from[1]];
        expect(radial[0]! * along[0]! + radial[1]! * along[1]!).toBeCloseTo(0, 6);
        expect(radial[0]! * along[1]! - radial[1]! * along[0]!).toBeLessThan(0);
        expect(
          Math.hypot(arrow.from[0] - geometry.body.x, arrow.from[1] - geometry.body.y),
        ).toBeCloseTo(geometry.body.radius, 9);
      }
    }
  });

  it("draws the force arrow along the radius, towards the centre, at a constant length", () => {
    for (const slot of SLOTS) {
      const reference = layoutFor(slot, { ...unit, force: 1 }, 0).force!;
      for (const angle of ANGLES) {
        const geometry = layoutFor(slot, { ...unit, force: 1 }, angle);
        const arrow = geometry.force!;
        expect(arrow.length).toBeCloseTo(reference.length, 9);
        const toCentre = [
          geometry.centre[0] - geometry.body.x,
          geometry.centre[1] - geometry.body.y,
        ];
        const along = [arrow.tip[0] - arrow.from[0], arrow.tip[1] - arrow.from[1]];
        expect(toCentre[0]! * along[1]! - toCentre[1]! * along[0]!).toBeCloseTo(0, 6);
        expect(toCentre[0]! * along[0]! + toCentre[1]! * along[1]!).toBeGreaterThan(0);
      }
    }
  });

  it("scales both arrows in strict proportion to their ratio until they reach their cap", () => {
    const slot = SLOTS[0]!;
    const speeds = [0.4, 0.6, 0.8].map(
      (velocity) => layoutFor(slot, { ...unit, velocity }, 0.7).velocity!.length,
    );
    expect(speeds[1]! / speeds[0]!).toBeCloseTo(1.5, 12);
    expect(speeds[2]! / speeds[0]!).toBeCloseTo(2, 12);
    const pulls = [0.5, 0.75, 1].map(
      (force) => layoutFor(slot, { ...unit, force }, 0.7).force!.length,
    );
    expect(pulls[1]! / pulls[0]!).toBeCloseTo(1.5, 12);
    expect(pulls[2]! / pulls[0]!).toBeCloseTo(2, 12);
    const capped = layoutFor(slot, { ...unit, velocity: 1e9, force: 1e9 }, 0.7);
    expect(capped.velocity!.length).toBeLessThan(1e9);
    expect(
      layoutFor(slot, { ...unit, velocity: Number.POSITIVE_INFINITY }, 0).velocity,
    ).not.toBeNull();
  });

  it("leaves out an arrow that would be shorter than its head", () => {
    for (const slot of SLOTS) {
      const geometry = layoutFor(slot, { ...unit, velocity: 0, force: 0 }, 1);
      expect(geometry.velocity).toBeNull();
      expect(geometry.force).toBeNull();
      const tiny = layoutFor(slot, { ...unit, velocity: 1e-6, force: 1e-6 }, 1);
      expect(tiny.velocity).toBeNull();
      expect(tiny.force).toBeNull();
      const drawn = layoutFor(slot, unit, 1);
      expect(drawn.velocity!.length).toBeGreaterThanOrEqual(MIN_ARROW_U * U);
      expect(drawn.force!.length).toBeGreaterThanOrEqual(MIN_ARROW_U * U);
    }
  });

  it("draws the default velocity arrow in every slot", () => {
    for (const slot of SLOTS) {
      for (const angle of ANGLES) {
        expect(layoutFor(slot, unit, angle).velocity, `${slot.height} ${angle}`).not.toBeNull();
        expect(layoutFor(slot, unit, angle).force).not.toBeNull();
      }
    }
  });

  it("keeps the whole figure inside the slot for any ratio and any angle", () => {
    for (const slot of SLOTS) {
      for (const radius of RATIOS) {
        for (const velocity of RATIOS) {
          for (const angle of ANGLES) {
            const geometry = layoutFor(slot, { radius, velocity, force: velocity }, angle);
            const { centre, orbitRadius, body } = geometry;
            expect(inside(discBox(centre[0], centre[1], orbitRadius), slot)).toBe(true);
            expect(inside(discBox(body.x, body.y, body.radius), slot)).toBe(true);
            for (const arrow of [geometry.velocity, geometry.force]) {
              if (!arrow) continue;
              for (const [x, y] of [arrow.from, arrow.tip]) {
                expect(inside({ x, y, width: 0, height: 0 }, slot)).toBe(true);
              }
            }
            for (const [name, box] of Object.entries(labelsOf(geometry))) {
              expect(inside(box, slot), `${name} ${JSON.stringify(box)}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("keeps the three labels clear of each other, of the two bodies and of the arrows", () => {
    for (const slot of SLOTS) {
      for (const radius of RATIOS) {
        for (const velocity of [0.05, 0.5, 1, 2, 1e9]) {
          for (const angle of ANGLES) {
            const geometry = layoutFor(slot, { radius, velocity, force: velocity }, angle);
            const labels = labelsOf(geometry);
            const where = `${slot.height} r=${radius} v=${velocity} a=${angle.toFixed(2)}`;
            const boxes = Object.entries(labels);
            for (let i = 0; i < boxes.length; i++) {
              for (let j = i + 1; j < boxes.length; j++) {
                expect(
                  overlap(boxes[i]![1], boxes[j]![1]),
                  `${boxes[i]![0]}/${boxes[j]![0]} ${where}`,
                ).toBe(false);
              }
            }
            const { body, centre, centreRadius } = geometry;
            for (const [name, box] of boxes) {
              expect(hitsDisc(box, body.x, body.y, body.radius), `${name} body ${where}`).toBe(
                false,
              );
              expect(
                hitsDisc(box, centre[0], centre[1], centreRadius),
                `${name} centre ${where}`,
              ).toBe(false);
              for (const arrow of [geometry.velocity, geometry.force]) {
                if (arrow)
                  expect(
                    touches(box, arrow.from, arrow.tip, 0.4 * U),
                    `${name} arrow ${where}`,
                  ).toBe(false);
              }
              if (name !== "r") {
                expect(
                  touches(box, geometry.radius.from, geometry.radius.to, 0.4 * U),
                  `${name} radius ${where}`,
                ).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it("keeps each label, with its halo, on one side of the orbit line", () => {
    for (const slot of SLOTS) {
      for (const radius of RATIOS) {
        for (const angle of ANGLES) {
          const geometry = layoutFor(slot, { radius, velocity: 1, force: 1 }, angle);
          for (const [name, box] of Object.entries(labelsOf(geometry))) {
            // A wide capital cannot fit between the centre and a small orbit of the short slot.
            if (name === "F" && slot.height < 500 && radius < 1) continue;
            const { near, far } = boxDistances(box, geometry.centre);
            const margin = 0.45 * U;
            const side =
              far < geometry.orbitRadius - margin
                ? "in"
                : near > geometry.orbitRadius + margin
                  ? "out"
                  : "across";
            expect(side, `${name} ${slot.height} r=${radius} a=${angle.toFixed(2)}`).not.toBe(
              "across",
            );
          }
        }
      }
    }
  });
});

describe("OrbitSim", () => {
  it("draws every part at the end of the entrance, the force excepted", () => {
    const { container } = setup({ time: 1 });
    for (const name of ["center", "body", "path", "velocity", "radius"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect(part(container, "force")).toBeNull();
    expect([...container.querySelectorAll("text")].map((text) => text.textContent).sort()).toEqual([
      "r",
      "v",
    ]);
  });

  it("draws the force too when the document asks for it", () => {
    const { container } = setup({ time: 1, element: WITH_FORCE });
    expect(part(container, "force")).not.toBeNull();
    expect([...container.querySelectorAll("text")].map((text) => text.textContent).sort()).toEqual([
      "F",
      "r",
      "v",
    ]);
  });

  it("leaves the velocity out when showVelocity is false, even if it is shown", () => {
    const { container } = setup({ time: 1, element: { ...ORBIT, showVelocity: false } });
    expect(part(container, "velocity")).toBeNull();
    expect(part(container, "body")).not.toBeNull();
    expect(
      setup({ element: { ...ORBIT, showForce: false } }).container.querySelector(
        "[data-part=force]",
      ),
    ).toBeNull();
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("does not render a part that the state hides, and keeps the others", () => {
    const { container } = setup({
      time: 1,
      element: WITH_FORCE,
      beats: showing(["orb.center", "orb.body", "orb.path", "orb.force"]),
    });
    for (const name of ["velocity", "radius"]) expect(part(container, name), name).toBeNull();
    for (const name of ["center", "body", "path", "force"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect([...container.querySelectorAll("text")].map((text) => text.textContent)).toEqual(["F"]);
  });

  it("shows a single part on its own", () => {
    const { container } = setup({ time: 1, beats: showing(["orb.path"]) });
    expect(part(container, "path")).not.toBeNull();
    for (const name of ["center", "body", "velocity", "radius", "force"]) {
      expect(part(container, name), name).toBeNull();
    }
    expect(container.querySelector("text")).toBeNull();
  });

  it("removes a part once it has been hidden", () => {
    const { container } = setup({
      beats: playing(1, 1, [{ do: "hide", targets: ["orb.radius"], at: 0.1 }]),
    });
    expect(part(container, "radius")).toBeNull();
    expect(part(container, "velocity")).not.toBeNull();
    expect(part(container, "path")).not.toBeNull();
  });

  describe("positions", () => {
    it("puts the body at θ = 2π·t/T on a circle of constant radius, at three instants", () => {
      const start = setup();
      const radius = pathRadius(start.container);
      expect(radius).toBeGreaterThan(0);
      for (const time of [0.5, 1.3, 3.1]) {
        const { container } = setup({ time });
        const now = pose(container);
        expect(circular(now.angle, (TAU * time) / PERIOD)).toBeLessThan(1e-9);
        expect(now.distance).toBeCloseTo(radius, 6);
        expect(pathRadius(container)).toBeCloseTo(radius, 9);
        expect(now.centre).toEqual(pose(start.container).centre);
      }
    });

    it("goes on turning past a full period, and is back where it started after one", () => {
      const start = pose(setup().container);
      expect(start.angle).toBeCloseTo(0, 9);
      for (const time of [PERIOD, 2 * PERIOD]) {
        const back = pose(setup({ time }).container);
        expect(back.body[0]).toBeCloseTo(start.body[0], 6);
        expect(back.body[1]).toBeCloseTo(start.body[1], 6);
      }
      const later = pose(setup({ time: 1.625 * PERIOD }).container);
      expect(circular(later.angle, 1.25 * Math.PI)).toBeLessThan(1e-9);
    });

    it("turns counter-clockwise: a quarter period puts the body above the centre", () => {
      const quarter = pose(setup({ time: PERIOD / 4 }).container);
      expect(quarter.body[0]).toBeCloseTo(quarter.centre[0], 6);
      expect(quarter.body[1]).toBeCloseTo(quarter.centre[1] - quarter.distance, 6);
      const half = pose(setup({ time: PERIOD / 2 }).container);
      expect(half.body[0]).toBeCloseTo(half.centre[0] - half.distance, 6);
    });

    it("sweeps equal angles in equal times", () => {
      const angles = Array.from(
        { length: 13 },
        (_, k) => pose(setup({ time: (k * PERIOD) / 12 }).container).angle,
      );
      for (let k = 1; k < angles.length; k++) {
        expect(mod(angles[k]! - angles[k - 1]!)).toBeCloseTo(TAU / 12, 9);
      }
      const chords = angles.slice(1).map((_, k) => {
        const a = pose(setup({ time: (k * PERIOD) / 12 }).container).body;
        const b = pose(setup({ time: ((k + 1) * PERIOD) / 12 }).container).body;
        return Math.hypot(b[0] - a[0], b[1] - a[1]);
      });
      for (const chord of chords) expect(chord).toBeCloseTo(chords[0]!, 6);
    });

    it("turns twice as fast when the period is halved, and half as fast when it doubles", () => {
      const angleAt = (period: number, time: number) =>
        pose(setup({ time, values: { T: period } }).container).angle;
      expect(angleAt(2, 0.4)).toBeCloseTo(2 * angleAt(4, 0.4), 9);
      expect(angleAt(8, 0.8)).toBeCloseTo(angleAt(4, 0.8) / 2, 9);
      expect(angleAt(4, 0.4)).toBeCloseTo((TAU * 0.4) / 4, 9);
    });

    it("keeps the body at its start while no play action runs", () => {
      const { container } = setup();
      expect(pose(container).angle).toBeCloseTo(0, 9);
    });

    it("follows the law with the simulated time of a real playback", () => {
      const radius = pathRadius(setup().container);
      let previous = -1;
      for (const frame of [10, 40, 80, 119]) {
        const view = setup({ frame, beats: playing(0, 8) });
        const time = view.ctx.state.simTime("orb");
        expect(time).toBeGreaterThan(previous);
        previous = time;
        const now = pose(view.container);
        expect(circular(now.angle, (TAU * time) / PERIOD)).toBeLessThan(1e-9);
        expect(now.distance).toBeCloseTo(radius, 6);
      }
    });

    it("starts a play at its own from, not at zero", () => {
      expect(circular(pose(setup({ beats: playing(1, 1) }).container).angle, TAU / 4)).toBeLessThan(
        1e-9,
      );
    });

    it("shows the final state at once for reduced motion", () => {
      const early = setup({ frame: 3, reducedMotion: true, beats: playing(0, 2.5) });
      const late = setup({ frame: 90, reducedMotion: true, beats: playing(0, 2.5) });
      expect(early.ctx.state.simTime("orb")).toBe(2.5);
      expect(pose(early.container)).toEqual(pose(late.container));
      expect(circular(pose(early.container).angle, (TAU * 2.5) / PERIOD)).toBeLessThan(1e-9);
      const moving = setup({ frame: 3, beats: playing(0, 2.5) });
      expect(pose(moving.container).angle).not.toBeCloseTo(pose(early.container).angle, 3);
    });

    it("draws a larger orbit for a larger radius, and a larger one still than the pictograms", () => {
      const radii = [0.3, 1, 4].map((r) => pathRadius(setup({ values: { r } }).container));
      expect(radii[0]).toBeLessThan(radii[1]!);
      expect(radii[1]).toBeLessThan(radii[2]!);
      const { container } = setup({ values: { r: 0.3 } });
      const planet = disc(container, "planet");
      const moon = disc(container, "moon");
      expect(pathRadius(container)).toBeGreaterThan(num(planet, "r") + num(moon, "r"));
      expect(pose(container).distance).toBeCloseTo(pathRadius(container), 6);
    });

    it("does not change the orbit when the period changes", () => {
      expect(pathRadius(setup({ values: { T: 2 } }).container)).toBe(pathRadius(setup().container));
    });
  });

  describe("vectors", () => {
    it("draws the velocity tangent to the orbit, counter-clockwise, at three instants", () => {
      const lengths: number[] = [];
      for (const time of [0.3, 1.1, 2.7]) {
        const { container } = setup({ time });
        const now = pose(container);
        const arrow = arrowOf(container, "velocity");
        const radial = [now.body[0] - now.centre[0], now.body[1] - now.centre[1]];
        const along = [arrow.tip[0] - arrow.from[0], arrow.tip[1] - arrow.from[1]];
        expect(radial[0]! * along[0]! + radial[1]! * along[1]!).toBeCloseTo(0, 6);
        expect(radial[0]! * along[1]! - radial[1]! * along[0]!).toBeLessThan(0);
        expect(circular(arrow.angle, now.angle + Math.PI / 2)).toBeLessThan(1e-9);
        lengths.push(arrow.length);
      }
      expect(lengths[1]).toBeCloseTo(lengths[0]!, 9);
      expect(lengths[2]).toBeCloseTo(lengths[0]!, 9);
    });

    it("draws the force along the radius towards the centre, at a constant length", () => {
      const lengths: number[] = [];
      for (const time of [0.3, 1.1, 2.7]) {
        const { container } = setup({ time, element: WITH_FORCE });
        const now = pose(container);
        const arrow = arrowOf(container, "force");
        expect(circular(arrow.angle, now.angle + Math.PI)).toBeLessThan(1e-9);
        lengths.push(arrow.length);
      }
      expect(lengths[1]).toBeCloseTo(lengths[0]!, 9);
      expect(lengths[2]).toBeCloseTo(lengths[0]!, 9);
    });

    it("draws a velocity arrow twice as long when the period halves", () => {
      const slow = arrowOf(setup({ time: 1, values: { T: 8 } }).container, "velocity").length;
      const base = arrowOf(setup({ time: 1 }).container, "velocity").length;
      expect(base / slow).toBeCloseTo(2, 9);
    });

    it("draws a force arrow four times as long when the period halves", () => {
      const view = (T: number) =>
        arrowOf(setup({ time: 1, element: WITH_FORCE, values: { T } }).container, "force").length;
      expect(view(4) / view(4 * Math.SQRT2)).toBeCloseTo(2, 9);
    });

    it("has no velocity arrow for a period that does not move the body", () => {
      const params = [param("r", "r", 0.3, 4, 1), param("T", "T", 1, 1e12, PERIOD)];
      const { container } = setup({ time: 1, params, values: { T: 1e12 } });
      expect(part(container, "velocity")).toBeNull();
      expect(circular(pose(container).angle, 0)).toBeLessThan(1e-9);
    });
  });

  describe("animation of the parts", () => {
    it("fades the pictograms in and traces the path and the radius before their label", () => {
      const fading = setup({ frame: 4, beats: showing(["orb.body"]) });
      const opacity = num(disc(fading.container, "moon"), "opacity");
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);

      const drawing = setup({ frame: 9, beats: showing(["orb.path", "orb.radius"], "draw") });
      const path = part(drawing.container, "path")!;
      expect(num(path, "stroke-dasharray")).toBeCloseTo(TAU * pathRadius(drawing.container), 6);
      expect(num(path, "stroke-dashoffset")).toBeGreaterThan(0);
      const radius = part(drawing.container, "radius")!;
      expect(radius.querySelector("line")!.hasAttribute("stroke-dasharray")).toBe(true);
      expect(num(radius.querySelector("text"), "opacity")).toBe(0);

      const done = setup({ beats: showing(["orb.path", "orb.radius"], "draw") });
      expect(part(done.container, "path")!.hasAttribute("stroke-dasharray")).toBe(false);
      expect(num(part(done.container, "radius")!.querySelector("text"), "opacity")).toBe(1);
    });

    it("traces the arrows and shows their heads and labels last", () => {
      const view = setup({
        frame: 9,
        element: WITH_FORCE,
        beats: [
          {
            id: "b1",
            narration: "Test.",
            duration_ms: 4000,
            actions: [
              { do: "show", targets: ["orb.velocity", "orb.force"], how: "draw", at: 0 },
              { do: "play", target: "orb", from: 1, to: 1, at: 0 },
            ],
          },
        ],
      });
      for (const name of ["velocity", "force"]) {
        const group = part(view.container, name)!;
        expect(group.querySelector("line")!.hasAttribute("stroke-dasharray")).toBe(true);
        expect(num(group.querySelector("polygon"), "opacity")).toBe(0);
        expect(num(group.querySelector("text"), "opacity")).toBe(0);
      }
    });
  });

  describe("highlight", () => {
    const highlighted = (targets: string[]) =>
      playing(1, 1, [{ do: "highlight", targets, at: 0.1 }]);

    it("draws a flat result band behind each highlighted part and none behind the others", () => {
      const { container, ctx } = setup({
        element: WITH_FORCE,
        beats: highlighted(["orb.center", "orb.body", "orb.velocity", "orb.force", "orb.radius"]),
      });
      for (const name of ["center", "body", "velocity", "force", "radius"]) {
        const band = container.querySelector(`[data-band="${name}"] rect`);
        expect(band, name).not.toBeNull();
        expect(band!.getAttribute("fill")).toBe(ctx.theme.role.result);
        expect(num(band, "width")).toBeGreaterThan(0);
      }
      expect(container.querySelector('[data-band="path"]')).toBeNull();
      expect(setup({ time: 1 }).container.querySelector("[data-band]")).toBeNull();
    });

    it("rings the whole orbit when the path is highlighted", () => {
      const { container, ctx } = setup({ beats: highlighted(["orb.path"]) });
      const ring = container.querySelector('[data-band="path"] circle')!;
      expect(ring.getAttribute("stroke")).toBe(ctx.theme.role.result);
      expect(num(ring, "r")).toBeCloseTo(pathRadius(container), 6);
      expect(num(ring, "cx")).toBeCloseTo(pose(container).centre[0], 6);
      expect(num(ring, "stroke-width")).toBeCloseTo(2 * ctx.u, 9);
      const circumference = TAU * num(ring, "r");
      expect(Number(ring.getAttribute("stroke-dasharray")!.split(" ")[0])).toBeCloseTo(
        circumference,
        6,
      );
    });

    it("aligns the band of an arrow with the arrow and the band of the radius with the line", () => {
      const { container } = setup({
        time: 1.3,
        beats: [
          {
            id: "b1",
            narration: "Test.",
            duration_ms: 4000,
            actions: [
              { do: "show", targets: ["orb"], how: "fade", at: 0 },
              { do: "play", target: "orb", from: 1.3, to: 1.3, at: 0 },
              { do: "highlight", targets: ["orb.velocity", "orb.radius"], at: 0.1 },
            ],
          },
        ],
      });
      const angleOf = (name: string): number => {
        const transform = container
          .querySelector(`[data-band="${name}"] g`)!
          .getAttribute("transform")!;
        return (Number(/rotate\((-?[\d.e+-]+)\)/.exec(transform)![1]) * Math.PI) / 180;
      };
      const arrow = arrowOf(container, "velocity");
      expect(circular(angleOf("velocity"), -arrow.angle)).toBeLessThan(1e-9);
      expect(circular(angleOf("radius"), -pose(container).angle)).toBeLessThan(1e-9);
    });

    it("draws the bands under the path, the radius, the arrows and the pictograms", () => {
      const { container } = setup({
        beats: highlighted(["orb.velocity", "orb.body", "orb.path"]),
      });
      const children = [...container.querySelector("svg > g")!.children];
      const lastBand = children.reduce(
        (found, child, index) => (child.hasAttribute("data-band") ? index : found),
        -1,
      );
      for (const name of ["path", "radius", "velocity", "body", "center"]) {
        expect(lastBand).toBeLessThan(
          children.findIndex((child) => child.getAttribute("data-part") === name),
        );
      }
    });
  });

  describe("labels and pictograms", () => {
    it("names the radius after the symbol of its parameter and sets every label in italic", () => {
      const { container } = setup({
        time: 1,
        params: [param("rayon", "ρ", 0.3, 4, 1), param("T", "T", 1, 12, PERIOD)],
        element: { ...ORBIT, radius: { expr: "rayon" } },
      });
      const texts = [...container.querySelectorAll("text")];
      expect(texts.map((text) => text.textContent).sort()).toEqual(["v", "ρ"]);
      for (const text of texts) expect(text.getAttribute("font-style")).toBe("italic");
    });

    it("falls back to r when the radius is a number or an expression", () => {
      for (const radius of [1, { expr: "r * 1" }]) {
        const { container } = setup({ time: 1, element: { ...ORBIT, radius } });
        expect(
          [...container.querySelectorAll("text")].map((text) => text.textContent).sort(),
        ).toEqual(["r", "v"]);
      }
    });

    it("draws a planet and a moon unless the document names other pictograms", () => {
      const plain = setup().container;
      expect(disc(plain, "planet")).not.toBeNull();
      expect(disc(plain, "moon")).not.toBeNull();
      const { container } = setup({ element: { ...ORBIT, center: "sun", body: "ball" } });
      expect(disc(container, "sun")).not.toBeNull();
      expect(disc(container, "ball")).not.toBeNull();
      expect(disc(container, "planet")).toBeNull();
    });

    it("centres the orbit in the slot and draws the central body larger than the orbiting one", () => {
      const { container, ctx } = setup();
      const now = pose(container);
      expect(now.centre).toEqual([ctx.size.width / 2, ctx.size.height / 2]);
      expect(num(disc(container, "planet"), "r")).toBeGreaterThan(
        num(disc(container, "moon"), "r"),
      );
    });
  });

  describe("extreme parameters", () => {
    const CORNERS = [
      { r: 0.3, T: 1 },
      { r: 4, T: 1 },
      { r: 0.3, T: 12 },
      { r: 4, T: 12 },
    ];
    const TIMES = [0, 0.37, 1.1, 2.9, 5.3, 11];

    it("keeps the orbit, both pictograms, the arrows and every label inside the slot", () => {
      for (const values of CORNERS) {
        for (const time of TIMES) {
          const { container, ctx } = setup({ values, time, element: WITH_FORCE });
          const slot = ctx.size;
          for (const kind of ["planet", "moon"]) {
            const circle = disc(container, kind)!;
            expect(
              inside(discBox(num(circle, "cx"), num(circle, "cy"), num(circle, "r")), slot),
            ).toBe(true);
          }
          const centre = pose(container).centre;
          const radius = pathRadius(container);
          expect(inside(discBox(centre[0], centre[1], radius), slot)).toBe(true);
          for (const box of textBoxes(container, ctx.u)) {
            expect(inside(box, slot), `${box.text} ${JSON.stringify(values)} t=${time}`).toBe(true);
          }
          for (const name of ["velocity", "force"]) {
            if (!part(container, name)) continue;
            const arrow = arrowOf(container, name);
            for (const [x, y] of [arrow.from, arrow.tip]) {
              expect(inside({ x, y, width: 0, height: 0 }, slot)).toBe(true);
            }
          }
        }
      }
    });

    it("never overlaps two texts, nor a text and a pictogram or an arrow", () => {
      for (const values of CORNERS) {
        for (const time of TIMES) {
          const { container, ctx } = setup({ values, time, element: WITH_FORCE });
          const boxes = textBoxes(container, ctx.u);
          const where = `${JSON.stringify(values)} t=${time}`;
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              expect(
                overlap(boxes[i]!, boxes[j]!),
                `${boxes[i]!.text}/${boxes[j]!.text} ${where}`,
              ).toBe(false);
            }
          }
          for (const box of boxes) {
            for (const kind of ["planet", "moon"]) {
              const circle = disc(container, kind)!;
              expect(
                hitsDisc(box, num(circle, "cx"), num(circle, "cy"), num(circle, "r")),
                `${box.text} ${kind} ${where}`,
              ).toBe(false);
            }
            for (const name of ["velocity", "force"]) {
              if (!part(container, name)) continue;
              const arrow = arrowOf(container, name);
              expect(
                touches(box, arrow.from, arrow.tip, 0.4 * ctx.u),
                `${box.text} ${name} ${where}`,
              ).toBe(false);
            }
          }
        }
      }
    });

    it("keeps the length of the arrows constant while the body goes round", () => {
      let drawn = 0;
      for (const values of CORNERS) {
        const lengths = TIMES.flatMap((time) => {
          const { container } = setup({ values, time, element: WITH_FORCE });
          return ["velocity", "force"].map((name) =>
            part(container, name) ? arrowOf(container, name).length : 0,
          );
        });
        for (let k = 0; k < lengths.length; k++) {
          expect(lengths[k]).toBeCloseTo(lengths[k % 2]!, 9);
          if (lengths[k]! > 0) drawn++;
        }
      }
      expect(drawn).toBeGreaterThan(CORNERS.length * TIMES.length);
    });
  });

  describe.each<ThemeName>(["paper", "board"])("in the %s theme", (theme) => {
    it("takes every colour from the theme tokens", () => {
      const { container, ctx } = setup({
        theme,
        element: WITH_FORCE,
        beats: playing(1, 1, [{ do: "highlight", targets: ["orb"], at: 0.1 }]),
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
          if (value && value !== "none") used.add(value);
        }
      }
      expect(used.size).toBeGreaterThan(0);
      for (const colour of used) expect(tokens.has(colour), colour).toBe(true);
    });

    it("colours the radius as a quantity, both arrows as an action and the path in ink", () => {
      const { container, ctx } = setup({ theme, time: 1, element: WITH_FORCE });
      const { role } = ctx.theme;
      const radius = part(container, "radius")!;
      expect(radius.querySelector("line")!.getAttribute("stroke")).toBe(role.quantity);
      expect(radius.querySelector("text")!.getAttribute("fill")).toBe(role.quantity);
      for (const name of ["velocity", "force"]) {
        const group = part(container, name)!;
        expect(group.querySelector("line")!.getAttribute("stroke")).toBe(role.action);
        expect(group.querySelector("polygon")!.getAttribute("fill")).toBe(role.action);
        expect(group.querySelector("text")!.getAttribute("fill")).toBe(role.actionText);
      }
      expect(part(container, "path")!.getAttribute("stroke")).toBe(ctx.theme.inkSoft);
    });
  });
});
