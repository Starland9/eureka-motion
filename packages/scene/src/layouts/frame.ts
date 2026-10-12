import { sceneMetrics, unitPx } from "../tokens";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Frame {
  width: number;
  height: number;
  u: number;
  title: Rect;
  body: Rect;
  band: Rect;
}

export const TITLE_HEIGHT_U = 9;
export const TITLE_GAP_U = 2;
export const SLOT_GUTTER_U = 4;

export function createFrame(width: number, height: number): Frame {
  const u = unitPx(width);
  const margin = sceneMetrics.safeMargin * u;
  const band = sceneMetrics.bottomBand * u;
  const inner = width - 2 * margin;
  const bodyTop = margin + (TITLE_HEIGHT_U + TITLE_GAP_U) * u;
  return {
    width,
    height,
    u,
    title: { x: margin, y: margin, width: inner, height: TITLE_HEIGHT_U * u },
    body: { x: margin, y: bodyTop, width: inner, height: height - band - bodyTop },
    band: { x: margin, y: height - band, width: inner, height: band },
  };
}

export function rectRight(rect: Rect): number {
  return rect.x + rect.width;
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.height;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && b.x < rectRight(a) && a.y < rectBottom(b) && b.y < rectBottom(a);
}

export function rectContains(outer: Rect, inner: Rect, tolerance = 0.5): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    rectRight(inner) <= rectRight(outer) + tolerance &&
    rectBottom(inner) <= rectBottom(outer) + tolerance
  );
}
