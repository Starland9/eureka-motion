// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PictogramProps } from "../../src/pictograms";
import { textWidth } from "../../src/primitives/figure/a-label";
import {
  bodyY,
  fallLayout,
  fallMotion,
  impactSpeed,
  sizeCurve,
  velocityArrow,
  type FallGeometry,
} from "../../src/primitives/sim/fall-layout";
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

const H = 20;
const G = 9.81;
const PARAMS: Param[] = [param("h", "h", 5, 100, H), param("g", "g", 1.6, 25, G)];
const MODEL: Model = { constants: [], derived: [] };
const LANDING = Math.sqrt((2 * H) / G);

type Fall = ElementOf<"sim.fall">;
const DROP: Fall = {
  id: "drop",
  slot: "figure",
  type: "sim.fall",
  height: { expr: "h" },
  gravity: { expr: "g" },
};

const showing = (targets: string[], how: "fade" | "draw" = "fade"): Scene["beats"] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [{ do: "show", targets, how, at: 0 }],
  },
];

const playing = (from: number, to: number): Scene["beats"] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [
      { do: "show", targets: ["drop"], how: "fade", at: 0 },
      { do: "play", target: "drop", from, to, at: 0 },
    ],
  },
];

interface Setup {
  element?: Fall;
  params?: Param[];
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
  reducedMotion?: boolean;
  time?: number;
}

function setup({ element = DROP, params = PARAMS, time, ...rest }: Setup = {}) {
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
const body = (container: Element, kind = "apple"): Element | null =>
  container.querySelector(`circle[data-kind="${kind}"]`);
const polygonPoints = (group: Element): [number, number][] =>
  (group.querySelector("polygon")?.getAttribute("points") ?? "")
    .split(" ")
    .map((pair) => pair.split(",").map(Number) as [number, number]);

function measure(container: Element) {
  const height = part(container, "height");
  const main = [...(height?.querySelectorAll("line") ?? [])].find(
    (line) => line.getAttribute("x1") === line.getAttribute("x2"),
  );
  const apple = body(container);
  return {
    drop: num(main, "y2") - num(main, "y1"),
    ground: num(part(container, "ground"), "y1"),
    top: num(main, "y1"),
    y: num(apple, "cy"),
    radius: num(apple, "r"),
  };
}

function arrowLength(container: Element): number {
  const group = part(container, "velocity");
  if (!group) throw new Error("no velocity");
  const [tip] = polygonPoints(group);
  return tip![1] - num(group.querySelector("line"), "y1");
}

const U = 16;
const CAP_HALF_HEIGHT = 1.4 * U;
const SLOTS = [
  { width: 1728, height: 648 },
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
];
const RATIOS = [0, 1e-6, 0.1, 0.5, 1, 2, 10, 1e9];

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

function labelBoxes(container: Element, u: number): (Box & { text: string })[] {
  return [...container.querySelectorAll("text")].map((text) => {
    const content = text.textContent ?? "";
    const width = textWidth(content, 4 * u, text.getAttribute("font-style") === "italic");
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

function layoutBoxes(geometry: FallGeometry, arrow: ReturnType<typeof velocityArrow>, y: number) {
  const hWidth = textWidth("h", 4 * U, true);
  const vWidth = textWidth("v", 4 * U, true);
  const { dimension } = geometry;
  return {
    h: {
      x: dimension.label[0] - hWidth,
      y: dimension.label[1] - CAP_HALF_HEIGHT,
      width: hWidth,
      height: 2 * CAP_HALF_HEIGHT,
    },
    v: {
      x: arrow.label[0],
      y: arrow.label[1] - CAP_HALF_HEIGHT,
      width: vWidth,
      height: 2 * CAP_HALF_HEIGHT,
    },
    body: discBox(geometry.bodyX, y, geometry.radius),
  };
}

describe("fall motion", () => {
  it("falls ½·g·t² of the way at three instants, with a speed of g·t", () => {
    for (const [height, gravity] of [
      [20, 9.81],
      [45, 1.62],
      [3, 24.8],
    ] as const) {
      const landing = Math.sqrt((2 * height) / gravity);
      for (const share of [0.25, 0.5, 0.9]) {
        const time = share * landing;
        const { fraction, speed } = fallMotion(height, gravity, time);
        expect(fraction).toBeCloseTo((0.5 * gravity * time ** 2) / height, 12);
        expect(speed).toBeCloseTo(gravity * time, 12);
      }
    }
  });

  it("reaches the ground exactly at t = √(2h/g) with the speed √(2gh)", () => {
    const landed = fallMotion(H, G, LANDING);
    expect(landed.fraction).toBe(1);
    expect(landed.speed).toBeCloseTo(impactSpeed(H, G), 9);
    expect(landed.speed).toBeCloseTo(Math.sqrt(2 * G * H), 12);
  });

  it("rests on the ground, at the impact speed, after the landing", () => {
    for (const time of [LANDING + 0.01, 2 * LANDING, 1e6]) {
      const { fraction, speed } = fallMotion(H, G, time);
      expect(fraction).toBe(1);
      expect(speed).toBeCloseTo(impactSpeed(H, G), 9);
    }
  });

  it("stays at the start until the play begins, and for values it cannot use", () => {
    expect(fallMotion(H, G, 0)).toEqual({ fraction: 0, speed: 0 });
    expect(fallMotion(H, G, -3)).toEqual({ fraction: 0, speed: 0 });
    expect(fallMotion(H, G, Number.NaN)).toEqual({ fraction: 0, speed: 0 });
    for (const [height, gravity] of [
      [0, G],
      [H, 0],
      [-5, G],
      [H, -9],
      [Number.NaN, G],
      [H, Number.POSITIVE_INFINITY],
    ]) {
      expect(fallMotion(height!, gravity!, 1)).toEqual({ fraction: 0, speed: 0 });
    }
  });

  it("makes the fraction four times larger when the time doubles, and twice with g", () => {
    const base = fallMotion(100, 9.81, 1).fraction;
    expect(fallMotion(100, 9.81, 2).fraction / base).toBeCloseTo(4, 12);
    expect(fallMotion(100, 19.62, 1).fraction / base).toBeCloseTo(2, 12);
    expect(fallMotion(200, 9.81, 1).fraction / base).toBeCloseTo(0.5, 12);
  });
});

describe("sizeCurve", () => {
  it("maps the default to the reference and every ratio into the open range", () => {
    expect(sizeCurve(1, 0.7)).toBeCloseTo(0.7, 12);
    expect(sizeCurve(1, 0.55)).toBeCloseTo(0.55, 12);
    expect(sizeCurve(0, 0.7)).toBe(0);
    expect(sizeCurve(Number.POSITIVE_INFINITY, 0.7)).toBe(1);
    expect(sizeCurve(Number.NaN, 0.7)).toBe(0.7);
    expect(sizeCurve(-4, 0.7)).toBe(0);
    for (const ratio of [1e-9, 0.01, 1e9]) {
      expect(sizeCurve(ratio, 0.7)).toBeGreaterThan(0);
      expect(sizeCurve(ratio, 0.7)).toBeLessThan(1);
    }
  });

  it("keeps the order of the ratios, so that a slider never goes dead", () => {
    const ratios = [0, 0.05, 0.2, 0.5, 1, 2, 5, 20, 1000];
    const sizes = ratios.map((ratio) => sizeCurve(ratio, 0.7));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
  });
});

describe("fall layout", () => {
  it("puts the body on the ground at the end of the fall, whatever the pictogram", () => {
    for (const slot of SLOTS) {
      const geometry = fallLayout(slot, U, 1, true);
      const rest = bodyY(geometry, 1);
      expect(rest).toBe(geometry.endY);
      expect(rest + geometry.radius * 0.8).toBeCloseTo(geometry.ground.y, 9);
      expect(bodyY(geometry, 0)).toBe(geometry.startY);
      expect(bodyY(geometry, 7)).toBe(geometry.endY);
      expect(bodyY(geometry, -2)).toBe(geometry.startY);
    }
  });

  it("measures the height from the ground up to the bottom of the body at the start", () => {
    for (const slot of SLOTS) {
      for (const ratio of [0.1, 1, 5]) {
        const geometry = fallLayout(slot, U, ratio, true);
        const { dimension } = geometry;
        expect(dimension.bottom).toBe(geometry.ground.y);
        expect(dimension.bottom - dimension.top).toBeCloseTo(geometry.endY - geometry.startY, 9);
        expect(dimension.top).toBeCloseTo(geometry.startY + 0.8 * geometry.radius, 9);
        expect(dimension.x).toBeLessThan(geometry.bodyX - geometry.radius);
      }
    }
  });

  it("draws a longer drop for a larger height and a body that stays centred", () => {
    for (const slot of SLOTS) {
      const drops = [0.1, 0.5, 1, 2, 10].map((ratio) => {
        const geometry = fallLayout(slot, U, ratio, true);
        expect(geometry.bodyX).toBe(slot.width / 2);
        expect(geometry.ground.left + geometry.ground.right).toBeCloseTo(slot.width, 9);
        return geometry.endY - geometry.startY;
      });
      for (let i = 1; i < drops.length; i++) expect(drops[i]!).toBeGreaterThan(drops[i - 1]!);
      expect(fallLayout(slot, U, 1, true).ground.y).toBe(fallLayout(slot, U, 7, true).ground.y);
    }
  });

  it("scales the velocity arrow with the speed until it reaches its cap", () => {
    for (const slot of SLOTS) {
      const geometry = fallLayout(slot, U, 1, true);
      const y = bodyY(geometry, 0.5);
      const lengths = [0.1, 0.2, 0.4].map((ratio) => velocityArrow(geometry, U, y, ratio).length);
      expect(lengths[1]! / lengths[0]!).toBeCloseTo(2, 12);
      expect(lengths[2]! / lengths[1]!).toBeCloseTo(2, 12);
      expect(velocityArrow(geometry, U, y, 1).length).toBeCloseTo(0.11 * slot.height, 9);
      expect(velocityArrow(geometry, U, y, 0).length).toBe(0);
      expect(velocityArrow(geometry, U, y, 1e9).length).toBe(geometry.arrow.max);
      expect(velocityArrow(geometry, U, y, Number.POSITIVE_INFINITY).length).toBe(
        geometry.arrow.max,
      );
    }
  });

  it("keeps the body, the arrow and the labels inside the slot for extreme ratios", () => {
    for (const slot of SLOTS) {
      for (const velocity of [true, false]) {
        for (const ratio of RATIOS) {
          const geometry = fallLayout(slot, U, ratio, velocity);
          for (const fraction of [0, 0.3, 1]) {
            for (const speed of RATIOS) {
              const y = bodyY(geometry, fraction);
              const arrow = velocityArrow(geometry, U, y, velocity ? speed : 0);
              const boxes = layoutBoxes(geometry, arrow, y);
              expect(inside(boxes.body, slot), JSON.stringify(boxes.body)).toBe(true);
              expect(inside(boxes.h, slot), JSON.stringify(boxes.h)).toBe(true);
              expect(arrow.tip[1]).toBeLessThanOrEqual(slot.height - 2 * U + 1e-9);
              if (arrow.length > 0)
                expect(inside(boxes.v, slot), JSON.stringify(boxes.v)).toBe(true);
              const { ground, dimension } = geometry;
              expect(ground.left).toBeGreaterThanOrEqual(0);
              expect(ground.right).toBeLessThanOrEqual(slot.width);
              expect(dimension.top - dimension.tick).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
  });

  it("keeps the two labels clear of each other, of the body and of the ground", () => {
    for (const slot of SLOTS) {
      for (const ratio of RATIOS) {
        const geometry = fallLayout(slot, U, ratio, true);
        for (const fraction of [0, 0.2, 0.5, 0.8, 1]) {
          for (const speed of [0.01, 0.3, 1, 5, 1e9]) {
            const y = bodyY(geometry, fraction);
            const arrow = velocityArrow(geometry, U, y, speed);
            const boxes = layoutBoxes(geometry, arrow, y);
            expect(overlap(boxes.h, boxes.v)).toBe(false);
            expect(overlap(boxes.v, boxes.body)).toBe(false);
            expect(overlap(boxes.h, boxes.body)).toBe(false);
            const line: Box = {
              x: geometry.ground.left,
              y: geometry.ground.y - 0.125 * U,
              width: geometry.ground.right - geometry.ground.left,
              height: 0.25 * U,
            };
            expect(overlap(boxes.v, line)).toBe(false);
            expect(overlap(boxes.h, line)).toBe(false);
          }
        }
      }
    }
  });
});

describe("FallSim", () => {
  it("draws every part at the end of the entrance", () => {
    const { container } = setup({ time: 1 });
    for (const name of ["body", "velocity", "height", "ground"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect(body(container, "apple")).not.toBeNull();
    expect([...container.querySelectorAll("text")].map((text) => text.textContent).sort()).toEqual([
      "h",
      "v",
    ]);
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("does not render a part that the state hides, and keeps the others", () => {
    const { container } = setup({
      time: 1,
      beats: showing(["drop.ground", "drop.height", "drop.body"]),
    });
    expect(part(container, "velocity")).toBeNull();
    for (const name of ["ground", "height", "body"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect([...container.querySelectorAll("text")].map((text) => text.textContent)).toEqual(["h"]);
  });

  it("shows a single part on its own", () => {
    const { container } = setup({ beats: showing(["drop.body"]) });
    expect(part(container, "body")).not.toBeNull();
    for (const name of ["velocity", "height", "ground"]) {
      expect(part(container, name), name).toBeNull();
    }
    expect(container.querySelector("text")).toBeNull();
  });

  it("removes a part once it has been hidden", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["drop"], how: "fade", at: 0 },
          { do: "play", target: "drop", from: 1, to: 1, at: 0 },
          { do: "hide", targets: ["drop.height"], at: 0.1 },
        ],
      },
    ];
    const { container } = setup({ beats });
    expect(part(container, "height")).toBeNull();
    expect(part(container, "velocity")).not.toBeNull();
    expect(part(container, "body")).not.toBeNull();
  });

  it("does not draw the velocity when showVelocity is false, even if it is shown", () => {
    const { container } = setup({ time: 1, element: { ...DROP, showVelocity: false } });
    expect(part(container, "velocity")).toBeNull();
    expect(part(container, "body")).not.toBeNull();
    const { container: withArrow } = setup({ time: 1, element: { ...DROP, showVelocity: true } });
    expect(part(withArrow, "velocity")).not.toBeNull();
  });

  describe("positions", () => {
    it("places the body at ½·g·t² of the drop at three instants", () => {
      const start = measure(setup().container);
      expect(start.y).toBeCloseTo(start.top - 0.8 * start.radius, 6);
      const scale = start.drop / H;
      for (const time of [0.6, 1.2, 1.8]) {
        const now = measure(setup({ time }).container);
        expect(now.drop).toBeCloseTo(start.drop, 9);
        expect(now.y - start.y).toBeCloseTo(scale * 0.5 * G * time ** 2, 6);
      }
    });

    it("falls four times as far when the time doubles, and the first third in the ratio 1:3:5", () => {
      const start = measure(setup().container).y;
      const travelled = (time: number) => measure(setup({ time }).container).y - start;
      expect(travelled(1.2) / travelled(0.6)).toBeCloseTo(4, 9);
      expect(travelled(1.8) / travelled(0.6)).toBeCloseTo(9, 9);
      const [one, two, three] = [0.6, 1.2, 1.8].map(travelled);
      expect((two! - one!) / one!).toBeCloseTo(3, 9);
      expect((three! - two!) / one!).toBeCloseTo(5, 9);
    });

    it("falls twice as far at the same instant when g doubles", () => {
      const start = measure(setup().container).y;
      const base = measure(setup({ time: 0.8 }).container).y - start;
      const doubled = measure(setup({ time: 0.8, values: { g: 2 * G } }).container).y - start;
      expect(doubled / base).toBeCloseTo(2, 9);
    });

    it("follows the law for another height, the whole drop standing for h metres", () => {
      for (const height of [5, 20, 80]) {
        const start = measure(setup({ values: { h: height } }).container);
        const scale = start.drop / height;
        for (const time of [0.3, 0.7, 1]) {
          const now = measure(setup({ time, values: { h: height } }).container);
          const expected = Math.min(start.drop, scale * 0.5 * G * time ** 2);
          expect(now.y - start.y).toBeCloseTo(expected, 6);
        }
      }
    });

    it("lands at t = √(2h/g) and stays on the ground afterwards", () => {
      const start = measure(setup().container);
      const before = measure(setup({ time: LANDING - 0.05 }).container);
      expect(before.y - start.y).toBeLessThan(start.drop);
      for (const time of [LANDING, LANDING + 0.5, 10]) {
        const landed = measure(setup({ time }).container);
        expect(landed.y - start.y).toBeCloseTo(start.drop, 6);
        expect(landed.y + 0.8 * landed.radius).toBeCloseTo(landed.ground, 6);
      }
    });

    it("keeps the body at the top of the drop while no play action runs", () => {
      const { container } = setup();
      const start = measure(container);
      expect(start.y + 0.8 * start.radius).toBeCloseTo(start.top, 6);
      expect(part(container, "velocity")).toBeNull();
      expect(container.querySelectorAll("text")).toHaveLength(1);
    });

    it("follows the law with the simulated time of a real playback", () => {
      const start = measure(setup().container);
      const scale = start.drop / H;
      let previous = 0;
      for (const frame of [20, 45, 70]) {
        const view = setup({ frame, beats: playing(0, 2.5) });
        const time = view.ctx.state.simTime("drop");
        expect(time).toBeGreaterThan(previous);
        expect(time).toBeLessThan(LANDING);
        previous = time;
        expect(measure(view.container).y - start.y).toBeCloseTo(scale * 0.5 * G * time ** 2, 6);
      }
      const late = setup({ frame: 119, beats: playing(0, 2.5) });
      expect(late.ctx.state.simTime("drop")).toBeGreaterThan(LANDING);
      expect(measure(late.container).y - start.y).toBeCloseTo(start.drop, 6);
    });

    it("starts a play at its own from, not at zero", () => {
      const start = measure(setup().container);
      const scale = start.drop / H;
      const view = setup({ beats: playing(1, 1) });
      expect(measure(view.container).y - start.y).toBeCloseTo(scale * 0.5 * G, 6);
    });

    it("shows the final state at once for reduced motion", () => {
      const early = setup({ frame: 3, reducedMotion: true, beats: playing(0, 1.4) });
      const late = setup({ frame: 90, reducedMotion: true, beats: playing(0, 1.4) });
      expect(early.ctx.state.simTime("drop")).toBe(1.4);
      expect(measure(early.container)).toEqual(measure(late.container));
      expect(arrowLength(early.container)).toBeCloseTo(arrowLength(late.container), 9);
      const final = setup({ time: 1.4 });
      expect(measure(early.container).y).toBeCloseTo(measure(final.container).y, 9);
      const moving = setup({ frame: 3, beats: playing(0, 1.4) });
      expect(measure(moving.container).y).toBeLessThan(measure(early.container).y);
    });
  });

  describe("velocity", () => {
    it("draws an arrow whose length goes as g·t at three instants", () => {
      const [one, two, three] = [0.6, 1.2, 1.8].map((time) =>
        arrowLength(setup({ time }).container),
      );
      expect(two! / one!).toBeCloseTo(2, 9);
      expect(three! / one!).toBeCloseTo(3, 9);
      const faster = arrowLength(setup({ time: 0.6, values: { g: 2 * G } }).container);
      expect(faster / one!).toBeCloseTo(2, 9);
    });

    it("draws the arrow at its reference length at the impact of the default fall", () => {
      const { container, ctx } = setup({ time: LANDING });
      expect(arrowLength(container)).toBeCloseTo(0.11 * ctx.size.height, 6);
    });

    it("keeps the impact speed once the body has landed", () => {
      const landing = arrowLength(setup({ time: LANDING }).container);
      expect(arrowLength(setup({ time: LANDING + 1 }).container)).toBeCloseTo(landing, 9);
    });

    it("scales the impact arrow with √(g·h) relative to the default fall", () => {
      const base = arrowLength(setup({ time: 10, values: { h: 5 } }).container);
      const quadruple = arrowLength(setup({ time: 10, values: { h: 20 } }).container);
      expect(quadruple / base).toBeCloseTo(2, 9);
    });

    it("hangs below the body on its right, pointing down, and never leaves the slot", () => {
      for (const time of [0.6, LANDING, 5]) {
        const { container, ctx } = setup({ time });
        const group = part(container, "velocity")!;
        const shaft = group.querySelector("line")!;
        const apple = body(container)!;
        expect(shaft.getAttribute("x1")).toBe(shaft.getAttribute("x2"));
        expect(num(shaft, "x1")).toBeGreaterThan(num(apple, "cx") + num(apple, "r"));
        expect(num(shaft, "y1")).toBeCloseTo(num(apple, "cy"), 9);
        expect(num(shaft, "y2")).toBeGreaterThan(num(shaft, "y1"));
        const points = polygonPoints(group);
        expect(Math.max(...points.map(([, y]) => y))).toBeLessThanOrEqual(ctx.size.height);
      }
    });
  });

  describe("animation of the parts", () => {
    it("fades the body in and traces the lines before their labels", () => {
      const fading = setup({ frame: 4, beats: showing(["drop.body"]) });
      const opacity = num(body(fading.container), "opacity");
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);

      const drawing = setup({ frame: 9, beats: showing(["drop.height", "drop.ground"], "draw") });
      const height = part(drawing.container, "height")!;
      for (const line of height.querySelectorAll("line")) {
        expect(line.hasAttribute("stroke-dasharray")).toBe(true);
      }
      expect(num(height.querySelector("text"), "opacity")).toBe(0);
      const ground = part(drawing.container, "ground")!;
      expect(num(ground, "stroke-dashoffset")).toBeGreaterThan(0);

      const done = setup({ beats: showing(["drop.height", "drop.ground"], "draw") });
      expect(part(done.container, "ground")!.hasAttribute("stroke-dasharray")).toBe(false);
      expect(num(part(done.container, "height")!.querySelector("text"), "opacity")).toBe(1);
    });

    it("traces the velocity arrow and shows its head and label last", () => {
      const view = setup({
        frame: 9,
        beats: [
          {
            ...playing(1, 1)[0]!,
            actions: [
              { do: "show", targets: ["drop.velocity"], how: "draw", at: 0 },
              { do: "play", target: "drop", from: 1, to: 1, at: 0 },
            ],
          },
        ],
      });
      const group = part(view.container, "velocity")!;
      expect(group.querySelector("line")!.hasAttribute("stroke-dasharray")).toBe(true);
      expect(num(group.querySelector("polygon"), "opacity")).toBe(0);
      expect(num(group.querySelector("text"), "opacity")).toBe(0);
    });
  });

  describe("highlight", () => {
    const highlighted = (targets: string[]): Scene["beats"] => [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["drop"], how: "fade", at: 0 },
          { do: "play", target: "drop", from: 1, to: 1, at: 0 },
          { do: "highlight", targets, at: 0.1 },
        ],
      },
    ];

    it("draws a flat result band behind each highlighted part and none behind the others", () => {
      const { container, ctx } = setup({
        beats: highlighted(["drop.body", "drop.velocity", "drop.height", "drop.ground"]),
      });
      for (const name of ["body", "velocity", "height", "ground"]) {
        const band = container.querySelector(`[data-band="${name}"] rect`);
        expect(band, name).not.toBeNull();
        expect(band!.getAttribute("fill")).toBe(ctx.theme.role.result);
        expect(num(band, "width")).toBeGreaterThan(0);
      }
      expect(
        setup({ beats: highlighted(["drop.ground"]) }).container.querySelectorAll("rect"),
      ).toHaveLength(1);
      expect(setup({ time: 1 }).container.querySelector("rect")).toBeNull();
    });

    it("draws the bands under the lines, the arrow and the body", () => {
      const { container } = setup({ beats: highlighted(["drop.ground", "drop.body"]) });
      const children = [...container.querySelector("svg > g")!.children];
      const last = (name: string) =>
        children.reduce(
          (found, child, index) => (child.getAttribute("data-band") === name ? index : found),
          -1,
        );
      const first = (name: string) =>
        children.findIndex((child) => child.getAttribute("data-part") === name);
      expect(last("ground")).toBeLessThan(first("ground"));
      expect(last("body")).toBeLessThan(first("height"));
      expect(last("body")).toBeLessThan(first("body"));
    });

    it("rotates nothing: the band of the arrow follows the vertical arrow", () => {
      const { container } = setup({ beats: highlighted(["drop.velocity"]) });
      const band = container.querySelector('[data-band="velocity"] g');
      expect(band!.getAttribute("transform")).toMatch(/rotate\(90\)$/);
    });
  });

  describe("labels and pictogram", () => {
    it("names the height after the symbol of its parameter and sets the labels in italic", () => {
      const { container } = setup({
        time: 1,
        params: [param("hauteur", "H", 5, 100, H), param("g", "g", 1.6, 25, G)],
        element: { ...DROP, height: { expr: "hauteur" } },
      });
      const texts = [...container.querySelectorAll("text")];
      expect(texts.map((text) => text.textContent).sort()).toEqual(["H", "v"]);
      for (const text of texts) expect(text.getAttribute("font-style")).toBe("italic");
    });

    it("falls back to h when the height is a number or an expression", () => {
      for (const height of [20, { expr: "h * 1" }]) {
        const { container } = setup({ time: 1, element: { ...DROP, height } });
        expect(
          [...container.querySelectorAll("text")].map((text) => text.textContent).sort(),
        ).toEqual(["h", "v"]);
      }
    });

    it("draws an apple unless the document names another pictogram", () => {
      expect(body(setup().container, "apple")).not.toBeNull();
      const { container } = setup({ element: { ...DROP, object: "ball" } });
      expect(body(container, "ball")).not.toBeNull();
      expect(body(container, "apple")).toBeNull();
    });

    it("draws the body at the centre of the slot, with the dimension on its left", () => {
      const { container, ctx } = setup();
      const apple = body(container)!;
      expect(num(apple, "cx")).toBeCloseTo(ctx.size.width / 2, 9);
      const main = [...part(container, "height")!.querySelectorAll("line")].find(
        (line) => line.getAttribute("x1") === line.getAttribute("x2"),
      );
      expect(num(main, "x1")).toBeLessThan(num(apple, "cx") - num(apple, "r"));
      const ground = part(container, "ground")!;
      expect(num(ground, "stroke-width")).toBeCloseTo(0.25 * ctx.u, 9);
      expect(num(ground, "x1")).toBeLessThan(num(main, "x1"));
      expect(num(ground, "x2")).toBeGreaterThan(num(apple, "cx"));
    });
  });

  describe("extreme parameters", () => {
    const CORNERS = [
      { h: 5, g: 1.6 },
      { h: 100, g: 1.6 },
      { h: 5, g: 25 },
      { h: 100, g: 25 },
    ];

    it("keeps the body, the arrow and every label inside the slot at the sliders' corners", () => {
      for (const values of CORNERS) {
        const landing = Math.sqrt((2 * values.h) / values.g);
        for (const time of [0, 0.3 * landing, landing, 3 * landing]) {
          const { container, ctx } = setup({ values, time });
          const apple = body(container)!;
          const boxes = labelBoxes(container, ctx.u);
          expect(num(apple, "cy") - num(apple, "r")).toBeGreaterThanOrEqual(0);
          expect(num(apple, "cy") + num(apple, "r")).toBeLessThanOrEqual(ctx.size.height);
          for (const box of boxes) expect(inside(box, ctx.size), JSON.stringify(box)).toBe(true);
          if (part(container, "velocity")) {
            expect(arrowLength(container)).toBeLessThanOrEqual(0.22 * ctx.size.height + 1e-9);
          }
          for (const line of container.querySelectorAll("line")) {
            for (const name of ["x1", "x2"]) {
              expect(num(line, name)).toBeGreaterThanOrEqual(0);
              expect(num(line, name)).toBeLessThanOrEqual(ctx.size.width);
            }
            for (const name of ["y1", "y2"]) {
              expect(num(line, name)).toBeGreaterThanOrEqual(0);
              expect(num(line, name)).toBeLessThanOrEqual(ctx.size.height);
            }
          }
        }
      }
    });

    it("never overlaps two texts, nor a text and the body", () => {
      for (const values of CORNERS) {
        const landing = Math.sqrt((2 * values.h) / values.g);
        for (const time of [0, 0.1 * landing, 0.5 * landing, 0.9 * landing, landing, 2 * landing]) {
          const { container, ctx } = setup({ values, time });
          const boxes = labelBoxes(container, ctx.u);
          const apple = body(container)!;
          const disc = discBox(num(apple, "cx"), num(apple, "cy"), num(apple, "r"));
          for (const box of boxes) expect(overlap(box, disc), box.text).toBe(false);
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              expect(overlap(boxes[i]!, boxes[j]!), `${boxes[i]!.text} ${boxes[j]!.text}`).toBe(
                false,
              );
            }
          }
        }
      }
    });
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
              { do: "show", targets: ["drop"], how: "fade", at: 0 },
              { do: "play", target: "drop", from: 1, to: 1, at: 0 },
              { do: "highlight", targets: ["drop"], at: 0.1 },
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

    it("colours the height as a quantity, the speed as an action and the ground in ink", () => {
      const { container, ctx } = setup({ theme, time: 1 });
      const { role } = ctx.theme;
      const height = part(container, "height")!;
      for (const line of height.querySelectorAll("line")) {
        expect(line.getAttribute("stroke")).toBe(role.quantity);
      }
      expect(height.querySelector("text")!.getAttribute("fill")).toBe(role.quantity);
      const velocity = part(container, "velocity")!;
      expect(velocity.querySelector("line")!.getAttribute("stroke")).toBe(role.action);
      expect(velocity.querySelector("polygon")!.getAttribute("fill")).toBe(role.action);
      expect(velocity.querySelector("text")!.getAttribute("fill")).toBe(role.actionText);
      expect(part(container, "ground")!.getAttribute("stroke")).toBe(ctx.theme.ink);
    });
  });
});
