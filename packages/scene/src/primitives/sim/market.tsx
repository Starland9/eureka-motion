import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { resolve, type Bindable } from "../../expr";
import type { SceneColour } from "../../tokens";
import { HighlightBand } from "../figure/b-band";
import {
  ARROW_HEAD_U,
  ArrowHead,
  colourOf,
  drawStyle,
  FigureLabel,
  labelOpacity,
  strokeWidth,
} from "../shared";
import {
  marketLayout,
  shiftOf,
  type AxisGeometry,
  type CurveGeometry,
  type EquilibriumGeometry,
  type Placed,
  type Trace,
} from "./market-layout";

const HEAD_APPEARS_AT = 0.85;
const SHAFT_INTO_HEAD = 0.75;
const MARKER_RADIUS_U = 0.9;
const HIGHLIGHT_RADIUS_U = 2.2;
const MARKER_APPEARS_BY = 0.25;
const TICK_HALF_U = 0.4;
const GUIDE_DASH_U = 0.6;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function partial(line: Trace, progress: number): Trace["to"] {
  return [
    line.from[0] + (line.to[0] - line.from[0]) * progress,
    line.from[1] + (line.to[1] - line.from[1]) * progress,
  ];
}

interface LabelProps {
  ctx: SceneContext;
  state: ElementState;
  at: Placed;
  colour?: SceneColour;
}

function Name({ ctx, state, at, colour }: LabelProps) {
  return (
    <FigureLabel
      ctx={ctx}
      state={state}
      x={at.x}
      y={at.y}
      text={at.text}
      anchor={at.anchor}
      colour={colour}
      italic
    />
  );
}

interface AxisProps {
  ctx: SceneContext;
  state: ElementState;
  axis: AxisGeometry;
  part: string;
}

function Axis({ ctx, state, axis, part }: AxisProps) {
  const { shaft, tip } = axis;
  const head = ARROW_HEAD_U * ctx.u;
  const ux = shaft.length === 0 ? 0 : (tip[0] - shaft.from[0]) / shaft.length;
  const uy = shaft.length === 0 ? 0 : (tip[1] - shaft.from[1]) / shaft.length;
  const end: Trace["to"] = [
    tip[0] - ux * head * SHAFT_INTO_HEAD,
    tip[1] - uy * head * SHAFT_INTO_HEAD,
  ];
  const headAppear =
    state.how === "draw" ? clamp01((state.progress - HEAD_APPEARS_AT) / (1 - HEAD_APPEARS_AT)) : 1;
  return (
    <g data-part={part}>
      <HighlightBand ctx={ctx} state={state} from={shaft.from} to={tip} />
      <line
        x1={shaft.from[0]}
        y1={shaft.from[1]}
        x2={end[0]}
        y2={end[1]}
        stroke={ctx.theme.ink}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, Math.max(0, shaft.length - head * SHAFT_INTO_HEAD))}
      />
      <ArrowHead
        ctx={ctx}
        tip={tip}
        from={shaft.from}
        colour={ctx.theme.ink}
        opacity={state.opacity * headAppear}
      />
      <Name ctx={ctx} state={state} at={axis.name} />
    </g>
  );
}

interface CurveProps {
  ctx: SceneContext;
  state: ElementState;
  curve: CurveGeometry;
  colour: SceneColour;
  labelColour: SceneColour;
  part: string;
}

function Curve({ ctx, state, curve, colour, labelColour, part }: CurveProps) {
  const stroke = colourOf(ctx, colour);
  const { line, ghost } = curve;
  return (
    <g data-part={part}>
      <HighlightBand ctx={ctx} state={state} from={line.from} to={line.to} />
      {curve.ghostOpacity > 0 ? (
        <line
          data-ghost=""
          x1={ghost.from[0]}
          y1={ghost.from[1]}
          x2={ghost.to[0]}
          y2={ghost.to[1]}
          stroke={stroke}
          strokeWidth={strokeWidth(ctx, "regular")}
          strokeDasharray={`${GUIDE_DASH_U * ctx.u} ${GUIDE_DASH_U * ctx.u}`}
          opacity={curve.ghostOpacity * labelOpacity(state)}
        />
      ) : null}
      {line.length > 0 ? (
        <line
          x1={line.from[0]}
          y1={line.from[1]}
          x2={line.to[0]}
          y2={line.to[1]}
          stroke={stroke}
          strokeWidth={strokeWidth(ctx, "accent")}
          opacity={state.opacity}
          {...drawStyle(state, line.length)}
        />
      ) : null}
      <Name ctx={ctx} state={state} at={curve.label} colour={labelColour} />
    </g>
  );
}

interface EquilibriumProps {
  ctx: SceneContext;
  state: ElementState;
  equilibrium: EquilibriumGeometry;
  axisX: number;
  axisY: number;
}

function Equilibrium({ ctx, state, equilibrium, axisX, axisY }: EquilibriumProps) {
  const { point, previous } = equilibrium;
  const { u, theme } = ctx;
  const tracing = state.how === "draw";
  const progress = tracing ? state.progress : 1;
  const marker = tracing
    ? clamp01(state.progress / MARKER_APPEARS_BY) * state.opacity
    : state.opacity;
  const dash = `${GUIDE_DASH_U * u} ${GUIDE_DASH_U * u}`;
  const tick = TICK_HALF_U * u;
  const guides: { guide: Trace; key: string }[] = [
    { guide: equilibrium.priceGuide, key: "price" },
    { guide: equilibrium.quantityGuide, key: "quantity" },
  ];
  return (
    <g data-part="equilibrium">
      {state.highlight > 0 ? (
        <circle
          cx={point[0]}
          cy={point[1]}
          r={HIGHLIGHT_RADIUS_U * u * state.highlight}
          fill={theme.role.result}
        />
      ) : null}
      {equilibrium.previousOpacity > 0 ? (
        <circle
          data-ghost=""
          cx={previous[0]}
          cy={previous[1]}
          r={MARKER_RADIUS_U * u}
          fill="none"
          stroke={theme.ink}
          strokeWidth={strokeWidth(ctx, "construction")}
          opacity={equilibrium.previousOpacity * labelOpacity(state)}
        />
      ) : null}
      {guides.map(({ guide, key }) => {
        const end = partial(guide, progress);
        return (
          <line
            key={key}
            data-guide={key}
            x1={guide.from[0]}
            y1={guide.from[1]}
            x2={end[0]}
            y2={end[1]}
            stroke={theme.inkSoft}
            strokeWidth={strokeWidth(ctx, "regular")}
            strokeDasharray={dash}
            opacity={state.opacity}
          />
        );
      })}
      <g stroke={theme.ink} strokeWidth={strokeWidth(ctx, "regular")} opacity={labelOpacity(state)}>
        <line x1={axisX - tick} y1={point[1]} x2={axisX + tick} y2={point[1]} />
        <line x1={point[0]} y1={axisY - tick} x2={point[0]} y2={axisY + tick} />
      </g>
      <circle
        cx={point[0]}
        cy={point[1]}
        r={MARKER_RADIUS_U * u}
        fill={theme.role.result}
        stroke={theme.ink}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={marker}
      />
      <Name ctx={ctx} state={state} at={equilibrium.priceLabel} />
      <Name ctx={ctx} state={state} at={equilibrium.quantityLabel} />
    </g>
  );
}

export function MarketSim({ element, ctx }: PrimitiveProps<"sim.market">) {
  const shift = (value: Bindable): number =>
    shiftOf(resolve(value, ctx.scope), resolve(value, ctx.refScope));
  const french = ctx.language === "fr";
  const geometry = marketLayout(ctx.size, ctx.u, {
    demandShift: shift(element.demandShift),
    supplyShift: shift(element.supplyShift),
    priceLabel: element.priceLabel ?? "P",
    quantityLabel: element.quantityLabel ?? "Q",
    demandLabel: "D",
    supplyLabel: french ? "O" : "S",
  });
  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const price = part("price");
  const quantity = part("quantity");
  const demand = part("demand");
  const supply = part("supply");
  const equilibrium = part("equilibrium");
  const [axisX, axisY] = geometry.origin;

  return (
    <g>
      {price.visible ? (
        <Axis ctx={ctx} state={price} axis={geometry.priceAxis} part="price" />
      ) : null}
      {quantity.visible ? (
        <Axis ctx={ctx} state={quantity} axis={geometry.quantityAxis} part="quantity" />
      ) : null}
      {demand.visible ? (
        <Curve
          ctx={ctx}
          state={demand}
          curve={geometry.demand}
          colour="quantity"
          labelColour="quantity"
          part="demand"
        />
      ) : null}
      {supply.visible ? (
        <Curve
          ctx={ctx}
          state={supply}
          curve={geometry.supply}
          colour="action"
          labelColour="actionText"
          part="supply"
        />
      ) : null}
      {equilibrium.visible ? (
        <Equilibrium
          ctx={ctx}
          state={equilibrium}
          equilibrium={geometry.equilibrium}
          axisX={axisX}
          axisY={axisY}
        />
      ) : null}
    </g>
  );
}
