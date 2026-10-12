import type { PrimitiveProps } from "../../composition/context";
import { colourOf, strokeWidth, textSize } from "../shared";
import { ClipRect, figureOf } from "./a-frame";
import { PlateLabel, textWidth } from "./a-label";
import {
  endLabel,
  pathData,
  plotRange,
  plotScope,
  runLength,
  sampleCurve,
  traceStyles,
  visibleEnd,
} from "./a-curve";

const DASH_U = 2.5;
const GAP_U = 1.25;

export function PlotPrimitive({ element, ctx }: PrimitiveProps<"plot">) {
  const figure = figureOf(ctx);
  if (!figure) return null;
  const state = ctx.state.of(element.id);
  const { rect } = figure;
  const { u } = ctx;
  const scope = plotScope(ctx, element.id);
  const range = plotRange(element, scope, figure);
  const runs = range ? sampleCurve(element.fn, range, scope, figure) : [];
  const dashed = element.style === "dashed";
  const revealing = dashed && state.how === "draw" && state.progress < 1;
  const styles = dashed ? [] : traceStyles(state, runs.map(runLength));
  const first = runs[0]?.[0];
  const lastRun = runs.at(-1);
  const last = lastRun?.[lastRun.length - 1];
  const leading = first && last ? first[0] + (last[0] - first[0]) * state.progress : rect.x;
  const frameId = `clip-plot-${element.id}`;
  const revealId = `reveal-plot-${element.id}`;

  const end = element.label ? visibleEnd(runs, figure, u) : null;
  const labelSize = textSize(ctx, "label");
  const label =
    end && element.label
      ? endLabel(end, textWidth(element.label, labelSize, false), labelSize, u, rect)
      : null;

  return (
    <g>
      <defs>
        <ClipRect id={frameId} rect={rect} />
        {revealing ? <ClipRect id={revealId} rect={{ ...rect, width: leading - rect.x }} /> : null}
      </defs>
      <g opacity={state.opacity} clipPath={`url(#${frameId})`}>
        <g clipPath={revealing ? `url(#${revealId})` : undefined}>
          {runs.map((run, i) => (
            <path
              key={i}
              data-part="curve"
              d={pathData(run)}
              fill="none"
              stroke={colourOf(ctx, element.role)}
              strokeWidth={strokeWidth(ctx, "accent")}
              strokeLinejoin="round"
              strokeDasharray={dashed ? `${DASH_U * u} ${GAP_U * u}` : undefined}
              {...styles[i]}
            />
          ))}
        </g>
      </g>
      {element.label && label ? (
        <PlateLabel
          ctx={ctx}
          state={state}
          x={label.x}
          y={label.y}
          text={element.label}
          colour={element.role}
          anchor={label.anchor}
        />
      ) : null}
    </g>
  );
}
