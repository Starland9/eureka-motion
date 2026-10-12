import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { resolve, type Bindable } from "../../expr";
import { Pictogram, type PictogramKind } from "../../pictograms";
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
  ratioOf,
  twoBodyLayout,
  type ArrowGeometry,
  type BodyGeometry,
  type DimensionGeometry,
} from "./two-body-layout";

// The shaft stops inside the head so its square end does not poke out of the tip.
const SHAFT_INTO_HEAD = 0.8;
const HEAD_APPEARS_AT = 0.9;
const BAND_HALF_HEIGHT_U = 1;
const BAND_PAD_U = 0.5;

function fadedBody(state: ElementState): ElementState {
  if (state.how === "fade") return state;
  return { ...state, how: "fade", opacity: state.opacity * state.progress };
}

interface BodyProps {
  ctx: SceneContext;
  state: ElementState;
  body: BodyGeometry;
  kind: PictogramKind;
  name: string | undefined;
  part: string;
}

function Body({ ctx, state, body, kind, name, part }: BodyProps) {
  const shown = fadedBody(state);
  return (
    <g data-part={part}>
      <Pictogram
        ctx={ctx}
        kind={kind}
        x={body.x}
        y={body.y}
        size={2 * body.radius}
        opacity={shown.opacity}
      />
      {name ? (
        <FigureLabel ctx={ctx} state={shown} x={body.name[0]} y={body.name[1]} text={name} />
      ) : null}
    </g>
  );
}

interface ForceArrowProps {
  ctx: SceneContext;
  state: ElementState;
  arrow: ArrowGeometry;
  text: string;
  part: string;
}

function ForceArrow({ ctx, state, arrow, text, part }: ForceArrowProps) {
  const colour = colourOf(ctx, "action");
  const fullHead = ARROW_HEAD_U * ctx.u;
  const head = Math.min(fullHead, arrow.length);
  const shaftEnd = arrow.tip[0] - arrow.direction * head * SHAFT_INTO_HEAD;
  const shaft = Math.abs(shaftEnd - arrow.from[0]);
  const headAppear =
    state.how === "draw"
      ? Math.min(1, Math.max(0, (state.progress - HEAD_APPEARS_AT) / (1 - HEAD_APPEARS_AT)))
      : 1;
  const pad = BAND_PAD_U * ctx.u;
  const half = BAND_HALF_HEIGHT_U * ctx.u;
  return (
    <g data-part={part}>
      <SvgHighlight
        ctx={ctx}
        state={state}
        x={Math.min(arrow.from[0], arrow.tip[0]) - pad}
        y={arrow.from[1] - half}
        width={arrow.length + 2 * pad}
        height={2 * half}
      />
      {shaft > 0 ? (
        <line
          x1={arrow.from[0]}
          y1={arrow.from[1]}
          x2={shaftEnd}
          y2={arrow.from[1]}
          stroke={colour}
          strokeWidth={strokeWidth(ctx, "accent")}
          opacity={state.opacity}
          {...drawStyle(state, shaft)}
        />
      ) : null}
      <ArrowHead
        ctx={{ ...ctx, u: (ctx.u * head) / fullHead }}
        tip={arrow.tip}
        from={arrow.from}
        colour={colour}
        opacity={state.opacity * headAppear}
      />
      <FigureLabel
        ctx={ctx}
        state={state}
        x={arrow.label[0]}
        y={arrow.label[1]}
        text={text}
        colour="actionText"
        italic
      />
    </g>
  );
}

interface DimensionLineProps {
  ctx: SceneContext;
  state: ElementState;
  dimension: DimensionGeometry;
  text: string;
}

function DimensionLine({ ctx, state, dimension, text }: DimensionLineProps) {
  const { y, left, right, centreY, extensionEnd, tick } = dimension;
  const colour = colourOf(ctx, "quantity");
  const pad = BAND_PAD_U * ctx.u;
  const half = BAND_HALF_HEIGHT_U * ctx.u;
  const common = { stroke: colour, opacity: state.opacity };
  return (
    <g data-part="distance">
      <SvgHighlight
        ctx={ctx}
        state={state}
        x={left - pad}
        y={y - half}
        width={right - left + 2 * pad}
        height={2 * half}
      />
      {[left, right].map((x) => (
        <line
          key={x}
          x1={x}
          y1={centreY}
          x2={x}
          y2={extensionEnd}
          strokeWidth={strokeWidth(ctx, "construction")}
          {...common}
          {...drawStyle(state, extensionEnd - centreY)}
        />
      ))}
      <line
        x1={left}
        y1={y}
        x2={right}
        y2={y}
        strokeWidth={strokeWidth(ctx, "regular")}
        {...common}
        {...drawStyle(state, right - left)}
      />
      {[left, right].map((x) => (
        <line
          key={x}
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
        italic
      />
    </g>
  );
}

export function TwoBodySim({ element, ctx }: PrimitiveProps<"sim.two-body">) {
  const ratio = (value: Bindable): number =>
    ratioOf(resolve(value, ctx.scope), resolve(value, ctx.refScope));
  const geometry = twoBodyLayout(ctx.size, ctx.u, {
    massA: ratio(element.massA),
    massB: ratio(element.massB),
    distance: ratio(element.distance),
    force: ratio(element.force),
  });
  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const bodyA = part("body_a");
  const bodyB = part("body_b");
  const forceA = part("force_a");
  const forceB = part("force_b");
  const distance = part("distance");
  const forceLabel = element.forceLabel ?? "F";

  return (
    <g>
      {distance.visible ? (
        <DimensionLine
          ctx={ctx}
          state={distance}
          dimension={geometry.dimension}
          text={element.distanceLabel ?? "r"}
        />
      ) : null}
      {forceA.visible ? (
        <ForceArrow
          ctx={ctx}
          state={forceA}
          arrow={geometry.arrowA}
          text={forceLabel}
          part="force_a"
        />
      ) : null}
      {forceB.visible ? (
        <ForceArrow
          ctx={ctx}
          state={forceB}
          arrow={geometry.arrowB}
          text={forceLabel}
          part="force_b"
        />
      ) : null}
      {bodyA.visible ? (
        <Body
          ctx={ctx}
          state={bodyA}
          body={geometry.a}
          kind={element.objectA ?? "planet"}
          name={element.labelA}
          part="body_a"
        />
      ) : null}
      {bodyB.visible ? (
        <Body
          ctx={ctx}
          state={bodyB}
          body={geometry.b}
          kind={element.objectB ?? "moon"}
          name={element.labelB}
          part="body_b"
        />
      ) : null}
    </g>
  );
}
