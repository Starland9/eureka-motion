import type { PrimitiveProps } from "../../composition/context";
import { drawStyle, FigureLabel, strokeWidth } from "../shared";
import { along, figureSpace, sideNormal, toward, type Px } from "./b-geometry";
import {
  clearance,
  labelBox,
  labelColour,
  labelText,
  lineColour,
  reach,
  type LabelBox,
} from "./b-label";

const ARC_RADIUS_U = 3;
const NARROW_ANGLE = Math.PI / 3;
const MAX_WIDENING = 1.6;
const SQUARE_RATIO = 0.8;
const RIGHT_TOLERANCE = 0.01;
const LEG_SHARE = 0.5;
const MAX_LABEL_DISTANCE_U = 16;

function labelDistance(
  box: LabelBox,
  bisector: Px,
  span: number,
  { inner, gap, cap }: { inner: number; gap: number; cap: number },
): number {
  const lateral: Px = [-bisector[1], bisector[0]];
  const ahead = reach(box, bisector);
  const wedge = ahead + (reach(box, lateral) + gap) / Math.tan(span / 2);
  return Math.max(inner + gap + ahead, Math.min(wedge, cap));
}

export function AnglePrimitive({ element, ctx }: PrimitiveProps<"angle">) {
  const space = figureSpace(ctx);
  const vertex = space?.anchor(element.vertex);
  const first = space?.anchor(element.from);
  const second = space?.anchor(element.to);
  const legA = vertex && first ? toward(vertex, first) : null;
  const legB = vertex && second ? toward(vertex, second) : null;
  if (!vertex || !legA || !legB) return null;

  const state = ctx.state.of(element.id);
  const u = ctx.u;
  const [ax, ay] = legA.unit;
  const [bx, by] = legB.unit;
  const span = Math.acos(Math.min(1, Math.max(-1, ax * bx + ay * by)));
  const right = Math.abs(span - Math.PI / 2) < RIGHT_TOLERANCE;
  const widening = Math.min(MAX_WIDENING, Math.max(1, NARROW_ANGLE / span));
  const radius = Math.min(
    ARC_RADIUS_U * widening * u,
    LEG_SHARE * Math.min(legA.length, legB.length),
  );
  const side = radius * SQUARE_RATIO;

  const stroke = lineColour(ctx, element.role);
  const width = strokeWidth(ctx, "regular");
  const point = (p: Px): string => `${p[0]} ${p[1]}`;
  const feet = [along(vertex, legA.unit, side), along(vertex, legB.unit, side)] as const;
  const rim = [along(vertex, legA.unit, radius), along(vertex, legB.unit, radius)] as const;
  const sweep = ax * by - ay * bx > 0 ? 1 : 0;
  const path = right
    ? `M ${point(feet[0])} L ${point(along(feet[0], legB.unit, side))} L ${point(feet[1])}`
    : `M ${point(rim[0])} A ${radius} ${radius} 0 0 ${sweep} ${point(rim[1])}`;
  const markLength = right ? 2 * side : radius * span;

  const bisector = toward([0, 0], [ax + bx, ay + by])?.unit ?? sideNormal(legA.unit);
  const at = element.label
    ? along(
        vertex,
        bisector,
        labelDistance(labelBox(ctx, element.label), bisector, span, {
          inner: right ? side * Math.SQRT2 : radius,
          gap: clearance(ctx, 0),
          cap: MAX_LABEL_DISTANCE_U * u,
        }),
      )
    : null;

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeLinejoin="miter"
        opacity={state.opacity}
        {...drawStyle(state, markLength)}
      />
      {element.label && at ? (
        <FigureLabel
          ctx={ctx}
          state={state}
          x={at[0]}
          y={at[1]}
          text={labelText(element.label)}
          colour={labelColour(element.role)}
        />
      ) : null}
    </g>
  );
}
