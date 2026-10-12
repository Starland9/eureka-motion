import type { Pt } from "./shapes";

export type Region = (x: number, y: number) => boolean;

const SAMPLE_STEP = 0.5;
const MIN_LENGTH = 6;
const BISECTIONS = 8;
const SHADE_SHIFT = 8;
const SHADE_FROM = 4;
const SHADE_ANGLE = -50;
const REACH = 70;

export const inCircle =
  (cx: number, cy: number, r: number): Region =>
  (x, y) =>
    Math.hypot(x - cx, y - cy) <= r;

export function inPolygon(points: readonly Pt[]): Region {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]!;
      const [xj, yj] = points[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

export const minus =
  (region: Region, hole: Region): Region =>
  (x, y) =>
    region(x, y) && !hole(x, y);

const both =
  (a: Region, b: Region): Region =>
  (x, y) =>
    a(x, y) && b(x, y);

// Light comes from the upper left: the shade is what the shape, pushed that way, leaves uncovered.
export function shaded(region: Region, centre: Pt, shift = SHADE_SHIFT): Region {
  return both(
    minus(region, (x, y) => region(x + shift, y + shift)),
    // keeps the hatching off the thin horns of the crescent
    (x, y) => x + y > centre[0] + centre[1] + SHADE_FROM,
  );
}

export function hatch(
  region: Region,
  gap: number,
  angle = SHADE_ANGLE,
  minLength = MIN_LENGTH,
): string {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad);
  const nx = -dy;
  const ny = dx;
  const edge = (outside: number, inside: number, ox: number, oy: number): number => {
    let a = outside;
    let b = inside;
    for (let i = 0; i < BISECTIONS; i++) {
      const mid = (a + b) / 2;
      if (region(ox + dx * mid, oy + dy * mid)) b = mid;
      else a = mid;
    }
    return (a + b) / 2;
  };
  const parts: string[] = [];
  const last = Math.floor(REACH / gap);
  for (let k = -last; k <= last; k++) {
    const ox = 50 + nx * k * gap;
    const oy = 50 + ny * k * gap;
    let start: number | null = null;
    const close = (end: number): void => {
      if (start !== null && end - start >= minLength) {
        const f = (v: number): string => String(Math.round(v * 100) / 100);
        parts.push(
          `M${f(ox + dx * start)} ${f(oy + dy * start)}L${f(ox + dx * end)} ${f(oy + dy * end)}`,
        );
      }
      start = null;
    };
    for (let t = -REACH; t <= REACH; t += SAMPLE_STEP) {
      const on = region(ox + dx * t, oy + dy * t);
      if (on && start === null) start = t === -REACH ? t : edge(t - SAMPLE_STEP, t, ox, oy);
      else if (!on && start !== null) close(edge(t, t - SAMPLE_STEP, ox, oy));
    }
    if (start !== null) close(REACH);
  }
  return parts.join("");
}
