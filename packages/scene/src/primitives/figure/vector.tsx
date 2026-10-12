import type { PrimitiveProps } from "../../composition/context";
import { resolve } from "../../expr";
import { vectorEnd } from "../../schema/geometry";
import { ARROW_HEAD_U, ArrowHead, drawStyle, FigureLabel, strokeWidth } from "../shared";
import { HighlightBand } from "./b-band";
import { along, clamp01, figureSpace, sideNormal, toward } from "./b-geometry";
import {
  BAND_WIDTH_U,
  clearance,
  labelBox,
  labelColour,
  labelText,
  lineColour,
  reach,
} from "./b-label";

const HEAD_HALF_WIDTH = 0.38;
const HEAD_OVERLAP_U = 0.1;
const HEAD_APPEARS_AT = 0.92;
const OBJECT_REACH = 0.58;
const OBJECT_GAP_U = 0.4;
const MIN_SHAFT_HEADS = 1.6;

export function VectorPrimitive({ element, ctx }: PrimitiveProps<"vector">) {
  const space = figureSpace(ctx);
  const centre = space?.anchor(element.from);
  const tipWorld = space ? vectorEnd(element, space.lookup, ctx.scope) : null;
  const aimed = space && tipWorld ? space.px(tipWorld) : null;
  const direction = centre && aimed ? toward(centre, aimed) : null;
  if (!space || !centre || !aimed || !direction) return null;

  // A vector that leaves a pictogram starts at its edge, not under its drawing.
  const source = typeof element.from === "string" ? space.lookup.get(element.from) : undefined;
  const clear =
    source?.type === "object"
      ? resolve(source.size, ctx.scope) * space.scale * OBJECT_REACH + OBJECT_GAP_U * ctx.u
      : 0;
  const origin = along(centre, direction.unit, clear);
  const shortest = clear > 0 ? ARROW_HEAD_U * ctx.u * MIN_SHAFT_HEADS : 0;
  const tip = along(origin, direction.unit, Math.max(direction.length - clear, shortest));
  const arrow = toward(origin, tip);
  if (!arrow) return null;

  const state = ctx.state.of(element.id);
  const colour = lineColour(ctx, element.role);
  const head = ARROW_HEAD_U * ctx.u;
  const hasShaft = arrow.length > head;
  const base = along(tip, arrow.unit, -(head - HEAD_OVERLAP_U * ctx.u));
  const shaftLength = Math.hypot(base[0] - origin[0], base[1] - origin[1]);
  const arrivesAt = hasShaft ? HEAD_APPEARS_AT : 0;
  const headOpacity =
    state.how === "draw" ? clamp01((state.progress - arrivesAt) / (1 - arrivesAt)) : 1;

  const bandHalf = (BAND_WIDTH_U / 2) * ctx.u;
  const bandEnd = arrow.length > bandHalf ? along(tip, arrow.unit, -bandHalf) : origin;

  const normal = sideNormal(arrow.unit);
  const label = element.label ? labelBox(ctx, element.label) : null;
  const offset = label
    ? head * HEAD_HALF_WIDTH + reach(label, normal) + clearance(ctx, state.highlight)
    : 0;
  const ahead = label ? Math.min(reach(label, arrow.unit) / 2, head) : 0;
  const at = along(along(tip, arrow.unit, ahead), normal, offset);

  return (
    <g>
      <g opacity={state.opacity}>
        <HighlightBand ctx={ctx} state={state} from={origin} to={bandEnd} />
        {hasShaft ? (
          <line
            x1={origin[0]}
            y1={origin[1]}
            x2={base[0]}
            y2={base[1]}
            stroke={colour}
            strokeWidth={strokeWidth(ctx, "accent")}
            {...drawStyle(state, shaftLength)}
          />
        ) : null}
        <ArrowHead ctx={ctx} tip={tip} from={origin} colour={colour} opacity={headOpacity} />
      </g>
      {element.label ? (
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
