import type { PrimitiveProps } from "../../composition/context";
import { drawStyle, FigureLabel, strokeWidth } from "../shared";
import { HighlightBand, TraceClip } from "./b-band";
import { along, figureSpace, sideNormal, toward, type Px } from "./b-geometry";
import { clearance, labelBox, labelColour, labelText, lineColour, reach } from "./b-label";

const LABEL_OFFSET_U = 1.6;
const DASH_U = 1.8;
const DASH_GAP_U = 1;

function dashPattern(length: number, dash: number, gap: number): string {
  const count = Math.max(1, Math.round((length + gap) / (dash + gap)));
  return `${(length - (count - 1) * gap) / count} ${gap}`;
}

export function SegmentPrimitive({ element, ctx }: PrimitiveProps<"segment">) {
  const space = figureSpace(ctx);
  const from = space?.anchor(element.from);
  const to = space?.anchor(element.to);
  const line = from && to ? toward(from, to) : null;
  if (!from || !to || !line) return null;

  const state = ctx.state.of(element.id);
  const dashed = element.style === "dashed";
  const clipped = dashed && state.how === "draw" && state.progress < 1;
  const clipId = `trace-${element.id}`;
  const stroke = lineColour(ctx, element.role);

  const normal = sideNormal(line.unit);
  const label = element.label ? labelBox(ctx, element.label) : null;
  const mid: Px = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const offset = label
    ? Math.max(LABEL_OFFSET_U * ctx.u, reach(label, normal) + clearance(ctx, state.highlight))
    : 0;
  const at = along(mid, normal, offset);

  return (
    <g>
      <g opacity={state.opacity}>
        {clipped ? (
          <defs>
            <TraceClip
              id={clipId}
              from={from}
              to={to}
              progress={state.progress}
              margin={2 * ctx.u}
            />
          </defs>
        ) : null}
        <HighlightBand ctx={ctx} state={state} from={from} to={to} />
        <line
          x1={from[0]}
          y1={from[1]}
          x2={to[0]}
          y2={to[1]}
          stroke={stroke}
          strokeWidth={strokeWidth(ctx, "regular")}
          strokeLinecap={dashed ? "butt" : "square"}
          clipPath={clipped ? `url(#${clipId})` : undefined}
          {...(dashed
            ? { strokeDasharray: dashPattern(line.length, DASH_U * ctx.u, DASH_GAP_U * ctx.u) }
            : drawStyle(state, line.length))}
        />
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
