import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { formatNumber, resolve, type Language, type NumberFormat } from "../../expr";
import type { SceneColour } from "../../tokens";
import { clamp01 } from "../figure/b-geometry";
import { labelBox } from "../figure/b-label";
import {
  colourOf,
  drawStyle,
  FigureLabel,
  HatchPattern,
  hatchId,
  strokeWidth,
  SvgHighlight,
  textSize,
} from "../shared";
import {
  areasOf,
  cleanLength,
  rightTriangleLayout,
  SIDES,
  type Box,
  type LabelBoxes,
  type LabelPlacement,
  type Side,
  type SquareGeometry,
} from "./right-triangle-layout";

type Vec = readonly [number, number];

const AREA_FORMAT: NumberFormat = { kind: "fixed", digits: 2 };
const FILL_APPEARS_AT = 0.6;
const BAND_HALF_U = 1;
const MARK_PAD_U = 0.8;
const LINE_PITCH = 1.1;
const ROW_GAP_U = 1;
const CAPITAL_ADVANCE = 0.7;
const ITALIC_ADVANCE = 0.5;

const SIDE_COLOUR: Record<Side, SceneColour> = { a: "quantity", b: "quantity", c: "ink" };
const HATCH_COLOUR: Record<Side, SceneColour> = { a: "quantity", b: "quantity", c: "inkSoft" };

function areaText(value: number, language: Language): string {
  return formatNumber(value, AREA_FORMAT, language)
    .replace(/[.,]00$/, "")
    .replace(/([.,]\d)0$/, "$1");
}

function symbolBox(ctx: SceneContext, text: string): Box {
  const { height } = labelBox(ctx, text, true);
  const advance = [...text].reduce(
    (sum, char) => sum + (char !== char.toLowerCase() ? CAPITAL_ADVANCE : ITALIC_ADVANCE),
    0,
  );
  return { width: advance * textSize(ctx, "label"), height };
}

function typed(state: ElementState): ElementState {
  if (state.how !== "type") return state;
  return { ...state, how: "fade", opacity: state.opacity * state.progress };
}

const pointsOf = (points: readonly Vec[]): string => points.map((p) => p.join(",")).join(" ");

function boundsOf(points: readonly Vec[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

interface Content {
  symbol: string;
  value: string;
  symbolWidth: number;
  valueWidth: number;
  boxes: LabelBoxes;
}

interface WashProps {
  ctx: SceneContext;
  state: ElementState;
  id: string;
  points: readonly Vec[];
}

function Wash({ ctx, state, id, points }: WashProps) {
  if (state.highlight <= 0) return null;
  const bounds = boundsOf(points);
  return (
    <>
      <defs>
        <clipPath id={id}>
          <rect
            x={bounds.x}
            y={bounds.y}
            width={bounds.width * state.highlight}
            height={bounds.height}
          />
        </clipPath>
      </defs>
      <polygon points={pointsOf(points)} fill={ctx.theme.role.result} clipPath={`url(#${id})`} />
    </>
  );
}

interface BandProps {
  ctx: SceneContext;
  state: ElementState;
  from: Vec;
  to: Vec;
}

function Band({ ctx, state, from, to }: BandProps) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (state.highlight <= 0 || length === 0) return null;
  const half = BAND_HALF_U * ctx.u;
  const nx = (-dy / length) * half;
  const ny = (dx / length) * half;
  const end: Vec = [from[0] + dx * state.highlight, from[1] + dy * state.highlight];
  return (
    <polygon
      points={pointsOf([
        [from[0] - nx, from[1] - ny],
        [end[0] - nx, end[1] - ny],
        [end[0] + nx, end[1] + ny],
        [from[0] + nx, from[1] + ny],
      ])}
      fill={ctx.theme.role.result}
    />
  );
}

interface LabelProps {
  ctx: SceneContext;
  state: ElementState;
  at: LabelPlacement;
  content: Content;
  colour: SceneColour;
}

function Label({ ctx, state, at, content, colour }: LabelProps) {
  const ink = state.highlight >= 0.5 ? "ink" : colour;
  const { symbol, value } = content;
  const line = (x: number, y: number, text: string, italic = false) => (
    <FigureLabel ctx={ctx} state={state} x={x} y={y} text={text} colour={ink} italic={italic} />
  );
  if (value === "") return line(at.x, at.y, symbol, true);
  if (at.form === "value") return line(at.x, at.y, value);
  if (at.form === "row") {
    const gap = ROW_GAP_U * ctx.u;
    return (
      <>
        {line(at.x - (gap + content.valueWidth) / 2, at.y, symbol, true)}
        {line(at.x + (content.symbolWidth + gap) / 2, at.y, value)}
      </>
    );
  }
  const half = (LINE_PITCH * textSize(ctx, "label")) / 2;
  return (
    <>
      {line(at.x, at.y - half, symbol, true)}
      {line(at.x, at.y + half, value)}
    </>
  );
}

interface SquareProps {
  ctx: SceneContext;
  state: ElementState;
  uid: string;
  side: Side;
  geometry: SquareGeometry;
  label: LabelPlacement;
  content: Content;
}

function Square({ ctx, state, uid, side, geometry, label, content }: SquareProps) {
  const part = `square_${side}`;
  const pattern = hatchId(`${uid}-${part}`);
  const points = pointsOf(geometry.corners);
  const fillOpacity =
    state.how === "draw" ? clamp01((state.progress - FILL_APPEARS_AT) / (1 - FILL_APPEARS_AT)) : 1;
  return (
    <g data-part={part}>
      <g opacity={state.opacity}>
        <defs>
          <HatchPattern ctx={ctx} id={pattern} colour={colourOf(ctx, HATCH_COLOUR[side])} />
        </defs>
        <Wash ctx={ctx} state={state} id={`highlight-${uid}-${part}`} points={geometry.corners} />
        <polygon points={points} fill={`url(#${pattern})`} fillOpacity={fillOpacity} />
        <polygon
          points={points}
          fill="none"
          stroke={colourOf(ctx, SIDE_COLOUR[side])}
          strokeWidth={strokeWidth(ctx, "regular")}
          strokeLinejoin="miter"
          {...drawStyle(state, 4 * geometry.side)}
        />
      </g>
      <Label ctx={ctx} state={state} at={label} content={content} colour={SIDE_COLOUR[side]} />
    </g>
  );
}

interface SideLineProps {
  ctx: SceneContext;
  state: ElementState;
  side: Side;
  from: Vec;
  to: Vec;
  label: { at: LabelPlacement; content: Content } | null;
}

function SideLine({ ctx, state, side, from, to, label }: SideLineProps) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const lead = side === "c" || length === 0 ? 0 : strokeWidth(ctx, "accent") / 2;
  const start: Vec = [
    from[0] - ((to[0] - from[0]) / length) * lead,
    from[1] - ((to[1] - from[1]) / length) * lead,
  ];
  return (
    <g data-part={`side_${side}`}>
      <Band ctx={ctx} state={state} from={from} to={to} />
      <line
        x1={start[0]}
        y1={start[1]}
        x2={to[0]}
        y2={to[1]}
        stroke={colourOf(ctx, SIDE_COLOUR[side])}
        strokeWidth={strokeWidth(ctx, "accent")}
        opacity={state.opacity}
        {...drawStyle(state, length + lead)}
      />
      {label ? (
        <Label
          ctx={ctx}
          state={state}
          at={label.at}
          content={label.content}
          colour={SIDE_COLOUR[side]}
        />
      ) : null}
    </g>
  );
}

interface TriangleProps {
  ctx: SceneContext;
  state: ElementState;
  uid: string;
  points: readonly Vec[];
  length: number;
}

function Triangle({ ctx, state, uid, points, length }: TriangleProps) {
  return (
    <g data-part="triangle" opacity={state.opacity}>
      <Wash ctx={ctx} state={state} id={`highlight-${uid}-triangle`} points={points} />
      <polygon
        points={pointsOf(points)}
        fill="none"
        stroke={ctx.theme.ink}
        strokeWidth={strokeWidth(ctx, "regular")}
        strokeLinejoin="miter"
        {...drawStyle(state, length)}
      />
    </g>
  );
}

interface RightAngleProps {
  ctx: SceneContext;
  state: ElementState;
  corner: Vec;
  size: number;
}

function RightAngle({ ctx, state, corner, size }: RightAngleProps) {
  const pad = MARK_PAD_U * ctx.u;
  const points: Vec[] = [
    [corner[0] + size, corner[1]],
    [corner[0] + size, corner[1] - size],
    [corner[0], corner[1] - size],
  ];
  return (
    <g data-part="right_angle">
      <SvgHighlight
        ctx={ctx}
        state={state}
        x={corner[0] - pad}
        y={corner[1] - size - pad}
        width={size + 2 * pad}
        height={size + 2 * pad}
      />
      <polyline
        points={pointsOf(points)}
        fill="none"
        stroke={ctx.theme.ink}
        strokeWidth={strokeWidth(ctx, "regular")}
        strokeLinejoin="miter"
        opacity={state.opacity}
        {...drawStyle(state, 2 * size)}
      />
    </g>
  );
}

function contentOf(
  ctx: SceneContext,
  name: string,
  area: number | null,
  language: Language,
): Content {
  if (area === null) {
    const box = symbolBox(ctx, name);
    return {
      symbol: name,
      value: "",
      symbolWidth: box.width,
      valueWidth: 0,
      boxes: { stacked: box, value: box, row: box },
    };
  }
  const symbol = `${name}²`;
  const value = areaText(area, language);
  const top = symbolBox(ctx, symbol);
  const bottom = labelBox(ctx, value);
  return {
    symbol,
    value,
    symbolWidth: top.width,
    valueWidth: bottom.width,
    boxes: {
      stacked: {
        width: Math.max(top.width, bottom.width),
        height: LINE_PITCH * textSize(ctx, "label") + top.height,
      },
      value: bottom,
      row: {
        width: top.width + ROW_GAP_U * ctx.u + bottom.width,
        height: Math.max(top.height, bottom.height),
      },
    },
  };
}

export function RightTriangleSim({ element, ctx }: PrimitiveProps<"sim.right-triangle">) {
  const squares = element.showSquares !== false;
  const a = cleanLength(resolve(element.a, ctx.scope));
  const b = cleanLength(resolve(element.b, ctx.scope));
  const names: Record<Side, string> = {
    a: element.labelA ?? "a",
    b: element.labelB ?? "b",
    c: element.labelC ?? "c",
  };
  const areas = areasOf(a, b);
  const texts = {
    a: contentOf(ctx, names.a, squares ? areas.a : null, ctx.language),
    b: contentOf(ctx, names.b, squares ? areas.b : null, ctx.language),
    c: contentOf(ctx, names.c, squares ? areas.c : null, ctx.language),
  };
  const geometry = rightTriangleLayout(ctx.size, ctx.u, {
    a,
    b,
    refA: resolve(element.a, ctx.refScope),
    refB: resolve(element.b, ctx.refScope),
    squares,
    labels: { a: texts.a.boxes, b: texts.b.boxes, c: texts.c.boxes },
  });
  const { corner, apex, foot, lengths } = geometry;
  const part = (name: string): ElementState => typed(ctx.state.of(`${element.id}.${name}`));
  const triangle = part("triangle");
  const mark = part("right_angle");
  const ends: Record<Side, readonly [Vec, Vec]> = {
    a: [corner, apex],
    b: [corner, foot],
    c: [apex, foot],
  };

  return (
    <g>
      {SIDES.map((side) => {
        const state = part(`square_${side}`);
        const square = geometry.squares?.[side];
        if (!state.visible || !square) return null;
        return (
          <Square
            key={side}
            ctx={ctx}
            state={state}
            uid={element.id}
            side={side}
            geometry={square}
            label={geometry.labels[side]}
            content={texts[side]}
          />
        );
      })}
      {triangle.visible ? (
        <Triangle
          ctx={ctx}
          state={triangle}
          uid={element.id}
          points={[corner, apex, foot]}
          length={(lengths.a + lengths.b + lengths.c) * geometry.scale}
        />
      ) : null}
      {mark.visible ? (
        <RightAngle ctx={ctx} state={mark} corner={corner} size={geometry.markSize} />
      ) : null}
      {SIDES.map((side) => {
        const state = part(`side_${side}`);
        if (!state.visible) return null;
        return (
          <SideLine
            key={side}
            ctx={ctx}
            state={state}
            side={side}
            from={ends[side][0]}
            to={ends[side][1]}
            label={squares ? null : { at: geometry.labels[side], content: texts[side] }}
          />
        );
      })}
    </g>
  );
}
