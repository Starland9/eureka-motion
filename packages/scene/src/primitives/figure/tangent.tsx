import type { PrimitiveProps } from "../../composition/context";
import { compile, formatNumber, resolve } from "../../expr";
import { colourOf, drawStyle, labelOpacity, strokeWidth, textSize } from "../shared";
import { plotElement, plotScope } from "./a-curve";
import { ClipRect, figureOf } from "./a-frame";
import { PlateLabel, textWidth } from "./a-label";

const SPAN = 1 / 3;
const STEP = 1e-5;
const FLAT = 1e-9;
const DOT_U = 0.4;
const LABEL_GAP_U = 1;
const SLOPE_FORMAT = { kind: "sig", digits: 2 } as const;

export function TangentPrimitive({ element, ctx }: PrimitiveProps<"tangent">) {
  const figure = figureOf(ctx);
  const plot = plotElement(ctx, element.plot);
  if (!figure || !plot) return null;
  const state = ctx.state.of(element.id);
  const { rect, projection, world } = figure;
  const { u } = ctx;
  const scope = plotScope(ctx, plot.id);
  const fn = compile(plot.fn);
  const x = resolve(element.at, ctx.scope);
  const h = (world.x[1] - world.x[0]) * STEP;
  const value = fn.evaluate({ ...scope, x });
  const before = fn.evaluate({ ...scope, x: x - h });
  const after = fn.evaluate({ ...scope, x: x + h });
  if (![value, before, after].every(Number.isFinite)) return null;
  const rawSlope = (after - before) / (2 * h);
  const slope = Math.abs(rawSlope) < FLAT ? 0 : rawSlope;
  const convex = before + after - 2 * value > 0;

  const [cx, cy] = projection.toPx([x, value]);
  const norm = Math.hypot(1, slope);
  const half = (rect.width * SPAN) / 2;
  const dx = half / norm;
  const dy = (-slope * half) / norm;
  const colour = colourOf(ctx, element.role, "action");
  const frameId = `clip-tangent-${element.id}`;

  const slopeText = formatNumber(slope, SLOPE_FORMAT, ctx.language);
  const text = element.showSlope
    ? element.label
      ? `${element.label} = ${slopeText}`
      : slopeText
    : element.label;
  const size = textSize(ctx, "label");
  const width = textWidth(text ?? "", size, false);
  const fits = cx + dx + LABEL_GAP_U * u + width <= rect.x + rect.width;
  const labelX = fits ? cx + dx + LABEL_GAP_U * u : cx - dx - LABEL_GAP_U * u;
  const labelY = (fits ? cy + dy : cy - dy) + (convex ? 1 : -1) * (size / 2);

  return (
    <g>
      <defs>
        <ClipRect id={frameId} rect={rect} />
      </defs>
      <g opacity={state.opacity} clipPath={`url(#${frameId})`}>
        <line
          data-part="line"
          x1={cx - dx}
          y1={cy - dy}
          x2={cx + dx}
          y2={cy + dy}
          stroke={colour}
          strokeWidth={strokeWidth(ctx, "regular")}
          {...drawStyle(state, 2 * half)}
        />
      </g>
      <g opacity={labelOpacity(state)}>
        <circle data-part="contact" cx={cx} cy={cy} r={DOT_U * u} fill={colour} />
      </g>
      {text ? (
        <PlateLabel
          ctx={ctx}
          state={state}
          x={labelX}
          y={labelY}
          text={text}
          colour={element.role ?? "action"}
          anchor={fits ? "start" : "end"}
        />
      ) : null}
    </g>
  );
}
