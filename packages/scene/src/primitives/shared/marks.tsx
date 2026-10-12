import type { SceneContext } from "../../composition/context";
import { strokeWidth } from "./style";

export const ARROW_HEAD_U = 1.6;
export const HATCH_SPACING_U = 0.9;

export interface ArrowHeadProps {
  ctx: SceneContext;
  tip: readonly [number, number];
  from: readonly [number, number];
  colour: string;
  opacity?: number;
}

export function ArrowHead({ ctx, tip, from, colour, opacity = 1 }: ArrowHeadProps) {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  const size = ARROW_HEAD_U * ctx.u;
  const half = size * 0.38;
  const baseX = tip[0] - ux * size;
  const baseY = tip[1] - uy * size;
  const points = [
    `${tip[0]},${tip[1]}`,
    `${baseX - uy * half},${baseY + ux * half}`,
    `${baseX + uy * half},${baseY - ux * half}`,
  ].join(" ");
  return <polygon points={points} fill={colour} opacity={opacity} />;
}

export function hatchId(elementId: string): string {
  return `hatch-${elementId}`;
}

export function HatchPattern({
  ctx,
  id,
  colour,
}: {
  ctx: SceneContext;
  id: string;
  colour: string;
}) {
  const spacing = HATCH_SPACING_U * ctx.u;
  return (
    <pattern
      id={id}
      width={spacing}
      height={spacing}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line
        x1={0}
        y1={0}
        x2={0}
        y2={spacing}
        stroke={colour}
        strokeWidth={strokeWidth(ctx, "construction")}
      />
    </pattern>
  );
}
