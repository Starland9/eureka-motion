import { sizeCurve } from "./fall-layout";
import { ratioOf } from "./two-body-layout";

type Vec = readonly [number, number];

export interface OrbitRatios {
  radius: number;
  velocity: number;
  force: number;
}

export interface LabelWidths {
  radius: number;
  velocity: number;
  force: number;
}

export interface ArrowGeometry {
  from: Vec;
  tip: Vec;
  length: number;
  label: Vec;
}

export interface OrbitGeometry {
  centre: Vec;
  centreRadius: number;
  orbitRadius: number;
  body: { x: number; y: number; radius: number };
  radius: { from: Vec; to: Vec; length: number; label: Vec };
  velocity: ArrowGeometry | null;
  force: ArrowGeometry | null;
}

export const LABEL_HEIGHT_U = 2.8;
export const MIN_ARROW_U = 0.5;
const FIT_ARROW_U = 1.6;
const MARGIN_U = 1;
const CENTRE_SHARE = 0.16;
const CENTRE_MIN_U = 1.5;
const BODY_SHARE = 0.1;
const BODY_MIN_U = 1;
const MIN_GAP_U = 2.5;
const MAX_SHARE = 0.84;
// Share of the room between the smallest and the largest orbit where the default orbit is drawn.
const ORBIT_REFERENCE = 0.55;
const VELOCITY_SHARE = 0.22;
const FORCE_SHARE = 0.2;
const SIDE_GAP_U = 1;
const CLEAR_U = 0.6;
const HEAD_HALF_U = 0.6;
const TIP_GAP_U = 0.8;
const FORCE_CLEARANCE_U = 1;

const CAPITAL_ADVANCE = 0.7;
const LOWER_ADVANCE = 0.5;

const times = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : a * b);

// Angle swept at constant angular speed, 2π per period.
export function orbitAngle(period: number, time: number): number {
  if (!(period > 0) || !Number.isFinite(period) || !Number.isFinite(time)) return 0;
  return (2 * Math.PI * time) / period;
}

// Speed goes as r/T and the centripetal acceleration as r/T².
export function orbitRatios(
  current: { radius: number; period: number },
  reference: { radius: number; period: number },
): OrbitRatios {
  const radius = ratioOf(current.radius, reference.radius);
  const period = ratioOf(current.period, reference.period);
  const turning = current.period > 0 && Number.isFinite(current.period) && period > 0;
  const turns = turning ? 1 / period : 0;
  return { radius, velocity: times(radius, turns), force: times(radius, turns * turns) };
}

// Width of an italic symbol: capitals are wider than the other letters.
export function symbolWidth(text: string, size: number): number {
  const advance = [...text].reduce(
    (sum, char) => sum + (char !== char.toLowerCase() ? CAPITAL_ADVANCE : LOWER_ADVANCE),
    0,
  );
  return advance * size;
}

export function labelRadius(width: number, u: number): number {
  return Math.hypot(width / 2, (LABEL_HEIGHT_U * u) / 2);
}

// Distance along the radius, from the centre of a disc, beyond which a label set `side` away from
// the line clears the disc.
function clearOf(radius: number, label: number, side: number, clear: number): number {
  return Math.sqrt(Math.max(0, (radius + label + clear) ** 2 - side ** 2));
}

// Farthest distance from the centre, along the radius, at which a label `side` away from the line
// stays inside the orbit.
function insideLimit(orbitRadius: number, label: number, side: number, clear: number): number {
  return Math.sqrt(Math.max(0, (orbitRadius - clear - label) ** 2 - side ** 2));
}

function support(direction: Vec, width: number, u: number): number {
  return (Math.abs(direction[0]) * width + Math.abs(direction[1]) * LABEL_HEIGHT_U * u) / 2;
}

export function orbitLayout(
  slot: { width: number; height: number },
  u: number,
  ratios: OrbitRatios,
  labels: LabelWidths,
  angle: number,
): OrbitGeometry {
  const centre: Vec = [slot.width / 2, slot.height / 2];
  const reach = Math.min(slot.width, slot.height) / 2 - MARGIN_U * u;
  const centreRadius = Math.max(CENTRE_MIN_U * u, CENTRE_SHARE * reach);
  const bodyRadius = Math.max(BODY_MIN_U * u, BODY_SHARE * reach);
  const clear = CLEAR_U * u;
  const speedLabel = labelRadius(labels.velocity, u);
  const tipDistance = speedLabel + TIP_GAP_U * u;
  const radiusLabel = labelRadius(labels.radius, u);
  const leastSide = Math.min(labels.radius, LABEL_HEIGHT_U * u) / 2 + SIDE_GAP_U * u;
  const radiusFromCentre = (side: number): number =>
    clearOf(centreRadius, radiusLabel, side, clear);
  const radiusFromBody = (side: number): number =>
    Math.max(clearOf(bodyRadius, radiusLabel, side, clear), radiusLabel + HEAD_HALF_U * u + clear);
  const nearest = Math.max(
    centreRadius + bodyRadius + MIN_GAP_U * u,
    radiusFromCentre(leastSide) + radiusFromBody(leastSide),
    clear + radiusLabel + Math.hypot(radiusFromCentre(leastSide), leastSide),
  );
  const fits = Math.sqrt(
    Math.max(0, (reach - speedLabel) ** 2 - (bodyRadius + FIT_ARROW_U * u + tipDistance) ** 2),
  );
  const farthest = Math.max(
    nearest,
    Math.min(MAX_SHARE * reach, reach - clear - 2 * speedLabel, fits),
  );
  const orbitRadius = nearest + (farthest - nearest) * sizeCurve(ratios.radius, ORBIT_REFERENCE);

  const outward: Vec = [Math.cos(angle), -Math.sin(angle)];
  const along: Vec = [-Math.sin(angle), -Math.cos(angle)];
  const at = (base: Vec, direction: Vec, distance: number): Vec => [
    base[0] + direction[0] * distance,
    base[1] + direction[1] * distance,
  ];
  const position = at(centre, outward, orbitRadius);
  const gap = orbitRadius - centreRadius - bodyRadius;
  const side = (width: number): number => support(along, width, u) + SIDE_GAP_U * u;

  const radiusSide = side(labels.radius);
  const radiusAt = Math.min(
    Math.max(centreRadius + gap / 2, radiusFromCentre(radiusSide)),
    orbitRadius - radiusFromBody(radiusSide),
    insideLimit(orbitRadius, radiusLabel, radiusSide, clear),
  );

  const room =
    Math.sqrt(Math.max(0, (reach - speedLabel) ** 2 - orbitRadius ** 2)) - bodyRadius - tipDistance;
  const speedLength = Math.min(VELOCITY_SHARE * reach * ratios.velocity, room);
  let velocity: ArrowGeometry | null = null;
  if (speedLength >= MIN_ARROW_U * u) {
    const from = at(position, along, bodyRadius);
    const tip = at(from, along, speedLength);
    const ahead = bodyRadius + speedLength + tipDistance;
    // Near the body the tangent has not yet left the orbit line, so the label is lifted off it.
    const lift = Math.max(
      0,
      Math.sqrt(Math.max(0, (orbitRadius + clear + speedLabel) ** 2 - ahead ** 2)) - orbitRadius,
    );
    velocity = {
      from,
      tip,
      length: speedLength,
      label: at(at(tip, along, tipDistance), outward, lift),
    };
  }

  const pullLength = Math.min(FORCE_SHARE * reach * ratios.force, gap - FORCE_CLEARANCE_U * u);
  let force: ArrowGeometry | null = null;
  if (pullLength >= MIN_ARROW_U * u) {
    const from = at(position, outward, -bodyRadius);
    const tip = at(from, outward, -pullLength);
    const forceSide = side(labels.force);
    const forceLabel = labelRadius(labels.force, u);
    const shortest = Math.max(
      bodyRadius + pullLength / 2,
      clearOf(bodyRadius, forceLabel, forceSide, clear),
      orbitRadius - insideLimit(orbitRadius, forceLabel, forceSide, clear),
    );
    const distance = Math.min(
      shortest,
      orbitRadius - clearOf(centreRadius, forceLabel, forceSide, clear),
    );
    force = {
      from,
      tip,
      length: pullLength,
      label: at(at(position, outward, -distance), along, -forceSide),
    };
  }

  return {
    centre,
    centreRadius,
    orbitRadius,
    body: { x: position[0], y: position[1], radius: bodyRadius },
    radius: {
      from: at(centre, outward, centreRadius),
      to: at(position, outward, -bodyRadius),
      length: gap,
      label: at(at(centre, outward, radiusAt), along, radiusSide),
    },
    velocity,
    force,
  };
}
