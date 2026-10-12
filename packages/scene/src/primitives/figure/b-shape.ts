import type { SceneContext } from "../../composition/context";
import { resolve } from "../../expr";
import type { ElementOf } from "../../schema/document";
import { resolvePoint } from "../../schema/geometry";
import { along, type FigureSpace, type Px } from "./b-geometry";
import { reach, type LabelBox } from "./b-label";

export type Outline =
  | { kind: "circle"; centre: Px; radius: number }
  | { kind: "rect"; centre: Px; width: number; height: number }
  | { kind: "polygon"; points: Px[] }
  | { kind: "arc"; centre: Px; radius: number; start: number; span: number };

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FULL_TURN = 2 * Math.PI;

export function outlineOf(
  element: ElementOf<"shape">,
  space: FigureSpace,
  ctx: SceneContext,
): Outline | null {
  const { scope } = ctx;
  const centre = element.center ? space.px(resolvePoint(element.center, scope)) : null;
  const radius = element.radius !== undefined ? resolve(element.radius, scope) * space.scale : null;
  switch (element.kind) {
    case "circle":
      return centre && radius !== null ? { kind: "circle", centre, radius } : null;
    case "rect": {
      if (!centre || element.width === undefined || element.height === undefined) return null;
      return {
        kind: "rect",
        centre,
        width: resolve(element.width, scope) * space.scale,
        height: resolve(element.height, scope) * space.scale,
      };
    }
    case "polygon":
      return element.points
        ? { kind: "polygon", points: element.points.map((p) => space.px(resolvePoint(p, scope))) }
        : null;
    case "arc": {
      if (!centre || radius === null) return null;
      if (element.startDeg === undefined || element.endDeg === undefined) return null;
      const start = (resolve(element.startDeg, scope) * Math.PI) / 180;
      const end = (resolve(element.endDeg, scope) * Math.PI) / 180;
      const turn = end - start;
      const span = turn >= FULL_TURN ? FULL_TURN : ((turn % FULL_TURN) + FULL_TURN) % FULL_TURN;
      return { kind: "arc", centre, radius, start, span };
    }
  }
}

export function isFullCircle(outline: Outline): boolean {
  return outline.kind === "arc" && outline.span >= FULL_TURN - 1e-9;
}

export function arcPoint(outline: Extract<Outline, { kind: "arc" }>, angle: number): Px {
  return [
    outline.centre[0] + outline.radius * Math.cos(angle),
    outline.centre[1] - outline.radius * Math.sin(angle),
  ];
}

const text = (p: Px): string => `${p[0]} ${p[1]}`;
const CREST_TOLERANCE = 1;

export function pathOf(outline: Outline, sector: boolean): string {
  if (outline.kind !== "arc") return "";
  const from = arcPoint(outline, outline.start);
  const to = arcPoint(outline, outline.start + outline.span);
  const large = outline.span > Math.PI ? 1 : 0;
  const arc = `A ${outline.radius} ${outline.radius} 0 ${large} 0 ${text(to)}`;
  return sector ? `M ${text(outline.centre)} L ${text(from)} ${arc} Z` : `M ${text(from)} ${arc}`;
}

export function lengthOf(outline: Outline, sector: boolean): number {
  switch (outline.kind) {
    case "circle":
      return FULL_TURN * outline.radius;
    case "rect":
      return 2 * (outline.width + outline.height);
    case "polygon":
      return outline.points.reduce((sum, point, i) => {
        const next = outline.points[(i + 1) % outline.points.length] as Px;
        return sum + Math.hypot(next[0] - point[0], next[1] - point[1]);
      }, 0);
    case "arc":
      return outline.radius * outline.span + (sector ? 2 * outline.radius : 0);
  }
}

export function boundsOf(outline: Outline): Bounds {
  switch (outline.kind) {
    case "circle":
    case "arc":
      return {
        x: outline.centre[0] - outline.radius,
        y: outline.centre[1] - outline.radius,
        width: 2 * outline.radius,
        height: 2 * outline.radius,
      };
    case "rect":
      return {
        x: outline.centre[0] - outline.width / 2,
        y: outline.centre[1] - outline.height / 2,
        width: outline.width,
        height: outline.height,
      };
    case "polygon": {
      const xs = outline.points.map((p) => p[0]);
      const ys = outline.points.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
  }
}

function polygonCentre(points: Px[]): Px {
  let area = 0;
  let cx = 0;
  let cy = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] as Px;
    const cross = p[0] * q[1] - q[0] * p[1];
    area += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  });
  if (Math.abs(area) < 1e-9) {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

const SECTOR_LABEL_RADIUS = 0.6;

export function innerPoint(outline: Outline): Px {
  switch (outline.kind) {
    case "circle":
    case "rect":
      return outline.centre;
    case "polygon":
      return polygonCentre(outline.points);
    case "arc": {
      if (isFullCircle(outline)) return outline.centre;
      const middle = outline.start + outline.span / 2;
      return along(
        outline.centre,
        [Math.cos(middle), -Math.sin(middle)],
        outline.radius * SECTOR_LABEL_RADIUS,
      );
    }
  }
}

export function outerPoint(outline: Outline, box: LabelBox, gap: number): Px {
  const above = (x: number, top: number): Px => [x, top - gap - box.height / 2];
  switch (outline.kind) {
    case "circle":
      return above(outline.centre[0], outline.centre[1] - outline.radius);
    case "rect":
      return above(outline.centre[0], outline.centre[1] - outline.height / 2);
    case "polygon": {
      const top = Math.min(...outline.points.map((p) => p[1]));
      const crest = outline.points.filter((p) => p[1] - top < CREST_TOLERANCE);
      return above(crest.reduce((s, p) => s + p[0], 0) / crest.length, top);
    }
    case "arc": {
      const middle = outline.start + outline.span / 2;
      const direction: Px = isFullCircle(outline) ? [0, -1] : [Math.cos(middle), -Math.sin(middle)];
      return along(outline.centre, direction, outline.radius + gap + reach(box, direction));
    }
  }
}
