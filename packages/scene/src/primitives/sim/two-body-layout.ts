import { sceneMetrics } from "../../tokens";

type Vec = readonly [number, number];

export interface TwoBodyRatios {
  massA: number;
  massB: number;
  distance: number;
  force: number;
}

export interface BodyGeometry {
  x: number;
  y: number;
  radius: number;
  name: Vec;
}

export interface ArrowGeometry {
  from: Vec;
  tip: Vec;
  length: number;
  direction: 1 | -1;
  label: Vec;
}

export interface DimensionGeometry {
  y: number;
  left: number;
  right: number;
  centreY: number;
  extensionEnd: number;
  tick: number;
  label: Vec;
}

export interface TwoBodyGeometry {
  axisY: number;
  separation: number;
  a: BodyGeometry;
  b: BodyGeometry;
  arrowA: ArrowGeometry;
  arrowB: ArrowGeometry;
  dimension: DimensionGeometry;
}

const REFERENCE = { bodyA: 0.22, bodyB: 0.12, separation: 0.36, arrow: 0.11 } as const;
const SIZE_SCALE = { min: 0.5, max: 1.4 } as const;
// In a narrow slot the bodies shrink so that the reference arrows still fit between them.
const BASIS_WIDTH_RATIO = 0.6;

const MARGIN_U = 4;
// Lower bound of the separation: bodies never touch and the arrows keep room for a head.
const MIN_GAP_U = 7;
const ARROW_CLEARANCE_U = 1.5;
const NAME_GAP_U = 0.75;
const FORCE_LABEL_DROP_U = 3.2;
const FORCE_LABEL_BOTTOM_U = 4.7;
const DIMENSION_GAP_U = 1.5;
const DIMENSION_OVERSHOOT_U = 0.8;
const DIMENSION_LABEL_DROP_U = 3.2;
const TICK_U = 0.8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export function ratioOf(current: number, reference: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference <= 0) return 1;
  return Math.max(0, current / reference);
}

function sizeScale(massRatio: number): number {
  return clamp(Math.cbrt(massRatio), SIZE_SCALE.min, SIZE_SCALE.max);
}

export function twoBodyLayout(
  slot: { width: number; height: number },
  u: number,
  ratios: TwoBodyRatios,
): TwoBodyGeometry {
  const { width, height } = slot;
  const axisY = height / 3;
  const basis = Math.min(height, BASIS_WIDTH_RATIO * width);
  const radiusA = (REFERENCE.bodyA * basis * sizeScale(ratios.massA)) / 2;
  const radiusB = (REFERENCE.bodyB * basis * sizeScale(ratios.massB)) / 2;
  const nameLift = NAME_GAP_U * u + (sceneMetrics.text.label * u) / 2;

  const minSeparation = radiusA + radiusB + MIN_GAP_U * u;
  const maxSeparation = Math.max(
    minSeparation,
    width - 2 * MARGIN_U * u - 2 * Math.max(radiusA, radiusB),
  );
  const separation = clamp(
    REFERENCE.separation * width * ratios.distance,
    minSeparation,
    maxSeparation,
  );
  const xA = (width - separation) / 2;
  const xB = (width + separation) / 2;

  const room = Math.max(0, (separation - radiusA - radiusB - ARROW_CLEARANCE_U * u) / 2);
  const length = Math.min(REFERENCE.arrow * width * ratios.force, room);
  const startA = xA + radiusA;
  const startB = xB - radiusB;
  const labelY = axisY + FORCE_LABEL_DROP_U * u;

  const tallest = (Math.max(REFERENCE.bodyA, REFERENCE.bodyB) * basis * SIZE_SCALE.max) / 2;
  const dimensionY = axisY + Math.max(tallest, FORCE_LABEL_BOTTOM_U * u) + DIMENSION_GAP_U * u;

  return {
    axisY,
    separation,
    a: { x: xA, y: axisY, radius: radiusA, name: [xA, axisY - radiusA - nameLift] },
    b: { x: xB, y: axisY, radius: radiusB, name: [xB, axisY - radiusB - nameLift] },
    arrowA: {
      from: [startA, axisY],
      tip: [startA + length, axisY],
      length,
      direction: 1,
      label: [startA + length / 2, labelY],
    },
    arrowB: {
      from: [startB, axisY],
      tip: [startB - length, axisY],
      length,
      direction: -1,
      label: [startB - length / 2, labelY],
    },
    dimension: {
      y: dimensionY,
      left: xA,
      right: xB,
      centreY: axisY,
      extensionEnd: dimensionY + DIMENSION_OVERSHOOT_U * u,
      tick: TICK_U * u,
      label: [width / 2, dimensionY + DIMENSION_LABEL_DROP_U * u],
    },
  };
}
