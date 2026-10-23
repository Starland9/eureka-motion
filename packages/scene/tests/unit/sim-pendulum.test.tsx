// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PictogramProps } from "../../src/pictograms";
import { textWidth } from "../../src/primitives/figure/a-label";
import {
  amplitudeRadians,
  bobAt,
  DEFAULT_GRAVITY,
  MAX_AMPLITUDE_DEG,
  MIN_PERIOD_S,
  pendulumAngle,
  pendulumLayout,
  pendulumPeriod,
  type PendulumGeometry,
  type Rect,
} from "../../src/primitives/sim/pendulum-layout";
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

const PARAMS: Param[] = [
  param("L", "L", -5, 1e9, 1),
  param("a", "θ", -1e9, 1e9, 30),
  param("g", "g", -20, 100, 9.81),
];
const NO_MODEL: Model = { constants: [], derived: [] };

type Pendulum = ElementOf<"sim.pendulum">;
const PENDULUM: Pendulum = {
  id: "pend",
  slot: "figure",
  type: "sim.pendulum",
  length: { expr: "L" },
  amplitude: { expr: "a" },
};

const showing = (targets: string[], how: "fade" | "draw" = "fade"): Scene["beats"] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [{ do: "show", targets, how, at: 0 }],
  },
];
// One simulated second per 30 frames.
const PLAYING: Scene["beats"] = [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [
      { do: "show", targets: ["pend"], how: "fade", at: 0 },
      { do: "play", target: "pend", to: 4, at: 0 },
    ],
  },
];
const FPS = 30;

interface Setup {
  element?: Pendulum;
  params?: Param[];
  model?: Model;
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
  reducedMotion?: boolean;
  layout?: Scene["layout"];
}

function setup({ element = PENDULUM, params = PARAMS, model = NO_MODEL, ...rest }: Setup = {}) {
  const scene = sceneOf([element], { beats: rest.beats, layout: rest.layout });
  const ctx = testContext({
    scene,
    params,
    model,
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
const mark = (container: Element, name: string): Element | null =>
  container.querySelector(`[data-mark="${name}"]`);
const ball = (container: Element): Element | null =>
  container.querySelector('circle[data-kind="ball"]');
const textsOf = (container: Element): string[] =>
  [...container.querySelectorAll("text")].map((text) => text.textContent ?? "");

function rodOf(container: Element) {
  const shaft = mark(container, "shaft");
  return {
    x1: num(shaft, "x1"),
    y1: num(shaft, "y1"),
    x2: num(shaft, "x2"),
    y2: num(shaft, "y2"),
  };
}
const swingOf = (container: Element): number => {
  const { x1, y1, x2, y2 } = rodOf(container);
  return Math.atan2(x2 - x1, y2 - y1);
};
const rodLength = (container: Element): number => {
  const { x1, y1, x2, y2 } = rodOf(container);
  return Math.hypot(x2 - x1, y2 - y1);
};

function quarterPeriod(view: Setup): number {
  const sign = (view.values?.a ?? 30) < 0 ? -1 : 1;
  let previous = sign * swingOf(setup({ ...view, frame: 1 }).container);
  for (let frame = 2; frame < 120; frame++) {
    const current = sign * swingOf(setup({ ...view, frame }).container);
    if (previous > 0 && current <= 0) return (frame - 1 + previous / (previous - current)) / FPS;
    previous = current;
  }
  throw new Error("the rod never crossed the vertical");
}
const periodOf = (view: Setup): number => 4 * quarterPeriod({ beats: PLAYING, ...view });

const SLOTS = [
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
  { width: 1728, height: 648 },
];
const U = 16;
const CAP_HALF_HEIGHT = 1.4 * U;
const RATIOS = [0, 1e-6, 0.1, 0.5, 1, 2, 10, 1e9];
const ANGLES = [0, 1e-9, 5, 30, 60, 80, -45, -80, 1e9].map(amplitudeRadians);
const LABELS = [
  { lengthLabel: "L", angleLabel: "θ" },
  { lengthLabel: "ℓ", angleLabel: "α" },
];

const inside = (rect: Rect, slot: { width: number; height: number }): boolean =>
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.x + rect.width <= slot.width &&
  rect.y + rect.height <= slot.height;
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const discHits = (centre: readonly [number, number], radius: number, rect: Rect): boolean => {
  const dx = centre[0] - Math.min(Math.max(centre[0], rect.x), rect.x + rect.width);
  const dy = centre[1] - Math.min(Math.max(centre[1], rect.y), rect.y + rect.height);
  return Math.hypot(dx, dy) < radius;
};
const segmentHits = (from: readonly number[], to: readonly number[], rect: Rect): boolean =>
  Array.from({ length: 81 }, (_, k) => k / 80).some((t) => {
    const x = from[0]! + (to[0]! - from[0]!) * t;
    const y = from[1]! + (to[1]! - from[1]!) * t;
    return x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height;
  });
const labelBox = (centre: readonly [number, number], text: string, anchor: string): Rect => {
  const width = textWidth(text, 4 * U, true);
  const x =
    anchor === "end" ? centre[0] - width : anchor === "start" ? centre[0] : centre[0] - width / 2;
  return { x, y: centre[1] - CAP_HALF_HEIGHT, width, height: 2 * CAP_HALF_HEIGHT };
};

function boxesOf(geometry: PendulumGeometry, labels: (typeof LABELS)[number]) {
  return {
    length: labelBox(geometry.cote.label, labels.lengthLabel, geometry.cote.anchor),
    angle: labelBox(geometry.angleLabel, labels.angleLabel, "middle"),
  };
}
const swing = (geometry: PendulumGeometry): number[] =>
  Array.from({ length: 41 }, (_, k) => geometry.angle * (1 - k / 20));

const layoutOf = (
  slot: { width: number; height: number },
  lengthRatio: number,
  angle: number,
  labels = LABELS[0]!,
) => pendulumLayout(slot, U, { lengthRatio, angle, ...labels });

describe("pendulum law", () => {
  it("gives the period 2π√(L/g)", () => {
    expect(pendulumPeriod(1, 9.81)).toBeCloseTo(2.00607, 4);
    expect(pendulumPeriod(0.25, 9.81)).toBeCloseTo(1.00303, 4);
    expect(pendulumPeriod(9.81, 9.81)).toBeCloseTo(2 * Math.PI, 12);
  });

  it("doubles the period when the length is multiplied by four, halves it when g is", () => {
    for (const length of [0.1, 0.5, 1, 2.7, 25]) {
      expect(pendulumPeriod(4 * length, 9.81) / pendulumPeriod(length, 9.81)).toBeCloseTo(2, 12);
      expect(pendulumPeriod(length, 4 * 9.81) / pendulumPeriod(length, 9.81)).toBeCloseTo(0.5, 12);
    }
    expect(pendulumPeriod(9, 9.81) / pendulumPeriod(1, 9.81)).toBeCloseTo(3, 12);
  });

  it("has no period for a length or a gravity that cannot swing", () => {
    expect(pendulumPeriod(-1, 9.81)).toBe(Infinity);
    expect(pendulumPeriod(1, 0)).toBe(Infinity);
    expect(pendulumPeriod(1, -9.81)).toBe(Infinity);
    expect(pendulumPeriod(Number.NaN, 9.81)).toBe(Infinity);
    expect(pendulumPeriod(1, Number.NaN)).toBe(Infinity);
    expect(pendulumPeriod(0, 9.81)).toBe(0);
  });

  it("starts at the amplitude, crosses the vertical after a quarter period and returns after one", () => {
    const period = pendulumPeriod(1, DEFAULT_GRAVITY);
    const start = amplitudeRadians(30);
    expect(pendulumAngle(start, period, 0)).toBe(start);
    expect(pendulumAngle(start, period, period / 4)).toBeCloseTo(0, 12);
    expect(pendulumAngle(start, period, period / 2)).toBeCloseTo(-start, 12);
    expect(pendulumAngle(start, period, period)).toBeCloseTo(start, 12);
    expect(pendulumAngle(start, period, 3 * period)).toBeCloseTo(start, 9);
  });

  it("swings with the same period whatever the amplitude", () => {
    const period = pendulumPeriod(2, DEFAULT_GRAVITY);
    for (const degrees of [5, 20, 45, 80]) {
      const start = amplitudeRadians(degrees);
      expect(pendulumAngle(start, period, period / 4) / start).toBeCloseTo(0, 12);
      expect(pendulumAngle(start, period, period / 3) / start).toBeCloseTo(
        Math.cos((2 * Math.PI) / 3),
        12,
      );
    }
  });

  it("keeps the sign of the amplitude and caps it", () => {
    expect(amplitudeRadians(30)).toBeCloseTo(Math.PI / 6, 12);
    expect(amplitudeRadians(-30)).toBeCloseTo(-Math.PI / 6, 12);
    expect(amplitudeRadians(0)).toBe(0);
    expect(amplitudeRadians(1e9)).toBeCloseTo((MAX_AMPLITUDE_DEG * Math.PI) / 180, 12);
    expect(amplitudeRadians(-1e9)).toBeCloseTo((-MAX_AMPLITUDE_DEG * Math.PI) / 180, 12);
    expect(amplitudeRadians(Number.NaN)).toBe(0);
  });

  it("holds the start angle when there is no period or no time", () => {
    const start = amplitudeRadians(40);
    expect(pendulumAngle(start, Infinity, 5)).toBe(start);
    expect(pendulumAngle(start, 2, Number.NaN)).toBe(start);
  });

  it("slows a period shorter than the floor so that the swing stays readable", () => {
    const start = amplitudeRadians(40);
    expect(pendulumAngle(start, 0.01, MIN_PERIOD_S / 4)).toBeCloseTo(0, 12);
    expect(pendulumAngle(start, 0, MIN_PERIOD_S / 2)).toBeCloseTo(-start, 12);
  });
});

describe("pendulum layout", () => {
  it("hangs the pivot at the top centre and the bob below it at the end of the rod", () => {
    for (const slot of SLOTS) {
      const geometry = layoutOf(slot, 1, amplitudeRadians(30));
      expect(geometry.pivot[0]).toBe(slot.width / 2);
      expect(geometry.pivot[1]).toBeGreaterThan(0);
      const rest = bobAt(geometry, 0);
      expect(rest[0]).toBeCloseTo(slot.width / 2, 9);
      expect(rest[1]).toBeCloseTo(geometry.pivot[1] + geometry.length, 9);
      const tilted = bobAt(geometry, amplitudeRadians(30));
      expect(Math.hypot(tilted[0] - geometry.pivot[0], tilted[1] - geometry.pivot[1])).toBeCloseTo(
        geometry.length,
        9,
      );
      expect(tilted[0]).toBeGreaterThan(rest[0]);
      expect(tilted[1]).toBeLessThan(rest[1]);
    }
  });

  it("draws the rod in proportion to the length until the slot is full", () => {
    for (const slot of SLOTS) {
      const [one, mid, high] = [1, 1.2, 1.4].map(
        (ratio) => layoutOf(slot, ratio, amplitudeRadians(30)).length,
      );
      expect(mid! / one!).toBeCloseTo(1.2, 9);
      expect(high! / one!).toBeCloseTo(1.4, 9);
    }
  });

  it("keeps the rod between a minimum and what the slot allows", () => {
    for (const slot of SLOTS) {
      for (const angle of ANGLES) {
        const shortest = layoutOf(slot, 0, angle);
        const longest = layoutOf(slot, 1e9, angle);
        expect(shortest.length).toBe(10 * U);
        expect(longest.length).toBeGreaterThanOrEqual(shortest.length);
        expect(layoutOf(slot, 1e-6, angle).length).toBe(shortest.length);
        expect(layoutOf(slot, 5, angle).length).toBeLessThanOrEqual(longest.length);
      }
    }
  });

  it("keeps the whole figure inside the slot for any length and angle", () => {
    for (const slot of SLOTS) {
      for (const labels of LABELS) {
        for (const ratio of RATIOS) {
          for (const angle of ANGLES) {
            const geometry = layoutOf(slot, ratio, angle, labels);
            const { cote, radius, ceiling } = geometry;
            const where = JSON.stringify({ slot, ratio, angle });
            for (const rect of [geometry.pivotBand, ...Object.values(boxesOf(geometry, labels))]) {
              expect(inside(rect, slot), where + JSON.stringify(rect)).toBe(true);
            }
            for (const swingAngle of [-Math.abs(angle), 0, Math.abs(angle)]) {
              const [x, y] = bobAt(geometry, swingAngle);
              const reach = radius + geometry.bandPad;
              expect(
                inside({ x: x - reach, y: y - reach, width: 2 * reach, height: 2 * reach }, slot),
                where,
              ).toBe(true);
            }
            for (const [from, to] of cote.extensions) {
              for (const [x, y] of [from, to]) {
                expect(x, where).toBeGreaterThanOrEqual(0);
                expect(x, where).toBeLessThanOrEqual(slot.width);
                expect(y, where).toBeLessThanOrEqual(slot.height);
              }
            }
            expect(cote.x - cote.tick).toBeGreaterThanOrEqual(0);
            expect(cote.x + cote.tick).toBeLessThanOrEqual(slot.width);
            expect(geometry.axisEnd[1]).toBeLessThanOrEqual(slot.height);
            expect(ceiling.x0).toBeGreaterThanOrEqual(0);
            expect(ceiling.x1).toBeLessThanOrEqual(slot.width);
          }
        }
      }
    }
  });

  it("keeps the two labels clear of each other, of the ceiling and of the bob over the whole swing", () => {
    for (const slot of SLOTS) {
      for (const labels of LABELS) {
        for (const ratio of RATIOS) {
          for (const angle of ANGLES) {
            const geometry = layoutOf(slot, ratio, angle, labels);
            const boxes = boxesOf(geometry, labels);
            const where = JSON.stringify({ slot, ratio, angle });
            expect(overlap(boxes.length, boxes.angle), where).toBe(false);
            expect(boxes.angle.y, where).toBeGreaterThanOrEqual(geometry.pivot[1]);
            for (const box of Object.values(boxes)) {
              for (const phi of swing(geometry)) {
                expect(discHits(bobAt(geometry, phi), geometry.radius, box), where).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it("keeps the labels out of the way of the rod while it swings", () => {
    for (const slot of SLOTS) {
      for (const ratio of RATIOS) {
        for (const angle of ANGLES) {
          const geometry = layoutOf(slot, ratio, angle);
          const boxes = boxesOf(geometry, LABELS[0]!);
          for (const phi of swing(geometry)) {
            for (const box of Object.values(boxes)) {
              expect(
                segmentHits(geometry.pivot, bobAt(geometry, phi), box),
                JSON.stringify({ slot, ratio, angle, phi }),
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it("puts the length gauge on the side the pendulum does not start on", () => {
    const slot = SLOTS[0]!;
    const right = layoutOf(slot, 1, amplitudeRadians(30));
    const left = layoutOf(slot, 1, amplitudeRadians(-30));
    expect(right.side).toBe(1);
    expect(left.side).toBe(-1);
    expect(right.cote.x).toBeLessThan(slot.width / 2);
    expect(left.cote.x).toBeGreaterThan(slot.width / 2);
    expect(right.angleLabel[0]).toBeGreaterThan(slot.width / 2);
    expect(left.angleLabel[0]).toBeLessThan(slot.width / 2);
    expect(right.cote.anchor).toBe("end");
    expect(left.cote.anchor).toBe("start");
    expect(right.cote.bottom - right.cote.top).toBeCloseTo(right.length, 9);
    expect(left.cote.x).toBeCloseTo(slot.width - right.cote.x, 9);
  });

  it("opens the sector and the angle arc to the starting angle", () => {
    const geometry = layoutOf(SLOTS[0]!, 1, amplitudeRadians(30));
    expect(geometry.arc.length).toBeCloseTo(geometry.arc.radius * amplitudeRadians(30), 9);
    expect(geometry.arc.radius).toBeLessThan(geometry.length - geometry.radius);
    expect(geometry.sector.length).toBeCloseTo(
      2 * geometry.length + 2 * amplitudeRadians(30) * geometry.length,
      9,
    );
    expect(layoutOf(SLOTS[0]!, 1, 0).arc.length).toBe(0);
  });
});

describe("PendulumSim", () => {
  it("draws every part at the end of the entrance, with the two symbols", () => {
    const { container } = setup();
    for (const name of ["pivot", "arc", "rod", "bob"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect(textsOf(container).sort()).toEqual(["L", "θ"]);
    expect(ball(container)).not.toBeNull();
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("does not render a part that the state hides, and keeps the others", () => {
    const { container } = setup({ beats: showing(["pend.pivot", "pend.rod", "pend.bob"]) });
    expect(part(container, "arc")).toBeNull();
    for (const name of ["pivot", "rod", "bob"]) expect(part(container, name), name).not.toBeNull();
    expect(textsOf(container)).toEqual(["L"]);
  });

  it("shows a single part on its own", () => {
    const { container } = setup({ beats: showing(["pend.arc"]) });
    expect(part(container, "arc")).not.toBeNull();
    for (const name of ["pivot", "rod", "bob"]) expect(part(container, name), name).toBeNull();
    expect(textsOf(container)).toEqual(["θ"]);
  });

  it("removes a part once it has been hidden", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["pend"], how: "fade", at: 0 },
          { do: "hide", targets: ["pend.arc"], at: 0.1 },
        ],
      },
    ];
    const { container } = setup({ beats });
    expect(part(container, "arc")).toBeNull();
    expect(part(container, "rod")).not.toBeNull();
    expect(textsOf(container)).toEqual(["L"]);
  });

  it("makes the period grow with the square root of the length, measured on the rendered rod", () => {
    const period = (L: number) => periodOf({ values: { L } });
    const base = period(1);
    expect(base / pendulumPeriod(1, DEFAULT_GRAVITY)).toBeCloseTo(1, 2);
    expect(period(4) / base).toBeCloseTo(2, 2);
    expect(period(0.25) / base).toBeCloseTo(0.5, 2);
    expect(period(9) / base).toBeCloseTo(3, 2);
    expect(period(16) / period(4)).toBeCloseTo(2, 2);
  });

  it("swings with the same period for a small and a wide amplitude", () => {
    const small = periodOf({ values: { a: 10 } });
    const wide = periodOf({ values: { a: 70 } });
    expect(wide / small).toBeCloseTo(1, 2);
  });

  it("halves the period when gravity is multiplied by four", () => {
    const withGravity = { ...PENDULUM, gravity: { expr: "g" } };
    const earth = periodOf({ element: withGravity });
    const strong = periodOf({ element: withGravity, values: { g: 4 * 9.81 } });
    expect(earth / pendulumPeriod(1, 9.81)).toBeCloseTo(1, 2);
    expect(strong / earth).toBeCloseTo(0.5, 2);
    const moon = periodOf({ element: withGravity, values: { g: 1.62 } });
    expect(moon / earth).toBeCloseTo(Math.sqrt(9.81 / 1.62), 2);
  });

  it("starts the bob at the starting angle, on the right for a positive amplitude", () => {
    const early = setup({ beats: PLAYING, frame: 1 });
    expect(swingOf(early.container)).toBeCloseTo(amplitudeRadians(30), 2);
    const rod = rodOf(early.container);
    expect(rod.x2).toBeGreaterThan(rod.x1);
    const mirrored = setup({ beats: PLAYING, frame: 1, values: { a: -30 } });
    expect(swingOf(mirrored.container)).toBeCloseTo(-amplitudeRadians(30), 2);
  });

  it("swings through the vertical to the other side and back", () => {
    const at = (frame: number) => swingOf(setup({ beats: PLAYING, frame }).container);
    expect(at(1)).toBeGreaterThan(0.4);
    expect(at(10)).toBeGreaterThan(0);
    expect(at(20)).toBeLessThan(0);
    expect(at(30)).toBeLessThan(-0.4);
    expect(at(45)).toBeLessThan(0.1);
    expect(at(60)).toBeGreaterThan(0.4);
  });

  it("keeps the pivot fixed and the rod the same length during the swing", () => {
    const first = setup({ beats: PLAYING, frame: 1 });
    const lengths: number[] = [];
    for (const frame of [1, 7, 15, 22, 30, 41, 66, 100]) {
      const view = setup({ beats: PLAYING, frame });
      const rod = rodOf(view.container);
      expect(rod.x1).toBe(rodOf(first.container).x1);
      expect(rod.y1).toBe(rodOf(first.container).y1);
      lengths.push(rodLength(view.container));
      const bob = ball(view.container);
      expect(num(bob, "cx")).toBeCloseTo(rod.x2, 9);
      expect(num(bob, "cy")).toBeCloseTo(rod.y2, 9);
    }
    for (const length of lengths) expect(length).toBeCloseTo(lengths[0]!, 9);
  });

  it("draws a longer rod for a longer pendulum, within the slot", () => {
    const length = (L: number) => rodLength(setup({ values: { L } }).container);
    expect(length(1.4) / length(1)).toBeCloseTo(1.4, 9);
    expect(length(0.5) / length(1)).toBeCloseTo(0.5, 9);
    const { ctx } = setup();
    expect(length(1e9)).toBeLessThanOrEqual(ctx.size.height);
    expect(length(0)).toBeGreaterThan(0);
    expect(length(25)).toBeGreaterThan(length(1));
  });

  it("holds the start angle when no play action runs", () => {
    for (const frame of [3, 40, 90]) {
      const { container } = setup({ frame });
      expect(swingOf(container)).toBeCloseTo(amplitudeRadians(30), 9);
    }
  });

  it("holds the start angle for reduced motion, even while a play action runs", () => {
    const early = setup({ beats: PLAYING, frame: 3, reducedMotion: true });
    const late = setup({ beats: PLAYING, frame: 60, reducedMotion: true });
    expect(swingOf(early.container)).toBeCloseTo(amplitudeRadians(30), 9);
    expect(rodOf(late.container)).toEqual(rodOf(early.container));
    expect(num(ball(late.container), "cx")).toBe(num(ball(early.container), "cx"));
  });

  it("keeps every mark and label inside the slot for extreme values, at several instants", () => {
    const corners = [
      { L: 25, a: 80 },
      { L: 0.1, a: 80 },
      { L: 25, a: 5 },
      { L: 0.1, a: 5 },
      { L: 1e9, a: -1e9 },
      { L: 0, a: 0 },
      { L: -3, a: 1e-9 },
    ];
    for (const values of corners) {
      for (const layout of ["figure", "figure-notes", "compare"] as const) {
        for (const frame of [1, 12, 33, 90]) {
          const element: Pendulum =
            layout === "compare" ? { ...PENDULUM, slot: "figure_a" } : PENDULUM;
          const { container, ctx } = setup({ element, values, frame, layout, beats: PLAYING });
          const { width, height } = ctx.size;
          const where = JSON.stringify({ values, layout, frame });
          const rod = rodOf(container);
          for (const [x, y] of [
            [rod.x1, rod.y1],
            [rod.x2, rod.y2],
          ] as const) {
            expect(x, where).toBeGreaterThanOrEqual(0);
            expect(x, where).toBeLessThanOrEqual(width);
            expect(y, where).toBeGreaterThanOrEqual(0);
            expect(y, where).toBeLessThanOrEqual(height);
          }
          const bob = ball(container)!;
          const radius = 0.76 * num(bob, "r");
          expect(num(bob, "cx") - radius, where).toBeGreaterThanOrEqual(0);
          expect(num(bob, "cx") + radius, where).toBeLessThanOrEqual(width);
          expect(num(bob, "cy") + radius, where).toBeLessThanOrEqual(height);
          for (const text of container.querySelectorAll("text")) {
            const box = labelBox(
              [num(text, "x"), num(text, "y")],
              text.textContent ?? "",
              text.getAttribute("text-anchor") ?? "middle",
            );
            expect(inside(box, ctx.size), where + text.textContent).toBe(true);
          }
        }
      }
    }
  });

  it("never lets two texts overlap", () => {
    const cases: Record<string, number>[] = [
      {},
      { L: 0.1, a: 80 },
      { L: 25, a: -80 },
      { L: 25, a: 5 },
    ];
    for (const values of cases) {
      for (const frame of [1, 20, 60]) {
        const { container } = setup({ values, frame, beats: PLAYING });
        const boxes = [...container.querySelectorAll("text")].map((text) =>
          labelBox(
            [num(text, "x"), num(text, "y")],
            text.textContent ?? "",
            text.getAttribute("text-anchor") ?? "middle",
          ),
        );
        expect(boxes).toHaveLength(2);
        expect(overlap(boxes[0]!, boxes[1]!), JSON.stringify(values)).toBe(false);
      }
    }
  });

  it("fades the bob in and traces the strokes before their labels", () => {
    const fading = setup({ frame: 4, beats: showing(["pend.bob"]) });
    const opacity = num(ball(fading.container), "opacity");
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);

    const drawing = setup({
      frame: 9,
      beats: showing(["pend.rod", "pend.arc", "pend.pivot"], "draw"),
    });
    const shaft = mark(drawing.container, "shaft")!;
    expect(shaft.hasAttribute("stroke-dasharray")).toBe(true);
    expect(num(shaft, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(shaft, "stroke-dasharray")).toBeCloseTo(rodLength(drawing.container), 6);
    expect(mark(drawing.container, "sector")!.hasAttribute("stroke-dasharray")).toBe(true);
    expect(mark(drawing.container, "ceiling")!.hasAttribute("stroke-dasharray")).toBe(true);
    for (const text of drawing.container.querySelectorAll("text"))
      expect(num(text, "opacity")).toBe(0);

    const done = setup({ beats: showing(["pend.rod", "pend.arc", "pend.pivot"], "draw") });
    expect(mark(done.container, "shaft")!.hasAttribute("stroke-dasharray")).toBe(false);
    for (const text of done.container.querySelectorAll("text"))
      expect(num(text, "opacity")).toBe(1);
  });

  const highlighting = (targets: string[]): Scene["beats"] => [
    {
      id: "b1",
      narration: "Test.",
      duration_ms: 4000,
      actions: [
        { do: "show", targets: ["pend"], how: "fade", at: 0 },
        { do: "highlight", targets, at: 0.1 },
      ],
    },
  ];

  it("draws a flat result band behind each highlighted part and none behind the others", () => {
    const { container, ctx } = setup({
      beats: highlighting(["pend.pivot", "pend.arc", "pend.rod", "pend.bob"]),
    });
    for (const name of ["pivot", "arc", "rod", "bob"]) {
      const band = container.querySelector(`[data-band="${name}"]`);
      expect(band, name).not.toBeNull();
      const shape = band!.tagName === "g" ? band!.querySelector("rect") : band!;
      expect(shape!.getAttribute("fill")).toBe(ctx.theme.role.result);
    }
    const partial = setup({ beats: highlighting(["pend.rod"]) });
    expect(partial.container.querySelector('[data-band="rod"]')).not.toBeNull();
    for (const name of ["pivot", "arc", "bob"]) {
      expect(partial.container.querySelector(`[data-band="${name}"]`), name).toBeNull();
    }
    expect(setup().container.querySelector("[data-band]")).toBeNull();
  });

  it("lays the rod band along the rod and the bob band around the bob", () => {
    const { container, ctx } = setup({ beats: highlighting(["pend.rod", "pend.bob"]) });
    const rod = rodOf(container);
    const polygon = container.querySelector('[data-band="rod"]')!;
    const points = polygon
      .getAttribute("points")!
      .split(" ")
      .map((pair) => pair.split(",").map(Number) as [number, number]);
    expect(points).toHaveLength(4);
    const mid: [number, number] = [
      (points[0]![0] + points[3]![0]) / 2,
      (points[0]![1] + points[3]![1]) / 2,
    ];
    expect(mid[0]).toBeCloseTo(rod.x1, 6);
    expect(mid[1]).toBeCloseTo(rod.y1, 6);
    const far: [number, number] = [
      (points[1]![0] + points[2]![0]) / 2,
      (points[1]![1] + points[2]![1]) / 2,
    ];
    expect(far[0]).toBeCloseTo(rod.x2, 6);
    expect(far[1]).toBeCloseTo(rod.y2, 6);
    expect(Math.hypot(points[0]![0] - points[3]![0], points[0]![1] - points[3]![1])).toBeCloseTo(
      1.6 * ctx.u,
      6,
    );
    const disc = container.querySelector('[data-band="bob"]')!;
    expect(num(disc, "cx")).toBeCloseTo(rod.x2, 9);
    expect(num(disc, "cy")).toBeCloseTo(rod.y2, 9);
    expect(num(disc, "r")).toBeGreaterThan(0.76 * num(ball(container), "r"));
  });

  it("draws the bands under the ceiling, the sector, the rod and the bob", () => {
    const { container } = setup({
      beats: highlighting(["pend.pivot", "pend.rod", "pend.bob", "pend.arc"]),
    });
    const children = [...container.querySelector("svg > g")!.children];
    const index = (name: string) =>
      children.findIndex((child) => child.getAttribute("data-part") === name);
    const lastBand = Math.max(
      ...children.map((child, k) => (child.hasAttribute("data-band") ? k : -1)),
    );
    expect(lastBand).toBeGreaterThanOrEqual(0);
    expect(lastBand).toBeLessThan(index("pivot"));
    expect(index("pivot")).toBeLessThan(index("arc"));
    expect(index("arc")).toBeLessThan(index("rod"));
    expect(index("rod")).toBeLessThan(index("bob"));
  });

  it("names the quantities after the symbols of the model", () => {
    const { container } = setup({
      params: [param("long", "ℓ", 0.1, 25, 1), param("ang", "α", 5, 80, 30)],
      element: { ...PENDULUM, length: { expr: "long" }, amplitude: { expr: "ang" } },
    });
    expect(textsOf(container).sort()).toEqual(["α", "ℓ"]);
  });

  it("falls back to L and θ when a value is a number, an expression or has no symbol", () => {
    const literal = setup({ element: { ...PENDULUM, length: 1, amplitude: { expr: "a * 1" } } });
    expect(textsOf(literal.container).sort()).toEqual(["L", "θ"]);
    const derived = setup({
      model: {
        constants: [],
        derived: [
          { id: "len", expr: "L * 1", unit: "m", label: "" },
          { id: "ang", expr: "a * 1", unit: "°", label: "" },
        ],
      },
      element: { ...PENDULUM, length: { expr: "len" }, amplitude: { expr: "ang" } },
    });
    expect(textsOf(derived.container).sort()).toEqual(["L", "θ"]);
  });

  it("sets the symbols in italic and draws the ball pictogram for the bob", () => {
    const { container } = setup();
    for (const text of container.querySelectorAll("text")) {
      expect(text.getAttribute("font-style")).toBe("italic");
    }
    expect(ball(container)!.closest('[data-part="bob"]')).not.toBeNull();
  });

  it("measures the length above the pendulum at rest, with a gauge as long as the rod", () => {
    const { container } = setup();
    const gauge = [...mark(container, "length")!.querySelectorAll("line")].find(
      (line) => line.getAttribute("x1") === line.getAttribute("x2"),
    )!;
    expect(Math.abs(num(gauge, "y2") - num(gauge, "y1"))).toBeCloseTo(rodLength(container), 9);
    expect(num(gauge, "y1")).toBeCloseTo(rodOf(container).y1, 9);
    expect(num(gauge, "x1")).toBeLessThan(rodOf(container).x1);
  });

  describe.each<ThemeName>(["paper", "board"])("in the %s theme", (theme) => {
    it("takes every colour from the theme tokens", () => {
      const { container, ctx } = setup({
        theme,
        beats: highlighting(["pend.pivot", "pend.arc", "pend.rod", "pend.bob"]),
      });
      const tokens = new Set([
        ctx.theme.ink,
        ctx.theme.rule,
        ctx.theme.surface,
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

    it("colours the gauge, the angle and the symbols as quantities, the structure in ink", () => {
      const { container, ctx } = setup({ theme });
      const { role } = ctx.theme;
      for (const text of container.querySelectorAll("text")) {
        expect(text.getAttribute("fill")).toBe(role.quantity);
      }
      expect(mark(container, "angle")!.getAttribute("stroke")).toBe(role.quantity);
      for (const line of mark(container, "length")!.querySelectorAll("line")) {
        expect(line.getAttribute("stroke")).toBe(role.quantity);
      }
      expect(mark(container, "shaft")!.getAttribute("stroke")).toBe(ctx.theme.ink);
      expect(mark(container, "ceiling")!.getAttribute("stroke")).toBe(ctx.theme.ink);
      expect(mark(container, "dot")!.getAttribute("fill")).toBe(ctx.theme.ink);
      expect(mark(container, "sector")!.getAttribute("stroke")).toBe(ctx.theme.rule);
      expect(mark(container, "axis")!.getAttribute("stroke")).toBe(ctx.theme.rule);
    });
  });

  it("turns the ink strokes over a highlighted band dark on the blackboard only", () => {
    const beats = highlighting(["pend.pivot", "pend.rod"]);
    const board = setup({ theme: "board", beats });
    expect(mark(board.container, "shaft")!.getAttribute("stroke")).toBe(board.ctx.theme.surface);
    expect(mark(board.container, "ceiling")!.getAttribute("stroke")).toBe(board.ctx.theme.surface);
    expect(mark(board.container, "hatch")!.getAttribute("stroke")).toBe(board.ctx.theme.surface);
    expect(mark(board.container, "dot")!.getAttribute("fill")).toBe(board.ctx.theme.surface);
    const paper = setup({ theme: "paper", beats });
    expect(mark(paper.container, "shaft")!.getAttribute("stroke")).toBe(paper.ctx.theme.ink);
    expect(mark(paper.container, "dot")!.getAttribute("fill")).toBe(paper.ctx.theme.ink);
    const plain = setup({ theme: "board" });
    expect(mark(plain.container, "shaft")!.getAttribute("stroke")).toBe(plain.ctx.theme.ink);
    const early = setup({ theme: "board", beats, frame: 1 });
    expect(mark(early.container, "shaft")!.getAttribute("stroke")).toBe(early.ctx.theme.ink);
  });

  it("uses only the quantity role, as declared for the simulation", () => {
    const { container, ctx } = setup({ beats: highlighting(["pend"]) });
    const { role } = ctx.theme;
    for (const element of container.querySelectorAll("[fill], [stroke]")) {
      for (const name of ["fill", "stroke"]) {
        const value = element.getAttribute(name);
        for (const other of [role.action, role.actionText, role.valid])
          expect(value).not.toBe(other);
      }
    }
  });

  it("draws the rod at the regular weight and the bands without stroke", () => {
    const { container, ctx } = setup({ beats: highlighting(["pend"]) });
    expect(num(mark(container, "shaft"), "stroke-width")).toBeCloseTo(0.25 * ctx.u, 9);
    expect(num(mark(container, "sector"), "stroke-width")).toBeCloseTo(0.125 * ctx.u, 9);
    for (const band of container.querySelectorAll("[data-band]")) {
      expect(band.hasAttribute("stroke")).toBe(false);
    }
  });
});
