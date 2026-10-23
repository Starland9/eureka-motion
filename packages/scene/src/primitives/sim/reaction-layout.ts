import { sceneMetrics } from "../../tokens";
import { monoWidth } from "../structure/measure";

type Vec = readonly [number, number];

export interface SpeciesInput {
  formula: string;
  coefficient: number;
}

export interface ReactionInput {
  reactants: readonly SpeciesInput[];
  products: readonly SpeciesInput[];
}

export interface Atom {
  x: number;
  y: number;
  symbol: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TallyRow {
  symbol: string;
  left: number;
  right: number;
  balanced: boolean;
}

export interface SpeciesGeometry {
  formula: string;
  coefficient: number;
  coefficientAt: Vec | null;
  formulaAt: Vec;
  molecules: Atom[][];
}

export interface SideGeometry {
  species: SpeciesGeometry[];
  operators: Vec[];
  centreX: number;
  box: Box;
}

export interface TallyGeometry {
  rows: (TallyRow & { y: number })[];
  leftX: number;
  midX: number;
  rightX: number;
  box: Box;
}

export interface ReactionGeometry {
  scale: number;
  diameter: number;
  symbols: boolean;
  allCopies: boolean;
  axisY: number;
  reactants: SideGeometry;
  products: SideGeometry;
  arrow: { from: Vec; tip: Vec; box: Box };
  tally: TallyGeometry;
}

interface ElementCount {
  symbol: string;
  count: number;
}

interface Shape {
  atoms: Atom[];
  width: number;
  height: number;
}

const MAX_COEFFICIENT = 99;
// Past this size a molecule is drawn with one atom per element: the tally keeps the exact count.
const MAX_DRAWN_ATOMS = 36;

const BOND_ANGLE_DEG = 104.5;
// With two ligands a carbon is linear (CO2); any other centre is bent (H2O).
const LINEAR_CENTRES: ReadonlySet<string> = new Set(["C"]);
const HEX_ROW_PITCH = Math.sqrt(3) / 2;
const CLUSTER_ASPECT = 1.3;

const D_MAX_U = 8;
// Below this size the whole drawing is scaled down rather than left to spill out of its slot.
const D_FLOOR_U = 2.5;
const SHRINK_MARGIN = 0.995;
const EDGE_U = 1;
const MOLECULE_GAP = 0.45;
const COEFFICIENT_SIZE_U = sceneMetrics.text.title;
const COEFFICIENT_ADVANCE = 0.55;
const COEFFICIENT_GAP_U = 1.6;
const OPERATOR_U = 8;
const ARROW_U = 10;
const ARROW_GAP_U = 3;
const FORMULA_DROP_U = 3.4;
const FORMULA_STRIP_U = 6.5;
const SUBSCRIPT_DROP_U = 0.8;
const TALLY_GAP_U = 2;
const TALLY_PITCH_U = 5.2;
export const TALLY_HALF_GAP_U = 1.2;
const SYMBOL_PAD_U = 0.3;
const CAP_HALF = 0.36;

const FORMULA_TOKEN = /([A-Z][a-z]?)(\d*)/g;
const COPY_ROWS = [1, 2, 3] as const;

export const subscriptDrop = (u: number): number => SUBSCRIPT_DROP_U * u;

export function wholeCoefficient(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_COEFFICIENT, Math.max(0, Math.round(value)));
}

export function parseFormula(formula: string): ElementCount[] {
  const found = new Map<string, number>();
  for (const [, symbol = "", digits = ""] of formula.matchAll(FORMULA_TOKEN)) {
    const count = digits === "" ? 1 : Number(digits);
    if (count > 0) found.set(symbol, (found.get(symbol) ?? 0) + count);
  }
  return [...found].map(([symbol, count]) => ({ symbol, count }));
}

export function formulaRuns(formula: string): { text: string; sub: boolean }[] {
  return (formula.match(/\d+|\D+/g) ?? []).map((text) => ({ text, sub: /^\d/.test(text) }));
}

export function tallyRows(input: ReactionInput): TallyRow[] {
  const order: string[] = [];
  const count = (species: readonly SpeciesInput[]): Map<string, number> => {
    const found = new Map<string, number>();
    for (const { formula, coefficient } of species) {
      if (coefficient <= 0) continue;
      for (const { symbol, count: perMolecule } of parseFormula(formula)) {
        found.set(symbol, (found.get(symbol) ?? 0) + perMolecule * coefficient);
        if (!order.includes(symbol)) order.push(symbol);
      }
    }
    return found;
  };
  const left = count(input.reactants);
  const right = count(input.products);
  return order.map((symbol) => {
    const a = left.get(symbol) ?? 0;
    const b = right.get(symbol) ?? 0;
    return { symbol, left: a, right: b, balanced: a === b };
  });
}

function centred(atoms: Atom[]): Shape {
  if (atoms.length === 0) return { atoms, width: 1, height: 1 };
  const xs = atoms.map((atom) => atom.x);
  const ys = atoms.map((atom) => atom.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  return {
    atoms: atoms.map(({ x, y, symbol }) => ({ symbol, x: x - cx, y: y - cy })),
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
  };
}

function ligandOffsets(count: number, centre: string): Vec[] {
  if (count === 2) {
    if (LINEAR_CENTRES.has(centre)) {
      return [
        [-1, 0],
        [1, 0],
      ];
    }
    const half = ((BOND_ANGLE_DEG / 2) * Math.PI) / 180;
    return [
      [-Math.sin(half), Math.cos(half)],
      [Math.sin(half), Math.cos(half)],
    ];
  }
  const angles = count === 3 ? [90, 210, 330] : [45, 135, 225, 315];
  return angles.map((deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]);
}

export function moleculeShape(formula: string): Shape {
  const elements = parseFormula(formula);
  const total = elements.reduce((sum, { count }) => sum + count, 0);
  const symbols =
    total > MAX_DRAWN_ATOMS
      ? elements.map(({ symbol }) => symbol)
      : elements.flatMap(({ symbol, count }) => Array<string>(count).fill(symbol));
  const n = symbols.length;
  if (n === 0) return centred([]);
  if (n <= 2) return centred(symbols.map((symbol, i) => ({ symbol, x: i, y: 0 })));

  const hub =
    n >= 3 && n <= 5 && total <= MAX_DRAWN_ATOMS
      ? elements.find((element) => element.count === 1 && element.symbol !== "H")
      : undefined;
  if (hub) {
    const ligands = symbols.filter((symbol) => symbol !== hub.symbol);
    const offsets = ligandOffsets(ligands.length, hub.symbol);
    return centred([
      { symbol: hub.symbol, x: 0, y: 0 },
      ...ligands.map((symbol, i) => ({ symbol, x: offsets[i]![0], y: offsets[i]![1] })),
    ]);
  }

  const columns = Math.max(2, Math.round(Math.sqrt(n * CLUSTER_ASPECT)));
  return centred(
    symbols.map((symbol, i) => {
      const row = Math.floor(i / columns);
      return { symbol, x: (i % columns) + 0.5 * (row % 2), y: row * HEX_ROW_PITCH };
    }),
  );
}

interface Prepared {
  formula: string;
  coefficient: number;
  shape: Shape;
  labelWidth: number;
  digitsWidth: number;
  coefficientWidth: number;
}

interface Plan {
  rows: number;
  allCopies: boolean;
}

interface Candidate {
  plan: Plan;
  d: number;
}

function prepare(species: readonly SpeciesInput[], u: number): Prepared[] {
  return species
    .filter(({ coefficient }) => coefficient > 0)
    .map(({ formula, coefficient }) => {
      const digitsWidth =
        coefficient === 1
          ? 0
          : String(coefficient).length * COEFFICIENT_ADVANCE * COEFFICIENT_SIZE_U * u;
      return {
        formula,
        coefficient,
        shape: moleculeShape(formula),
        labelWidth: monoWidth(formula, sceneMetrics.text.label * u),
        digitsWidth,
        coefficientWidth: digitsWidth === 0 ? 0 : digitsWidth + COEFFICIENT_GAP_U * u,
      };
    });
}

function grid(item: Prepared, plan: Plan): { copies: number; columns: number; rows: number } {
  const copies = plan.allCopies ? item.coefficient : 1;
  const columns = Math.ceil(copies / Math.min(plan.rows, copies));
  return { copies, columns, rows: Math.ceil(copies / columns) };
}

function blockSize(item: Prepared, d: number, plan: Plan): { width: number; height: number } {
  const { columns, rows } = grid(item, plan);
  const { width, height } = item.shape;
  return {
    width: (columns * width + (columns - 1) * MOLECULE_GAP) * d,
    height: (rows * height + (rows - 1) * MOLECULE_GAP) * d,
  };
}

const tallest = (items: readonly Prepared[], d: number, plan: Plan): number =>
  Math.max(0, ...items.map((item) => blockSize(item, d, plan).height));

function sideWidth(items: readonly Prepared[], d: number, plan: Plan, u: number): number {
  const species = items.reduce(
    (sum, item) =>
      sum + item.coefficientWidth + Math.max(blockSize(item, d, plan).width, item.labelWidth),
    0,
  );
  return species + Math.max(0, items.length - 1) * OPERATOR_U * u;
}

const arrowZone = (u: number): number => (ARROW_U + 2 * ARROW_GAP_U) * u;

function symbolDiameter(u: number, length: number): number {
  const size = sceneMetrics.text.label * u;
  const half = Math.hypot(
    monoWidth("x".repeat(length), size) / 2 + SYMBOL_PAD_U * u,
    CAP_HALF * size,
  );
  return 2 * half + sceneMetrics.stroke.regular * u;
}

function copiesOf(item: Prepared, d: number, plan: Plan, centre: Vec): Atom[][] {
  const { copies, columns, rows } = grid(item, plan);
  const cellWidth = item.shape.width * d;
  const cellHeight = item.shape.height * d;
  const gap = MOLECULE_GAP * d;
  const top = centre[1] - (rows * cellHeight + (rows - 1) * gap) / 2 + cellHeight / 2;
  return Array.from({ length: copies }, (_, k) => {
    const row = Math.floor(k / columns);
    const inRow = Math.min(columns, copies - row * columns);
    const x = centre[0] + ((k % columns) - (inRow - 1) / 2) * (cellWidth + gap);
    const y = top + row * (cellHeight + gap);
    return item.shape.atoms.map((atom) => ({
      symbol: atom.symbol,
      x: x + atom.x * d,
      y: y + atom.y * d,
    }));
  });
}

interface Arranged {
  geometry: Omit<ReactionGeometry, "scale">;
  fits: boolean;
  scale: number;
}

function arrange(
  slot: { width: number; height: number },
  u: number,
  input: ReactionInput,
): Arranged {
  const reactants = prepare(input.reactants, u);
  const products = prepare(input.products, u);
  const rows = tallyRows(input);
  const tallyHeight = rows.length === 0 ? 0 : (TALLY_GAP_U + rows.length * TALLY_PITCH_U) * u;
  const width = slot.width - 2 * EDGE_U * u;

  const measure = (d: number, plan: Plan): { width: number; height: number } => ({
    width: sideWidth(reactants, d, plan, u) + sideWidth(products, d, plan, u) + arrowZone(u),
    height:
      Math.max(tallest(reactants, d, plan), tallest(products, d, plan)) +
      FORMULA_STRIP_U * u +
      tallyHeight,
  });
  const fits = (d: number, plan: Plan): boolean => {
    const size = measure(d, plan);
    return size.width <= width && size.height <= slot.height;
  };
  const fitted = (plan: Plan): number => {
    let high = D_MAX_U * u;
    let low = D_FLOOR_U * u;
    if (fits(high, plan)) return high;
    if (!fits(low, plan)) return low;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (fits(mid, plan)) low = mid;
      else high = mid;
    }
    return low;
  };

  const longest = Math.max(
    1,
    ...[...input.reactants, ...input.products]
      .filter(({ coefficient }) => coefficient > 0)
      .flatMap(({ formula }) => parseFormula(formula).map(({ symbol }) => symbol.length)),
  );
  const symbolMin = symbolDiameter(u, longest);
  const candidates: Candidate[] = [true, false].flatMap((allCopies) =>
    COPY_ROWS.map((rowsOfCopies) => {
      const plan = { rows: rowsOfCopies, allCopies };
      return { plan, d: fitted(plan) };
    }),
  );
  const fitting = candidates.filter((candidate) => fits(candidate.d, candidate.plan));
  const pool = fitting.length > 0 ? fitting : candidates;
  const widest = (list: Candidate[]): Candidate | undefined =>
    list.reduce<Candidate | undefined>(
      (top, next) => (!top || next.d > top.d ? next : top),
      undefined,
    );
  const readable = (allCopies: boolean): Candidate[] =>
    pool.filter((candidate) => candidate.plan.allCopies === allCopies && candidate.d >= symbolMin);
  const { plan, d } = widest(readable(true)) ?? widest(readable(false)) ?? widest(pool)!;

  const block = Math.max(tallest(reactants, d, plan), tallest(products, d, plan));
  const equationHeight = block + FORMULA_STRIP_U * u;
  const top = (slot.height - equationHeight - tallyHeight) / 2;
  const axisY = top + block / 2;
  const labelY = top + block + FORMULA_DROP_U * u;

  const leftWidth = sideWidth(reactants, d, plan, u);
  const rightWidth = sideWidth(products, d, plan, u);
  const start = (slot.width - (leftWidth + rightWidth + arrowZone(u))) / 2;

  const placeSide = (items: readonly Prepared[], from: number, span: number): SideGeometry => {
    let cursor = from;
    const species: SpeciesGeometry[] = [];
    const operators: Vec[] = [];
    items.forEach((item, index) => {
      if (index > 0) {
        operators.push([cursor + (OPERATOR_U * u) / 2, axisY]);
        cursor += OPERATOR_U * u;
      }
      const room = Math.max(blockSize(item, d, plan).width, item.labelWidth);
      const centreX = cursor + item.coefficientWidth + room / 2;
      species.push({
        formula: item.formula,
        coefficient: item.coefficient,
        coefficientAt: item.digitsWidth === 0 ? null : [cursor + item.digitsWidth / 2, axisY],
        formulaAt: [centreX, labelY],
        molecules: copiesOf(item, d, plan, [centreX, axisY]),
      });
      cursor += item.coefficientWidth + room;
    });
    return {
      species,
      operators,
      centreX: from + span / 2,
      box: { x: from, y: top, width: span, height: equationHeight },
    };
  };
  const reactantSide = placeSide(reactants, start, leftWidth);
  const productSide = placeSide(products, start + leftWidth + arrowZone(u), rightWidth);

  const arrowFrom = start + leftWidth + ARROW_GAP_U * u;
  const arrowTip = arrowFrom + ARROW_U * u;
  const midX = (arrowFrom + arrowTip) / 2;

  const labelSize = sceneMetrics.text.label * u;
  const symbolReach = monoWidth("x".repeat(longest), labelSize);
  const countReach = monoWidth(
    "9".repeat(Math.max(1, ...rows.map((row) => String(Math.max(row.left, row.right)).length))),
    labelSize,
  );
  const half = TALLY_HALF_GAP_U * u;
  const tallyTop = top + equationHeight + TALLY_GAP_U * u;
  const tallyLeft = reactantSide.centreX - half - symbolReach;
  const tallyRight = productSide.centreX + half + countReach;

  const shrink = Math.max(
    ...candidates.map(({ plan: other }) => {
      const need = measure(D_FLOOR_U * u, other);
      return Math.min(width / need.width, slot.height / need.height);
    }),
  );

  const geometry: Arranged["geometry"] = {
    diameter: d,
    symbols: d >= symbolMin,
    allCopies: plan.allCopies,
    axisY,
    reactants: reactantSide,
    products: productSide,
    arrow: {
      from: [arrowFrom, axisY],
      tip: [arrowTip, axisY],
      box: { x: arrowFrom, y: axisY - block / 2, width: ARROW_U * u, height: block },
    },
    tally: {
      rows: rows.map((row, index) => ({ ...row, y: tallyTop + (index + 0.5) * TALLY_PITCH_U * u })),
      leftX: reactantSide.centreX,
      midX,
      rightX: productSide.centreX,
      box: {
        x: tallyLeft,
        y: tallyTop,
        width: tallyRight - tallyLeft,
        height: rows.length * TALLY_PITCH_U * u,
      },
    },
  };
  return { geometry, fits: fitting.length > 0, scale: shrink };
}

export function reactionLayout(
  slot: { width: number; height: number },
  u: number,
  input: ReactionInput,
): ReactionGeometry {
  const natural = arrange(slot, u, input);
  if (natural.fits) return { ...natural.geometry, scale: 1 };
  const scale = natural.scale * SHRINK_MARGIN;
  const shrunk = arrange({ width: slot.width / scale, height: slot.height / scale }, u, input);
  return { ...shrunk.geometry, scale };
}
