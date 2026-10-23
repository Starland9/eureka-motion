// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { textWidth } from "../../src/primitives/figure/a-label";
import {
  MAX_RATE_RATIO,
  REFERENCE_RATE,
  waveCurve,
  waveLayout,
  wavelengthRatio,
  type Rect,
  type WaveGeometry,
} from "../../src/primitives/sim/wave-layout";
import type { ElementOf, Model, Param, Scene } from "../../src/schema/document";
import type { ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext } from "../helpers/scene";

const param = (id: string, symbol: string, min: number, max: number, value: number): Param => ({
  id,
  symbol,
  label: id,
  unit: "",
  min,
  max,
  step: 1,
  default: value,
  role: "quantity",
});

const PARAMS: Param[] = [
  param("A", "A", -5, 1e9, 4),
  param("f", "f", -5, 1e9, 2),
  param("v", "v", -5, 1e9, 4),
];
const NO_MODEL: Model = { constants: [], derived: [] };

type Wave = ElementOf<"sim.wave">;
const WAVE: Wave = {
  id: "wv",
  slot: "figure",
  type: "sim.wave",
  amplitude: { expr: "A" },
  frequency: { expr: "f" },
};
const FAST: Wave = { ...WAVE, speed: { expr: "v" } };

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
      { do: "show", targets: ["wv"], how: "fade", at: 0 },
      { do: "play", target: "wv", to: 4, at: 0 },
    ],
  },
];
const FPS = 30;

interface Setup {
  element?: Wave;
  params?: Param[];
  model?: Model;
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
  reducedMotion?: boolean;
  layout?: Scene["layout"];
}

function setup({ element = WAVE, params = PARAMS, model = NO_MODEL, ...rest }: Setup = {}) {
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
const textsOf = (container: Element): string[] =>
  [...container.querySelectorAll("text")].map((text) => text.textContent ?? "");

const curveOf = (container: Element): [number, number][] =>
  (part(container, "wave")?.getAttribute("points") ?? "")
    .split(" ")
    .map((pair) => pair.split(",").map(Number) as [number, number]);
const rulerLength = (container: Element): number =>
  num(mark(container, "ruler"), "x2") - num(mark(container, "ruler"), "x1");
const gaugeLength = (container: Element): number =>
  num(mark(container, "gauge"), "y2") - num(mark(container, "gauge"), "y1");

function upwardCrossings(points: readonly (readonly [number, number])[], axisY: number): number[] {
  const xs: number[] = [];
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1]!;
    const [x1, y1] = points[k]!;
    if (y0 > axisY && y1 <= axisY) xs.push(x0 + ((x1 - x0) * (y0 - axisY)) / (y0 - y1));
  }
  return xs;
}
const spatialPeriod = (view: Setup): number => {
  const { container } = setup({ frame: 1, beats: PLAYING, ...view });
  const xs = upwardCrossings(curveOf(container), num(mark(container, "baseline"), "y1"));
  expect(xs.length).toBeGreaterThan(1);
  return (xs.at(-1)! - xs[0]!) / (xs.length - 1);
};
const crestShift = (view: Setup, from: number, to: number): number => {
  const first = setup({ ...view, beats: PLAYING, frame: from }).container;
  const second = setup({ ...view, beats: PLAYING, frame: to }).container;
  const axis = num(mark(first, "baseline"), "y1");
  const wavelength = rulerLength(first);
  const delta =
    upwardCrossings(curveOf(second), axis)[0]! - upwardCrossings(curveOf(first), axis)[0]!;
  return ((delta % wavelength) + wavelength) % wavelength;
};

const SLOTS = [
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
  { width: 1728, height: 648 },
];
const U = 16;
const CAP_HALF_HEIGHT = 1.4 * U;
const RATIOS = [0, 1e-6, 0.1, 0.5, 1, 2, 10, 1e9];
const UNIT = { amplitudeRatio: 1, frequencyRatio: 1, speedRatio: 1 };

const reachOf = (slot: { width: number }): number => slot.width - 12 * U;
const inside = (rect: Rect, slot: { width: number; height: number }): boolean =>
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.x + rect.width <= slot.width &&
  rect.y + rect.height <= slot.height;
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const labelBox = (centre: readonly [number, number], text: string, anchor: string): Rect => {
  const width = textWidth(text, 4 * U, true);
  const x =
    anchor === "end" ? centre[0] - width : anchor === "start" ? centre[0] : centre[0] - width / 2;
  return { x, y: centre[1] - CAP_HALF_HEIGHT, width, height: 2 * CAP_HALF_HEIGHT };
};
const boxesOf = (geometry: WaveGeometry) => ({
  wavelength: labelBox(geometry.ruler.label, "λ", "middle"),
  amplitude: labelBox(geometry.gauge.label, "A", "end"),
});

describe("wave layout", () => {
  it("gives the wavelength v / f as a ratio, unbounded when the frequency is nil", () => {
    expect(wavelengthRatio(1, 1)).toBe(1);
    expect(wavelengthRatio(2, 1)).toBe(0.5);
    expect(wavelengthRatio(0.5, 1)).toBe(2);
    expect(wavelengthRatio(2, 3)).toBe(1.5);
    expect(wavelengthRatio(0, 1)).toBe(Infinity);
    expect(wavelengthRatio(-1, 1)).toBe(Infinity);
  });

  it("divides the wavelength by two when the frequency doubles", () => {
    for (const slot of SLOTS) {
      const wavelength = (frequencyRatio: number) =>
        waveLayout(slot, U, { ...UNIT, frequencyRatio }).wavelength;
      expect(wavelength(1)).toBeCloseTo(0.28 * reachOf(slot), 9);
      expect(wavelength(2) / wavelength(1)).toBeCloseTo(0.5, 12);
      expect(wavelength(1) / wavelength(0.5)).toBeCloseTo(0.5, 12);
      expect(wavelength(1.5) / wavelength(0.75)).toBeCloseTo(0.5, 12);
      expect(wavelength(1.5) * 1.5).toBeCloseTo(wavelength(1), 9);
    }
  });

  it("multiplies the wavelength by two when the speed doubles at a given frequency", () => {
    for (const slot of SLOTS) {
      const wavelength = (speedRatio: number) =>
        waveLayout(slot, U, { ...UNIT, frequencyRatio: 1.5, speedRatio }).wavelength;
      expect(wavelength(1.5) / wavelength(0.75)).toBeCloseTo(2, 12);
    }
  });

  it("keeps the wave speed, wavelength times rate, when only the frequency changes", () => {
    for (const slot of SLOTS) {
      const speed = (frequencyRatio: number, speedRatio = 1) => {
        const { wavelength, rate } = waveLayout(slot, U, { ...UNIT, frequencyRatio, speedRatio });
        return wavelength * rate;
      };
      expect(speed(0.5)).toBeCloseTo(speed(1), 9);
      expect(speed(2)).toBeCloseTo(speed(1), 9);
      expect(speed(1, 2)).toBeCloseTo(2 * speed(1), 9);
    }
  });

  it("makes the crests pass faster when the frequency rises", () => {
    const slot = SLOTS[0]!;
    const rate = (frequencyRatio: number) => waveLayout(slot, U, { ...UNIT, frequencyRatio }).rate;
    expect(rate(1)).toBe(REFERENCE_RATE);
    expect(rate(2) / rate(1)).toBe(2);
    expect(rate(0.5) / rate(1)).toBe(0.5);
    expect(rate(0)).toBe(0);
    expect(rate(1e9)).toBe(MAX_RATE_RATIO * REFERENCE_RATE);
    expect(rate(-3)).toBe(0);
  });

  it("scales the amplitude in proportion until the figure is full", () => {
    for (const slot of SLOTS) {
      const amplitude = (amplitudeRatio: number) =>
        waveLayout(slot, U, { ...UNIT, amplitudeRatio }).amplitude;
      expect(amplitude(2) / amplitude(1)).toBeCloseTo(2, 12);
      expect(amplitude(0.5) / amplitude(1)).toBeCloseTo(0.5, 12);
      expect(amplitude(0)).toBe(0);
      expect(amplitude(1e9)).toBeGreaterThan(amplitude(2));
      expect(amplitude(1e9)).toBeLessThan(slot.height / 2);
    }
  });

  it("keeps the wavelength between a minimum and the width of the curve", () => {
    for (const slot of SLOTS) {
      const longest = waveLayout(slot, U, { ...UNIT, frequencyRatio: 0 });
      const shortest = waveLayout(slot, U, { ...UNIT, frequencyRatio: 1e9 });
      expect(longest.wavelength).toBeCloseTo(reachOf(slot), 9);
      expect(shortest.wavelength).toBeCloseTo(3.5 * U, 9);
      expect(waveLayout(slot, U, { ...UNIT, speedRatio: 0 }).wavelength).toBeCloseTo(3.5 * U, 9);
      expect(waveLayout(slot, U, { ...UNIT, speedRatio: 1e9 }).wavelength).toBeCloseTo(
        reachOf(slot),
        9,
      );
    }
  });

  it("draws a sine that starts on a crest and repeats every wavelength", () => {
    const slot = SLOTS[0]!;
    const geometry = waveLayout(slot, U, UNIT);
    const curve = waveCurve(geometry, 0);
    expect(curve).toHaveLength(geometry.samples + 1);
    expect(curve[0]![0]).toBe(geometry.left);
    expect(curve.at(-1)![0]).toBeCloseTo(geometry.right, 9);
    expect(curve[0]![1]).toBeCloseTo(geometry.axisY - geometry.amplitude, 9);
    for (const [x, y] of curve) {
      expect(y).toBeGreaterThanOrEqual(geometry.axisY - geometry.amplitude - 1e-9);
      expect(y).toBeLessThanOrEqual(geometry.axisY + geometry.amplitude + 1e-9);
      const ahead = waveCurve({ ...geometry }, 0).find(
        (point) => Math.abs(point[0] - (x + geometry.wavelength)) < 1e-6,
      );
      if (ahead) expect(ahead[1]).toBeCloseTo(y, 6);
    }
    const crossings = upwardCrossings(curve, geometry.axisY);
    for (let k = 1; k < crossings.length; k++) {
      expect(crossings[k]! - crossings[k - 1]!).toBeCloseTo(geometry.wavelength, 0);
    }
  });

  it("moves the crests to the right as the phase grows, and comes back after a whole cycle", () => {
    const geometry = waveLayout(SLOTS[0]!, U, UNIT);
    const at = (phase: number) => waveCurve(geometry, phase);
    const firstCrossing = (phase: number) => upwardCrossings(at(phase), geometry.axisY)[0]!;
    const shift = (phase: number) =>
      (((firstCrossing(phase) - firstCrossing(0)) % geometry.wavelength) + geometry.wavelength) %
      geometry.wavelength;
    expect(shift(0.1) / geometry.wavelength).toBeCloseTo(0.1, 1);
    expect(shift(0.25) / geometry.wavelength).toBeCloseTo(0.25, 1);
    expect(shift(0.4) / geometry.wavelength).toBeCloseTo(0.4, 1);
    for (const [k, [, y]] of at(1).entries()) expect(y).toBeCloseTo(at(0)[k]![1], 6);
  });

  it("keeps the whole figure inside the slot for any amplitude, frequency and speed", () => {
    for (const slot of SLOTS) {
      for (const amplitudeRatio of RATIOS) {
        for (const frequencyRatio of RATIOS) {
          for (const speedRatio of [0, 0.3, 1, 7, 1e9]) {
            const geometry = waveLayout(slot, U, { amplitudeRatio, frequencyRatio, speedRatio });
            const where = JSON.stringify({ slot, amplitudeRatio, frequencyRatio, speedRatio });
            const { ruler, gauge } = geometry;
            for (const rect of [
              ruler.band,
              gauge.band,
              geometry.curveBand,
              ...Object.values(boxesOf(geometry)),
            ]) {
              expect(inside(rect, slot), where + JSON.stringify(rect)).toBe(true);
            }
            expect(ruler.left).toBeGreaterThanOrEqual(0);
            expect(ruler.right).toBeLessThanOrEqual(geometry.right + 1e-9);
            expect(ruler.y - ruler.tick).toBeGreaterThan(0);
            expect(gauge.levelFrom).toBeGreaterThanOrEqual(0);
            expect(geometry.right).toBeLessThanOrEqual(slot.width);
            for (const phase of [0, 0.37]) {
              const curve = waveCurve(geometry, phase);
              expect(Math.min(...curve.map(([x]) => x)), where).toBeGreaterThanOrEqual(0);
              expect(Math.max(...curve.map(([x]) => x)), where).toBeLessThanOrEqual(slot.width);
              expect(Math.min(...curve.map(([, y]) => y)), where).toBeGreaterThanOrEqual(0);
              expect(Math.max(...curve.map(([, y]) => y)), where).toBeLessThanOrEqual(slot.height);
            }
          }
        }
      }
    }
  });

  it("keeps the two labels clear of each other, of the curve, of the ruler and of the gauge", () => {
    for (const slot of SLOTS) {
      for (const amplitudeRatio of RATIOS) {
        for (const frequencyRatio of RATIOS) {
          const geometry = waveLayout(slot, U, { ...UNIT, amplitudeRatio, frequencyRatio });
          const boxes = boxesOf(geometry);
          const { ruler, gauge } = geometry;
          const where = JSON.stringify({ slot, amplitudeRatio, frequencyRatio });
          expect(overlap(boxes.wavelength, boxes.amplitude), where).toBe(false);
          expect(boxes.amplitude.x + boxes.amplitude.width, where).toBeLessThan(
            gauge.x - gauge.tick,
          );
          expect(boxes.amplitude.x + boxes.amplitude.width, where).toBeLessThan(geometry.left);
          expect(boxes.wavelength.y + boxes.wavelength.height, where).toBeLessThan(
            ruler.y - ruler.tick,
          );
          expect(ruler.y + ruler.tick, where).toBeLessThan(geometry.axisY - geometry.amplitude);
        }
      }
    }
  });

  it("puts the ruler above the crests, just clear of the envelope", () => {
    const geometry = waveLayout(SLOTS[0]!, U, UNIT);
    expect(geometry.ruler.y).toBeCloseTo(geometry.axisY - geometry.amplitude - 2.4 * U, 9);
    const small = waveLayout(SLOTS[0]!, U, { ...UNIT, amplitudeRatio: 0.2 });
    expect(small.ruler.y).toBeGreaterThan(geometry.ruler.y);
    expect(small.ruler.y).toBeCloseTo(small.axisY - small.amplitude - 2.4 * U, 9);
  });

  it("measures the amplitude from the axis up to the crest level", () => {
    const geometry = waveLayout(SLOTS[0]!, U, UNIT);
    expect(geometry.gauge.bottom).toBe(geometry.axisY);
    expect(geometry.gauge.bottom - geometry.gauge.top).toBeCloseTo(geometry.amplitude, 12);
    expect(geometry.gauge.x).toBeLessThan(geometry.left);
  });
});

describe("WaveSim", () => {
  it("draws every part at the end of the entrance, with the two symbols", () => {
    const { container } = setup();
    for (const name of ["wave", "wavelength", "amplitude"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect(textsOf(container).sort()).toEqual(["A", "λ"]);
    expect(curveOf(container).length).toBeGreaterThan(100);
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("does not render a part that the state hides, and keeps the others", () => {
    const { container } = setup({ beats: showing(["wv.wave", "wv.amplitude"]) });
    expect(part(container, "wavelength")).toBeNull();
    for (const name of ["wave", "amplitude"]) expect(part(container, name), name).not.toBeNull();
    expect(textsOf(container)).toEqual(["A"]);
  });

  it("shows a single part on its own", () => {
    const { container } = setup({ beats: showing(["wv.wavelength"]) });
    expect(part(container, "wavelength")).not.toBeNull();
    for (const name of ["wave", "amplitude"]) expect(part(container, name), name).toBeNull();
    expect(textsOf(container)).toEqual(["λ"]);
  });

  it("removes a part once it has been hidden", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["wv"], how: "fade", at: 0 },
          { do: "hide", targets: ["wv.wavelength"], at: 0.1 },
        ],
      },
    ];
    const { container } = setup({ beats });
    expect(part(container, "wavelength")).toBeNull();
    expect(part(container, "wave")).not.toBeNull();
    expect(textsOf(container)).toEqual(["A"]);
  });

  it("divides the wavelength by two when the frequency doubles, on the ruler and on the curve", () => {
    const base = setup();
    const doubled = setup({ values: { f: 4 } });
    const halved = setup({ values: { f: 1 } });
    expect(rulerLength(doubled.container) / rulerLength(base.container)).toBeCloseTo(0.5, 9);
    expect(rulerLength(halved.container) / rulerLength(base.container)).toBeCloseTo(2, 9);

    const period = spatialPeriod({ values: {} });
    expect(period / rulerLength(base.container)).toBeCloseTo(1, 2);
    expect(spatialPeriod({ values: { f: 4 } }) / period).toBeCloseTo(0.5, 2);
    expect(spatialPeriod({ values: { f: 8 } }) / period).toBeCloseTo(0.25, 2);
    expect(spatialPeriod({ values: { f: 1 } }) / period).toBeCloseTo(2, 2);
    expect(spatialPeriod({ values: { f: 3 } }) * 3).toBeCloseTo(period * 2, 0);
  });

  it("multiplies the wavelength by two when the speed doubles", () => {
    const base = setup({ element: FAST });
    const faster = setup({ element: FAST, values: { v: 8 } });
    const slower = setup({ element: FAST, values: { v: 2 } });
    expect(rulerLength(faster.container) / rulerLength(base.container)).toBeCloseTo(2, 9);
    expect(rulerLength(slower.container) / rulerLength(base.container)).toBeCloseTo(0.5, 9);
    expect(rulerLength(base.container)).toBeCloseTo(rulerLength(setup().container), 9);
    const both = setup({ element: FAST, values: { v: 8, f: 4 } });
    expect(rulerLength(both.container)).toBeCloseTo(rulerLength(base.container), 9);
  });

  it("moves the crests to the right at the speed v, whatever the frequency", () => {
    const shift = (values: Record<string, number>, element: Wave = WAVE) =>
      crestShift({ values, element }, 1, 4);
    const slow = shift({});
    expect(slow).toBeGreaterThan(0);
    expect(shift({ f: 4 }) / slow).toBeCloseTo(1, 1);
    expect(shift({ f: 8 }) / slow).toBeCloseTo(1, 1);
    expect(shift({ v: 8 }, FAST) / shift({}, FAST)).toBeCloseTo(2, 1);
    const wavelength = rulerLength(setup().container);
    expect(slow / wavelength).toBeCloseTo((3 / FPS) * REFERENCE_RATE, 1);
  });

  it("reads the amplitude on the gauge and on the crests", () => {
    const base = setup();
    const tall = setup({ values: { A: 6 } });
    const flat = setup({ values: { A: 2 } });
    expect(Math.abs(gaugeLength(tall.container) / gaugeLength(base.container))).toBeCloseTo(1.5, 9);
    expect(Math.abs(gaugeLength(flat.container) / gaugeLength(base.container))).toBeCloseTo(0.5, 9);
    const axis = num(mark(base.container, "baseline"), "y1");
    const top = Math.min(...curveOf(base.container).map(([, y]) => y));
    expect(axis - top).toBeCloseTo(Math.abs(gaugeLength(base.container)), 1);
    const levels = [...base.container.querySelectorAll('[data-mark="level"]')].map((line) =>
      num(line, "y1"),
    );
    expect(levels.sort((a, b) => a - b)).toEqual([
      axis - Math.abs(gaugeLength(base.container)),
      axis + Math.abs(gaugeLength(base.container)),
    ]);
  });

  it("holds the sine at its first crest when no play action runs", () => {
    const first = setup({ frame: 3 });
    const later = setup({ frame: 90 });
    expect(curveOf(later.container)).toEqual(curveOf(first.container));
    const axis = num(mark(first.container, "baseline"), "y1");
    expect(axis - curveOf(first.container)[0]![1]).toBeCloseTo(
      Math.abs(gaugeLength(first.container)),
      9,
    );
  });

  it("holds the sine still for reduced motion, even while a play action runs", () => {
    const early = setup({ beats: PLAYING, frame: 3, reducedMotion: true });
    const late = setup({ beats: PLAYING, frame: 60, reducedMotion: true });
    const still = setup({ frame: 60 });
    expect(curveOf(late.container)).toEqual(curveOf(early.container));
    expect(curveOf(late.container)).toEqual(curveOf(still.container));
    const moving = setup({ beats: PLAYING, frame: 60 });
    expect(curveOf(moving.container)).not.toEqual(curveOf(early.container));
  });

  it("keeps the ruler, the gauge, the labels and the curve inside the slot at extreme values", () => {
    const corners = [
      { A: 1e9, f: -5, v: 4 },
      { A: 0, f: 1e9, v: 1e9 },
      { A: 1e9, f: 1e9, v: 0 },
      { A: 0.01, f: 0.001, v: 1e9 },
      { A: 4, f: 2, v: 4 },
    ];
    for (const values of corners) {
      for (const layout of ["figure", "figure-notes", "compare"] as const) {
        for (const frame of [1, 25, 90]) {
          const element: Wave = layout === "compare" ? { ...FAST, slot: "figure_a" } : FAST;
          const { container, ctx } = setup({ element, values, frame, layout, beats: PLAYING });
          const { width, height } = ctx.size;
          const where = JSON.stringify({ values, layout, frame });
          for (const [x, y] of curveOf(container)) {
            expect(x, where).toBeGreaterThanOrEqual(0);
            expect(x, where).toBeLessThanOrEqual(width);
            expect(y, where).toBeGreaterThanOrEqual(0);
            expect(y, where).toBeLessThanOrEqual(height);
          }
          const ruler = mark(container, "ruler")!;
          expect(num(ruler, "x1"), where).toBeGreaterThanOrEqual(0);
          expect(num(ruler, "x2"), where).toBeLessThanOrEqual(width);
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

  it("never lets the two texts overlap", () => {
    const cases: Record<string, number>[] = [
      {},
      { A: 1e9, f: 1e9 },
      { A: 0, f: -5 },
      { A: 1e9, f: 0.001, v: 1e9 },
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

  it("fades the parts in, then traces the strokes before their labels", () => {
    const drawing = setup({
      frame: 9,
      beats: showing(["wv.wave", "wv.wavelength", "wv.amplitude"], "draw"),
    });
    for (const element of [
      part(drawing.container, "wave")!,
      mark(drawing.container, "ruler")!,
      mark(drawing.container, "gauge")!,
      mark(drawing.container, "baseline")!,
    ]) {
      expect(element.hasAttribute("stroke-dasharray")).toBe(true);
      expect(num(element, "stroke-dashoffset")).toBeGreaterThan(0);
    }
    for (const text of drawing.container.querySelectorAll("text"))
      expect(num(text, "opacity")).toBe(0);
    expect(num(mark(drawing.container, "level"), "opacity")).toBeGreaterThan(0);
    expect(num(mark(drawing.container, "level"), "opacity")).toBeLessThan(1);

    const done = setup({ beats: showing(["wv.wave", "wv.wavelength", "wv.amplitude"], "draw") });
    expect(part(done.container, "wave")!.hasAttribute("stroke-dasharray")).toBe(false);
    for (const text of done.container.querySelectorAll("text"))
      expect(num(text, "opacity")).toBe(1);
  });

  const highlighting = (targets: string[]): Scene["beats"] => [
    {
      id: "b1",
      narration: "Test.",
      duration_ms: 4000,
      actions: [
        { do: "show", targets: ["wv"], how: "fade", at: 0 },
        { do: "highlight", targets, at: 0.1 },
      ],
    },
  ];

  it("draws a flat result band behind each highlighted part and none behind the others", () => {
    const { container, ctx } = setup({
      beats: highlighting(["wv.wave", "wv.wavelength", "wv.amplitude"]),
    });
    for (const name of ["wave", "wavelength", "amplitude"]) {
      const bands = container.querySelectorAll(`[data-band="${name}"] rect`);
      expect(bands.length, name).toBe(1);
      expect(bands[0]!.getAttribute("fill")).toBe(ctx.theme.role.result);
      expect(num(bands[0], "width")).toBeGreaterThan(0);
    }
    const partial = setup({ beats: highlighting(["wv.wavelength"]) });
    expect(partial.container.querySelector('[data-band="wavelength"]')).not.toBeNull();
    for (const name of ["wave", "amplitude"]) {
      expect(partial.container.querySelector(`[data-band="${name}"]`), name).toBeNull();
    }
    expect(setup().container.querySelector("[data-band]")).toBeNull();
  });

  it("puts the bands around their part and keeps the labels off them", () => {
    const { container, ctx } = setup({
      beats: highlighting(["wv.wavelength", "wv.amplitude"]),
    });
    const band = (name: string) => container.querySelector(`[data-band="${name}"] rect`)!;
    const ruler = mark(container, "ruler")!;
    const rulerBand = band("wavelength");
    expect(num(rulerBand, "x")).toBeLessThan(num(ruler, "x1"));
    expect(num(rulerBand, "x") + num(rulerBand, "width")).toBeGreaterThan(num(ruler, "x2"));
    expect(num(rulerBand, "y")).toBeLessThan(num(ruler, "y1"));
    expect(num(rulerBand, "y") + num(rulerBand, "height")).toBeGreaterThan(num(ruler, "y1"));
    const label = labelBox(
      [
        num(part(container, "wavelength")!.querySelector("text"), "x"),
        num(part(container, "wavelength")!.querySelector("text"), "y"),
      ],
      "λ",
      "middle",
    );
    expect(num(rulerBand, "y")).toBeGreaterThan(label.y + label.height - 0.5 * ctx.u);
    const gauge = mark(container, "gauge")!;
    const gaugeBand = band("amplitude");
    expect(num(gaugeBand, "x")).toBeLessThan(num(gauge, "x1"));
    expect(num(gaugeBand, "x") + num(gaugeBand, "width")).toBeGreaterThan(num(gauge, "x1"));
  });

  it("draws the bands under the baseline, the ruler and the curve", () => {
    const { container } = setup({
      beats: highlighting(["wv.wave", "wv.wavelength", "wv.amplitude"]),
    });
    const children = [...container.querySelector("svg > g")!.children];
    const index = (name: string) =>
      children.findIndex((child) => child.getAttribute("data-part") === name);
    const lastBand = Math.max(
      ...children.map((child, k) => (child.hasAttribute("data-band") ? k : -1)),
    );
    expect(lastBand).toBeGreaterThanOrEqual(0);
    expect(lastBand).toBeLessThan(index("amplitude"));
    expect(index("amplitude")).toBeLessThan(index("wavelength"));
    expect(index("wavelength")).toBeLessThan(index("wave"));
  });

  it("names the amplitude after the symbol of the model and the wavelength λ", () => {
    const { container } = setup({
      params: [param("amp", "ψ", 1, 10, 4), param("f", "f", 1, 8, 2)],
      element: { ...WAVE, amplitude: { expr: "amp" } },
    });
    expect(textsOf(container).sort()).toEqual(["λ", "ψ"]);
  });

  it("falls back to A when the amplitude is a number, an expression or has no symbol", () => {
    const literal = setup({ element: { ...WAVE, amplitude: 4 } });
    expect(textsOf(literal.container).sort()).toEqual(["A", "λ"]);
    const expression = setup({ element: { ...WAVE, amplitude: { expr: "A * 1" } } });
    expect(textsOf(expression.container).sort()).toEqual(["A", "λ"]);
    const derived = setup({
      model: { constants: [], derived: [{ id: "amp", expr: "A * 1", unit: "cm", label: "" }] },
      element: { ...WAVE, amplitude: { expr: "amp" } },
    });
    expect(textsOf(derived.container).sort()).toEqual(["A", "λ"]);
  });

  it("sets the two symbols in italic", () => {
    const { container } = setup();
    for (const text of container.querySelectorAll("text")) {
      expect(text.getAttribute("font-style")).toBe("italic");
    }
  });

  it("draws the curve at the accent weight and the axis at the regular weight", () => {
    const { container, ctx } = setup();
    expect(num(part(container, "wave"), "stroke-width")).toBeCloseTo(0.5 * ctx.u, 9);
    expect(num(mark(container, "baseline"), "stroke-width")).toBeCloseTo(0.25 * ctx.u, 9);
    expect(num(mark(container, "ruler"), "stroke-width")).toBeCloseTo(0.25 * ctx.u, 9);
    expect(num(mark(container, "level"), "stroke-width")).toBeCloseTo(0.125 * ctx.u, 9);
    const baseline = mark(container, "baseline")!;
    expect(num(baseline, "y1")).toBe(num(baseline, "y2"));
    expect(num(baseline, "x2")).toBeLessThanOrEqual(ctx.size.width);
  });

  describe.each<ThemeName>(["paper", "board"])("in the %s theme", (theme) => {
    it("takes every colour from the theme tokens", () => {
      const { container, ctx } = setup({
        theme,
        beats: highlighting(["wv.wave", "wv.wavelength", "wv.amplitude"]),
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

    it("colours the curve, the ruler, the gauge and the symbols as quantities, the axis in ink", () => {
      const { container, ctx } = setup({ theme });
      const { role } = ctx.theme;
      expect(part(container, "wave")!.getAttribute("stroke")).toBe(role.quantity);
      expect(mark(container, "ruler")!.getAttribute("stroke")).toBe(role.quantity);
      expect(mark(container, "gauge")!.getAttribute("stroke")).toBe(role.quantity);
      for (const tick of part(container, "wavelength")!.querySelectorAll("line")) {
        expect(tick.getAttribute("stroke")).toBe(role.quantity);
      }
      for (const text of container.querySelectorAll("text")) {
        expect(text.getAttribute("fill")).toBe(role.quantity);
      }
      expect(mark(container, "baseline")!.getAttribute("stroke")).toBe(ctx.theme.ink);
      for (const level of container.querySelectorAll('[data-mark="level"]')) {
        expect(level.getAttribute("stroke")).toBe(ctx.theme.rule);
      }
    });
  });

  it("turns the strokes over a highlighted band dark on the blackboard only", () => {
    const beats = highlighting(["wv.wave", "wv.wavelength", "wv.amplitude"]);
    const board = setup({ theme: "board", beats });
    const dark = board.ctx.theme.surface;
    expect(part(board.container, "wave")!.getAttribute("stroke")).toBe(dark);
    expect(mark(board.container, "ruler")!.getAttribute("stroke")).toBe(dark);
    expect(mark(board.container, "gauge")!.getAttribute("stroke")).toBe(dark);
    for (const tick of part(board.container, "wavelength")!.querySelectorAll("line")) {
      expect(tick.getAttribute("stroke")).toBe(dark);
    }
    const paper = setup({ theme: "paper", beats });
    expect(part(paper.container, "wave")!.getAttribute("stroke")).toBe(
      paper.ctx.theme.role.quantity,
    );
    expect(mark(paper.container, "ruler")!.getAttribute("stroke")).toBe(
      paper.ctx.theme.role.quantity,
    );
    const plain = setup({ theme: "board" });
    expect(part(plain.container, "wave")!.getAttribute("stroke")).toBe(
      plain.ctx.theme.role.quantity,
    );
    const early = setup({ theme: "board", beats, frame: 1 });
    expect(part(early.container, "wave")!.getAttribute("stroke")).toBe(
      early.ctx.theme.role.quantity,
    );
  });

  it("uses only the quantity role, as declared for the simulation", () => {
    const { container, ctx } = setup({ beats: highlighting(["wv"]) });
    const { role } = ctx.theme;
    for (const element of container.querySelectorAll("[fill], [stroke]")) {
      for (const name of ["fill", "stroke"]) {
        const value = element.getAttribute(name);
        for (const other of [role.action, role.actionText, role.valid])
          expect(value).not.toBe(other);
      }
    }
  });
});
