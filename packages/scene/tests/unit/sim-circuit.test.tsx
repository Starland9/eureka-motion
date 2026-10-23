// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PictogramProps } from "../../src/pictograms";
import { textWidth } from "../../src/primitives/figure/a-label";
import {
  carrierPoints,
  circuitLayout,
  isCovered,
  MAX_FLOW_RATIO,
  pointOnLoop,
  REFERENCE_RATE,
  type CircuitGeometry,
  type Rect,
} from "../../src/primitives/sim/circuit-layout";
import type { ElementOf, Model, Param, Scene } from "../../src/schema/document";
import type { ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext } from "../helpers/scene";

vi.mock("../../src/pictograms", async () => {
  const { createElement } = await import("react");
  return {
    Pictogram: ({ kind, x, y, size, colour, opacity }: PictogramProps) =>
      createElement("circle", {
        "data-kind": kind,
        cx: x,
        cy: y,
        r: size / 2,
        stroke: colour,
        opacity,
      }),
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

const PARAMS: Param[] = [param("U", "U", 1, 24, 12), param("R", "R", 1, 100, 6)];
const OHM: Model = {
  constants: [],
  derived: [{ id: "I", expr: "U / R", unit: "A", label: "Intensité", symbol: "I" }],
};

type Circuit = ElementOf<"sim.circuit">;
const CIRCUIT: Circuit = {
  id: "ckt",
  slot: "figure",
  type: "sim.circuit",
  voltage: { expr: "U" },
  resistance: { expr: "R" },
  current: { expr: "I" },
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
  element?: Circuit;
  params?: Param[];
  model?: Model;
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
  reducedMotion?: boolean;
}

function setup({ element = CIRCUIT, params = PARAMS, model = OHM, ...rest }: Setup = {}) {
  const scene = sceneOf([element], { beats: rest.beats });
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
const dots = (container: Element): Element[] => [
  ...(part(container, "carriers")?.querySelectorAll("circle") ?? []),
];
const wireOf = (container: Element): Rect => {
  const rect = part(container, "wire");
  return {
    x: num(rect, "x"),
    y: num(rect, "y"),
    width: num(rect, "width"),
    height: num(rect, "height"),
  };
};
const arrowLength = (container: Element): number => {
  const group = part(container, "carriers");
  const tip = group?.querySelector("polygon")?.getAttribute("points")?.split(" ")[0];
  return Number(tip?.split(",")[0]) - num(group?.querySelector("line"), "x1");
};
const climbed = (container: Element): number => {
  const wire = wireOf(container);
  return wire.y + wire.height - num(dots(container)[0], "cy");
};
const travelled = (view: Setup): number => {
  const early = setup({ ...view, frame: 3 });
  const late = setup({ ...view, frame: 9 });
  return climbed(late.container) - climbed(early.container);
};

const SLOTS = [
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
];
const U = 16;
const CAP_HALF_HEIGHT = 1.4 * U;
const RATIOS = [0, 1e-6, 0.1, 0.5, 1, 2, 10, 1e9];

const inside = (rect: Rect, slot: { width: number; height: number }): boolean =>
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.x + rect.width <= slot.width &&
  rect.y + rect.height <= slot.height;
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const labelBox = (centre: readonly [number, number], text: string, anchor: "start" | "middle") => {
  const width = textWidth(text, 4 * U, true);
  return {
    x: anchor === "start" ? centre[0] : centre[0] - width / 2,
    y: centre[1] - CAP_HALF_HEIGHT,
    width,
    height: 2 * CAP_HALF_HEIGHT,
  };
};

function labelBoxes(geometry: CircuitGeometry) {
  return {
    source: labelBox(geometry.battery.label, "U", "start"),
    resistor: labelBox(geometry.resistor.label, "R", "middle"),
    current: labelBox(geometry.arrow.label, "I", "middle"),
  };
}

describe("circuit layout", () => {
  it("sends REFERENCE_RATE carriers per second through the wire at the reference current", () => {
    for (const slot of SLOTS) {
      const { flow, loop, arrow } = circuitLayout(slot, U, 1);
      expect(flow.rate).toBe(REFERENCE_RATE);
      expect(flow.speed).toBeCloseTo(REFERENCE_RATE * flow.spacing, 9);
      expect(flow.count * flow.spacing).toBeCloseTo(loop.length, 9);
      expect(flow.spacing).toBeGreaterThanOrEqual(5 * U);
      expect(flow.spacing).toBeLessThan(6 * U);
      expect(arrow.length).toBeCloseTo(0.2 * loop.width, 9);
    }
  });

  it("makes the flow, the speed and the arrow strictly proportional to the current", () => {
    for (const slot of SLOTS) {
      const [quarter, half, one, two] = [0.25, 0.5, 1, 2].map((r) => circuitLayout(slot, U, r));
      for (const [small, large] of [
        [quarter, half],
        [half, one],
        [one, two],
      ] as const) {
        expect(large!.flow.rate / small!.flow.rate).toBeCloseTo(2, 12);
        expect(large!.flow.speed / small!.flow.speed).toBeCloseTo(2, 12);
        expect(large!.arrow.length / small!.arrow.length).toBeCloseTo(2, 12);
        expect(large!.flow.count).toBe(small!.flow.count);
        expect(large!.flow.spacing).toBe(small!.flow.spacing);
      }
    }
  });

  it("stops the carriers and shortens the arrow to nothing when no current flows", () => {
    const geometry = circuitLayout(SLOTS[0]!, U, 0);
    expect(geometry.flow.rate).toBe(0);
    expect(geometry.arrow.length).toBe(0);
    expect(carrierPoints(geometry, 7)).toEqual(carrierPoints(geometry, 0));
    expect(circuitLayout(SLOTS[0]!, U, -3).flow.rate).toBe(0);
  });

  it("caps the flow and the arrow for an extreme current", () => {
    const slot = SLOTS[0]!;
    const capped = circuitLayout(slot, U, 1e9);
    expect(capped.flow.rate).toBe(MAX_FLOW_RATIO * REFERENCE_RATE);
    expect(capped.arrow.length).toBeCloseTo(capped.loop.width - 6 * U, 9);
    expect(capped.arrow.tip[0]).toBeLessThan(capped.loop.x1);
  });

  it("walks the loop clockwise from the bottom-left corner", () => {
    const { loop } = circuitLayout(SLOTS[0]!, U, 1);
    const corners: [number, [number, number]][] = [
      [0, [loop.x0, loop.y1]],
      [loop.height, [loop.x0, loop.y0]],
      [loop.height + loop.width, [loop.x1, loop.y0]],
      [2 * loop.height + loop.width, [loop.x1, loop.y1]],
      [loop.length, [loop.x0, loop.y1]],
      [-10, [loop.x0 + 10, loop.y1]],
    ];
    for (const [distance, [x, y]] of corners) {
      const [px, py] = pointOnLoop(loop, distance);
      expect(px).toBeCloseTo(x, 9);
      expect(py).toBeCloseTo(y, 9);
    }
  });

  it("keeps the carriers on the wire, evenly spaced", () => {
    for (const slot of SLOTS) {
      const geometry = circuitLayout(slot, U, 1);
      const { loop, flow } = geometry;
      for (const seconds of [0, 0.37, 2]) {
        const points = carrierPoints(geometry, seconds);
        expect(points).toHaveLength(flow.count);
        for (const [x, y] of points) {
          const onVertical = Math.abs(x - loop.x0) < 1e-6 || Math.abs(x - loop.x1) < 1e-6;
          const onHorizontal = Math.abs(y - loop.y0) < 1e-6 || Math.abs(y - loop.y1) < 1e-6;
          expect(onVertical || onHorizontal).toBe(true);
          expect(x).toBeGreaterThanOrEqual(loop.x0 - 1e-6);
          expect(x).toBeLessThanOrEqual(loop.x1 + 1e-6);
          expect(y).toBeGreaterThanOrEqual(loop.y0 - 1e-6);
          expect(y).toBeLessThanOrEqual(loop.y1 + 1e-6);
        }
      }
      const now = carrierPoints(geometry, 0.4);
      const oneSpacingLater = carrierPoints(geometry, 0.4 + flow.spacing / flow.speed);
      oneSpacingLater.forEach(([x, y], k) => {
        const [nx, ny] = now[(k + 1) % flow.count]!;
        expect(x).toBeCloseTo(nx, 6);
        expect(y).toBeCloseTo(ny, 6);
      });
      const start = carrierPoints(geometry, 0)[0]!;
      const later = carrierPoints(geometry, 0.3)[0]!;
      expect(start[1] - later[1]).toBeCloseTo(flow.speed * 0.3, 9);
    }
  });

  it("keeps the whole figure inside the slot for any current", () => {
    for (const slot of SLOTS) {
      for (const ratio of RATIOS) {
        const geometry = circuitLayout(slot, U, ratio);
        const { loop } = geometry;
        expect(loop.x0).toBeGreaterThan(0);
        expect(loop.x1).toBeLessThan(slot.width);
        expect(loop.y0).toBeGreaterThan(0);
        expect(loop.y1).toBeLessThanOrEqual(slot.height);
        for (const rect of [
          geometry.battery.band,
          geometry.resistor.band,
          geometry.arrow.band,
          ...geometry.wireBands,
          ...Object.values(labelBoxes(geometry)),
        ]) {
          expect(inside(rect, slot), JSON.stringify(rect)).toBe(true);
        }
      }
    }
  });

  it("keeps the three labels clear of the wire, of the parts and of each other", () => {
    for (const slot of SLOTS) {
      for (const ratio of RATIOS) {
        const geometry = circuitLayout(slot, U, ratio);
        const { loop, battery, resistor, arrow } = geometry;
        const boxes = labelBoxes(geometry);
        const thin = 0.25 * U;
        const wires: Rect[] = [
          { x: loop.x0, y: loop.y0 - thin, width: loop.width, height: 2 * thin },
          { x: loop.x0, y: loop.y1 - thin, width: loop.width, height: 2 * thin },
          { x: loop.x0 - thin, y: loop.y0, width: 2 * thin, height: loop.height },
          { x: loop.x1 - thin, y: loop.y0, width: 2 * thin, height: loop.height },
        ];
        for (const box of Object.values(boxes)) {
          for (const wire of wires) expect(overlap(box, wire), JSON.stringify(box)).toBe(false);
          expect(overlap(box, battery.band)).toBe(false);
          expect(overlap(box, resistor.band)).toBe(false);
          expect(overlap(box, arrow.band)).toBe(false);
        }
        expect(overlap(boxes.source, boxes.resistor)).toBe(false);
        expect(overlap(boxes.source, boxes.current)).toBe(false);
        expect(overlap(boxes.resistor, boxes.current)).toBe(false);
        expect(boxes.source.x + boxes.source.width).toBeLessThan(loop.x1);
        expect(boxes.current.y + boxes.current.height).toBeLessThan(arrow.from[1]);
      }
    }
  });

  it("keeps the arrow clear of the dots travelling along the top wire", () => {
    for (const slot of SLOTS) {
      const { loop, arrow } = circuitLayout(slot, U, 1);
      const headHalf = 0.38 * 1.6 * U;
      expect(loop.y0 - arrow.from[1]).toBeGreaterThan(headHalf + 0.6 * U);
    }
  });

  it("covers a carrier only where a part would hide at least half of it", () => {
    const radius = 0.6 * U;
    for (const slot of SLOTS) {
      const { battery, resistor, loop } = circuitLayout(slot, U, 1);
      const bodies = [battery.body, resistor.body];
      expect(isCovered(bodies, [resistor.x, loop.y0], radius)).toBe(true);
      expect(isCovered(bodies, [battery.x, battery.y], radius)).toBe(true);
      const right = resistor.body.x + resistor.body.width;
      expect(isCovered(bodies, [right + radius - 1, loop.y0], radius)).toBe(true);
      expect(isCovered(bodies, [right + radius + 1, loop.y0], radius)).toBe(false);
      expect(isCovered(bodies, [resistor.x + 0.4 * resistor.size, loop.y0], radius)).toBe(false);
      const below = battery.body.y + battery.body.height;
      expect(isCovered(bodies, [loop.x0, below + radius + 1], radius)).toBe(false);
      expect(isCovered(bodies, [loop.x0, loop.y0], radius)).toBe(false);
      expect(isCovered([], [resistor.x, loop.y0], radius)).toBe(false);
    }
  });

  it("puts the source on the left wire, the resistor on the top wire and centres them", () => {
    for (const slot of SLOTS) {
      const { loop, battery, resistor } = circuitLayout(slot, U, 1);
      expect(battery.x).toBe(loop.x0);
      expect(battery.y).toBeCloseTo((loop.y0 + loop.y1) / 2, 9);
      expect(resistor.y).toBe(loop.y0);
      expect(resistor.x).toBeCloseTo((loop.x0 + loop.x1) / 2, 9);
      expect(battery.band.height).toBeLessThan(loop.height);
    }
  });
});

describe("CircuitSim", () => {
  it("draws every part at the end of the entrance, with the three symbols", () => {
    const { container } = setup();
    for (const name of ["source", "resistor", "wire", "carriers"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    const texts = [...container.querySelectorAll("text")].map((text) => text.textContent);
    expect(texts.sort()).toEqual(["I", "R", "U"]);
    expect(container.querySelector("[data-kind=battery]")).not.toBeNull();
    expect(container.querySelector("[data-kind=resistor]")).not.toBeNull();
    expect(dots(container).length).toBeGreaterThan(8);
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("does not render a part that the state hides, and keeps the others", () => {
    const { container } = setup({ beats: showing(["ckt.wire", "ckt.source", "ckt.carriers"]) });
    expect(part(container, "resistor")).toBeNull();
    for (const name of ["wire", "source", "carriers"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect([...container.querySelectorAll("text")].map((text) => text.textContent).sort()).toEqual([
      "I",
      "U",
    ]);
  });

  it("shows a single part on its own", () => {
    const { container } = setup({ beats: showing(["ckt.carriers"]) });
    expect(part(container, "carriers")).not.toBeNull();
    for (const name of ["source", "resistor", "wire"]) {
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
          { do: "show", targets: ["ckt"], how: "fade", at: 0 },
          { do: "hide", targets: ["ckt.carriers"], at: 0.1 },
        ],
      },
    ];
    const { container } = setup({ beats });
    expect(part(container, "carriers")).toBeNull();
    expect(part(container, "wire")).not.toBeNull();
    expect(part(container, "source")).not.toBeNull();
  });

  it("divides the displayed current by two when the resistance doubles", () => {
    const base = setup();
    const doubled = setup({ values: { R: 12 } });
    expect(doubled.ctx.scope.I! / base.ctx.scope.I!).toBeCloseTo(0.5, 12);

    expect(arrowLength(doubled.container) / arrowLength(base.container)).toBeCloseTo(0.5, 9);
    const flow = travelled({});
    expect(flow).toBeGreaterThan(0);
    expect(travelled({ values: { R: 12 } }) / flow).toBeCloseTo(0.5, 9);
    expect(travelled({ values: { R: 3 } }) / flow).toBeCloseTo(2, 9);
    expect(travelled({ values: { R: 6 * 4 } }) / flow).toBeCloseTo(0.25, 9);
  });

  it("multiplies the displayed current by two when the voltage doubles", () => {
    const flow = travelled({});
    expect(travelled({ values: { U: 24 } }) / flow).toBeCloseTo(2, 9);
    expect(travelled({ values: { U: 6 } }) / flow).toBeCloseTo(0.5, 9);
    const base = setup();
    const doubled = setup({ values: { U: 24 } });
    expect(arrowLength(doubled.container) / arrowLength(base.container)).toBeCloseTo(2, 9);
  });

  it("leaves out the carriers that would be half behind the source or the resistor", () => {
    let hidden = 0;
    for (const frame of [3, 20, 40, 77, 120, 200]) {
      const { container, ctx } = setup({ frame });
      const geometry = circuitLayout(ctx.size, ctx.u, 1);
      const bodies = [geometry.battery.body, geometry.resistor.body];
      const all = carrierPoints(geometry, frame / ctx.fps);
      const shown = all.filter((point) => !isCovered(bodies, point, 0.6 * ctx.u));
      hidden += all.length - shown.length;
      expect(dots(container).map((dot) => [num(dot, "cx"), num(dot, "cy")])).toEqual(shown);
    }
    expect(hidden).toBeGreaterThan(0);
  });

  it("shows the carriers over a part that is not drawn", () => {
    const frame = 40;
    const bare = setup({ frame, beats: showing(["ckt.wire", "ckt.carriers"]) });
    const geometry = circuitLayout(bare.ctx.size, bare.ctx.u, 1);
    expect(dots(bare.container)).toHaveLength(geometry.flow.count);
    expect(part(bare.container, "source")).toBeNull();
  });

  it("sends the first carrier up the left wire", () => {
    const early = setup({ frame: 3 });
    const late = setup({ frame: 9 });
    const wire = wireOf(early.container);
    for (const view of [early, late]) {
      expect(num(dots(view.container)[0], "cx")).toBeCloseTo(wire.x, 9);
    }
    expect(num(dots(late.container)[0], "cy")).toBeLessThan(num(dots(early.container)[0], "cy"));
    expect(num(dots(early.container)[0], "cy")).toBeLessThanOrEqual(wire.y + wire.height);
  });

  it("freezes the carriers for reduced motion, which still shows the current as an arrow", () => {
    const early = setup({ frame: 3, reducedMotion: true });
    const late = setup({ frame: 60, reducedMotion: true });
    const positions = (container: Element) =>
      dots(container).map((dot) => [num(dot, "cx"), num(dot, "cy")]);
    expect(positions(late.container)).toEqual(positions(early.container));
    const halved = setup({ frame: 60, reducedMotion: true, values: { R: 12 } });
    expect(arrowLength(halved.container) / arrowLength(late.container)).toBeCloseTo(0.5, 9);
  });

  it("fades the parts in and traces the wire and the arrow before their labels", () => {
    const fading = setup({ frame: 4, beats: showing(["ckt.source"]) });
    const opacity = num(fading.container.querySelector("[data-kind=battery]"), "opacity");
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);

    const drawing = setup({ frame: 9, beats: showing(["ckt.wire", "ckt.carriers"], "draw") });
    const wire = part(drawing.container, "wire")!;
    const length = num(wire, "stroke-dasharray");
    expect(length).toBeCloseTo(
      2 * (wireOf(drawing.container).width + wireOf(drawing.container).height),
      6,
    );
    expect(num(wire, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(wire, "stroke-dashoffset")).toBeLessThan(length);
    const carriers = part(drawing.container, "carriers")!;
    const shaft = carriers.querySelector("line")!;
    expect(shaft.hasAttribute("stroke-dasharray")).toBe(true);
    expect(num(carriers.querySelector("text"), "opacity")).toBe(0);
    expect(num(carriers.querySelector("polygon"), "opacity")).toBe(0);

    const done = setup({ beats: showing(["ckt.wire", "ckt.carriers"], "draw") });
    expect(part(done.container, "wire")!.hasAttribute("stroke-dasharray")).toBe(false);
    expect(num(part(done.container, "carriers")!.querySelector("text"), "opacity")).toBe(1);
    expect(num(dots(done.container)[0], "opacity")).toBe(1);
  });

  it("draws a flat result band behind each highlighted part and none behind the others", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["ckt"], how: "fade", at: 0 },
          { do: "highlight", targets: ["ckt.source", "ckt.carriers", "ckt.wire"], at: 0.1 },
        ],
      },
    ];
    const { container, ctx } = setup({ beats });
    for (const name of ["source", "carriers", "wire"]) {
      const bands = container.querySelectorAll(`[data-band="${name}"] rect`);
      expect(bands.length, name).toBeGreaterThan(0);
      for (const band of bands) {
        expect(band.getAttribute("fill")).toBe(ctx.theme.role.result);
        expect(num(band, "width")).toBeGreaterThan(0);
      }
    }
    expect(container.querySelector('[data-band="resistor"]')).toBeNull();
    expect(setup().container.querySelector("[data-band]")).toBeNull();
  });

  it("draws the bands under the wire, the parts and the carriers", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["ckt"], how: "fade", at: 0 },
          { do: "highlight", targets: ["ckt.source"], at: 0.1 },
        ],
      },
    ];
    const { container } = setup({ beats });
    const children = [...container.querySelector("svg > g")!.children];
    const band = children.findIndex((child) => child.hasAttribute("data-band"));
    const wire = children.findIndex((child) => child.getAttribute("data-part") === "wire");
    const source = children.findIndex((child) => child.getAttribute("data-part") === "source");
    const carriers = children.findIndex((child) => child.getAttribute("data-part") === "carriers");
    expect(band).toBeGreaterThanOrEqual(0);
    expect(band).toBeLessThan(wire);
    expect(wire).toBeLessThan(source);
    expect(source).toBeLessThan(carriers);
  });

  it("names the quantities after the symbols of the model", () => {
    const { container } = setup({
      params: [param("tension", "E", 1, 24, 12), param("charge", "Ω", 1, 100, 6)],
      model: {
        constants: [],
        derived: [{ id: "debit", expr: "tension / charge", unit: "A", label: "", symbol: "i" }],
      },
      element: {
        ...CIRCUIT,
        voltage: { expr: "tension" },
        resistance: { expr: "charge" },
        current: { expr: "debit" },
      },
    });
    const texts = [...container.querySelectorAll("text")].map((text) => text.textContent);
    expect(texts.sort()).toEqual(["E", "i", "Ω"]);
  });

  it("falls back to U, R and I when a value is an expression or has no symbol", () => {
    const { container } = setup({
      element: {
        ...CIRCUIT,
        voltage: 12,
        resistance: { expr: "R * 1" },
        current: { expr: "U / R" },
      },
    });
    const texts = [...container.querySelectorAll("text")].map((text) => text.textContent);
    expect(texts.sort()).toEqual(["I", "R", "U"]);
    const bare = setup({
      model: { constants: [], derived: [{ id: "I", expr: "U / R", unit: "A", label: "" }] },
    });
    expect(
      [...bare.container.querySelectorAll("text")].map((text) => text.textContent).sort(),
    ).toEqual(["I", "R", "U"]);
  });

  it("sets the three symbols in italic", () => {
    const { container } = setup();
    for (const text of container.querySelectorAll("text")) {
      expect(text.getAttribute("font-style")).toBe("italic");
    }
  });

  it("draws the wire at the regular weight and the arrow at the accent weight", () => {
    const { container, ctx } = setup();
    expect(num(part(container, "wire"), "stroke-width")).toBeCloseTo(0.25 * ctx.u, 9);
    const shaft = part(container, "carriers")!.querySelector("line")!;
    expect(num(shaft, "stroke-width")).toBeCloseTo(0.5 * ctx.u, 9);
    expect(shaft.getAttribute("y1")).toBe(shaft.getAttribute("y2"));
    expect(num(shaft, "y1")).toBeLessThan(wireOf(container).y);
    const wire = wireOf(container);
    expect(wire.x).toBeGreaterThan(0);
    expect(wire.x + wire.width).toBeLessThan(ctx.size.width);
  });

  it("puts the battery on the left wire and the resistor on the top wire", () => {
    const { container } = setup();
    const wire = wireOf(container);
    const battery = container.querySelector("[data-kind=battery]");
    const resistor = container.querySelector("[data-kind=resistor]");
    expect(num(battery, "cx")).toBeCloseTo(wire.x, 9);
    expect(num(battery, "cy")).toBeCloseTo(wire.y + wire.height / 2, 9);
    expect(num(resistor, "cy")).toBeCloseTo(wire.y, 9);
    expect(num(resistor, "cx")).toBeCloseTo(wire.x + wire.width / 2, 9);
  });

  it("keeps every dot and the arrow inside the slot at the extremes of the sliders", () => {
    const corners = [
      { U: 1, R: 100 },
      { U: 24, R: 100 },
      { U: 1, R: 1 },
      { U: 24, R: 1 },
    ];
    for (const values of corners) {
      for (const frame of [3, 40, 90]) {
        const { container, ctx } = setup({ values, frame });
        for (const dot of dots(container)) {
          expect(num(dot, "cx")).toBeGreaterThanOrEqual(0);
          expect(num(dot, "cx")).toBeLessThanOrEqual(ctx.size.width);
          expect(num(dot, "cy")).toBeGreaterThanOrEqual(0);
          expect(num(dot, "cy")).toBeLessThanOrEqual(ctx.size.height);
        }
        const shaft = part(container, "carriers")!.querySelector("line");
        if (shaft) expect(num(shaft, "x2")).toBeLessThanOrEqual(ctx.size.width);
      }
    }
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
              { do: "show", targets: ["ckt"], how: "fade", at: 0 },
              { do: "highlight", targets: ["ckt"], at: 0.1 },
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

    it("colours the source and the resistor as quantities, the flow as an action", () => {
      const { container, ctx } = setup({ theme });
      const { role } = ctx.theme;
      for (const name of ["source", "resistor"]) {
        const group = part(container, name)!;
        expect(group.querySelector("circle")!.getAttribute("stroke")).toBe(role.quantity);
        expect(group.querySelector("text")!.getAttribute("fill")).toBe(role.quantity);
      }
      const carriers = part(container, "carriers")!;
      for (const dot of dots(container)) expect(dot.getAttribute("fill")).toBe(role.action);
      expect(carriers.querySelector("line")!.getAttribute("stroke")).toBe(role.action);
      expect(carriers.querySelector("polygon")!.getAttribute("fill")).toBe(role.action);
      expect(carriers.querySelector("text")!.getAttribute("fill")).toBe(role.actionText);
      expect(part(container, "wire")!.getAttribute("stroke")).toBe(ctx.theme.ink);
    });
  });
});
