import type { ReactNode } from "react";
import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { isBound, resolve, type Bindable } from "../../expr";
import { Pictogram } from "../../pictograms";
import {
  ARROW_HEAD_U,
  ArrowHead,
  colourOf,
  drawStyle,
  FigureLabel,
  strokeWidth,
  SvgHighlight,
} from "../shared";
import {
  bodyY,
  fallLayout,
  fallMotion,
  impactSpeed,
  MIN_ARROW_U,
  velocityArrow,
  type DimensionGeometry,
} from "./fall-layout";
import { ratioOf } from "./two-body-layout";

type Vec = readonly [number, number];

// The shaft stops inside the head so its square end does not poke out of the tip.
const SHAFT_INTO_HEAD = 0.8;
const HEAD_APPEARS_AT = 0.9;
const BAND_HALF_U = 1;
const BAND_PAD_U = 0.5;

export interface ArrowShape {
  from: Vec;
  tip: Vec;
  length: number;
}

export function fadedIn(state: ElementState): ElementState {
  if (state.how === "fade") return state;
  return { ...state, how: "fade", opacity: state.opacity * state.progress };
}

export function symbolOf(ctx: SceneContext, value: Bindable, fallback: string): string {
  const symbol = isBound(value) ? ctx.valueInfo(value.expr.trim())?.symbol : undefined;
  return symbol ?? fallback;
}

export function Band({
  name,
  state,
  children,
}: {
  name: string;
  state: ElementState;
  children: ReactNode;
}) {
  if (!state.visible || state.highlight <= 0) return null;
  return (
    <g data-band={name} opacity={state.opacity}>
      {children}
    </g>
  );
}

export function ArrowBand({
  ctx,
  state,
  arrow,
}: {
  ctx: SceneContext;
  state: ElementState;
  arrow: ArrowShape;
}) {
  const angle =
    (Math.atan2(arrow.tip[1] - arrow.from[1], arrow.tip[0] - arrow.from[0]) * 180) / Math.PI;
  const pad = BAND_PAD_U * ctx.u;
  const half = BAND_HALF_U * ctx.u;
  return (
    <g transform={`translate(${arrow.from[0]} ${arrow.from[1]}) rotate(${angle})`}>
      <SvgHighlight
        ctx={ctx}
        state={state}
        x={-pad}
        y={-half}
        width={arrow.length + 2 * pad}
        height={2 * half}
      />
    </g>
  );
}

interface VectorArrowProps {
  ctx: SceneContext;
  state: ElementState;
  arrow: ArrowShape;
  label: Vec;
  anchor: "start" | "middle";
  text: string;
  part: string;
}

export function VectorArrow({ ctx, state, arrow, label, anchor, text, part }: VectorArrowProps) {
  const colour = colourOf(ctx, "action");
  const { from, tip, length } = arrow;
  const fullHead = ARROW_HEAD_U * ctx.u;
  const head = Math.min(fullHead, length);
  const unitX = (tip[0] - from[0]) / length;
  const unitY = (tip[1] - from[1]) / length;
  const shaftEnd: Vec = [
    tip[0] - unitX * head * SHAFT_INTO_HEAD,
    tip[1] - unitY * head * SHAFT_INTO_HEAD,
  ];
  const shaft = length - head * SHAFT_INTO_HEAD;
  const headAppear =
    state.how === "draw"
      ? Math.min(1, Math.max(0, (state.progress - HEAD_APPEARS_AT) / (1 - HEAD_APPEARS_AT)))
      : 1;
  return (
    <g data-part={part}>
      {shaft > 0 ? (
        <line
          x1={from[0]}
          y1={from[1]}
          x2={shaftEnd[0]}
          y2={shaftEnd[1]}
          stroke={colour}
          strokeWidth={strokeWidth(ctx, "accent")}
          opacity={state.opacity}
          {...drawStyle(state, shaft)}
        />
      ) : null}
      <ArrowHead
        ctx={{ ...ctx, u: (ctx.u * head) / fullHead }}
        tip={tip}
        from={from}
        colour={colour}
        opacity={state.opacity * headAppear}
      />
      <FigureLabel
        ctx={ctx}
        state={state}
        x={label[0]}
        y={label[1]}
        text={text}
        colour="actionText"
        anchor={anchor}
        italic
      />
    </g>
  );
}

interface HeightLineProps {
  ctx: SceneContext;
  state: ElementState;
  dimension: DimensionGeometry;
  text: string;
}

function HeightLine({ ctx, state, dimension, text }: HeightLineProps) {
  const { x, top, bottom, reachFrom, reachTo, tick } = dimension;
  const common = { stroke: colourOf(ctx, "quantity"), opacity: state.opacity };
  return (
    <g data-part="height">
      <line
        x1={reachFrom}
        y1={top}
        x2={reachTo}
        y2={top}
        strokeWidth={strokeWidth(ctx, "construction")}
        {...common}
        {...drawStyle(state, reachTo - reachFrom)}
      />
      <line
        x1={x}
        y1={top}
        x2={x}
        y2={bottom}
        strokeWidth={strokeWidth(ctx, "regular")}
        {...common}
        {...drawStyle(state, bottom - top)}
      />
      {[top, bottom].map((y) => (
        <line
          key={y}
          x1={x - tick}
          y1={y + tick}
          x2={x + tick}
          y2={y - tick}
          strokeWidth={strokeWidth(ctx, "regular")}
          {...common}
          {...drawStyle(state, 2 * Math.SQRT2 * tick)}
        />
      ))}
      <FigureLabel
        ctx={ctx}
        state={state}
        x={dimension.label[0]}
        y={dimension.label[1]}
        text={text}
        colour="quantity"
        anchor="end"
        italic
      />
    </g>
  );
}

export function FallSim({ element, ctx }: PrimitiveProps<"sim.fall">) {
  const height = resolve(element.height, ctx.scope);
  const gravity = resolve(element.gravity, ctx.scope);
  const referenceHeight = resolve(element.height, ctx.refScope);
  const referenceGravity = resolve(element.gravity, ctx.refScope);
  const withVelocity = element.showVelocity !== false;

  const geometry = fallLayout(ctx.size, ctx.u, ratioOf(height, referenceHeight), withVelocity);
  const motion = fallMotion(height, gravity, ctx.state.simTime(element.id));
  const y = bodyY(geometry, motion.fraction);
  const speedRatio =
    motion.speed > 0 ? ratioOf(motion.speed, impactSpeed(referenceHeight, referenceGravity)) : 0;
  const velocity = velocityArrow(geometry, ctx.u, y, speedRatio);

  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const body = part("body");
  const speed = part("velocity");
  const heightState = part("height");
  const ground = part("ground");
  const showArrow = withVelocity && speed.visible && velocity.length > MIN_ARROW_U * ctx.u;
  const shownBody = fadedIn(body);
  const pad = BAND_PAD_U * ctx.u;
  const half = BAND_HALF_U * ctx.u;
  const { dimension } = geometry;
  const reach = geometry.radius + pad;

  return (
    <g>
      <Band name="ground" state={ground}>
        <SvgHighlight
          ctx={ctx}
          state={ground}
          x={geometry.ground.left}
          y={geometry.ground.y - half}
          width={geometry.ground.right - geometry.ground.left}
          height={2 * half}
        />
      </Band>
      <Band name="height" state={heightState}>
        <SvgHighlight
          ctx={ctx}
          state={heightState}
          x={dimension.x - half}
          y={dimension.top - pad}
          width={2 * half}
          height={dimension.bottom - dimension.top + 2 * pad}
        />
      </Band>
      {showArrow ? (
        <Band name="velocity" state={speed}>
          <ArrowBand ctx={ctx} state={speed} arrow={velocity} />
        </Band>
      ) : null}
      <Band name="body" state={body}>
        <SvgHighlight
          ctx={ctx}
          state={body}
          x={geometry.bodyX - reach}
          y={y - reach}
          width={2 * reach}
          height={2 * reach}
        />
      </Band>
      {ground.visible ? (
        <line
          data-part="ground"
          x1={geometry.ground.left}
          y1={geometry.ground.y}
          x2={geometry.ground.right}
          y2={geometry.ground.y}
          stroke={ctx.theme.ink}
          strokeWidth={strokeWidth(ctx, "regular")}
          opacity={ground.opacity}
          {...drawStyle(ground, geometry.ground.right - geometry.ground.left)}
        />
      ) : null}
      {heightState.visible ? (
        <HeightLine
          ctx={ctx}
          state={heightState}
          dimension={dimension}
          text={symbolOf(ctx, element.height, "h")}
        />
      ) : null}
      {showArrow ? (
        <VectorArrow
          ctx={ctx}
          state={speed}
          arrow={velocity}
          label={velocity.label}
          anchor="start"
          text="v"
          part="velocity"
        />
      ) : null}
      {body.visible ? (
        <g data-part="body">
          <Pictogram
            ctx={ctx}
            kind={element.object ?? "apple"}
            x={geometry.bodyX}
            y={y}
            size={2 * geometry.radius}
            opacity={shownBody.opacity}
          />
        </g>
      ) : null}
    </g>
  );
}
