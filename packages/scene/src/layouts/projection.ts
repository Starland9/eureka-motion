import type { Rect } from "./frame";

export interface World {
  x: readonly [number, number];
  y: readonly [number, number];
}

export interface Projection {
  scale: number;
  scaleX: number;
  scaleY: number;
  fitted: Rect;
  toPx(point: readonly [number, number]): [number, number];
  length(worldLength: number): number;
}

export const DEFAULT_WORLD: World = { x: [-10, 10], y: [-5, 5] };

export interface ProjectionOptions {
  // A graph fills its slot: each axis gets its own scale.
  stretch?: boolean;
}

export function createProjection(
  world: World,
  size: { width: number; height: number },
  options: ProjectionOptions = {},
): Projection {
  const worldWidth = world.x[1] - world.x[0];
  const worldHeight = world.y[1] - world.y[0];
  const fit = Math.min(size.width / worldWidth, size.height / worldHeight);
  const scaleX = options.stretch ? size.width / worldWidth : fit;
  const scaleY = options.stretch ? size.height / worldHeight : fit;
  const scale = Math.min(scaleX, scaleY);
  const fitted: Rect = {
    x: (size.width - worldWidth * scaleX) / 2,
    y: (size.height - worldHeight * scaleY) / 2,
    width: worldWidth * scaleX,
    height: worldHeight * scaleY,
  };
  return {
    scale,
    scaleX,
    scaleY,
    fitted,
    toPx: ([x, y]) => [fitted.x + (x - world.x[0]) * scaleX, fitted.y + (world.y[1] - y) * scaleY],
    length: (worldLength) => worldLength * scale,
  };
}
