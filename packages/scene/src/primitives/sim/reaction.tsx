import type { ReactNode } from "react";
import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { resolve } from "../../expr";
import type { ElementOf } from "../../schema/document";
import { sceneMetrics } from "../../tokens";
import {
  ArrowHead,
  colourOf,
  drawStyle,
  fontOf,
  highlightTextColour,
  labelOpacity,
  labelRise,
  strokeWidth,
  SvgHighlight,
  textSize,
} from "../shared";
import {
  formulaRuns,
  reactionLayout,
  subscriptDrop,
  TALLY_HALF_GAP_U,
  wholeCoefficient,
  type Box,
  type SideGeometry,
  type SpeciesGeometry,
  type TallyGeometry,
} from "./reaction-layout";

const HEAD_APPEARS_AT = 0.9;
const BAND_PAD_U = 0.8;
const MARK_SIZE_U = 5.5;
const MARK_BALANCED = "=";
const MARK_UNBALANCED = "≠";

function fadedState(state: ElementState): ElementState {
  if (state.how === "fade") return state;
  return { ...state, how: "fade", opacity: state.opacity * state.progress };
}

interface TextProps {
  ctx: SceneContext;
  state: ElementState;
  x: number;
  y: number;
  size: number;
  colour: string;
  font?: "mono" | "text";
  weight?: number;
  anchor?: "start" | "middle" | "end";
  part?: string;
  children: ReactNode;
}

function Text({
  ctx,
  state,
  x,
  y,
  size,
  colour,
  font = "mono",
  weight = 500,
  anchor = "middle",
  part,
  children,
}: TextProps) {
  return (
    <text
      data-text={part}
      x={x}
      y={y + labelRise(ctx, state)}
      textAnchor={anchor}
      dominantBaseline="middle"
      fontFamily={fontOf(font)}
      fontWeight={weight}
      fontSize={size}
      fill={colour}
      opacity={labelOpacity(state)}
    >
      {children}
    </text>
  );
}

function Band({ ctx, state, box }: { ctx: SceneContext; state: ElementState; box: Box }) {
  const pad = BAND_PAD_U * ctx.u;
  return (
    <SvgHighlight
      ctx={ctx}
      state={state}
      x={box.x - pad}
      y={box.y - pad}
      width={box.width + 2 * pad}
      height={box.height + 2 * pad}
    />
  );
}

interface SideProps {
  ctx: SceneContext;
  state: ElementState;
  side: SideGeometry;
  diameter: number;
  symbols: boolean;
  part: string;
}

function Formula({
  ctx,
  state,
  species,
}: {
  ctx: SceneContext;
  state: ElementState;
  species: SpeciesGeometry;
}) {
  const drop = subscriptDrop(ctx.u);
  const runs = formulaRuns(species.formula);
  return (
    <Text
      ctx={ctx}
      state={state}
      x={species.formulaAt[0]}
      y={species.formulaAt[1]}
      size={textSize(ctx, "label")}
      colour={highlightTextColour(ctx, state, ctx.theme.ink)}
      part="formula"
    >
      {runs.map((run, index) => {
        const before = runs[index - 1]?.sub ?? false;
        const dy = run.sub === before ? undefined : run.sub ? drop : -drop;
        return (
          <tspan key={index} dy={dy}>
            {run.text}
          </tspan>
        );
      })}
    </Text>
  );
}

function Side({ ctx, state, side, diameter, symbols, part }: SideProps) {
  const radius = diameter / 2;
  const size = textSize(ctx, "label");
  const ink = ctx.theme.ink;
  const circumference = 2 * Math.PI * radius;
  const coefficientColour = highlightTextColour(ctx, state, colourOf(ctx, "quantity"));
  return (
    <g data-part={part}>
      <Band ctx={ctx} state={state} box={side.box} />
      {side.species.map((species, index) => (
        <g key={index} data-species={species.formula}>
          {species.molecules.map((atoms, copy) => (
            <g key={copy}>
              {atoms.map((atom, i) => (
                <g key={i}>
                  <circle
                    data-atom={atom.symbol}
                    cx={atom.x}
                    cy={atom.y}
                    r={radius}
                    fill="none"
                    stroke={ink}
                    strokeWidth={strokeWidth(ctx, "regular")}
                    opacity={state.opacity}
                    {...drawStyle(state, circumference)}
                  />
                  {symbols ? (
                    <Text
                      ctx={ctx}
                      state={state}
                      x={atom.x}
                      y={atom.y}
                      size={size}
                      colour={highlightTextColour(ctx, state, ink)}
                    >
                      {atom.symbol}
                    </Text>
                  ) : null}
                </g>
              ))}
            </g>
          ))}
          {species.coefficientAt ? (
            <Text
              ctx={ctx}
              state={state}
              x={species.coefficientAt[0]}
              y={species.coefficientAt[1]}
              size={sceneMetrics.text.title * ctx.u}
              colour={coefficientColour}
              font="text"
              weight={600}
              part="coefficient"
            >
              {species.coefficient}
            </Text>
          ) : null}
          <Formula ctx={ctx} state={state} species={species} />
        </g>
      ))}
      {side.operators.map(([x, y], index) => (
        <Text
          key={index}
          ctx={ctx}
          state={state}
          x={x}
          y={y}
          size={sceneMetrics.text.title * ctx.u}
          colour={highlightTextColour(ctx, state, ink)}
          font="text"
          part="operator"
        >
          +
        </Text>
      ))}
    </g>
  );
}

interface ArrowProps {
  ctx: SceneContext;
  state: ElementState;
  arrow: { from: readonly [number, number]; tip: readonly [number, number]; box: Box };
}

function Arrow({ ctx, state, arrow }: ArrowProps) {
  const ink = ctx.theme.ink;
  const length = arrow.tip[0] - arrow.from[0];
  const headAppear =
    state.how === "draw"
      ? Math.min(1, Math.max(0, (state.progress - HEAD_APPEARS_AT) / (1 - HEAD_APPEARS_AT)))
      : 1;
  return (
    <g data-part="arrow">
      <Band ctx={ctx} state={state} box={arrow.box} />
      <line
        x1={arrow.from[0]}
        y1={arrow.from[1]}
        x2={arrow.tip[0]}
        y2={arrow.tip[1]}
        stroke={ink}
        strokeWidth={strokeWidth(ctx, "regular")}
        opacity={state.opacity}
        {...drawStyle(state, length)}
      />
      <ArrowHead
        ctx={ctx}
        tip={arrow.tip}
        from={arrow.from}
        colour={ink}
        opacity={state.opacity * headAppear}
      />
    </g>
  );
}

function Tally({
  ctx,
  state,
  tally,
}: {
  ctx: SceneContext;
  state: ElementState;
  tally: TallyGeometry;
}) {
  const shown = fadedState(state);
  const size = textSize(ctx, "label");
  const half = TALLY_HALF_GAP_U * ctx.u;
  const ink = highlightTextColour(ctx, shown, ctx.theme.ink);
  const valid = highlightTextColour(ctx, shown, colourOf(ctx, "valid"));
  return (
    <g data-part="tally">
      <Band ctx={ctx} state={state} box={tally.box} />
      {tally.rows.map((row) => {
        const colour = row.balanced ? valid : ink;
        const cell = (
          x: number,
          anchor: "start" | "end",
          text: string,
          fill: string,
          part: string,
        ) => (
          <Text
            ctx={ctx}
            state={shown}
            x={x}
            y={row.y}
            size={size}
            colour={fill}
            anchor={anchor}
            part={part}
          >
            {text}
          </Text>
        );
        return (
          <g key={row.symbol} data-row={row.symbol} data-balanced={row.balanced}>
            {cell(tally.leftX - half, "end", row.symbol, ink, "symbol")}
            {cell(tally.leftX + half, "start", String(row.left), colour, "count")}
            <Text
              ctx={ctx}
              state={shown}
              x={tally.midX}
              y={row.y}
              size={MARK_SIZE_U * ctx.u}
              colour={colour}
              part="mark"
            >
              {row.balanced ? MARK_BALANCED : MARK_UNBALANCED}
            </Text>
            {cell(tally.rightX - half, "end", row.symbol, ink, "symbol")}
            {cell(tally.rightX + half, "start", String(row.right), colour, "count")}
          </g>
        );
      })}
    </g>
  );
}

export function ReactionSim({ element, ctx }: PrimitiveProps<"sim.reaction">) {
  const whole = (species: ElementOf<"sim.reaction">["reactants"]) =>
    species.map(({ formula, coefficient }) => ({
      formula,
      coefficient: wholeCoefficient(resolve(coefficient, ctx.scope)),
    }));
  const geometry = reactionLayout(ctx.size, ctx.u, {
    reactants: whole(element.reactants),
    products: whole(element.products),
  });
  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const reactants = part("reactants");
  const products = part("products");
  const arrow = part("arrow");
  const tally = part("tally");
  const { diameter, symbols } = geometry;

  return (
    <g transform={geometry.scale === 1 ? undefined : `scale(${geometry.scale})`}>
      {reactants.visible ? (
        <Side
          ctx={ctx}
          state={reactants}
          side={geometry.reactants}
          diameter={diameter}
          symbols={symbols}
          part="reactants"
        />
      ) : null}
      {arrow.visible ? <Arrow ctx={ctx} state={arrow} arrow={geometry.arrow} /> : null}
      {products.visible ? (
        <Side
          ctx={ctx}
          state={products}
          side={geometry.products}
          diameter={diameter}
          symbols={symbols}
          part="products"
        />
      ) : null}
      {tally.visible ? <Tally ctx={ctx} state={tally} tally={geometry.tally} /> : null}
    </g>
  );
}
