import { sceneMetrics } from "../../tokens";
import { textWidth } from "../figure/a-label";

type Vec = readonly [number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PendulumInput {
  lengthRatio: number;
  angle: number;
  lengthLabel: string;
  angleLabel: string;
}

export interface CoteGeometry {
  x: number;
  top: number;
  bottom: number;
  tick: number;
  extensions: readonly (readonly [Vec, Vec])[];
  label: Vec;
  anchor: "start" | "end";
}

export interface PendulumGeometry {
  pivot: Vec;
  length: number;
  radius: number;
  ballSize: number;
  angle: number;
  side: 1 | -1;
  ceiling: { x0: number; x1: number; y: number; hatch: string; hatchLength: number; dot: number };
  axisEnd: Vec;
  sector: { d: string; length: number };
  arc: { d: string; length: number; radius: number };
  angleLabel: Vec;
  cote: CoteGeometry;
  pivotBand: Rect;
  bandPad: number;
}

export const DEFAULT_GRAVITY = 9.81;
// Beyond this the small-angle law the scene explains no longer holds.
export const MAX_AMPLITUDE_DEG = 80;
// A shorter period leaves fewer than 12 frames per swing at 30 fps and reads as a blur.
export const MIN_PERIOD_S = 0.4;

const PIVOT_TOP_U = 4.5;
const BOTTOM_U = 3;
const SIDE_MARGIN_U = 3;
const BOB_RADIUS_U = 2.2;
// The ball pictogram draws its circle at this share of its box.
const BALL_DIAMETER_SHARE = 0.76;
const MIN_ROD_U = 10;
const REFERENCE_SHARE = 0.7;
const ARC_SHARE = 0.4;
const ARC_CLEARANCE_U = 0.5;
const LABEL_HALF_HEIGHT_U = 1.4;
const LABEL_GAP_U = 0.6;
const CEILING_GAP_U = 0.2;
const COTE_GAP_U = 2.5;
const COTE_LABEL_GAP_U = 1.2;
const TICK_U = 0.8;
const OVERSHOOT_U = 0.8;
const BALL_EXTENSION_GAP_U = 0.5;
const CEILING_HALF_U = 7;
const HATCH_STEP_U = 2;
const HATCH_RISE_U = 1.6;
const DOT_U = 0.7;
const AXIS_OVERSHOOT_U = 1;
const BAND_PAD_U = 0.8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function pendulumPeriod(length: number, gravity: number): number {
  if (!(length >= 0) || !(gravity > 0)) return Infinity;
  return 2 * Math.PI * Math.sqrt(length / gravity);
}

export function amplitudeRadians(degrees: number): number {
  if (Number.isNaN(degrees)) return 0;
  return (clamp(degrees, -MAX_AMPLITUDE_DEG, MAX_AMPLITUDE_DEG) * Math.PI) / 180;
}

export function pendulumAngle(amplitude: number, period: number, seconds: number): number {
  if (!Number.isFinite(period) || !Number.isFinite(seconds)) return amplitude;
  return amplitude * Math.cos((2 * Math.PI * seconds) / Math.max(period, MIN_PERIOD_S));
}

export function bobAt(geometry: Pick<PendulumGeometry, "pivot" | "length">, angle: number): Vec {
  return [
    geometry.pivot[0] + geometry.length * Math.sin(angle),
    geometry.pivot[1] + geometry.length * Math.cos(angle),
  ];
}

export function sectorPath(pivot: Vec, radius: number, angle: number): string {
  const reach = Math.abs(angle);
  const dx = radius * Math.sin(reach);
  const dy = radius * Math.cos(reach);
  return `M ${pivot[0]} ${pivot[1]} L ${pivot[0] - dx} ${pivot[1] + dy} A ${radius} ${radius} 0 0 0 ${pivot[0] + dx} ${pivot[1] + dy} Z`;
}

export function pendulumLayout(
  slot: { width: number; height: number },
  u: number,
  input: PendulumInput,
): PendulumGeometry {
  const { width, height } = slot;
  const labelSize = sceneMetrics.text.label * u;
  const cx = width / 2;
  const py = PIVOT_TOP_U * u;
  const radius = BOB_RADIUS_U * u;
  const angle = input.angle;
  const side: 1 | -1 = angle < 0 ? -1 : 1;
  const reach = Math.abs(angle);
  const sin = Math.sin(reach);
  const pivot: Vec = [cx, py];

  const lengthWidth = textWidth(input.lengthLabel, labelSize, true);
  const farReach = radius + (COTE_GAP_U + COTE_LABEL_GAP_U) * u + lengthWidth;
  const verticalRoom = height - py - BOTTOM_U * u - radius;
  const horizontalRoom =
    sin > 1e-9 ? (width / 2 - SIDE_MARGIN_U * u - farReach) / sin : Number.POSITIVE_INFINITY;
  const minRod = MIN_ROD_U * u;
  const length = clamp(
    REFERENCE_SHARE * verticalRoom * input.lengthRatio,
    minRod,
    Math.max(minRod, Math.min(verticalRoom, horizontalRoom)),
  );

  const angleWidth = textWidth(input.angleLabel, labelSize, true);
  const rho = Math.hypot(angleWidth / 2, LABEL_HALF_HEIGHT_U * u);
  const arcRadius = Math.max(
    u,
    Math.min(ARC_SHARE * length, length - radius - rho - ARC_CLEARANCE_U * u),
  );
  const offset = Math.asin(Math.min(1, (rho + LABEL_GAP_U * u) / arcRadius));
  const labelAngle = reach + offset;
  const nearLabel: Vec = [
    cx + side * arcRadius * Math.sin(labelAngle),
    py + arcRadius * Math.cos(labelAngle),
  ];
  // Too steep for the label to sit beside the arc without reaching the ceiling: it goes past the bob.
  const farDistance = length + radius + rho + LABEL_GAP_U * u;
  const farLabel: Vec = [
    cx + side * farDistance * Math.sin(reach),
    py + farDistance * Math.cos(reach),
  ];
  const angleLabel =
    nearLabel[1] >= py + (LABEL_HALF_HEIGHT_U + CEILING_GAP_U) * u ? nearLabel : farLabel;

  const arcEnd: Vec = [cx + side * arcRadius * Math.sin(reach), py + arcRadius * Math.cos(reach)];

  const coteX = cx - side * (length * sin + radius + COTE_GAP_U * u);
  const overshoot = OVERSHOOT_U * u;
  const rest = py + length;
  const coteEnd = coteX - side * overshoot;
  const ceilingEnd = cx - side * CEILING_HALF_U * u;
  const topReach = side * (ceilingEnd - coteEnd);
  const topExtension: readonly [Vec, Vec] = [
    [ceilingEnd, py],
    [coteEnd, py],
  ];
  const bottomExtension: readonly [Vec, Vec] = [
    [cx - side * (radius + BALL_EXTENSION_GAP_U * u), rest],
    [coteEnd, rest],
  ];

  const x0 = cx - CEILING_HALF_U * u;
  const x1 = cx + CEILING_HALF_U * u;
  const rise = HATCH_RISE_U * u;
  const ticks: number[] = [];
  for (let x = x0 + rise; x <= x1 + 1e-9; x += HATCH_STEP_U * u) ticks.push(x);
  const pad = BAND_PAD_U * u;

  return {
    pivot,
    length,
    radius,
    ballSize: (2 * radius) / BALL_DIAMETER_SHARE,
    angle,
    side,
    ceiling: {
      x0,
      x1,
      y: py,
      hatch: ticks.map((x) => `M ${x} ${py} L ${x - rise} ${py - rise}`).join(" "),
      hatchLength: ticks.length * rise * Math.SQRT2,
      dot: DOT_U * u,
    },
    axisEnd: [cx, rest + radius + AXIS_OVERSHOOT_U * u],
    sector: { d: sectorPath(pivot, length, angle), length: 2 * length + 2 * reach * length },
    arc: {
      d: `M ${cx} ${py + arcRadius} A ${arcRadius} ${arcRadius} 0 0 ${side > 0 ? 0 : 1} ${arcEnd[0]} ${arcEnd[1]}`,
      length: arcRadius * reach,
      radius: arcRadius,
    },
    angleLabel,
    cote: {
      x: coteX,
      top: py,
      bottom: rest,
      tick: TICK_U * u,
      extensions: [...(topReach > 0 ? [topExtension] : []), bottomExtension],
      label: [coteX - side * COTE_LABEL_GAP_U * u, py + length / 2],
      anchor: side > 0 ? "end" : "start",
    },
    pivotBand: {
      x: x0 - pad,
      y: py - rise - pad,
      width: x1 - x0 + 2 * pad,
      height: rise + DOT_U * u + 2 * pad,
    },
    bandPad: pad,
  };
}
