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
  carrierPoints,
  circuitLayout,
  isCovered,
  type ArrowGeometry,
  type ComponentGeometry,
  type LoopGeometry,
  type Rect,
} from "./circuit-layout";
import { ratioOf } from "./two-body-layout";

const CARRIER_RADIUS_U = 0.6;
// The shaft stops inside the head so its square end does not poke out of the tip.
const SHAFT_INTO_HEAD = 0.8;
const HEAD_APPEARS_AT = 0.9;

function fadedIn(state: ElementState): ElementState {
  if (state.how === "fade") return state;
  return { ...state, how: "fade", opacity: state.opacity * state.progress };
}

function symbolOf(ctx: SceneContext, value: Bindable, fallback: string): string {
  const symbol = isBound(value) ? ctx.valueInfo(value.expr.trim())?.symbol : undefined;
  return symbol ?? fallback;
}

interface DeviceProps {
  ctx: SceneContext;
  state: ElementState;
  geometry: ComponentGeometry;
  kind: "battery" | "resistor";
  text: string;
  part: string;
  anchor: "start" | "middle";
}

function Device({ ctx, state, geometry, kind, text, part, anchor }: DeviceProps) {
  const shown = fadedIn(state);
  return (
    <g data-part={part}>
      <Pictogram
        ctx={ctx}
        kind={kind}
        x={geometry.x}
        y={geometry.y}
        size={geometry.size}
        colour={colourOf(ctx, "quantity")}
        opacity={shown.opacity}
      />
      <FigureLabel
        ctx={ctx}
        state={shown}
        x={geometry.label[0]}
        y={geometry.label[1]}
        text={text}
        colour="quantity"
        anchor={anchor}
        italic
      />
    </g>
  );
}

function Wire({
  ctx,
  state,
  loop,
}: {
  ctx: SceneContext;
  state: ElementState;
  loop: LoopGeometry;
}) {
  return (
    <rect
      data-part="wire"
      x={loop.x0}
      y={loop.y0}
      width={loop.width}
      height={loop.height}
      fill="none"
      stroke={ctx.theme.ink}
      strokeWidth={strokeWidth(ctx, "regular")}
      opacity={state.opacity}
      {...drawStyle(state, loop.length)}
    />
  );
}

interface CurrentArrowProps {
  ctx: SceneContext;
  state: ElementState;
  arrow: ArrowGeometry;
  text: string;
}

function CurrentArrow({ ctx, state, arrow, text }: CurrentArrowProps) {
  const colour = colourOf(ctx, "action");
  const fullHead = ARROW_HEAD_U * ctx.u;
  const head = Math.min(fullHead, arrow.length);
  const shaftEnd = arrow.tip[0] - head * SHAFT_INTO_HEAD;
  const shaft = shaftEnd - arrow.from[0];
  const headAppear =
    state.how === "draw"
      ? Math.min(1, Math.max(0, (state.progress - HEAD_APPEARS_AT) / (1 - HEAD_APPEARS_AT)))
      : 1;
  return (
    <>
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
    </>
  );
}

export function CircuitSim({ element, ctx }: PrimitiveProps<"sim.circuit">) {
  const ratio = ratioOf(
    resolve(element.current, ctx.scope),
    resolve(element.current, ctx.refScope),
  );
  const geometry = circuitLayout(ctx.size, ctx.u, ratio);
  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const source = part("source");
  const resistor = part("resistor");
  const wire = part("wire");
  const carriers = part("carriers");
  const seconds = ctx.reducedMotion ? 0 : ctx.frame / ctx.fps;
  const bands: [string, ElementState, Rect[]][] = [
    ["source", source, [geometry.battery.band]],
    ["resistor", resistor, [geometry.resistor.band]],
    ["wire", wire, geometry.wireBands],
    ["carriers", carriers, [geometry.arrow.band]],
  ];
  const shownCarriers = fadedIn(carriers);
  const radius = CARRIER_RADIUS_U * ctx.u;
  const covers = [
    ...(resistor.visible ? [geometry.resistor.body] : []),
    ...(source.visible ? [geometry.battery.body] : []),
  ];

  return (
    <g>
      {bands.map(([name, state, rects]) =>
        state.visible && state.highlight > 0 ? (
          <g key={name} data-band={name} opacity={state.opacity}>
            {rects.map((rect) => (
              <SvgHighlight key={`${rect.x}:${rect.y}`} ctx={ctx} state={state} {...rect} />
            ))}
          </g>
        ) : null,
      )}
      {wire.visible ? <Wire ctx={ctx} state={wire} loop={geometry.loop} /> : null}
      {resistor.visible ? (
        <Device
          ctx={ctx}
          state={resistor}
          geometry={geometry.resistor}
          kind="resistor"
          text={symbolOf(ctx, element.resistance, "R")}
          part="resistor"
          anchor="middle"
        />
      ) : null}
      {source.visible ? (
        <Device
          ctx={ctx}
          state={source}
          geometry={geometry.battery}
          kind="battery"
          text={symbolOf(ctx, element.voltage, "U")}
          part="source"
          anchor="start"
        />
      ) : null}
      {carriers.visible ? (
        <g data-part="carriers">
          {carrierPoints(geometry, seconds).map(([x, y], k) =>
            isCovered(covers, [x, y], radius) ? null : (
              <circle
                key={k}
                cx={x}
                cy={y}
                r={radius}
                fill={colourOf(ctx, "action")}
                opacity={shownCarriers.opacity}
              />
            ),
          )}
          <CurrentArrow
            ctx={ctx}
            state={carriers}
            arrow={geometry.arrow}
            text={symbolOf(ctx, element.current, "I")}
          />
        </g>
      ) : null}
    </g>
  );
}
