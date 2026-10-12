import type { Rect } from "./frame";

export interface World {
  x: readonly [number, number];
  y: readonly [number, number];
}

export interface Projection {
  scale: number;
  fitted: Rect;
  toPx(point: readonly [number, number]): [number, number];
  length(worldLength: number): number;
}

export const DEFAULT_WORLD: World = { x: [-10, 10], y: [-5, 5] };

export function createProjection(
  world: World,
  size: { width: number; height: number },
): Projection {
  const worldWidth = world.x[1] - world.x[0];
  const worldHeight = world.y[1] - world.y[0];
  const scale = Math.min(size.width / worldWidth, size.height / worldHeight);
  const fitted: Rect = {
    x: (size.width - worldWidth * scale) / 2,
    y: (size.height - worldHeight * scale) / 2,
    width: worldWidth * scale,
    height: worldHeight * scale,
  };
  return {
    scale,
    fitted,
    toPx: ([x, y]) => [fitted.x + (x - world.x[0]) * scale, fitted.y + (world.y[1] - y) * scale],
    length: (worldLength) => worldLength * scale,
  };
}
