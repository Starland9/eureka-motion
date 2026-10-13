import type { PrimitiveProps } from "../../composition/context";
import { resolve } from "../../expr";
import { Pictogram } from "../../pictograms";
import { resolvePoint } from "../../schema/geometry";
import { OBJECT_REACH, objectLabelOffset, objectLabelSides } from "../../schema/object-labels";
import { lerp } from "../../tokens";
import { colourOf, FigureLabel, SvgHighlight, textSize } from "../shared";

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
  const reach = size * OBJECT_REACH;
  const fade = state.how === "draw" ? state.progress : 1;
  const labelSide =
    objectLabelSides({
      lookup: ctx.lookup,
      scope: ctx.scope,
      slot: element.slot,
      toPx: projection.toPx,
      length: projection.length,
      u: ctx.u,
      labelSize: textSize(ctx, "label"),
    }).get(element.id) ?? 1;
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
          y={cy + objectLabelOffset(labelSide, size, ctx.u)}
          text={element.label}
        />
      ) : null}
    </g>
  );
}
