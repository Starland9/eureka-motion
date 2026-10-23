import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { isBound, resolve, type Bindable } from "../../expr";
import { colourOf, drawStyle, FigureLabel, strokeWidth, SvgHighlight } from "../shared";
import { ratioOf } from "./two-body-layout";
import { waveCurve, waveLayout, type WaveGeometry } from "./wave-layout";

const DASH_U = { on: 0.8, off: 0.6 } as const;
const WAVELENGTH_SYMBOL = "λ";
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
  geometry: WaveGeometry;
}

function Ticks({
  ctx,
  state,
  at,
  tick,
}: {
  ctx: SceneContext;
  state: ElementState;
  at: readonly (readonly [number, number])[];
  tick: number;
}) {
  return (
    <>
      {at.map(([x, y]) => (
        <line
          key={`${x}:${y}`}
          x1={x - tick}
          y1={y + tick}
          x2={x + tick}
          y2={y - tick}
          stroke={overBand(ctx, state, colourOf(ctx, "quantity"))}
          strokeWidth={strokeWidth(ctx, "regular")}
          opacity={state.opacity}
          {...drawStyle(state, 2 * Math.SQRT2 * tick)}
        />
      ))}
    </>
  );
}

function Amplitude({ ctx, state, geometry, text }: PartProps & { text: string }) {
  const { gauge, axisY, amplitude, right } = geometry;
  const shown = fadedIn(state);
  const quantity = colourOf(ctx, "quantity");
  const dash = `${DASH_U.on * ctx.u} ${DASH_U.off * ctx.u}`;
  return (
    <g data-part="amplitude">
      <line
        data-mark="baseline"
        x1={gauge.levelFrom}
        y1={axisY}
        x2={right}
        y2={axisY}
        stroke={ctx.theme.ink}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, right - gauge.levelFrom)}
      />
      {[axisY - amplitude, axisY + amplitude].map((y) => (
        <line
          key={y}
          data-mark="level"
          x1={gauge.levelFrom}
          y1={y}
          x2={right}
          y2={y}
          stroke={ctx.theme.rule}
          strokeWidth={strokeWidth(ctx, "construction")}
          strokeDasharray={dash}
          opacity={shown.opacity}
        />
      ))}
      <line
        data-mark="gauge"
        x1={gauge.x}
        y1={gauge.top}
        x2={gauge.x}
        y2={gauge.bottom}
        stroke={overBand(ctx, state, quantity)}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, amplitude)}
      />
      <Ticks
        ctx={ctx}
        state={state}
        at={[
          [gauge.x, gauge.top],
          [gauge.x, gauge.bottom],
        ]}
        tick={gauge.tick}
      />
      <FigureLabel
        ctx={ctx}
        state={state}
        x={gauge.label[0]}
        y={gauge.label[1]}
        text={text}
        colour="quantity"
        anchor="end"
        italic
      />
    </g>
  );
}

function Wavelength({ ctx, state, geometry }: PartProps) {
  const { ruler } = geometry;
  return (
    <g data-part="wavelength">
      <line
        data-mark="ruler"
        x1={ruler.left}
        y1={ruler.y}
        x2={ruler.right}
        y2={ruler.y}
        stroke={overBand(ctx, state, colourOf(ctx, "quantity"))}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, ruler.right - ruler.left)}
      />
      <Ticks
        ctx={ctx}
        state={state}
        at={[
          [ruler.left, ruler.y],
          [ruler.right, ruler.y],
        ]}
        tick={ruler.tick}
      />
      <FigureLabel
        ctx={ctx}
        state={state}
        x={ruler.label[0]}
        y={ruler.label[1]}
        text={WAVELENGTH_SYMBOL}
        colour="quantity"
        italic
      />
    </g>
  );
}

function Curve({
  ctx,
  state,
  points,
}: Omit<PartProps, "geometry"> & { points: readonly (readonly [number, number])[] }) {
  const length = points.reduce(
    (sum, [x, y], k) =>
      k === 0 ? 0 : sum + Math.hypot(x - points[k - 1]![0], y - points[k - 1]![1]),
    0,
  );
  return (
    <polyline
      data-part="wave"
      points={points.map(([x, y]) => `${x},${y}`).join(" ")}
      fill="none"
      stroke={overBand(ctx, state, colourOf(ctx, "quantity"))}
      strokeWidth={strokeWidth(ctx, "accent")}
      strokeLinejoin="round"
      opacity={state.opacity}
      {...drawStyle(state, length)}
    />
  );
}

export function WaveSim({ element, ctx }: PrimitiveProps<"sim.wave">) {
  const ratio = (value: Bindable): number =>
    ratioOf(resolve(value, ctx.scope), resolve(value, ctx.refScope));
  const amplitudeText = symbolOf(ctx, element.amplitude, "A");
  const geometry = waveLayout(ctx.size, ctx.u, {
    amplitudeRatio: ratio(element.amplitude),
    frequencyRatio: ratio(element.frequency),
    speedRatio: element.speed === undefined ? 1 : ratio(element.speed),
  });
  const seconds = ctx.reducedMotion ? 0 : ctx.state.simTime(element.id);
  const points = waveCurve(geometry, geometry.rate * seconds);

  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const wave = part("wave");
  const wavelength = part("wavelength");
  const amplitude = part("amplitude");
  const bands: [string, ElementState, WaveGeometry["curveBand"]][] = [
    ["wave", wave, geometry.curveBand],
    ["wavelength", wavelength, geometry.ruler.band],
    ["amplitude", amplitude, geometry.gauge.band],
  ];

  return (
    <g>
      {bands.map(([name, state, rect]) =>
        state.visible && state.highlight > 0 ? (
          <g key={name} data-band={name} opacity={state.opacity}>
            <SvgHighlight ctx={ctx} state={state} {...rect} />
          </g>
        ) : null,
      )}
      {amplitude.visible ? (
        <Amplitude ctx={ctx} state={amplitude} geometry={geometry} text={amplitudeText} />
      ) : null}
      {wavelength.visible ? <Wavelength ctx={ctx} state={wavelength} geometry={geometry} /> : null}
      {wave.visible ? <Curve ctx={ctx} state={wave} points={points} /> : null}
    </g>
  );
}
