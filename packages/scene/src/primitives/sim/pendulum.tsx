import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { isBound, resolve, type Bindable } from "../../expr";
import { Pictogram } from "../../pictograms";
import { colourOf, drawStyle, FigureLabel, strokeWidth, SvgHighlight } from "../shared";
import {
  amplitudeRadians,
  bobAt,
  DEFAULT_GRAVITY,
  pendulumAngle,
  pendulumLayout,
  pendulumPeriod,
  sectorPath,
  type PendulumGeometry,
} from "./pendulum-layout";
import { ratioOf } from "./two-body-layout";

const DASH_U = { on: 0.8, off: 0.6 } as const;
// On the blackboard the result band is light, so strokes drawn over it turn dark.
const BAND_CONTRAST_AT = 0.5;

function fadedIn(state: ElementState): ElementState {
  if (state.how === "fade") return state;
  return { ...state, how: "fade", opacity: state.opacity * state.progress };
}

function overBand(ctx: SceneContext, state: ElementState, colour: string): string {
  return ctx.theme.name === "board" && state.highlight >= BAND_CONTRAST_AT
    ? ctx.theme.surface
    : colour;
}

function symbolOf(ctx: SceneContext, value: Bindable, fallback: string): string {
  const symbol = isBound(value) ? ctx.valueInfo(value.expr.trim())?.symbol : undefined;
  return symbol ?? fallback;
}

interface PartProps {
  ctx: SceneContext;
  state: ElementState;
  geometry: PendulumGeometry;
}

function Pivot({ ctx, state, geometry }: PartProps) {
  const { ceiling, pivot } = geometry;
  const shown = fadedIn(state);
  const ink = overBand(ctx, state, ctx.theme.ink);
  return (
    <g data-part="pivot">
      <line
        data-mark="ceiling"
        x1={ceiling.x0}
        y1={ceiling.y}
        x2={ceiling.x1}
        y2={ceiling.y}
        stroke={ink}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, ceiling.x1 - ceiling.x0)}
      />
      <path
        data-mark="hatch"
        d={ceiling.hatch}
        fill="none"
        stroke={ink}
        strokeWidth={strokeWidth(ctx, "construction")}
        opacity={state.opacity}
        {...drawStyle(state, ceiling.hatchLength)}
      />
      <circle
        data-mark="dot"
        cx={pivot[0]}
        cy={pivot[1]}
        r={ceiling.dot}
        fill={ink}
        opacity={shown.opacity}
      />
    </g>
  );
}

interface ArcProps extends PartProps {
  text: string;
}

function Arc({ ctx, state, geometry, text }: ArcProps) {
  const { sector, arc, pivot, axisEnd } = geometry;
  const shown = fadedIn(state);
  const quantity = colourOf(ctx, "quantity");
  return (
    <g data-part="arc">
      <path
        data-mark="sector"
        d={sector.d}
        fill="none"
        stroke={ctx.theme.rule}
        strokeWidth={strokeWidth(ctx, "construction")}
        opacity={state.opacity}
        {...drawStyle(state, sector.length)}
      />
      <line
        data-mark="axis"
        x1={pivot[0]}
        y1={pivot[1]}
        x2={axisEnd[0]}
        y2={axisEnd[1]}
        stroke={ctx.theme.rule}
        strokeWidth={strokeWidth(ctx, "construction")}
        strokeDasharray={`${DASH_U.on * ctx.u} ${DASH_U.off * ctx.u}`}
        opacity={shown.opacity}
      />
      <path
        data-mark="angle"
        d={arc.d}
        fill="none"
        stroke={quantity}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, arc.length)}
      />
      <FigureLabel
        ctx={ctx}
        state={state}
        x={geometry.angleLabel[0]}
        y={geometry.angleLabel[1]}
        text={text}
        colour="quantity"
        italic
      />
    </g>
  );
}

interface RodProps extends PartProps {
  bob: readonly [number, number];
  text: string;
}

function Rod({ ctx, state, geometry, bob, text }: RodProps) {
  const { pivot, cote, length } = geometry;
  const quantity = colourOf(ctx, "quantity");
  const common = { stroke: quantity, opacity: state.opacity };
  const span = cote.bottom - cote.top;
  return (
    <g data-part="rod">
      <line
        data-mark="shaft"
        x1={pivot[0]}
        y1={pivot[1]}
        x2={bob[0]}
        y2={bob[1]}
        stroke={overBand(ctx, state, ctx.theme.ink)}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, length)}
      />
      <g data-mark="length">
        {cote.extensions.map(([from, to]) => (
          <line
            key={from[1]}
            x1={from[0]}
            y1={from[1]}
            x2={to[0]}
            y2={to[1]}
            strokeWidth={strokeWidth(ctx, "construction")}
            {...common}
            {...drawStyle(state, Math.abs(to[0] - from[0]))}
          />
        ))}
        <line
          x1={cote.x}
          y1={cote.top}
          x2={cote.x}
          y2={cote.bottom}
          strokeWidth={strokeWidth(ctx, "regular")}
          {...common}
          {...drawStyle(state, span)}
        />
        {[cote.top, cote.bottom].map((y) => (
          <line
            key={y}
            x1={cote.x - cote.tick}
            y1={y + cote.tick}
            x2={cote.x + cote.tick}
            y2={y - cote.tick}
            strokeWidth={strokeWidth(ctx, "regular")}
            {...common}
            {...drawStyle(state, 2 * Math.SQRT2 * cote.tick)}
          />
        ))}
        <FigureLabel
          ctx={ctx}
          state={state}
          x={cote.label[0]}
          y={cote.label[1]}
          text={text}
          colour="quantity"
          anchor={cote.anchor}
          italic
        />
      </g>
    </g>
  );
}

interface Bands {
  pivot: ElementState;
  arc: ElementState;
  rod: ElementState;
  bob: ElementState;
}

function HighlightBands({
  ctx,
  geometry,
  bob,
  states,
}: {
  ctx: SceneContext;
  geometry: PendulumGeometry;
  bob: readonly [number, number];
  states: Bands;
}) {
  const fill = ctx.theme.role.result;
  const { pivot, length, angle, bandPad } = geometry;
  const dx = (bob[0] - pivot[0]) / length;
  const dy = (bob[1] - pivot[1]) / length;
  const along = states.rod.highlight * length;
  const corner = (distance: number, side: number): string =>
    `${pivot[0] + dx * distance - dy * side * bandPad},${pivot[1] + dy * distance + dx * side * bandPad}`;
  return (
    <>
      {states.pivot.visible && states.pivot.highlight > 0 ? (
        <g data-band="pivot" opacity={states.pivot.opacity}>
          <SvgHighlight ctx={ctx} state={states.pivot} {...geometry.pivotBand} />
        </g>
      ) : null}
      {states.arc.visible && states.arc.highlight > 0 ? (
        <path
          data-band="arc"
          d={sectorPath(pivot, (length + geometry.radius + bandPad) * states.arc.highlight, angle)}
          fill={fill}
          opacity={states.arc.opacity}
        />
      ) : null}
      {states.rod.visible && states.rod.highlight > 0 ? (
        <polygon
          data-band="rod"
          points={[corner(0, 1), corner(along, 1), corner(along, -1), corner(0, -1)].join(" ")}
          fill={fill}
          opacity={states.rod.opacity}
        />
      ) : null}
      {states.bob.visible && states.bob.highlight > 0 ? (
        <circle
          data-band="bob"
          cx={bob[0]}
          cy={bob[1]}
          r={(geometry.radius + bandPad) * states.bob.highlight}
          fill={fill}
          opacity={states.bob.opacity}
        />
      ) : null}
    </>
  );
}

export function PendulumSim({ element, ctx }: PrimitiveProps<"sim.pendulum">) {
  const length = resolve(element.length, ctx.scope);
  const gravity =
    element.gravity === undefined ? DEFAULT_GRAVITY : resolve(element.gravity, ctx.scope);
  const lengthText = symbolOf(ctx, element.length, "L");
  const angleText = symbolOf(ctx, element.amplitude, "θ");
  const geometry = pendulumLayout(ctx.size, ctx.u, {
    lengthRatio: ratioOf(length, resolve(element.length, ctx.refScope)),
    angle: amplitudeRadians(resolve(element.amplitude, ctx.scope)),
    lengthLabel: lengthText,
    angleLabel: angleText,
  });
  const seconds = ctx.reducedMotion ? 0 : ctx.state.simTime(element.id);
  const swing = pendulumAngle(geometry.angle, pendulumPeriod(length, gravity), seconds);
  const bob = bobAt(geometry, swing);

  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const states: Bands = {
    pivot: part("pivot"),
    arc: part("arc"),
    rod: part("rod"),
    bob: part("bob"),
  };

  return (
    <g>
      <HighlightBands ctx={ctx} geometry={geometry} bob={bob} states={states} />
      {states.pivot.visible ? <Pivot ctx={ctx} state={states.pivot} geometry={geometry} /> : null}
      {states.arc.visible ? (
        <Arc ctx={ctx} state={states.arc} geometry={geometry} text={angleText} />
      ) : null}
      {states.rod.visible ? (
        <Rod ctx={ctx} state={states.rod} geometry={geometry} bob={bob} text={lengthText} />
      ) : null}
      {states.bob.visible ? (
        <g data-part="bob">
          <Pictogram
            ctx={ctx}
            kind="ball"
            x={bob[0]}
            y={bob[1]}
            size={geometry.ballSize}
            opacity={fadedIn(states.bob).opacity}
          />
        </g>
      ) : null}
    </g>
  );
}
