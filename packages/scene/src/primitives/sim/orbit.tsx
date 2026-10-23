import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { resolve } from "../../expr";
import { Pictogram, type PictogramKind } from "../../pictograms";
import { colourOf, drawStyle, FigureLabel, strokeWidth, SvgHighlight, textSize } from "../shared";
import { ArrowBand, Band, fadedIn, symbolOf, VectorArrow } from "./fall";
import {
  orbitAngle,
  orbitLayout,
  orbitRatios,
  symbolWidth,
  type OrbitGeometry,
} from "./orbit-layout";

const BAND_HALF_U = 1;
const BAND_PAD_U = 0.5;

interface BodyProps {
  ctx: SceneContext;
  state: ElementState;
  kind: PictogramKind;
  x: number;
  y: number;
  radius: number;
  part: string;
}

function Body({ ctx, state, kind, x, y, radius, part }: BodyProps) {
  return (
    <g data-part={part}>
      <Pictogram
        ctx={ctx}
        kind={kind}
        x={x}
        y={y}
        size={2 * radius}
        opacity={fadedIn(state).opacity}
      />
    </g>
  );
}

function BodyBand({ ctx, state, x, y, radius, part }: Omit<BodyProps, "kind">) {
  const reach = radius + BAND_PAD_U * ctx.u;
  return (
    <Band name={part} state={state}>
      <SvgHighlight
        ctx={ctx}
        state={state}
        x={x - reach}
        y={y - reach}
        width={2 * reach}
        height={2 * reach}
      />
    </Band>
  );
}

// Drawn counter-clockwise, the way the body moves.
function pathOf([cx, cy]: readonly [number, number], radius: number): string {
  const arc = `A ${radius} ${radius} 0 1 0`;
  return `M ${cx + radius} ${cy} ${arc} ${cx - radius} ${cy} ${arc} ${cx + radius} ${cy}`;
}

function OrbitPath({
  ctx,
  state,
  geometry,
}: {
  ctx: SceneContext;
  state: ElementState;
  geometry: OrbitGeometry;
}) {
  return (
    <path
      data-part="path"
      d={pathOf(geometry.centre, geometry.orbitRadius)}
      fill="none"
      stroke={colourOf(ctx, "inkSoft")}
      strokeWidth={strokeWidth(ctx, "regular")}
      opacity={state.opacity}
      {...drawStyle(state, 2 * Math.PI * geometry.orbitRadius)}
    />
  );
}

function PathBand({
  ctx,
  state,
  geometry,
}: {
  ctx: SceneContext;
  state: ElementState;
  geometry: OrbitGeometry;
}) {
  const circumference = 2 * Math.PI * geometry.orbitRadius;
  return (
    <Band name="path" state={state}>
      <circle
        cx={geometry.centre[0]}
        cy={geometry.centre[1]}
        r={geometry.orbitRadius}
        fill="none"
        stroke={ctx.theme.role.result}
        strokeWidth={2 * BAND_HALF_U * ctx.u}
        strokeDasharray={`${circumference * state.highlight} ${circumference}`}
      />
    </Band>
  );
}

interface RadiusLineProps {
  ctx: SceneContext;
  state: ElementState;
  geometry: OrbitGeometry;
  text: string;
}

function RadiusLine({ ctx, state, geometry, text }: RadiusLineProps) {
  const { from, to, length, label } = geometry.radius;
  return (
    <g data-part="radius">
      <line
        x1={from[0]}
        y1={from[1]}
        x2={to[0]}
        y2={to[1]}
        stroke={colourOf(ctx, "quantity")}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, length)}
      />
      <FigureLabel
        ctx={ctx}
        state={state}
        x={label[0]}
        y={label[1]}
        text={text}
        colour="quantity"
        italic
      />
    </g>
  );
}

export function OrbitSim({ element, ctx }: PrimitiveProps<"sim.orbit">) {
  const radius = resolve(element.radius, ctx.scope);
  const period = resolve(element.period, ctx.scope);
  const ratios = orbitRatios(
    { radius, period },
    {
      radius: resolve(element.radius, ctx.refScope),
      period: resolve(element.period, ctx.refScope),
    },
  );
  const radiusText = symbolOf(ctx, element.radius, "r");
  const width = (text: string): number => symbolWidth(text, textSize(ctx, "label"));
  const geometry = orbitLayout(
    ctx.size,
    ctx.u,
    ratios,
    { radius: width(radiusText), velocity: width("v"), force: width("F") },
    orbitAngle(period, ctx.state.simTime(element.id)),
  );

  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const centre = part("center");
  const body = part("body");
  const path = part("path");
  const speed = part("velocity");
  const pull = part("force");
  const radiusState = part("radius");
  const { velocity, force } = geometry;
  const speedShown = element.showVelocity !== false && speed.visible && velocity !== null;
  const pullShown = element.showForce === true && pull.visible && force !== null;

  return (
    <g>
      {path.visible ? <PathBand ctx={ctx} state={path} geometry={geometry} /> : null}
      <Band name="radius" state={radiusState}>
        <ArrowBand
          ctx={ctx}
          state={radiusState}
          arrow={{
            from: geometry.radius.from,
            tip: geometry.radius.to,
            length: geometry.radius.length,
          }}
        />
      </Band>
      {speedShown ? (
        <Band name="velocity" state={speed}>
          <ArrowBand ctx={ctx} state={speed} arrow={velocity} />
        </Band>
      ) : null}
      {pullShown ? (
        <Band name="force" state={pull}>
          <ArrowBand ctx={ctx} state={pull} arrow={force} />
        </Band>
      ) : null}
      <BodyBand
        ctx={ctx}
        state={centre}
        x={geometry.centre[0]}
        y={geometry.centre[1]}
        radius={geometry.centreRadius}
        part="center"
      />
      <BodyBand
        ctx={ctx}
        state={body}
        x={geometry.body.x}
        y={geometry.body.y}
        radius={geometry.body.radius}
        part="body"
      />
      {path.visible ? <OrbitPath ctx={ctx} state={path} geometry={geometry} /> : null}
      {radiusState.visible ? (
        <RadiusLine ctx={ctx} state={radiusState} geometry={geometry} text={radiusText} />
      ) : null}
      {pullShown ? (
        <VectorArrow
          ctx={ctx}
          state={pull}
          arrow={force}
          label={force.label}
          anchor="middle"
          text="F"
          part="force"
        />
      ) : null}
      {speedShown ? (
        <VectorArrow
          ctx={ctx}
          state={speed}
          arrow={velocity}
          label={velocity.label}
          anchor="middle"
          text="v"
          part="velocity"
        />
      ) : null}
      {centre.visible ? (
        <Body
          ctx={ctx}
          state={centre}
          kind={element.center ?? "planet"}
          x={geometry.centre[0]}
          y={geometry.centre[1]}
          radius={geometry.centreRadius}
          part="center"
        />
      ) : null}
      {body.visible ? (
        <Body
          ctx={ctx}
          state={body}
          kind={element.body ?? "moon"}
          x={geometry.body.x}
          y={geometry.body.y}
          radius={geometry.body.radius}
          part="body"
        />
      ) : null}
    </g>
  );
}
