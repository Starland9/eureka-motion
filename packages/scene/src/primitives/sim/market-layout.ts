import { sceneMetrics } from "../../tokens";
import { textWidth } from "../figure/a-label";

type Vec = readonly [number, number];
type Anchor = "start" | "middle" | "end";

export interface MarketInput {
  demandShift: number;
  supplyShift: number;
  priceLabel: string;
  quantityLabel: string;
  demandLabel: string;
  supplyLabel: string;
}

export interface Trace {
  from: Vec;
  to: Vec;
  length: number;
}

export interface Placed {
  x: number;
  y: number;
  anchor: Anchor;
  text: string;
}

export interface AxisGeometry {
  shaft: Trace;
  tip: Vec;
  name: Placed;
}

export interface CurveGeometry {
  line: Trace;
  ghost: Trace;
  ghostOpacity: number;
  label: Placed;
}

export interface EquilibriumGeometry {
  point: Vec;
  previous: Vec;
  previousOpacity: number;
  priceGuide: Trace;
  quantityGuide: Trace;
  priceLabel: Placed;
  quantityLabel: Placed;
}

export interface MarketGeometry {
  origin: Vec;
  priceAxis: AxisGeometry;
  quantityAxis: AxisGeometry;
  demand: CurveGeometry;
  supply: CurveGeometry;
  equilibrium: EquilibriumGeometry;
}

export interface MarketPoint {
  quantity: number;
  price: number;
}

const AXIS_MAX = 10;
const DEMAND = { intercept: 9, slope: -0.8 } as const;
const SUPPLY = { intercept: 2, slope: 0.6 } as const;
// Keeps the equilibrium, and a visible stretch of each curve, inside the axes.
const MAX_SHIFT = 4;
// A default value that is not zero is read as a starting point: doubling it moves the curve this far.
const RELATIVE_SHIFT = MAX_SHIFT;
const GHOST_FULL_AT = 0.6;

const TOP_U = 7;
const BOTTOM_U = 6;
const MIN_LEFT_U = 7;
const MIN_RIGHT_U = 4.5;
const ARROW_CLEARANCE_U = 3;
const TICK_HALF_U = 0.4;
const LABEL_GAP_U = 0.7;
const LEFT_PAD_U = 0.8;
const AXIS_NAME_GAP_U = 1.4;
const CURVE_LABEL_GAP_U = 1;
const NAME_ROW_U = 2.6;
const SECOND_ROW_U = 4.5;
const SECOND_NAME_U = 7.6;
const INLINE_NAME_MAX = 0.3;
const MAX_MARGIN = 0.4;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function shiftOf(current: number, reference: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(reference)) return 0;
  if (reference === 0) return current;
  return (RELATIVE_SHIFT * (current - reference)) / Math.abs(reference);
}

const clampShift = (shift: number): number =>
  Number.isNaN(shift) ? 0 : clamp(shift, -MAX_SHIFT, MAX_SHIFT);

export function marketEquilibrium(demandShift: number, supplyShift: number): MarketPoint {
  const demand = clampShift(demandShift);
  const supply = clampShift(supplyShift);
  const kd = -DEMAND.slope;
  const ks = SUPPLY.slope;
  const quantity = (DEMAND.intercept - SUPPLY.intercept + kd * demand + ks * supply) / (kd + ks);
  return { quantity, price: DEMAND.intercept - kd * (quantity - demand) };
}

export function starred(label: string): string {
  const [initial = "?"] = [...label.trim()];
  return `${initial.toUpperCase()}*`;
}

function trace(from: Vec, to: Vec): Trace {
  return { from, to, length: Math.hypot(to[0] - from[0], to[1] - from[1]) };
}

export function marketLayout(
  slot: { width: number; height: number },
  u: number,
  input: MarketInput,
): MarketGeometry {
  const { width, height } = slot;
  const size = sceneMetrics.text.label * u;
  const demandShift = clampShift(input.demandShift);
  const supplyShift = clampShift(input.supplyShift);

  const priceStar = starred(input.priceLabel);
  const quantityStar = starred(input.quantityLabel);
  const starWidth = textWidth(priceStar, size, true);
  const quantityWidth = textWidth(input.quantityLabel, size, true);
  const inline = quantityWidth + AXIS_NAME_GAP_U * u <= INLINE_NAME_MAX * width;

  const left = Math.min(
    Math.max(MIN_LEFT_U * u, starWidth + (TICK_HALF_U + LABEL_GAP_U + LEFT_PAD_U) * u),
    MAX_MARGIN * width,
  );
  const rightMargin = Math.min(
    Math.max(MIN_RIGHT_U * u, inline ? quantityWidth + AXIS_NAME_GAP_U * u + u : 0),
    MAX_MARGIN * width,
  );
  const right = width - rightMargin;
  const top = TOP_U * u;
  const bottom = height - (BOTTOM_U + (inline ? 0 : SECOND_ROW_U)) * u;

  const x0 = left;
  const x1 = Math.max(x0, right - ARROW_CLEARANCE_U * u);
  const y0 = bottom;
  const y1 = Math.min(y0, top + ARROW_CLEARANCE_U * u);
  const toPx = (quantity: number, price: number): Vec => [
    x0 + (quantity / AXIS_MAX) * (x1 - x0),
    y0 - (price / AXIS_MAX) * (y0 - y1),
  ];
  const origin: Vec = [left, bottom];

  const curve = (
    curveFor: { intercept: number; slope: number },
    shift: number,
    text: string,
  ): CurveGeometry => {
    const stretch = (at: number): Trace => {
      const priceAt = (quantity: number): number =>
        curveFor.intercept + curveFor.slope * (quantity - at);
      const reached = [
        (0 - curveFor.intercept) / curveFor.slope,
        (AXIS_MAX - curveFor.intercept) / curveFor.slope,
      ]
        .map((offset) => at + offset)
        .sort((a, b) => a - b);
      const lo = Math.max(0, reached[0]!);
      const hi = Math.min(AXIS_MAX, reached[1]!);
      return trace(toPx(lo, priceAt(lo)), toPx(hi, priceAt(hi)));
    };
    const line = stretch(shift);
    const [dx, dy] = [line.to[0] - line.from[0], line.to[1] - line.from[1]];
    const direction: Vec = line.length === 0 ? [1, 0] : [dx / line.length, dy / line.length];
    const textW = textWidth(text, size, true);
    const reach = (textW / 2) * Math.abs(direction[0]) + (size / 2) * Math.abs(direction[1]);
    const away = CURVE_LABEL_GAP_U * u + reach;
    // A falling curve is named above its end: beyond it, the name would run into the axis name.
    const spot: Vec =
      direction[1] > 0
        ? [line.to[0], line.to[1] - CURVE_LABEL_GAP_U * u - size / 2]
        : [line.to[0] + direction[0] * away, line.to[1] + direction[1] * away];
    return {
      line,
      ghost: stretch(0),
      ghostOpacity: clamp(Math.abs(shift) / GHOST_FULL_AT, 0, 1),
      label: {
        x: clamp(spot[0], textW / 2, width - textW / 2),
        y: clamp(spot[1], size / 2, height - size / 2),
        anchor: "middle",
        text,
      },
    };
  };

  const { quantity, price } = marketEquilibrium(demandShift, supplyShift);
  const start = marketEquilibrium(0, 0);
  const point = toPx(quantity, price);
  const tickGap = (TICK_HALF_U + LABEL_GAP_U) * u;

  const nameRowY = NAME_ROW_U * u;
  const quantityName: Placed = inline
    ? { x: right + AXIS_NAME_GAP_U * u, y: bottom, anchor: "start", text: input.quantityLabel }
    : { x: right, y: bottom + SECOND_NAME_U * u, anchor: "end", text: input.quantityLabel };

  return {
    origin,
    priceAxis: {
      shaft: trace(origin, [left, top]),
      tip: [left, top],
      name: { x: Math.max(0, left - u), y: nameRowY, anchor: "start", text: input.priceLabel },
    },
    quantityAxis: {
      shaft: trace(origin, [right, bottom]),
      tip: [right, bottom],
      name: quantityName,
    },
    demand: curve(DEMAND, demandShift, input.demandLabel),
    supply: curve(SUPPLY, supplyShift, input.supplyLabel),
    equilibrium: {
      point,
      previous: toPx(start.quantity, start.price),
      previousOpacity: clamp(
        Math.hypot(quantity - start.quantity, price - start.price) / GHOST_FULL_AT,
        0,
        1,
      ),
      priceGuide: trace(point, [left, point[1]]),
      quantityGuide: trace(point, [point[0], bottom]),
      priceLabel: { x: left - tickGap, y: point[1], anchor: "end", text: priceStar },
      quantityLabel: {
        x: point[0],
        y: bottom + tickGap + size / 2,
        anchor: "middle",
        text: quantityStar,
      },
    },
  };
}
