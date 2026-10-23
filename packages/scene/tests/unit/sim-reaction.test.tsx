// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  formulaRuns,
  moleculeShape,
  parseFormula,
  reactionLayout,
  tallyRows,
  wholeCoefficient,
  type ReactionGeometry,
  type ReactionInput,
} from "../../src/primitives/sim/reaction-layout";
import { monoWidth } from "../../src/primitives/structure/measure";
import type { ElementOf, LayoutName, Param, Scene } from "../../src/schema/document";
import type { ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext } from "../helpers/scene";

const U = 16;
const WIDE = { width: 1728, height: 648 };
const NOTES = { width: 1088, height: 648 };
const LOW = { width: 1088, height: 392 };
const COMPARE = { width: 832, height: 648 };
const SLOTS = [WIDE, NOTES, LOW, COMPARE];

const isBalanced = (rows: { balanced: boolean }[]): boolean => rows.every((row) => row.balanced);
const species = (formula: string, coefficient: number) => ({ formula, coefficient });
const WATER: ReactionInput = {
  reactants: [species("H2", 2), species("O2", 1)],
  products: [species("H2O", 2)],
};
const WATER_SHORT: ReactionInput = {
  reactants: [species("H2", 1), species("O2", 1)],
  products: [species("H2O", 1)],
};
const METHANE: ReactionInput = {
  reactants: [species("CH4", 1), species("O2", 2)],
  products: [species("CO2", 1), species("H2O", 2)],
};
const PHOTOSYNTHESIS: ReactionInput = {
  reactants: [species("CO2", 6), species("H2O", 6)],
  products: [species("C6H12O6", 1), species("O2", 6)],
};
const CROWDED: ReactionInput = {
  reactants: [species("C6H12O6", 3), species("KMnO4", 12), species("H2SO4", 4)],
  products: [species("Fe2O3", 5), species("NaCl", 7), species("C2H5OH", 9)],
};
const INPUTS = [WATER, WATER_SHORT, METHANE, PHOTOSYNTHESIS, CROWDED];

describe("parseFormula", () => {
  it("reads elements and counts in order of appearance", () => {
    expect(parseFormula("H2O")).toEqual([
      { symbol: "H", count: 2 },
      { symbol: "O", count: 1 },
    ]);
    expect(parseFormula("C6H12O6")).toEqual([
      { symbol: "C", count: 6 },
      { symbol: "H", count: 12 },
      { symbol: "O", count: 6 },
    ]);
    expect(parseFormula("NaCl").map((element) => element.symbol)).toEqual(["Na", "Cl"]);
  });

  it("adds up an element that comes back", () => {
    expect(parseFormula("CH3COOH")).toEqual([
      { symbol: "C", count: 2 },
      { symbol: "H", count: 4 },
      { symbol: "O", count: 2 },
    ]);
  });

  it("finds nothing in text that is not a formula", () => {
    expect(parseFormula("")).toEqual([]);
    expect(parseFormula("123")).toEqual([]);
  });
});

describe("formulaRuns", () => {
  it("splits the digits, which are lowered, from the letters", () => {
    expect(formulaRuns("C6H12O6")).toEqual([
      { text: "C", sub: false },
      { text: "6", sub: true },
      { text: "H", sub: false },
      { text: "12", sub: true },
      { text: "O", sub: false },
      { text: "6", sub: true },
    ]);
    expect(formulaRuns("Na")).toEqual([{ text: "Na", sub: false }]);
  });
});

describe("wholeCoefficient", () => {
  it("rounds, clamps and falls back to one for a value that is not a number", () => {
    expect(wholeCoefficient(2.4)).toBe(2);
    expect(wholeCoefficient(2.6)).toBe(3);
    expect(wholeCoefficient(-3)).toBe(0);
    expect(wholeCoefficient(1e9)).toBe(99);
    expect(wholeCoefficient(Number.NaN)).toBe(1);
    expect(wholeCoefficient(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("tallyRows", () => {
  it("finds the same atoms on both sides of 2 H2 + O2 -> 2 H2O", () => {
    const rows = tallyRows(WATER);
    expect(rows).toEqual([
      { symbol: "H", left: 4, right: 4, balanced: true },
      { symbol: "O", left: 2, right: 2, balanced: true },
    ]);
    expect(isBalanced(rows)).toBe(true);
  });

  it("finds a different count for H2 + O2 -> H2O", () => {
    const rows = tallyRows(WATER_SHORT);
    expect(rows).toEqual([
      { symbol: "H", left: 2, right: 2, balanced: true },
      { symbol: "O", left: 2, right: 1, balanced: false },
    ]);
    expect(isBalanced(rows)).toBe(false);
  });

  it("multiplies the atoms of a molecule by its coefficient", () => {
    expect(isBalanced(tallyRows(METHANE))).toBe(true);
    expect(isBalanced(tallyRows(PHOTOSYNTHESIS))).toBe(true);
    const rows = tallyRows(PHOTOSYNTHESIS);
    expect(rows.find((row) => row.symbol === "O")).toMatchObject({ left: 18, right: 18 });
    expect(rows.find((row) => row.symbol === "H")).toMatchObject({ left: 12, right: 12 });
  });

  it("lists an element that is on one side only, with zero on the other", () => {
    const rows = tallyRows({
      reactants: [species("H2", 1)],
      products: [species("H2O", 1)],
    });
    expect(rows).toEqual([
      { symbol: "H", left: 2, right: 2, balanced: true },
      { symbol: "O", left: 0, right: 1, balanced: false },
    ]);
  });

  it("ignores a molecule whose coefficient is zero", () => {
    const rows = tallyRows({
      reactants: [species("H2", 2), species("N2", 0)],
      products: [species("H2", 2)],
    });
    expect(rows).toEqual([{ symbol: "H", left: 4, right: 4, balanced: true }]);
  });

  it("is unbalanced as soon as one coefficient changes", () => {
    expect(isBalanced(tallyRows(WATER))).toBe(true);
    const off: ReactionInput = { ...WATER, products: [species("H2O", 3)] };
    expect(isBalanced(tallyRows(off))).toBe(false);
  });
});

describe("moleculeShape", () => {
  const distances = (formula: string): number[] => {
    const { atoms } = moleculeShape(formula);
    return atoms.flatMap((a, i) => atoms.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
  };

  it("has as many atoms as the formula says", () => {
    for (const [formula, count] of [
      ["H2", 2],
      ["H2O", 3],
      ["CO2", 3],
      ["CH4", 5],
      ["NH3", 4],
      ["Fe2O3", 5],
      ["C6H12O6", 24],
    ] as const) {
      expect(moleculeShape(formula).atoms, formula).toHaveLength(count);
    }
  });

  it("never lets two atoms overlap", () => {
    for (const formula of ["H2", "O3", "H2O", "CO2", "CH4", "NH3", "Fe2O3", "C2H6", "C6H12O6"]) {
      for (const distance of distances(formula)) {
        expect(distance, formula).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    }
  });

  it("puts a single heavy atom at the centre, bent for water and straight for carbon dioxide", () => {
    const water = moleculeShape("H2O").atoms;
    const oxygen = water.find((atom) => atom.symbol === "O")!;
    for (const hydrogen of water.filter((atom) => atom.symbol === "H")) {
      expect(Math.hypot(hydrogen.x - oxygen.x, hydrogen.y - oxygen.y)).toBeCloseTo(1, 9);
      expect(hydrogen.y).toBeGreaterThan(oxygen.y);
    }
    const dioxide = moleculeShape("CO2").atoms;
    expect(new Set(dioxide.map((atom) => atom.y)).size).toBe(1);
    expect(dioxide.map((atom) => atom.symbol).sort()).toEqual(["C", "O", "O"]);
  });

  it("centres the molecule on the origin of its bounding box", () => {
    for (const formula of ["H2", "H2O", "CH4", "C6H12O6"]) {
      const { atoms, width, height } = moleculeShape(formula);
      const xs = atoms.map((atom) => atom.x);
      const ys = atoms.map((atom) => atom.y);
      expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 9);
      expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0, 9);
      expect(width).toBeCloseTo(Math.max(...xs) - Math.min(...xs) + 1, 9);
      expect(height).toBeCloseTo(Math.max(...ys) - Math.min(...ys) + 1, 9);
    }
  });

  it("draws one atom per element when the molecule is far too large to draw", () => {
    expect(moleculeShape("C40H40O40").atoms).toHaveLength(3);
  });

  it("leaves room for a blank where there is nothing to draw", () => {
    expect(moleculeShape("")).toEqual({ atoms: [], width: 1, height: 1 });
  });
});

const atomsOf = (geometry: ReactionGeometry) =>
  [geometry.reactants, geometry.products].flatMap((side) =>
    side.species.flatMap((entry) => entry.molecules.flat()),
  );

describe("reactionLayout", () => {
  it("keeps everything inside the slot, for every slot and every reaction", () => {
    for (const slot of SLOTS) {
      for (const input of INPUTS) {
        const g = reactionLayout(slot, U, input);
        const r = g.diameter / 2;
        for (const atom of atomsOf(g)) {
          expect((atom.x - r) * g.scale).toBeGreaterThanOrEqual(0);
          expect((atom.x + r) * g.scale).toBeLessThanOrEqual(slot.width);
          expect((atom.y - r) * g.scale).toBeGreaterThanOrEqual(0);
          expect((atom.y + r) * g.scale).toBeLessThanOrEqual(slot.height);
        }
        for (const box of [g.reactants.box, g.products.box, g.arrow.box, g.tally.box]) {
          expect(box.x * g.scale).toBeGreaterThanOrEqual(-1e-6);
          expect((box.x + box.width) * g.scale).toBeLessThanOrEqual(slot.width + 1e-6);
          expect(box.y * g.scale).toBeGreaterThanOrEqual(-1e-6);
          expect((box.y + box.height) * g.scale).toBeLessThanOrEqual(slot.height + 1e-6);
        }
      }
    }
  });

  it("never lets two atoms overlap", () => {
    for (const slot of SLOTS) {
      for (const input of INPUTS) {
        const g = reactionLayout(slot, U, input);
        const atoms = atomsOf(g);
        for (const [i, a] of atoms.entries()) {
          for (const b of atoms.slice(i + 1)) {
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(g.diameter - 1e-6);
          }
        }
      }
    }
  });

  it("keeps the formulas, the coefficients and the signs clear of each other", () => {
    for (const slot of SLOTS) {
      for (const input of INPUTS) {
        const g = reactionLayout(slot, U, input);
        const spans: [number, number][] = [];
        for (const side of [g.reactants, g.products]) {
          for (const entry of side.species) {
            const half = monoWidth(entry.formula, 4 * U) / 2;
            spans.push([entry.formulaAt[0] - half, entry.formulaAt[0] + half]);
          }
        }
        spans.sort((a, b) => a[0] - b[0]);
        spans.slice(1).forEach(([from], i) => {
          expect(from).toBeGreaterThanOrEqual(spans[i]![1] - 1e-6);
        });
      }
    }
  });

  it("places the reactants, the arrow, the products and the tally in reading order", () => {
    for (const slot of SLOTS) {
      for (const input of INPUTS) {
        const g = reactionLayout(slot, U, input);
        expect(g.reactants.box.x + g.reactants.box.width).toBeLessThanOrEqual(g.arrow.box.x + 1e-6);
        expect(g.arrow.box.x + g.arrow.box.width).toBeLessThanOrEqual(g.products.box.x + 1e-6);
        expect(g.tally.box.y).toBeGreaterThanOrEqual(g.reactants.box.y + g.reactants.box.height);
        expect(g.tally.leftX).toBeLessThan(g.tally.midX);
        expect(g.tally.midX).toBeLessThan(g.tally.rightX);
        expect(g.arrow.tip[0]).toBeGreaterThan(g.arrow.from[0]);
      }
    }
  });

  it("draws every molecule, in as many atoms as the tally counts, when they all fit", () => {
    for (const input of [WATER, WATER_SHORT, METHANE]) {
      const g = reactionLayout(WIDE, U, input);
      expect(g.allCopies).toBe(true);
      const drawn = (side: typeof g.reactants, symbol: string): number =>
        side.species
          .flatMap((entry) => entry.molecules.flat())
          .filter((atom) => atom.symbol === symbol).length;
      for (const row of tallyRows(input)) {
        expect(drawn(g.reactants, row.symbol), row.symbol).toBe(row.left);
        expect(drawn(g.products, row.symbol), row.symbol).toBe(row.right);
      }
    }
  });

  it("draws the atoms with their symbol when there is room, at the largest size", () => {
    const g = reactionLayout(WIDE, U, WATER_SHORT);
    expect(g.symbols).toBe(true);
    expect(g.diameter).toBeCloseTo(8 * U, 6);
    expect(g.scale).toBe(1);
  });

  it("stacks the copies of a molecule when the slot is narrow", () => {
    const wide = reactionLayout(WIDE, U, WATER).reactants.species[0]!.molecules;
    expect(wide[0]![0]!.y).toBeCloseTo(wide[1]![0]!.y, 6);
    const narrow = reactionLayout(NOTES, U, WATER);
    const copies = narrow.reactants.species[0]!.molecules;
    expect(copies).toHaveLength(2);
    expect(copies[0]![0]!.x).toBeCloseTo(copies[1]![0]!.x, 6);
    expect(copies[1]![0]!.y).toBeGreaterThan(copies[0]![0]!.y);
    expect(narrow.symbols).toBe(true);
  });

  it("draws one molecule per formula, with its coefficient, when the copies do not fit", () => {
    const g = reactionLayout(NOTES, U, PHOTOSYNTHESIS);
    const copies = g.reactants.species.map((entry) => entry.molecules.length);
    if (!g.allCopies) expect(copies).toEqual([1, 1]);
    expect(g.reactants.species[0]!.coefficient).toBe(6);
    expect(g.reactants.species[0]!.coefficientAt).not.toBeNull();
  });

  it("drops the symbols from atoms that are too small to hold them", () => {
    const small = reactionLayout(COMPARE, U, PHOTOSYNTHESIS);
    expect(small.symbols).toBe(false);
    const big = reactionLayout(WIDE, U, PHOTOSYNTHESIS);
    expect(big.diameter).toBeGreaterThan(small.diameter);
  });

  it("scales the drawing down rather than let it spill out when nothing else fits", () => {
    const g = reactionLayout({ width: 640, height: 300 }, U, CROWDED);
    expect(g.scale).toBeLessThan(1);
    const right = Math.max(
      g.products.box.x + g.products.box.width,
      g.tally.box.x + g.tally.box.width,
    );
    expect(right * g.scale).toBeLessThanOrEqual(640);
    expect((g.tally.box.y + g.tally.box.height) * g.scale).toBeLessThanOrEqual(300);
  });

  it("omits the coefficient 1 and a molecule whose coefficient is zero", () => {
    const g = reactionLayout(WIDE, U, {
      reactants: [species("H2", 2), species("O2", 1), species("N2", 0)],
      products: [species("H2O", 2)],
    });
    expect(g.reactants.species.map((entry) => entry.formula)).toEqual(["H2", "O2"]);
    expect(g.reactants.species.map((entry) => entry.coefficientAt !== null)).toEqual([true, false]);
    expect(g.reactants.operators).toHaveLength(1);
  });

  it("lays out an empty side without failing", () => {
    const g = reactionLayout(WIDE, U, { reactants: [], products: [species("H2O", 1)] });
    expect(g.reactants.species).toEqual([]);
    expect(g.products.species).toHaveLength(1);
    expect(Number.isFinite(g.diameter)).toBe(true);
  });

  it("gives one tally row per element, spaced evenly below the equation", () => {
    const g = reactionLayout(WIDE, U, METHANE);
    expect(g.tally.rows.map((row) => row.symbol)).toEqual(["C", "H", "O"]);
    const pitch = g.tally.rows[1]!.y - g.tally.rows[0]!.y;
    expect(pitch).toBeGreaterThan(4 * U);
    expect(g.tally.rows[2]!.y - g.tally.rows[1]!.y).toBeCloseTo(pitch, 6);
    expect(g.tally.rows[0]!.y).toBeGreaterThan(g.reactants.box.y + g.reactants.box.height);
  });
});

const param = (id: string, min: number, max: number, value: number): Param => ({
  id,
  symbol: id,
  label: id,
  unit: "",
  min,
  max,
  step: 1,
  default: value,
  role: "quantity",
});
const PARAMS = [param("c", 0, 6, 2)];

type Reaction = ElementOf<"sim.reaction">;
const BOUND: Reaction = {
  id: "rx",
  slot: "figure",
  type: "sim.reaction",
  reactants: [
    { formula: "H2", coefficient: { expr: "c" } },
    { formula: "O2", coefficient: 1 },
  ],
  products: [{ formula: "H2O", coefficient: { expr: "c" } }],
};
const SHORT: Reaction = {
  ...BOUND,
  reactants: [
    { formula: "H2", coefficient: 1 },
    { formula: "O2", coefficient: 1 },
  ],
  products: [{ formula: "H2O", coefficient: 1 }],
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
  element?: Reaction;
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
  layout?: LayoutName;
}

function setup({ element = BOUND, ...rest }: Setup = {}) {
  const scene = sceneOf([element], { beats: rest.beats, layout: rest.layout });
  const ctx = testContext({
    scene,
    params: PARAMS,
    values: rest.values,
    theme: rest.theme,
    frame: rest.frame,
  });
  return { ctx, ...renderElement(element, ctx) };
}

const part = (container: Element, name: string): Element | null =>
  container.querySelector(`[data-part="${name}"]`);
const atoms = (container: Element, side: string, symbol: string): number =>
  part(container, side)?.querySelectorAll(`circle[data-atom="${symbol}"]`).length ?? 0;
const row = (container: Element, symbol: string): Element | null =>
  container.querySelector(`[data-part="tally"] [data-row="${symbol}"]`);
const cell = (container: Element, symbol: string, name: string): Element[] => [
  ...(row(container, symbol)?.querySelectorAll(`[data-text="${name}"]`) ?? []),
];
const num = (element: Element | null | undefined, name: string): number => {
  if (!element) throw new Error(`missing element for ${name}`);
  return Number(element.getAttribute(name));
};

describe("ReactionSim", () => {
  it("draws every part at the end of the entrance", () => {
    const { container } = setup();
    for (const name of ["reactants", "products", "arrow", "tally"]) {
      expect(part(container, name), name).not.toBeNull();
    }
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("counts the same atoms on both sides of a balanced equation, and says so with =", () => {
    const { container } = setup();
    for (const symbol of ["H", "O"]) {
      expect(atoms(container, "reactants", symbol)).toBe(atoms(container, "products", symbol));
      const [left, right] = cell(container, symbol, "count");
      expect(left!.textContent).toBe(right!.textContent);
      expect(row(container, symbol)?.getAttribute("data-balanced")).toBe("true");
      expect(cell(container, symbol, "mark")[0]!.textContent).toBe("=");
    }
    expect(atoms(container, "reactants", "H")).toBe(4);
    expect(atoms(container, "reactants", "O")).toBe(2);
    expect(container.textContent).not.toContain("≠");
  });

  it("counts different atoms on the two sides of an unbalanced equation, and says so with a sign", () => {
    const { container } = setup({ element: SHORT });
    expect(atoms(container, "reactants", "O")).toBe(2);
    expect(atoms(container, "products", "O")).toBe(1);
    const [left, right] = cell(container, "O", "count");
    expect([left!.textContent, right!.textContent]).toEqual(["2", "1"]);
    expect(row(container, "O")?.getAttribute("data-balanced")).toBe("false");
    expect(cell(container, "O", "mark")[0]!.textContent).toBe("≠");
    expect(row(container, "H")?.getAttribute("data-balanced")).toBe("true");
    expect(cell(container, "H", "mark")[0]!.textContent).toBe("=");
  });

  it("goes from balanced to unbalanced when a coefficient is moved", () => {
    const balanced = setup({ values: { c: 2 } });
    const moved = setup({ values: { c: 3 } });
    expect(moved.container.querySelector("[data-balanced=false]")).not.toBeNull();
    expect(balanced.container.querySelector("[data-balanced=false]")).toBeNull();
    expect(atoms(moved.container, "reactants", "H")).toBe(6);
    expect(atoms(moved.container, "products", "O")).toBe(3);
    expect(atoms(moved.container, "reactants", "O")).toBe(2);
    const coefficients = [...moved.container.querySelectorAll('[data-text="coefficient"]')];
    expect(coefficients.map((text) => text.textContent)).toEqual(["3", "3"]);
  });

  it("writes the formulas with lowered digits and the coefficient only when it is not 1", () => {
    const { container } = setup();
    const formulas = [...container.querySelectorAll('[data-text="formula"]')];
    expect(formulas.map((text) => text.textContent)).toEqual(["H2", "O2", "H2O"]);
    const lowered = formulas[2]!.querySelectorAll("tspan[dy]");
    expect([...lowered].map((span) => span.textContent)).toEqual(["2", "O"]);
    expect(Number(lowered[0]!.getAttribute("dy"))).toBeGreaterThan(0);
    expect(Number(lowered[1]!.getAttribute("dy"))).toBeLessThan(0);
    expect(container.querySelectorAll('[data-text="coefficient"]')).toHaveLength(2);
    const plain = setup({ element: SHORT });
    expect(plain.container.querySelector('[data-text="coefficient"]')).toBeNull();
  });

  it("does not draw a molecule whose coefficient is zero", () => {
    const { container } = setup({ values: { c: 0 } });
    expect(container.querySelector('[data-species="H2"]')).toBeNull();
    expect(container.querySelector('[data-species="H2O"]')).toBeNull();
    expect(container.querySelector('[data-species="O2"]')).not.toBeNull();
  });

  it("does not render a part that the state hides, and keeps the others", () => {
    const { container } = setup({ beats: showing(["rx.reactants", "rx.arrow"]) });
    expect(part(container, "reactants")).not.toBeNull();
    expect(part(container, "arrow")).not.toBeNull();
    expect(part(container, "products")).toBeNull();
    expect(part(container, "tally")).toBeNull();
  });

  it("shows the tally on its own", () => {
    const { container } = setup({ beats: showing(["rx.tally"]) });
    expect(part(container, "tally")).not.toBeNull();
    for (const name of ["reactants", "products", "arrow"]) {
      expect(part(container, name), name).toBeNull();
    }
  });

  it("traces the atoms and the arrow, then names them", () => {
    const { container } = setup({
      frame: 9,
      beats: showing(["rx.reactants", "rx.arrow"], "draw"),
    });
    const circle = part(container, "reactants")!.querySelector("circle")!;
    const length = num(circle, "stroke-dasharray");
    expect(length).toBeGreaterThan(0);
    expect(num(circle, "stroke-dashoffset")).toBeGreaterThan(0);
    expect(num(circle, "stroke-dashoffset")).toBeLessThan(length);
    expect(num(part(container, "reactants")!.querySelector("text"), "opacity")).toBe(0);
    const shaft = part(container, "arrow")!.querySelector("line")!;
    expect(shaft.hasAttribute("stroke-dasharray")).toBe(true);
    expect(num(part(container, "arrow")!.querySelector("polygon"), "opacity")).toBe(0);

    const done = setup({ beats: showing(["rx.reactants", "rx.arrow"], "draw") });
    expect(
      part(done.container, "reactants")!.querySelector("circle")!.hasAttribute("stroke-dasharray"),
    ).toBe(false);
    expect(num(part(done.container, "reactants")!.querySelector("text"), "opacity")).toBe(1);
  });

  it("fades the tally in even when it is asked to be drawn", () => {
    const { container } = setup({ frame: 9, beats: showing(["rx.tally"], "draw") });
    const opacity = num(part(container, "tally")!.querySelector("text"), "opacity");
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  it("draws a flat result band behind a highlighted part", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["rx"], how: "fade", at: 0 },
          { do: "highlight", targets: ["rx.tally"], at: 0.1 },
        ],
      },
    ];
    const { container, ctx } = setup({ beats });
    const band = part(container, "tally")!.querySelector("rect")!;
    expect(band.getAttribute("fill")).toBe(ctx.theme.role.result);
    expect(num(band, "width")).toBeGreaterThan(0);
    expect(part(container, "reactants")!.querySelector("rect")).toBeNull();
    const text = part(container, "tally")!.querySelector("text")!;
    expect(text.getAttribute("fill")).toBe(ctx.theme.ink);
  });

  it("scales the whole drawing down when it cannot fit at any size", () => {
    const crowded: Reaction = {
      ...BOUND,
      slot: "figure_a",
      reactants: [
        { formula: "C6H12O6", coefficient: 3 },
        { formula: "KMnO4", coefficient: 12 },
        { formula: "H2SO4", coefficient: 4 },
      ],
      products: [
        { formula: "Fe2O3", coefficient: 5 },
        { formula: "NaCl", coefficient: 7 },
        { formula: "C2H5OH", coefficient: 9 },
      ],
    };
    const { container } = setup({ element: crowded, layout: "compare" });
    expect(container.querySelector("g[transform^='scale(']")).not.toBeNull();
    const plain = setup();
    expect(plain.container.querySelector("g[transform]")).toBeNull();
  });

  it("fits a narrow slot with the symbols still readable", () => {
    const { container } = setup({ layout: "figure-notes" });
    expect(atoms(container, "reactants", "H")).toBe(4);
    const symbols = [...part(container, "reactants")!.querySelectorAll("text")].map(
      (text) => text.textContent,
    );
    expect(symbols).toContain("H");
    expect(symbols).toContain("O");
  });

  describe.each<ThemeName>(["paper", "board"])("in the %s theme", (theme) => {
    it("takes every colour from the theme tokens", () => {
      const { container, ctx } = setup({
        theme,
        element: SHORT,
        beats: [
          {
            id: "b1",
            narration: "Test.",
            duration_ms: 4000,
            actions: [
              { do: "show", targets: ["rx"], how: "fade", at: 0 },
              { do: "highlight", targets: ["rx.arrow"], at: 0.1 },
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

    it("colours the coefficients as a quantity and the balanced counts as validated", () => {
      const { container, ctx } = setup({ theme });
      const { role } = ctx.theme;
      for (const text of container.querySelectorAll('[data-text="coefficient"]')) {
        expect(text.getAttribute("fill")).toBe(role.quantity);
      }
      for (const text of row(container, "H")!.querySelectorAll(
        '[data-text="count"], [data-text="mark"]',
      )) {
        expect(text.getAttribute("fill")).toBe(role.valid);
      }
      for (const text of part(container, "reactants")!.querySelectorAll("circle")) {
        expect(text.getAttribute("stroke")).toBe(ctx.theme.ink);
      }
    });

    it("leaves the counts that differ in ink, so that the sign carries the difference", () => {
      const { container, ctx } = setup({ theme, element: SHORT });
      for (const text of row(container, "O")!.querySelectorAll(
        '[data-text="count"], [data-text="mark"]',
      )) {
        expect(text.getAttribute("fill")).toBe(ctx.theme.ink);
      }
      for (const text of row(container, "H")!.querySelectorAll('[data-text="count"]')) {
        expect(text.getAttribute("fill")).toBe(ctx.theme.role.valid);
      }
    });
  });
});
