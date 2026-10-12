import type { PrimitiveProps } from "../../composition/context";
import { resolvePoint } from "../../schema/geometry";
import { lerp } from "../../tokens";
import { colourOf, textSize } from "../shared";
import { PlateLabel, textWidth } from "./a-label";

const DOT_U = 0.6;
const RING_U = 0.3;
const LABEL_DX_U = 2.8;
const LABEL_DY_U = 1.4;

export function PointPrimitive({ element, ctx }: PrimitiveProps<"point">) {
  const { projection, u } = ctx;
  if (!projection) return null;
  const state = ctx.state.of(element.id);
  const at = resolvePoint(element.at, ctx.scope);
  const to = state.move?.to ?? at;
  const progress = state.move?.progress ?? 0;
  const [x, y] = projection.toPx([lerp(at[0], to[0], progress), lerp(at[1], to[1], progress)]);

  const size = textSize(ctx, "label");
  const width = textWidth(element.label ?? "", size, false);
  const toRight = x + LABEL_DX_U * u + width <= ctx.size.width;
  const toTop = y - LABEL_DY_U * u - size / 2 >= 0;

  return (
    <g>
      <g opacity={state.opacity}>
        <circle cx={x} cy={y} r={(DOT_U + RING_U) * u} fill={ctx.theme.surfaceRaised} />
        <circle data-part="dot" cx={x} cy={y} r={DOT_U * u} fill={colourOf(ctx, element.role)} />
      </g>
      {element.label ? (
        <PlateLabel
          ctx={ctx}
          state={state}
          x={x + (toRight ? 1 : -1) * LABEL_DX_U * u}
          y={y + (toTop ? -1 : 1) * LABEL_DY_U * u}
          text={element.label}
          colour={element.role}
          anchor={toRight ? "start" : "end"}
        />
      ) : null}
    </g>
  );
}
