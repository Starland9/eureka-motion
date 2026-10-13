import type { SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import type { SceneElement } from "../../schema/document";
import {
  anchorOf,
  resolveAnchor,
  resolvePoint,
  type ElementLookup,
  type Vec,
} from "../../schema/geometry";

export type Px = readonly [number, number];
export type Anchor = Parameters<typeof resolveAnchor>[0];

export interface FigureSpace {
  lookup: ElementLookup;
  scale: number;
  scaleX: number;
  scaleY: number;
  worldHeight: number;
  px(point: Vec): Px;
  anchor(anchor: Anchor): Px | null;
}

function displacement(element: SceneElement, ctx: SceneContext): Vec {
  const move = ctx.state.of(element.id).move;
  const anchor = move ? anchorOf(element, ctx.scope) : null;
  if (!move || !anchor) return [0, 0];
  return [(move.to[0] - anchor[0]) * move.progress, (move.to[1] - anchor[1]) * move.progress];
}

function shifted(element: SceneElement, [dx, dy]: Vec, ctx: SceneContext): SceneElement {
  const at = (point: Parameters<typeof resolvePoint>[0]): [number, number] => {
    const [x, y] = resolvePoint(point, ctx.scope);
    return [x + dx, y + dy];
  };
  switch (element.type) {
    case "point":
    case "object":
      return { ...element, at: at(element.at) };
    case "shape":
      if (element.kind === "polygon" && element.points) {
        return { ...element, points: element.points.map(at) };
      }
      return element.center ? { ...element, center: at(element.center) } : element;
    default:
      return element;
  }
}

function followedLookup(ctx: SceneContext): ElementLookup {
  const lookup = new Map(ctx.lookup);
  for (const element of ctx.lookup.values()) {
    const shift = displacement(element, ctx);
    if (shift[0] !== 0 || shift[1] !== 0) lookup.set(element.id, shifted(element, shift, ctx));
  }
  return lookup;
}

export function figureSpace(ctx: SceneContext): FigureSpace | null {
  const { projection } = ctx;
  if (!projection) return null;
  const lookup = followedLookup(ctx);
  return {
    lookup,
    scale: projection.scale,
    scaleX: projection.scaleX,
    scaleY: projection.scaleY,
    worldHeight: projection.fitted.height / projection.scale,
    px: (point) => projection.toPx(point),
    anchor: (anchor) => {
      const world = resolveAnchor(anchor, lookup, ctx.scope);
      return world ? projection.toPx(world) : null;
    },
  };
}

export function toward(from: Px, to: Px): { unit: Px; length: number } | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  return length === 0 ? null : { unit: [dx / length, dy / length], length };
}

export function along(origin: Px, direction: Px, distance: number): Px {
  return [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance];
}

export function sideNormal(direction: Px): Px {
  const vertical = Math.abs(direction[0]) < 1e-6;
  const second = vertical ? direction[1] > 0 : direction[0] > 0;
  return second ? [direction[1], -direction[0]] : [-direction[1], direction[0]];
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function phased(state: ElementState, from: number, to: number): ElementState {
  return { ...state, progress: clamp01((state.progress - from) / (to - from)) };
}
