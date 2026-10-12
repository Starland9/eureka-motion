import type { PrimitiveProps } from "../../composition/context";
import {
  ARROW_HEAD_U,
  ArrowHead,
  drawStyle,
  labelOpacity,
  labelRise,
  strokeWidth,
  textSize,
} from "../shared";
import { ARROW_BASE, layoutAxes, PLATE_PAD_U, TICK_U, type Tick } from "./a-axes-layout";
import { clamp01, figureOf } from "./a-frame";
import { Plate, PlateLabel } from "./a-label";
import { NumberText } from "./a-value";

const ARROW_APPEARS_AT = 0.85;

export function AxesPrimitive({ element, ctx }: PrimitiveProps<"axes">) {
  const figure = figureOf(ctx);
  if (!figure) return null;
  const state = ctx.state.of(element.id);
  const { u, theme } = ctx;
  const size = textSize(ctx, "min");
  const { left, right, top, bottom, axisX, axisY, xTicks, yTicks, xName, yName, halves } =
    layoutAxes(element, ctx, figure);
  const tickHalf = (TICK_U / 2) * u;
  const pad = PLATE_PAD_U * u;
  const tracing = state.how === "draw";
  const arrowBase = ARROW_HEAD_U * u * ARROW_BASE;

  const traced = (distance: number, length: number): number =>
    tracing ? clamp01((state.progress * length - distance) / u) : 1;
  const xOpacity = (position: number): number =>
    position >= axisX
      ? traced(position - axisX, right - arrowBase - axisX)
      : traced(axisX - position, axisX - left);
  const yOpacity = (position: number): number =>
    position <= axisY
      ? traced(axisY - position, axisY - top - arrowBase)
      : traced(position - axisY, bottom - axisY);

  const arrowOpacity = tracing
    ? clamp01((state.progress - ARROW_APPEARS_AT) / (1 - ARROW_APPEARS_AT))
    : 1;
  const gridOpacity = tracing ? state.progress : 1;
  const textOpacity = labelOpacity(state);
  const rise = labelRise(ctx, state);

  const tickLabel = (tick: Tick, part: string) => {
    const { x, y, anchor, width } = tick.label;
    const edge = anchor === "start" ? -pad : anchor === "end" ? pad : 0;
    return (
      <g key={`${part}${tick.value}`}>
        <Plate
          x={x + edge}
          y={y + rise}
          width={width + 2 * pad}
          height={size}
          anchor={anchor}
          fill={theme.surfaceRaised}
          opacity={textOpacity}
        />
        <NumberText
          partName={part}
          parts={tick.parts}
          x={x}
          y={y + rise}
          size={size}
          anchor={anchor}
          baseline="middle"
          fill={theme.ink}
          opacity={textOpacity}
        />
      </g>
    );
  };

  return (
    <g>
      <g opacity={state.opacity}>
        {element.grid ? (
          <g
            data-part="grid"
            stroke={theme.rule}
            strokeWidth={strokeWidth(ctx, "construction")}
            opacity={gridOpacity}
          >
            {xTicks
              .filter((tick) => tick.position !== axisX)
              .map((tick) => (
                <line
                  key={`gx${tick.value}`}
                  x1={tick.position}
                  y1={top}
                  x2={tick.position}
                  y2={bottom}
                />
              ))}
            {yTicks
              .filter((tick) => tick.position !== axisY)
              .map((tick) => (
                <line
                  key={`gy${tick.value}`}
                  x1={left}
                  y1={tick.position}
                  x2={right}
                  y2={tick.position}
                />
              ))}
          </g>
        ) : null}
        <g
          data-part="axes"
          fill="none"
          stroke={theme.ink}
          strokeWidth={strokeWidth(ctx, "regular")}
        >
          {halves.map((half) => (
            <path key={half.id} d={half.d} {...drawStyle(state, half.length)} />
          ))}
        </g>
        <g data-part="ticks" stroke={theme.ink} strokeWidth={strokeWidth(ctx, "regular")}>
          {xTicks.map((tick) => (
            <line
              key={`tx${tick.value}`}
              x1={tick.position}
              y1={axisY - tickHalf}
              x2={tick.position}
              y2={axisY + tickHalf}
              opacity={xOpacity(tick.position)}
            />
          ))}
          {yTicks.map((tick) => (
            <line
              key={`ty${tick.value}`}
              x1={axisX - tickHalf}
              y1={tick.position}
              x2={axisX + tickHalf}
              y2={tick.position}
              opacity={yOpacity(tick.position)}
            />
          ))}
        </g>
        <ArrowHead
          ctx={ctx}
          tip={[right, axisY]}
          from={[right - 1, axisY]}
          colour={theme.ink}
          opacity={arrowOpacity}
        />
        <ArrowHead
          ctx={ctx}
          tip={[axisX, top]}
          from={[axisX, top + 1]}
          colour={theme.ink}
          opacity={arrowOpacity}
        />
      </g>
      {xTicks.map((tick) => tickLabel(tick, "tick-label-x"))}
      {yTicks.map((tick) => tickLabel(tick, "tick-label-y"))}
      {[xName, yName].map((name) =>
        name ? (
          <PlateLabel
            key={name.text}
            ctx={ctx}
            state={state}
            x={name.x}
            y={name.y}
            text={name.text}
            anchor={name.anchor}
            italic
          />
        ) : null,
      )}
    </g>
  );
}
