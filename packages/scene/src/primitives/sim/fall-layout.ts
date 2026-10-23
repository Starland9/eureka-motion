type Vec = readonly [number, number];

export interface DimensionGeometry {
  x: number;
  top: number;
  bottom: number;
  reachFrom: number;
  reachTo: number;
  tick: number;
  label: Vec;
}

export interface FallGeometry {
  bodyX: number;
  radius: number;
  startY: number;
  endY: number;
  ground: { y: number; left: number; right: number };
  dimension: DimensionGeometry;
  arrow: { x: number; reference: number; max: number; labelX: number };
}

export interface FallMotion {
  fraction: number;
  speed: number;
}

export interface VelocityGeometry {
  from: Vec;
  tip: Vec;
  length: number;
  label: Vec;
}

const BASIS_WIDTH_RATIO = 0.6;
const BODY_SHARE = 0.2;
const MIN_RADIUS_U = 2;
// Pictograms leave about a tenth of their box empty under the drawing.
const FOOT_SHARE = 0.1;
const TOP_U = 3;
const BOTTOM_U = 2;
// Room for the label of the height beside the line, clear of the ground.
const MIN_DROP_U = 3.5;
// Share of the room between the bounds where a drop at the default height is drawn.
const DROP_REFERENCE = 0.7;
const GROUND_HALF_SHARE = 0.6;
const GROUND_MARGIN_U = 4;
const DIMENSION_OFFSET_U = 6;
const DIMENSION_OVERSHOOT_U = 0.8;
const DIMENSION_LABEL_GAP_U = 1.5;
const TICK_U = 0.8;
const ARROW_OFFSET_U = 2;
const ARROW_LABEL_GAP_U = 1.5;
const LABEL_CLEARANCE_U = 2;
const ARROW_REFERENCE_SHARE = 0.11;
const ARROW_MAX_SHARE = 0.22;
export const MIN_ARROW_U = 0.1;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// Maps a ratio to the defaults onto (0, 1): the default maps to `reference`, any ratio fits.
export function sizeCurve(ratio: number, reference: number): number {
  if (ratio === Number.POSITIVE_INFINITY) return 1;
  if (!Number.isFinite(ratio)) return reference;
  const weight = (1 - reference) / reference;
  const safe = Math.max(0, ratio);
  return safe / (safe + weight);
}

export function impactSpeed(height: number, gravity: number): number {
  return Math.sqrt(2 * gravity * height);
}

export function fallMotion(height: number, gravity: number, time: number): FallMotion {
  if (!(height > 0) || !(gravity > 0) || !Number.isFinite(height) || !Number.isFinite(gravity)) {
    return { fraction: 0, speed: 0 };
  }
  const landing = Math.sqrt((2 * height) / gravity);
  const elapsed = Number.isFinite(time) ? clamp(time, 0, landing) : 0;
  return {
    fraction: Math.min(1, (gravity * elapsed * elapsed) / (2 * height)),
    speed: gravity * elapsed,
  };
}

export function fallLayout(
  slot: { width: number; height: number },
  u: number,
  heightRatio: number,
  velocity: boolean,
): FallGeometry {
  const { width, height } = slot;
  const bodyX = width / 2;
  const basis = Math.min(height, BASIS_WIDTH_RATIO * width);
  const radius = Math.max(MIN_RADIUS_U * u, (BODY_SHARE * basis) / 2);

  const arrowMax = ARROW_MAX_SHARE * height;
  const foot = 2 * FOOT_SHARE * radius;
  const below = velocity ? Math.max(0, arrowMax - radius + foot) : 0;
  const groundY = height - BOTTOM_U * u - below;
  const endY = groundY - radius + foot;
  const highest = TOP_U * u + radius;
  const minDrop = MIN_DROP_U * u;
  const maxDrop = Math.max(minDrop, endY - highest);
  const drop = minDrop + (maxDrop - minDrop) * sizeCurve(heightRatio, DROP_REFERENCE);
  const startY = endY - drop;

  const half = Math.min(width / 2 - GROUND_MARGIN_U * u, GROUND_HALF_SHARE * height);
  const dimensionX = bodyX - radius - DIMENSION_OFFSET_U * u;
  const arrowX = bodyX + radius + ARROW_OFFSET_U * u;

  return {
    bodyX,
    radius,
    startY,
    endY,
    ground: { y: groundY, left: bodyX - half, right: bodyX + half },
    dimension: {
      x: dimensionX,
      top: groundY - drop,
      bottom: groundY,
      reachFrom: dimensionX - DIMENSION_OVERSHOOT_U * u,
      reachTo: bodyX,
      tick: TICK_U * u,
      label: [dimensionX - DIMENSION_LABEL_GAP_U * u, groundY - drop / 2],
    },
    arrow: {
      x: arrowX,
      reference: ARROW_REFERENCE_SHARE * height,
      max: arrowMax,
      labelX: arrowX + ARROW_LABEL_GAP_U * u,
    },
  };
}

export function bodyY(geometry: FallGeometry, fraction: number): number {
  return geometry.startY + (geometry.endY - geometry.startY) * clamp(fraction, 0, 1);
}

export function velocityArrow(
  geometry: FallGeometry,
  u: number,
  y: number,
  speedRatio: number,
): VelocityGeometry {
  const { x, reference, max, labelX } = geometry.arrow;
  const length = clamp(reference * speedRatio, 0, max);
  const labelY = Math.min(y + length / 2, geometry.ground.y - LABEL_CLEARANCE_U * u);
  return { from: [x, y], tip: [x, y + length], length, label: [labelX, labelY] };
}
