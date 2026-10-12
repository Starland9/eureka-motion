import type { SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { BAND_WIDTH_U } from "./b-label";
import type { Px } from "./b-geometry";

export function HighlightBand({
  ctx,
  state,
  from,
  to,
}: {
  ctx: SceneContext;
  state: ElementState;
  from: Px;
  to: Px;
}) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (state.highlight <= 0 || length === 0) return null;
  return (
    <line
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      stroke={ctx.theme.role.result}
      strokeWidth={BAND_WIDTH_U * ctx.u}
      strokeLinecap="square"
      strokeDasharray={length}
      strokeDashoffset={length * (1 - state.highlight)}
    />
  );
}

export function TraceClip({
  id,
  from,
  to,
  progress,
  margin,
}: {
  id: string;
  from: Px;
  to: Px;
  progress: number;
  margin: number;
}) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const ux = (to[0] - from[0]) / length;
  const uy = (to[1] - from[1]) / length;
  const end: Px = [from[0] + ux * length * progress, from[1] + uy * length * progress];
  const corners: Px[] = [
    [from[0] - uy * margin, from[1] + ux * margin],
    [end[0] - uy * margin, end[1] + ux * margin],
    [end[0] + uy * margin, end[1] - ux * margin],
    [from[0] + uy * margin, from[1] - ux * margin],
  ];
  return (
    <clipPath id={id}>
      <polygon points={corners.map((c) => c.join(",")).join(" ")} />
    </clipPath>
  );
}
