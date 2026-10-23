// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { textWidth } from "../../src/primitives/figure/a-label";
import {
  marketEquilibrium,
  marketLayout,
  shiftOf,
  starred,
  type MarketGeometry,
  type MarketInput,
  type Placed,
} from "../../src/primitives/sim/market-layout";
import type { ElementOf, Param, Scene } from "../../src/schema/document";
import type { Language } from "../../src/expr";
import type { ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext } from "../helpers/scene";

const param = (id: string, min: number, max: number, value: number): Param => ({
  id,
  symbol: id,
  label: id,
  unit: "",
  min,
  max,
  step: 0.5,
  default: value,
  role: "quantity",
});

const SHIFTS: Param[] = [param("d", -4, 4, 0), param("s", -4, 4, 0), param("a", 100, 600, 300)];

type Market = ElementOf<"sim.market">;
const MARKET: Market = {
  id: "mk",
  slot: "figure",
  type: "sim.market",
  demandShift: { expr: "d" },
  supplyShift: { expr: "s" },
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
  element?: Market;
  values?: Record<string, number>;
  theme?: ThemeName;
  language?: Language;
  frame?: number | "end";
  beats?: Scene["beats"];
}

function setup({ element = MARKET, ...rest }: Setup = {}) {
  const scene = sceneOf([element], { beats: rest.beats });
  const ctx = testContext({
    scene,
    params: SHIFTS,
    values: rest.values,
    theme: rest.theme,
    language: rest.language,
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
const marker = (container: Element): Element | null =>
  part(container, "equilibrium")?.querySelector("circle[stroke]:not([data-ghost])") ?? null;
const curve = (container: Element, name: string): Element | null =>
  part(container, name)?.querySelector("line:not([data-ghost])") ?? null;
const ghost = (container: Element, name: string): Element | null =>
  part(container, name)?.querySelector("[data-ghost]") ?? null;
const texts = (container: Element): string[] =>
  [...container.querySelectorAll("text")].map((text) => text.textContent ?? "");

function equilibriumOf(container: Element) {
  const circle = marker(container);
  return { x: num(circle, "cx"), y: num(circle, "cy") };
}

const U = 16;
const SLOTS = [
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
  { width: 1728, height: 648 },
];
const SHORT: MarketInput = {
  demandShift: 0,
  supplyShift: 0,
  priceLabel: "P",
  quantityLabel: "Q",
  demandLabel: "D",
  supplyLabel: "O",
};
const LONG: MarketInput = {
  ...SHORT,
  priceLabel: "Prix (€/kg/an)",
  quantityLabel: "Quantité (kg/an)",
};
const EXTREMES = [0, 1, -1, 2.5, -2.5, 4, -4, 50, -50, 1e9, -1e9, Number.NaN, Infinity, -Infinity];

function box(label: Placed) {
  const width = textWidth(label.text, 4 * U, true);
  const left =
    label.anchor === "start"
      ? label.x
      : label.anchor === "end"
        ? label.x - width
        : label.x - width / 2;
  return { left, right: left + width, top: label.y - 2 * U, bottom: label.y + 2 * U };
}

function everyLabel(g: MarketGeometry): Placed[] {
  return [
    g.priceAxis.name,
    g.quantityAxis.name,
    g.demand.label,
    g.supply.label,
    g.equilibrium.priceLabel,
    g.equilibrium.quantityLabel,
  ];
}

function inside(g: MarketGeometry, slot: { width: number; height: number }) {
  const points = [
    g.origin,
    g.priceAxis.tip,
    g.quantityAxis.tip,
    g.demand.line.from,
    g.demand.line.to,
    g.supply.line.from,
    g.supply.line.to,
    g.demand.ghost.from,
    g.demand.ghost.to,
    g.supply.ghost.from,
    g.supply.ghost.to,
    g.equilibrium.point,
    g.equilibrium.previous,
    g.equilibrium.priceGuide.to,
    g.equilibrium.quantityGuide.to,
  ];
  for (const [x, y] of points) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(slot.width);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(slot.height);
  }
  for (const label of everyLabel(g)) {
    const { left, right, top, bottom } = box(label);
    expect(left, label.text).toBeGreaterThanOrEqual(0);
    expect(right, label.text).toBeLessThanOrEqual(slot.width);
    expect(top, label.text).toBeGreaterThanOrEqual(0);
    expect(bottom, label.text).toBeLessThanOrEqual(slot.height);
  }
  for (const line of [g.demand.line, g.supply.line]) {
    for (const [x, y] of [line.from, line.to]) {
      expect(x).toBeGreaterThanOrEqual(g.origin[0]);
      expect(x).toBeLessThanOrEqual(g.quantityAxis.tip[0]);
      expect(y).toBeLessThanOrEqual(g.origin[1]);
      expect(y).toBeGreaterThanOrEqual(g.priceAxis.tip[1]);
    }
  }
}

function offLine(
  line: { from: readonly number[]; to: readonly number[] },
  point: readonly number[],
) {
  const [x1, y1] = line.from as [number, number];
  const [x2, y2] = line.to as [number, number];
  const [px, py] = point as [number, number];
  return Math.abs((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) / Math.hypot(x2 - x1, y2 - y1);
}

describe("marketEquilibrium", () => {
  it("starts at the middle of the axes", () => {
    const start = marketEquilibrium(0, 0);
    expect(start.quantity).toBeCloseTo(5, 9);
    expect(start.price).toBeCloseTo(5, 9);
  });

  it("raises the price and the quantity when the demand shifts to the right", () => {
    const start = marketEquilibrium(0, 0);
    for (const shift of [0.5, 1, 2, 4]) {
      const moved = marketEquilibrium(shift, 0);
      expect(moved.price).toBeGreaterThan(start.price);
      expect(moved.quantity).toBeGreaterThan(start.quantity);
    }
  });

  it("lowers the price and the quantity when the demand shifts to the left", () => {
    const start = marketEquilibrium(0, 0);
    const moved = marketEquilibrium(-2, 0);
    expect(moved.price).toBeLessThan(start.price);
    expect(moved.quantity).toBeLessThan(start.quantity);
  });

  it("lowers the price and raises the quantity when the supply shifts to the right", () => {
    const start = marketEquilibrium(0, 0);
    const moved = marketEquilibrium(0, 2);
    expect(moved.price).toBeLessThan(start.price);
    expect(moved.quantity).toBeGreaterThan(start.quantity);
  });

  it("keeps the equilibrium on the demand and supply curves it moves with", () => {
    for (const [demand, supply] of [
      [0, 0],
      [2, -1],
      [-3, 3],
      [4, 4],
    ] as const) {
      const { quantity, price } = marketEquilibrium(demand, supply);
      expect(price).toBeCloseTo(9 - 0.8 * (quantity - demand), 9);
      expect(price).toBeCloseTo(2 + 0.6 * (quantity - supply), 9);
    }
  });

  it("saturates a shift that is too large and ignores one that is not a number", () => {
    expect(marketEquilibrium(1e9, 0)).toEqual(marketEquilibrium(4, 0));
    expect(marketEquilibrium(-Infinity, 0)).toEqual(marketEquilibrium(-4, 0));
    expect(marketEquilibrium(Number.NaN, Number.NaN)).toEqual(marketEquilibrium(0, 0));
  });

  it("stays inside the axes for every combination of shifts", () => {
    for (const demand of EXTREMES) {
      for (const supply of EXTREMES) {
        const { quantity, price } = marketEquilibrium(demand, supply);
        expect(quantity).toBeGreaterThan(0);
        expect(quantity).toBeLessThan(10);
        expect(price).toBeGreaterThan(0);
        expect(price).toBeLessThan(10);
      }
    }
  });
});

describe("shiftOf", () => {
  it("reads a value whose default is zero as a shift", () => {
    expect(shiftOf(0, 0)).toBe(0);
    expect(shiftOf(2.5, 0)).toBe(2.5);
    expect(shiftOf(-1, 0)).toBe(-1);
  });

  it("reads a value whose default is not zero as a change from its starting position", () => {
    expect(shiftOf(300, 300)).toBe(0);
    expect(shiftOf(450, 300)).toBeCloseTo(2, 9);
    expect(shiftOf(600, 300)).toBeCloseTo(4, 9);
    expect(shiftOf(150, 300)).toBeCloseTo(-2, 9);
    expect(shiftOf(-150, -300)).toBeCloseTo(2, 9);
  });

  it("falls back to no shift when a value cannot be compared", () => {
    expect(shiftOf(Number.NaN, 300)).toBe(0);
    expect(shiftOf(300, Number.NaN)).toBe(0);
    expect(shiftOf(Infinity, 300)).toBe(0);
  });
});

describe("starred", () => {
  it("marks the equilibrium value with the initial of the axis name", () => {
    expect(starred("P")).toBe("P*");
    expect(starred("prix p")).toBe("P*");
    expect(starred("Quantité (kg)")).toBe("Q*");
    expect(starred("  éclat")).toBe("É*");
    expect(starred("")).toBe("?*");
  });
});

describe("marketLayout", () => {
  it("draws no ghost until a curve has moved, then fades it in up to full strength", () => {
    const rest = marketLayout(SLOTS[0]!, U, SHORT);
    expect(rest.demand.ghostOpacity).toBe(0);
    expect(rest.supply.ghostOpacity).toBe(0);
    expect(rest.equilibrium.previousOpacity).toBe(0);
    const small = marketLayout(SLOTS[0]!, U, { ...SHORT, demandShift: 0.1 });
    const large = marketLayout(SLOTS[0]!, U, { ...SHORT, demandShift: 2 });
    expect(small.demand.ghostOpacity).toBeGreaterThan(0);
    expect(small.demand.ghostOpacity).toBeLessThan(1);
    expect(large.demand.ghostOpacity).toBe(1);
    expect(large.supply.ghostOpacity).toBe(0);
    expect(large.equilibrium.previousOpacity).toBe(1);
  });

  it("moves the equilibrium to the right and up when the demand shifts to the right", () => {
    const slot = SLOTS[0]!;
    const rest = marketLayout(slot, U, SHORT).equilibrium.point;
    const moved = marketLayout(slot, U, { ...SHORT, demandShift: 2 }).equilibrium.point;
    expect(moved[0]).toBeGreaterThan(rest[0]);
    expect(moved[1]).toBeLessThan(rest[1]);
  });

  it("keeps the equilibrium on both curves, and the resting one where the ghosts cross", () => {
    for (const slot of SLOTS) {
      for (const [demandShift, supplyShift] of [
        [0, 0],
        [2, 0],
        [-3, 1],
        [4, -4],
      ] as const) {
        const g = marketLayout(slot, U, { ...SHORT, demandShift, supplyShift });
        expect(offLine(g.demand.line, g.equilibrium.point)).toBeLessThan(1e-6);
        expect(offLine(g.supply.line, g.equilibrium.point)).toBeLessThan(1e-6);
        expect(offLine(g.demand.ghost, g.equilibrium.previous)).toBeLessThan(1e-6);
        expect(offLine(g.supply.ghost, g.equilibrium.previous)).toBeLessThan(1e-6);
      }
    }
  });

  it("gives the demand a falling slope and the supply a rising one", () => {
    const g = marketLayout(SLOTS[0]!, U, SHORT);
    expect(g.demand.line.to[1]).toBeGreaterThan(g.demand.line.from[1]);
    expect(g.supply.line.to[1]).toBeLessThan(g.supply.line.from[1]);
    expect(g.demand.line.to[0]).toBeGreaterThan(g.demand.line.from[0]);
  });

  it("keeps the curves, the guides and every label inside the slot for any shift", () => {
    for (const slot of SLOTS) {
      for (const labels of [SHORT, LONG]) {
        for (const demandShift of EXTREMES) {
          for (const supplyShift of [0, 4, -4, 1e9, -1e9, Number.NaN]) {
            const g = marketLayout(slot, U, { ...labels, demandShift, supplyShift });
            inside(g, slot);
            expect(g.demand.line.length).toBeGreaterThan(0);
            expect(g.supply.line.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("does not move the axes or their names when a curve shifts", () => {
    const rest = marketLayout(SLOTS[0]!, U, LONG);
    const moved = marketLayout(SLOTS[0]!, U, { ...LONG, demandShift: 3, supplyShift: -2 });
    expect(moved.origin).toEqual(rest.origin);
    expect(moved.priceAxis).toEqual(rest.priceAxis);
    expect(moved.quantityAxis).toEqual(rest.quantityAxis);
  });

  it("puts the starred labels on the axes at the foot of each guide", () => {
    const g = marketLayout(SLOTS[0]!, U, { ...SHORT, demandShift: 1.5 });
    const { point, priceGuide, quantityGuide, priceLabel, quantityLabel } = g.equilibrium;
    expect(priceGuide.to).toEqual([g.origin[0], point[1]]);
    expect(quantityGuide.to).toEqual([point[0], g.origin[1]]);
    expect(priceLabel.anchor).toBe("end");
    expect(priceLabel.x).toBeLessThan(g.origin[0]);
    expect(priceLabel.y).toBe(point[1]);
    expect(quantityLabel.x).toBe(point[0]);
    expect(quantityLabel.y).toBeGreaterThan(g.origin[1]);
    expect([priceLabel.text, quantityLabel.text]).toEqual(["P*", "Q*"]);
  });

  it("names the quantity axis beside its tip when the name is short, below the plot when long", () => {
    const short = marketLayout(SLOTS[0]!, U, SHORT);
    expect(short.quantityAxis.name.y).toBe(short.origin[1]);
    expect(short.quantityAxis.name.x).toBeGreaterThan(short.quantityAxis.tip[0]);
    const long = marketLayout(SLOTS[2]!, U, LONG);
    expect(long.quantityAxis.name.y).toBeGreaterThan(long.origin[1] + 4 * U);
    expect(long.quantityAxis.name.anchor).toBe("end");
    expect(long.origin[1]).toBeLessThan(short.origin[1]);
  });

  it("names the price axis above its tip", () => {
    const g = marketLayout(SLOTS[0]!, U, SHORT);
    expect(g.priceAxis.name.y).toBeLessThan(g.priceAxis.tip[1] - 2 * U);
    expect(g.priceAxis.name.anchor).toBe("start");
  });

  it("makes room on the left for the starred price label", () => {
    const wide = marketLayout(SLOTS[0]!, U, { ...SHORT, priceLabel: "Wolframite" });
    const { priceLabel } = wide.equilibrium;
    expect(box(priceLabel).left).toBeGreaterThanOrEqual(0);
  });
});

describe("MarketSim", () => {
  it("draws every part at the end of the entrance", () => {
    const { container } = setup();
    for (const name of ["price", "quantity", "demand", "supply", "equilibrium"]) {
      expect(part(container, name), name).not.toBeNull();
    }
    expect(texts(container).sort()).toEqual(["D", "O", "P", "P*", "Q", "Q*"]);
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("shows a single part on its own, and removes a part that has been hidden", () => {
    const alone = setup({ beats: showing(["mk.supply"]) });
    expect(part(alone.container, "supply")).not.toBeNull();
    for (const name of ["price", "quantity", "demand", "equilibrium"]) {
      expect(part(alone.container, name), name).toBeNull();
    }
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["mk"], how: "fade", at: 0 },
          { do: "hide", targets: ["mk.equilibrium"], at: 0.1 },
        ],
      },
    ];
    const hidden = setup({ beats });
    expect(part(hidden.container, "equilibrium")).toBeNull();
    expect(part(hidden.container, "demand")).not.toBeNull();
  });

  it("raises the equilibrium price and quantity when the demand shifts to the right", () => {
    const rest = setup();
    const moved = setup({ values: { d: 2 } });
    const before = equilibriumOf(rest.container);
    const after = equilibriumOf(moved.container);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeLessThan(before.y);

    const guide = (view: typeof rest, name: string) =>
      view.container.querySelector(`line[data-guide="${name}"]`);
    expect(num(guide(moved, "price"), "y1")).toBeLessThan(num(guide(rest, "price"), "y1"));
    expect(num(guide(moved, "quantity"), "x1")).toBeGreaterThan(num(guide(rest, "quantity"), "x1"));
    expect(num(curve(moved.container, "demand"), "x1")).toBeGreaterThan(
      num(curve(rest.container, "demand"), "x1"),
    );
  });

  it("lowers the equilibrium price and quantity when the demand shifts to the left", () => {
    const before = equilibriumOf(setup().container);
    const after = equilibriumOf(setup({ values: { d: -2 } }).container);
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
  });

  it("lowers the price and raises the quantity when the supply shifts to the right", () => {
    const before = equilibriumOf(setup().container);
    const after = equilibriumOf(setup({ values: { s: 2 } }).container);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
  });

  it("keeps the marker where both curves cross", () => {
    for (const values of [{}, { d: 3 }, { s: -2 }, { d: -4, s: 4 }] as Record<string, number>[]) {
      const { container } = setup({ values });
      const centre = equilibriumOf(container);
      for (const name of ["demand", "supply"]) {
        const line = curve(container, name);
        const from = [num(line, "x1"), num(line, "y1")] as const;
        const to = [num(line, "x2"), num(line, "y2")] as const;
        expect(offLine({ from, to }, [centre.x, centre.y])).toBeLessThan(1e-6);
      }
    }
  });

  it("starts from the same figure whatever the shift expression, when it is at its default", () => {
    const direct = setup();
    const relative = setup({
      element: { ...MARKET, demandShift: { expr: "a" }, supplyShift: 0 },
    });
    expect(equilibriumOf(relative.container)).toEqual(equilibriumOf(direct.container));
    expect(ghost(relative.container, "demand")).toBeNull();
    expect(ghost(relative.container, "supply")).toBeNull();
    expect(marker(relative.container)!.parentElement!.querySelector("[data-ghost]")).toBeNull();
  });

  it("reads a parameter that does not start at zero relative to its default", () => {
    const relative: Market = { ...MARKET, demandShift: { expr: "a" } };
    const doubled = setup({ element: relative, values: { a: 600 } });
    const same = setup({ values: { d: 4 } });
    expect(equilibriumOf(doubled.container)).toEqual(equilibriumOf(same.container));
    const raised = equilibriumOf(setup({ element: relative, values: { a: 450 } }).container);
    expect(raised.x).toBeGreaterThan(equilibriumOf(setup().container).x);
  });

  it("shows the starting position as a dashed ghost once a curve has moved", () => {
    const rest = setup();
    expect(ghost(rest.container, "demand")).toBeNull();
    expect(ghost(rest.container, "supply")).toBeNull();
    const moved = setup({ values: { d: 2 } });
    const dashed = ghost(moved.container, "demand")!;
    expect(dashed.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(num(dashed, "x1")).toBe(num(curve(rest.container, "demand"), "x1"));
    expect(num(dashed, "y1")).toBe(num(curve(rest.container, "demand"), "y1"));
    expect(ghost(moved.container, "supply")).toBeNull();
    const ring = ghost(moved.container, "equilibrium")!;
    expect(ring.getAttribute("fill")).toBe("none");
    expect(num(ring, "cx")).toBeCloseTo(equilibriumOf(rest.container).x, 6);
    expect(num(ring, "cy")).toBeCloseTo(equilibriumOf(rest.container).y, 6);
  });

  it("falls back to P, Q, D and the supply initial of the language", () => {
    expect(texts(setup().container)).toEqual(expect.arrayContaining(["P", "Q", "D", "O"]));
    expect(texts(setup({ language: "en" }).container)).toEqual(
      expect.arrayContaining(["P", "Q", "D", "S"]),
    );
  });

  it("uses the axis names the element gives, and stars their initials", () => {
    const { container } = setup({
      element: { ...MARKET, priceLabel: "Prix (€)", quantityLabel: "Quantité (kg)" },
    });
    expect(texts(container).sort()).toEqual(["D", "O", "P*", "Prix (€)", "Q*", "Quantité (kg)"]);
  });

  it("sets every name in italic", () => {
    const { container } = setup();
    for (const text of container.querySelectorAll("text")) {
      expect(text.getAttribute("font-style")).toBe("italic");
    }
  });

  it("traces the curves and the axes, and brings in the names after the stroke", () => {
    const drawing = setup({
      frame: 9,
      beats: showing(
        ["mk.demand", "mk.supply", "mk.price", "mk.quantity", "mk.equilibrium"],
        "draw",
      ),
    });
    for (const name of ["demand", "supply"]) {
      const line = curve(drawing.container, name)!;
      const length = num(line, "stroke-dasharray");
      expect(length).toBeGreaterThan(0);
      expect(num(line, "stroke-dashoffset")).toBeGreaterThan(0);
      expect(num(line, "stroke-dashoffset")).toBeLessThan(length);
      expect(num(part(drawing.container, name)!.querySelector("text"), "opacity")).toBe(0);
    }
    const axis = part(drawing.container, "price")!;
    expect(axis.querySelector("line")!.hasAttribute("stroke-dasharray")).toBe(true);
    expect(num(axis.querySelector("polygon"), "opacity")).toBe(0);

    const done = setup({ beats: showing(["mk.demand", "mk.price"], "draw") });
    expect(curve(done.container, "demand")!.hasAttribute("stroke-dasharray")).toBe(false);
    expect(num(part(done.container, "demand")!.querySelector("text"), "opacity")).toBe(1);
    expect(num(part(done.container, "price")!.querySelector("polygon"), "opacity")).toBe(1);
  });

  it("draws each guide from the marker towards its axis while the equilibrium is traced", () => {
    const early = setup({ frame: 9, beats: showing(["mk.equilibrium"], "draw") });
    const done = setup({ beats: showing(["mk.equilibrium"], "draw") });
    for (const name of ["price", "quantity"]) {
      const partial = early.container.querySelector(`line[data-guide="${name}"]`)!;
      const full = done.container.querySelector(`line[data-guide="${name}"]`)!;
      const reached = Math.hypot(
        num(partial, "x2") - num(partial, "x1"),
        num(partial, "y2") - num(partial, "y1"),
      );
      const total = Math.hypot(
        num(full, "x2") - num(full, "x1"),
        num(full, "y2") - num(full, "y1"),
      );
      expect(reached).toBeGreaterThan(0);
      expect(reached).toBeLessThan(total);
    }
    expect(num(marker(early.container), "opacity")).toBeGreaterThan(0);
  });

  it("draws a flat result band behind a highlighted curve, axis or equilibrium", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["mk"], how: "fade", at: 0 },
          { do: "highlight", targets: ["mk.demand", "mk.quantity", "mk.equilibrium"], at: 0.1 },
        ],
      },
    ];
    const { container, ctx } = setup({ beats });
    for (const name of ["demand", "quantity"]) {
      const band = part(container, name)!.querySelector("line")!;
      expect(band.getAttribute("stroke")).toBe(ctx.theme.role.result);
      expect(num(band, "stroke-width")).toBeGreaterThan(
        num(curve(container, "supply"), "stroke-width"),
      );
    }
    const disc = part(container, "equilibrium")!.querySelector("circle")!;
    expect(disc.getAttribute("fill")).toBe(ctx.theme.role.result);
    expect(num(disc, "r")).toBeGreaterThan(num(marker(container), "r"));
    expect(part(container, "supply")!.querySelectorAll("line")).toHaveLength(1);
    expect(part(container, "price")!.querySelectorAll("line")).toHaveLength(1);
    const plain = setup();
    expect(part(plain.container, "equilibrium")!.querySelectorAll("circle")).toHaveLength(1);
  });

  it("keeps every curve and label inside the slot at the extremes of the sliders", () => {
    for (const values of [
      { d: -4, s: -4 },
      { d: 4, s: 4 },
      { d: 4, s: -4 },
      { d: -4, s: 4 },
    ]) {
      const { container, ctx } = setup({ values });
      for (const name of ["demand", "supply"]) {
        const line = curve(container, name)!;
        for (const axis of ["x1", "x2"]) {
          expect(num(line, axis)).toBeGreaterThanOrEqual(0);
          expect(num(line, axis)).toBeLessThanOrEqual(ctx.size.width);
        }
        for (const axis of ["y1", "y2"]) {
          expect(num(line, axis)).toBeGreaterThanOrEqual(0);
          expect(num(line, axis)).toBeLessThanOrEqual(ctx.size.height);
        }
      }
      const centre = equilibriumOf(container);
      expect(centre.x).toBeGreaterThan(0);
      expect(centre.y).toBeGreaterThan(0);
      expect(centre.y).toBeLessThan(ctx.size.height);
    }
  });

  describe.each<ThemeName>(["paper", "board"])("in the %s theme", (theme) => {
    it("takes every colour from the theme tokens", () => {
      const { container, ctx } = setup({
        theme,
        values: { d: 2, s: -1 },
        beats: [
          {
            id: "b1",
            narration: "Test.",
            duration_ms: 4000,
            actions: [
              { do: "show", targets: ["mk"], how: "fade", at: 0 },
              { do: "highlight", targets: ["mk.demand", "mk.equilibrium"], at: 0.1 },
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
          if (value && value !== "none") used.add(value);
        }
      }
      expect(used.size).toBeGreaterThan(0);
      for (const colour of used) expect(tokens.has(colour), colour).toBe(true);
    });

    it("colours the demand as a quantity, the supply as an action and the equilibrium as a result", () => {
      const { container, ctx } = setup({ theme });
      const { role } = ctx.theme;
      expect(curve(container, "demand")!.getAttribute("stroke")).toBe(role.quantity);
      expect(part(container, "demand")!.querySelector("text")!.getAttribute("fill")).toBe(
        role.quantity,
      );
      expect(curve(container, "supply")!.getAttribute("stroke")).toBe(role.action);
      expect(part(container, "supply")!.querySelector("text")!.getAttribute("fill")).toBe(
        role.actionText,
      );
      expect(marker(container)!.getAttribute("fill")).toBe(role.result);
      expect(marker(container)!.getAttribute("stroke")).toBe(ctx.theme.ink);
      for (const name of ["price", "quantity"]) {
        expect(part(container, name)!.querySelector("line")!.getAttribute("stroke")).toBe(
          ctx.theme.ink,
        );
      }
    });

    it("draws the curves heavier than the axes and the guides", () => {
      const { container, ctx } = setup({ theme });
      const curveWidth = num(curve(container, "demand"), "stroke-width");
      expect(curveWidth).toBeCloseTo(0.5 * ctx.u, 9);
      expect(num(part(container, "price")!.querySelector("line"), "stroke-width")).toBeCloseTo(
        0.25 * ctx.u,
        9,
      );
      const guide = container.querySelector("line[data-guide]")!;
      expect(num(guide, "stroke-width")).toBeLessThan(curveWidth);
      expect(guide.getAttribute("stroke-dasharray")).not.toBeNull();
    });
  });
});
