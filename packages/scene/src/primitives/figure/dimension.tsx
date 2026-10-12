import type { PrimitiveProps } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { DIMENSION_OFFSET } from "../../schema/geometry";
import { drawStyle, FigureLabel, strokeWidth } from "../shared";
import { HighlightBand } from "./b-band";
import { along, figureSpace, phased, toward, type Px } from "./b-geometry";
import {
  BAND_WIDTH_U,
  clearance,
  labelBox,
  labelColour,
  labelText,
  lineColour,
  reach,
} from "./b-label";

const EXTENSION_GAP_U = 0.5;
const EXTENSION_OVERSHOOT_U = 0.8;
const TICK_HALF_U = 0.8;
const LABEL_PAD_U = 0.8;
const MIN_STUB_U = 1;
const EXTENSIONS_END = 0.3;
const LINE_START = 0.25;
const TICK_START_AT = 0.1;
const TICK_END_AT = 0.9;

function Rule({
  from,
  to,
  stroke,
  width,
  state,
}: {
  from: Px;
  to: Px;
  stroke: string;
  width: number;
  state: ElementState;
}) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length === 0) return null;
  return (
    <line
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      stroke={stroke}
      strokeWidth={width}
      {...drawStyle(state, length)}
    />
  );
}

export function DimensionPrimitive({ element, ctx }: PrimitiveProps<"dimension">) {
  const space = figureSpace(ctx);
  const a = space?.anchor(element.from);
  const b = space?.anchor(element.to);
  const measured = a && b ? toward(a, b) : null;
  if (!space || !a || !b || !measured) return null;

  const state = ctx.state.of(element.id);
  const u = ctx.u;
  const direction = measured.unit;
  const upright = direction[0] > 1e-6 || (Math.abs(direction[0]) <= 1e-6 && direction[1] < 0);
  const canonical: Px = upright ? direction : [-direction[0], -direction[1]];
  const up: Px = [canonical[1], -canonical[0]];
  const shift = (element.offset ?? DIMENSION_OFFSET * space.worldHeight) * space.scale;
  const side: Px = shift < 0 ? [-up[0], -up[1]] : up;
  const a1 = along(a, up, shift);
  const b1 = along(b, up, shift);
  const mid: Px = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
  const gap = Math.min(EXTENSION_GAP_U * u, Math.abs(shift) / 3);
  const reachOut = EXTENSION_OVERSHOOT_U * u;
  const tick: Px = [(direction[0] + side[0]) / Math.SQRT2, (direction[1] + side[1]) / Math.SQRT2];

  const label = element.label ? labelBox(ctx, element.label, true) : null;
  const halfGap = label
    ? reach(label, direction) + (LABEL_PAD_U + (BAND_WIDTH_U / 2) * state.highlight) * u
    : 0;
  const interrupted = label !== null && 2 * (halfGap + MIN_STUB_U * u) <= measured.length;
  const labelAt =
    label !== null && !interrupted
      ? along(mid, side, reach(label, side) + clearance(ctx, state.highlight))
      : mid;
  const pieces: [Px, Px][] = interrupted
    ? [
        [a1, along(mid, direction, -halfGap)],
        [along(mid, direction, halfGap), b1],
      ]
    : [[a1, b1]];
  const lengthOf = ([from, to]: [Px, Px]): number => Math.hypot(to[0] - from[0], to[1] - from[1]);
  const total = pieces.reduce((sum, piece) => sum + lengthOf(piece), 0);

  const stroke = lineColour(ctx, element.role, "quantity");
  const thin = strokeWidth(ctx, "construction");
  const regular = strokeWidth(ctx, "regular");
  let cursor = LINE_START;
  const strokes = pieces.map(([from, to]) => {
    const start = cursor;
    cursor += ((1 - LINE_START) * lengthOf([from, to])) / total;
    return { from, to, phase: phased(state, start, cursor) };
  });
  const extension = (foot: Px, head: Px) => (
    <Rule
      from={along(foot, side, gap)}
      to={along(head, side, reachOut)}
      stroke={stroke}
      width={thin}
      state={phased(state, 0, EXTENSIONS_END)}
    />
  );
  const tickAt = (centre: Px, phase: ElementState) => (
    <Rule
      from={along(centre, tick, -TICK_HALF_U * u)}
      to={along(centre, tick, TICK_HALF_U * u)}
      stroke={stroke}
      width={regular}
      state={phase}
    />
  );

  return (
    <g>
      <g opacity={state.opacity}>
        {pieces.map(([from, to], i) => (
          <HighlightBand key={i} ctx={ctx} state={state} from={from} to={to} />
        ))}
        {shift !== 0 ? (
          <>
            {extension(a, a1)}
            {extension(b, b1)}
          </>
        ) : null}
        {strokes.map(({ from, to, phase }, i) => (
          <Rule key={i} from={from} to={to} stroke={stroke} width={regular} state={phase} />
        ))}
        {tickAt(a1, phased(state, TICK_START_AT, EXTENSIONS_END))}
        {tickAt(b1, phased(state, TICK_END_AT, 1))}
      </g>
      {element.label ? (
        <FigureLabel
          ctx={ctx}
          state={state}
          x={labelAt[0]}
          y={labelAt[1]}
          text={labelText(element.label, true)}
          colour={labelColour(element.role, "quantity")}
          italic
        />
      ) : null}
    </g>
  );
}
