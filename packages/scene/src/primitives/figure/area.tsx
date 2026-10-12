import type { PrimitiveProps } from "../../composition/context";
import { compile, resolve } from "../../expr";
import { colourOf, drawStyle, HatchPattern, hatchId, strokeWidth, textSize } from "../shared";
import { plotElement, plotRange, plotScope, regionData, sampleCurve } from "./a-curve";
import { clamp01, ClipRect, figureOf } from "./a-frame";
import { PlateLabel } from "./a-label";

const RIGHT_SIDE_FROM = 0.7;
const LABEL_OFFSET_U = 0.6;

export function AreaPrimitive({ element, ctx }: PrimitiveProps<"area">) {
  const figure = figureOf(ctx);
  const plot = plotElement(ctx, element.plot);
  if (!figure || !plot) return null;
  const state = ctx.state.of(element.id);
  const { rect, projection } = figure;
  const scope = plotScope(ctx, plot.id);
  const domain = plotRange(plot, scope, figure);
  const bounds = [resolve(element.from, ctx.scope), resolve(element.to, ctx.scope)];
  if (!domain || !bounds.every(Number.isFinite)) return null;
  const low = Math.max(Math.min(...bounds), domain[0]);
  const high = Math.min(Math.max(...bounds), domain[1]);
  if (!(low < high)) return null;

  const runs = sampleCurve(plot.fn, [low, high], scope, figure);
  const first = runs[0]?.[0];
  const lastRun = runs.at(-1);
  const last = lastRun?.[lastRun.length - 1];
  if (!first || !last) return null;

  const base = projection.toPx([0, 0])[1];
  const role = element.role ?? plot.role;
  const flat = role === "result";
  const colour = colourOf(ctx, role);
  const sideColour = flat ? ctx.theme.ink : colour;
  const sideWidth = strokeWidth(ctx, "regular");
  const sides = [
    { id: "from", x: first[0], top: first[1], progress: state.progress },
    {
      id: "to",
      x: last[0],
      top: last[1],
      progress: clamp01((state.progress - RIGHT_SIDE_FROM) / (1 - RIGHT_SIDE_FROM)),
    },
  ];
  const revealing = state.how === "draw" && state.progress < 1;
  const frameId = `clip-area-${element.id}`;
  const revealId = `reveal-area-${element.id}`;
  const patternId = hatchId(element.id);

  const middle = (low + high) / 2;
  const curveAtMiddle = compile(plot.fn).evaluate({ ...scope, x: middle });
  const [labelX, curveY] = projection.toPx([middle, curveAtMiddle]);
  const size = textSize(ctx, "label");
  const thin = Math.abs(base - curveY) < size * 1.4;
  const outward = curveY <= base ? -1 : 1;
  const labelY = thin
    ? curveY + outward * (size / 2 + LABEL_OFFSET_U * ctx.u)
    : (base + curveY) / 2;

  return (
    <g>
      <defs>
        <ClipRect id={frameId} rect={rect} />
        {revealing ? (
          <ClipRect
            id={revealId}
            rect={{ ...rect, width: first[0] + (last[0] - first[0]) * state.progress - rect.x }}
          />
        ) : null}
        {flat ? null : <HatchPattern ctx={ctx} id={patternId} colour={colour} />}
      </defs>
      <g opacity={state.opacity} clipPath={`url(#${frameId})`}>
        <g clipPath={revealing ? `url(#${revealId})` : undefined}>
          {runs.map((run, i) => (
            <path
              key={i}
              data-part="region"
              d={regionData(run, base)}
              fill={flat ? colour : `url(#${patternId})`}
            />
          ))}
        </g>
        <g stroke={sideColour} strokeWidth={sideWidth}>
          {sides.map((side) => (
            <line
              key={side.id}
              data-part={`side-${side.id}`}
              x1={side.x}
              y1={base}
              x2={side.x}
              y2={side.top}
              {...drawStyle({ ...state, progress: side.progress }, Math.abs(base - side.top))}
            />
          ))}
        </g>
      </g>
      {element.label && Number.isFinite(curveAtMiddle) ? (
        <PlateLabel
          ctx={ctx}
          state={state}
          x={labelX}
          y={labelY}
          text={element.label}
          colour={flat ? "ink" : role}
        />
      ) : null}
    </g>
  );
}
