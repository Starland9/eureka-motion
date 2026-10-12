import type { SceneContext } from "../composition/context";
import type { PICTOGRAMS } from "../schema/document";
import { strokeWidth } from "../primitives/shared/style";

export type PictogramKind = (typeof PICTOGRAMS)[number];

export interface PictogramProps {
  ctx: SceneContext;
  kind: PictogramKind;
  x: number;
  y: number;
  size: number;
  colour?: string;
  opacity?: number;
}

export function Pictogram({ ctx, x, y, size, colour, opacity = 1 }: PictogramProps) {
  return (
    <circle
      cx={x}
      cy={y}
      r={size / 2}
      fill={ctx.theme.surfaceRaised}
      stroke={colour ?? ctx.theme.ink}
      strokeWidth={strokeWidth(ctx, "regular")}
      opacity={opacity}
    />
  );
}
