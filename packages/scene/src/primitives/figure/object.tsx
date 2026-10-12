import type { PrimitiveProps } from "../../composition/context";
import { resolve } from "../../expr";
import { Pictogram } from "../../pictograms";
import { resolveAnchor, resolvePoint, vectorEnd } from "../../schema/geometry";
import { lerp } from "../../tokens";
import { colourOf, FigureLabel, px, SvgHighlight } from "../shared";

const HIGHLIGHT_REACH = 0.58;
const LABEL_GAP_U = 3.2;

// A label under the pictogram would sit on a vector that leaves it downwards.
function hasVectorBelow(ctx: PrimitiveProps<"object">["ctx"], id: string): boolean {
  for (const other of ctx.lookup.values()) {
    if (other.type !== "vector" || other.from !== id) continue;
    const start = resolveAnchor(other.from, ctx.lookup, ctx.scope);
    const end = vectorEnd(other, ctx.lookup, ctx.scope);
    if (!start || !end) continue;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    if (dy < 0 && Math.abs(dx) < Math.abs(dy)) return true;
  }
  return false;
}

export function ObjectPrimitive({ element, ctx }: PrimitiveProps<"object">) {
  const { projection } = ctx;
  if (!projection) return null;
  const state = ctx.state.of(element.id);
  const [fromX, fromY] = resolvePoint(element.at, ctx.scope);
  const [x, y] = state.move
    ? [
        lerp(fromX, state.move.to[0], state.move.progress),
        lerp(fromY, state.move.to[1], state.move.progress),
      ]
    : [fromX, fromY];
  const [cx, cy] = projection.toPx([x, y]);
  const size = projection.length(resolve(element.size, ctx.scope));
  const reach = size * HIGHLIGHT_REACH;
  const fade = state.how === "draw" ? state.progress : 1;
  const labelSide = hasVectorBelow(ctx, element.id) ? -1 : 1;
  // result is a fill, never a stroke
  const stroke = element.role === "result" ? "ink" : element.role;

  return (
    <g>
      <g opacity={state.opacity}>
        <SvgHighlight
          ctx={ctx}
          state={state}
          x={cx - reach}
          y={cy - reach}
          width={2 * reach}
          height={2 * reach}
        />
      </g>
      <Pictogram
        ctx={ctx}
        kind={element.kind}
        x={cx}
        y={cy}
        size={size}
        colour={colourOf(ctx, stroke)}
        opacity={state.opacity * fade}
      />
      {element.label ? (
        <FigureLabel
          ctx={ctx}
          state={state}
          x={cx}
          y={cy + labelSide * (reach + px(ctx, LABEL_GAP_U))}
          text={element.label}
        />
      ) : null}
    </g>
  );
}
