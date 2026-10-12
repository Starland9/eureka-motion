import type { SceneContext } from "../../composition/context";
import type { Projection, Rect, World } from "../../layouts";

export interface Figure {
  projection: Projection;
  world: World;
  rect: Rect;
}

export function figureOf(ctx: SceneContext): Figure | null {
  const { projection } = ctx;
  if (!projection) return null;
  const [originX, originY] = projection.toPx([0, 0]);
  const { fitted, scale } = projection;
  const left = (fitted.x - originX) / scale;
  const top = (originY - fitted.y) / scale;
  return {
    projection,
    rect: fitted,
    world: {
      x: [left, left + fitted.width / scale],
      y: [top - fitted.height / scale, top],
    },
  };
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const fixed = (value: number): string => String(Math.round(value * 100) / 100);

export function ClipRect({ id, rect }: { id: string; rect: Rect }) {
  return (
    <clipPath id={id}>
      <rect x={rect.x} y={rect.y} width={Math.max(0, rect.width)} height={rect.height} />
    </clipPath>
  );
}
