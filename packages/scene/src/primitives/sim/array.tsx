import type { ReactNode } from "react";
import type { PrimitiveProps, SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { resolve, type Language } from "../../expr";
import {
  ARROW_HEAD_U,
  ArrowHead,
  colourOf,
  drawStyle,
  fontOf,
  highlightTextColour,
  labelOpacity,
  labelRise,
  strokeWidth,
  SvgHighlight,
} from "../shared";
import { arraySteps, type ArrayStep, type Relation } from "./array-steps";

const MONO_ADVANCE = 0.6;
const MARGIN_U = 3;
const GAP_U = 2;
const GAP_SHARE = 0.2;
const CELL_W_MAX_U = 10;
const CELL_H_MIN_U = 6;
const CELL_H_MAX_U = 10;
const VALUE_U = 6;
const LABEL_U = 4;
const GLYPH_U = 5;
const VALUE_FIT = 0.78;
const VALUE_IN_CELL = 0.6;
const MAX_COMPRESSION = 0.5;

const READOUT_GAP_U = 1;
const MARK_ZONE_U = 8;
const INDEX_GAP_U = 1.4;
const INDEX_HEIGHT_U = 4;
const RUN_GAP_U = 1.2;
const RUN_TAIL_U = 0.7;
const ABOVE_U = LABEL_U + READOUT_GAP_U + MARK_ZONE_U;
const BELOW_U = INDEX_GAP_U + INDEX_HEIGHT_U + RUN_GAP_U + RUN_TAIL_U;
const FIXED_U = ABOVE_U + BELOW_U;

const GLYPH_CENTRE_U = 2.7;
const BRIDGE_U = 5.6;
const LEG_END_U = 0.6;
const TIP_GAP_U = 0.7;
const POINTER_HEIGHT_U = 1.8;
const POINTER_HALF_U = 1;
const SHAFT_INTO_HEAD = 0.8;
const ARC_MIN_U = 2;
const ARC_MAX_U = 4.2;
const ARC_SLOPE = 0.3;
const BRACKET_REACH_U = 0.9;
const BRACKET_SERIF_U = 1.2;
const CROSSED_OFFSET_U = 0.5;
const FOUND_INSET_U = 0.8;
const BAND_PAD_U = 0.6;
const DASH_U = [0.8, 0.6] as const;

interface Geometry {
  unit: number;
  count: number;
  x0: number;
  cellW: number;
  cellH: number;
  gap: number;
  readoutY: number;
  zoneTop: number;
  cellTop: number;
  cellBottom: number;
  indexY: number;
  runY: number;
  valueSize: number;
  labelSize: number;
  glyphSize: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

function arrayGeometry(
  slot: { width: number; height: number },
  u: number,
  count: number,
  chars: number,
): Geometry {
  const compression = clamp(slot.height / ((FIXED_U + CELL_H_MIN_U) * u), MAX_COMPRESSION, 1);
  const unit = compression * u;
  const span = slot.width - 2 * MARGIN_U * u;
  const gap = Math.min(GAP_U * u, (GAP_SHARE * span) / count);
  const cellW = Math.min(CELL_W_MAX_U * u, Math.max(u, (span - (count - 1) * gap) / count));
  const cellH = clamp(
    cellW,
    CELL_H_MIN_U * unit,
    Math.min(CELL_H_MAX_U * unit, slot.height - FIXED_U * unit),
  );
  const top = Math.max(0, (slot.height - FIXED_U * unit - cellH) / 2);
  const cellTop = top + ABOVE_U * unit;
  const cellBottom = cellTop + cellH;
  return {
    unit,
    count,
    x0: (slot.width - (count * cellW + (count - 1) * gap)) / 2,
    cellW,
    cellH,
    gap,
    readoutY: top + (LABEL_U * unit) / 2,
    zoneTop: cellTop - MARK_ZONE_U * unit,
    cellTop,
    cellBottom,
    indexY: cellBottom + (INDEX_GAP_U + INDEX_HEIGHT_U / 2) * unit,
    runY: cellBottom + (INDEX_GAP_U + INDEX_HEIGHT_U + RUN_GAP_U) * unit,
    valueSize: Math.min(
      VALUE_U * unit,
      (VALUE_FIT * cellW) / (MONO_ADVANCE * Math.max(1, chars)),
      VALUE_IN_CELL * cellH,
    ),
    labelSize: LABEL_U * unit,
    glyphSize: GLYPH_U * unit,
  };
}

const cellLeft = (geo: Geometry, index: number): number => geo.x0 + index * (geo.cellW + geo.gap);
const cellCentre = (geo: Geometry, index: number): number => cellLeft(geo, index) + geo.cellW / 2;
const gapCentre = (geo: Geometry, boundary: number): number =>
  cellLeft(geo, clamp(boundary, 0, geo.count)) - geo.gap / 2;
const arrayWidth = (geo: Geometry): number => geo.count * geo.cellW + (geo.count - 1) * geo.gap;

function formatValue(value: number, language: Language): string {
  const text = String(Number(value.toFixed(2))).replace("-", "−");
  return language === "fr" ? text.replace(".", ",") : text;
}

type CellKind = "normal" | "compared" | "swapped" | "settled" | "found" | "excluded";

interface Visible {
  cells: boolean;
  compare: boolean;
  swap: boolean;
  low: boolean;
  high: boolean;
  mid: boolean;
}

function cellKind(step: ArrayStep, index: number, shown: Visible): CellKind {
  if (step.found === index) return "found";
  if (shown.swap && step.swap?.includes(index)) return "swapped";
  const pair = step.compare;
  const compared = pair !== null && (pair.left === index || pair.right === index);
  if ((shown.compare && compared) || (shown.mid && step.probe?.index === index)) return "compared";
  if (step.settled.includes(index)) return "settled";
  const { window: bounds } = step;
  const outside = bounds !== null && (index < bounds.low || index > bounds.high);
  if (outside && (shown.low || shown.high || shown.mid)) return "excluded";
  return "normal";
}

function runsOf(indices: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const index of [...indices].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[1] === index - 1) last[1] = index;
    else runs.push([index, index]);
  }
  return runs;
}

interface LayerProps {
  ctx: SceneContext;
  state: ElementState;
  geo: Geometry;
  step: ArrayStep;
}

interface TextProps {
  ctx: SceneContext;
  state: ElementState;
  x: number;
  y: number;
  size: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  partName?: string;
  children: ReactNode;
}

function Text({ ctx, state, x, y, size, fill, anchor = "middle", partName, children }: TextProps) {
  return (
    <text
      data-part={partName}
      x={x}
      y={y + labelRise(ctx, state)}
      textAnchor={anchor}
      dominantBaseline="middle"
      fontFamily={fontOf("mono")}
      fontWeight={500}
      fontSize={size}
      fill={fill}
      opacity={labelOpacity(state)}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {children}
    </text>
  );
}

function Bands({
  ctx,
  geo,
  step,
  states,
}: {
  ctx: SceneContext;
  geo: Geometry;
  step: ArrayStep;
  states: Record<keyof Visible | "counter", ElementState>;
}) {
  const pad = BAND_PAD_U * geo.unit;
  const box = (index: number) => ({
    x: cellLeft(geo, index) - pad,
    y: geo.cellTop - pad,
    width: geo.cellW + 2 * pad,
    height: geo.cellH + 2 * pad,
  });
  const inside = (index: number): boolean => index >= 0 && index < geo.count;
  const probe = step.probe?.index;
  const pair = step.compare ? [step.compare.left, step.compare.right] : [];
  const boxes: [ElementState, number[]][] = [
    [states.compare, probe === undefined ? pair : [probe]],
    [states.swap, step.swap ? [...step.swap] : []],
    [states.mid, probe === undefined ? [] : [probe]],
    [states.low, step.window && inside(step.window.low) ? [step.window.low] : []],
    [states.high, step.window && inside(step.window.high) ? [step.window.high] : []],
  ];
  const counterWidth = 6 * MONO_ADVANCE * geo.labelSize;
  return (
    <g data-layer="bands">
      <SvgHighlight
        ctx={ctx}
        state={states.cells}
        x={geo.x0 - pad}
        y={geo.cellTop - pad}
        width={arrayWidth(geo) + 2 * pad}
        height={geo.cellH + 2 * pad}
      />
      {boxes.flatMap(([state, indices], part) =>
        indices.map((index) => (
          <SvgHighlight key={`${part}-${index}`} ctx={ctx} state={state} {...box(index)} />
        )),
      )}
      <SvgHighlight
        ctx={ctx}
        state={states.counter}
        x={geo.x0 + arrayWidth(geo) - counterWidth}
        y={geo.readoutY - geo.labelSize}
        width={counterWidth}
        height={2 * geo.labelSize}
      />
    </g>
  );
}

function cellHighlight(
  step: ArrayStep,
  index: number,
  states: Record<keyof Visible | "counter", ElementState>,
): ElementState {
  const touching: ElementState[] = [states.cells];
  const pair = step.compare;
  if (pair && (pair.left === index || pair.right === index)) touching.push(states.compare);
  if (step.probe?.index === index) touching.push(states.compare, states.mid);
  if (step.swap?.includes(index)) touching.push(states.swap);
  if (step.window?.low === index) touching.push(states.low);
  if (step.window?.high === index) touching.push(states.high);
  return touching.reduce((best, state) => (state.highlight > best.highlight ? state : best));
}

function Cells({
  ctx,
  state,
  geo,
  step,
  shown,
  states,
  language,
}: LayerProps & {
  shown: Visible;
  states: Record<keyof Visible | "counter", ElementState>;
  language: Language;
}) {
  const { theme } = ctx;
  const perimeter = 2 * (geo.cellW + geo.cellH);
  const dash = DASH_U.map((part) => part * geo.unit).join(" ");
  const inset = FOUND_INSET_U * geo.unit;
  const styleOf = (kind: CellKind): { stroke: string; width: number; dashed: boolean } => {
    switch (kind) {
      case "compared":
        return {
          stroke: colourOf(ctx, "quantity"),
          width: strokeWidth(ctx, "accent"),
          dashed: false,
        };
      case "swapped":
        return {
          stroke: colourOf(ctx, "action"),
          width: strokeWidth(ctx, "accent"),
          dashed: false,
        };
      case "settled":
        return {
          stroke: colourOf(ctx, "valid"),
          width: strokeWidth(ctx, "regular"),
          dashed: false,
        };
      case "found":
        return { stroke: colourOf(ctx, "valid"), width: strokeWidth(ctx, "accent"), dashed: false };
      case "excluded":
        return { stroke: theme.inkFaint, width: strokeWidth(ctx, "regular"), dashed: true };
      case "normal":
        return { stroke: theme.ink, width: strokeWidth(ctx, "regular"), dashed: false };
    }
  };
  const drawing = drawStyle(state, perimeter);
  return (
    <g data-part="cells">
      {step.values.map((value, index) => {
        const kind = cellKind(step, index, shown);
        const style = styleOf(kind);
        const left = cellLeft(geo, index);
        const centre = cellCentre(geo, index);
        const valueColour = highlightTextColour(
          ctx,
          cellHighlight(step, index, states),
          kind === "excluded" ? theme.inkFaint : theme.ink,
        );
        return (
          <g key={index} data-cell={index} data-state={kind}>
            <rect
              x={left}
              y={geo.cellTop}
              width={geo.cellW}
              height={geo.cellH}
              fill="none"
              stroke={style.stroke}
              strokeWidth={style.width}
              opacity={state.opacity}
              {...(style.dashed && !drawing.strokeDasharray ? { strokeDasharray: dash } : drawing)}
            />
            {kind === "found" ? (
              <rect
                x={left + inset}
                y={geo.cellTop + inset}
                width={geo.cellW - 2 * inset}
                height={geo.cellH - 2 * inset}
                fill="none"
                stroke={style.stroke}
                strokeWidth={strokeWidth(ctx, "regular")}
                opacity={labelOpacity(state)}
              />
            ) : null}
            <Text
              ctx={ctx}
              state={state}
              x={centre}
              y={(geo.cellTop + geo.cellBottom) / 2}
              size={geo.valueSize}
              fill={valueColour}
            >
              {formatValue(value, language)}
            </Text>
            <Text
              ctx={ctx}
              state={state}
              x={centre}
              y={geo.indexY}
              size={geo.labelSize}
              fill={theme.inkFaint}
            >
              {index}
            </Text>
          </g>
        );
      })}
      {runsOf(step.settled).map(([from, to]) => {
        const tick = BRACKET_REACH_U * geo.unit;
        const start = cellLeft(geo, from);
        const end = cellLeft(geo, to) + geo.cellW;
        return (
          <path
            key={from}
            data-run={`${from}-${to}`}
            d={`M ${start} ${geo.runY - tick} L ${start} ${geo.runY} L ${end} ${geo.runY} L ${end} ${geo.runY - tick}`}
            fill="none"
            stroke={colourOf(ctx, "valid")}
            strokeWidth={strokeWidth(ctx, "accent")}
            opacity={state.opacity}
            {...drawStyle(state, end - start + 2 * tick)}
          />
        );
      })}
    </g>
  );
}

function Glyph({
  ctx,
  state,
  geo,
  x,
  relation,
}: {
  ctx: SceneContext;
  state: ElementState;
  geo: Geometry;
  x: number;
  relation: Relation;
}) {
  return (
    <Text
      ctx={ctx}
      state={state}
      x={x}
      y={geo.zoneTop + GLYPH_CENTRE_U * geo.unit}
      size={geo.glyphSize}
      fill={colourOf(ctx, "quantity")}
      partName="relation"
    >
      {relation}
    </Text>
  );
}

function Compare({
  ctx,
  state,
  geo,
  step,
  target,
  language,
}: LayerProps & { target: number | undefined; language: Language }) {
  const pair = step.compare;
  const probe = step.probe;
  const legEnd = geo.cellTop - LEG_END_U * geo.unit;
  const bridge = geo.zoneTop + BRIDGE_U * geo.unit;
  return (
    <g data-part="compare">
      {target !== undefined ? (
        <Text
          ctx={ctx}
          state={state}
          x={geo.x0}
          y={geo.readoutY}
          size={geo.labelSize}
          fill={ctx.theme.ink}
          anchor="start"
          partName="target"
        >
          <tspan fontFamily={fontOf("text")} fontStyle="italic">
            x
          </tspan>
          {` = ${formatValue(target, language)}`}
        </Text>
      ) : null}
      {pair ? (
        <>
          <path
            data-part="bridge"
            d={`M ${cellCentre(geo, pair.left)} ${legEnd} L ${cellCentre(geo, pair.left)} ${bridge} L ${cellCentre(geo, pair.right)} ${bridge} L ${cellCentre(geo, pair.right)} ${legEnd}`}
            fill="none"
            stroke={colourOf(ctx, "quantity")}
            strokeWidth={strokeWidth(ctx, "accent")}
            opacity={state.opacity}
            {...drawStyle(
              state,
              cellCentre(geo, pair.right) - cellCentre(geo, pair.left) + 2 * (legEnd - bridge),
            )}
          />
          <Glyph
            ctx={ctx}
            state={state}
            geo={geo}
            x={(cellCentre(geo, pair.left) + cellCentre(geo, pair.right)) / 2}
            relation={pair.relation}
          />
        </>
      ) : null}
      {probe ? (
        <Glyph
          ctx={ctx}
          state={state}
          geo={geo}
          x={cellCentre(geo, probe.index)}
          relation={probe.relation}
        />
      ) : null}
    </g>
  );
}

function Swap({ ctx, state, geo, step }: LayerProps) {
  if (!step.swap) return null;
  const [from, to] = step.swap;
  const xa = cellCentre(geo, from);
  const xb = cellCentre(geo, to);
  const tipY = geo.cellTop - TIP_GAP_U * geo.unit;
  const head = ARROW_HEAD_U * geo.unit;
  const shaftEnd = tipY - head * SHAFT_INTO_HEAD;
  const rise = clamp(ARC_SLOPE * Math.abs(xb - xa), ARC_MIN_U * geo.unit, ARC_MAX_U * geo.unit);
  const control = shaftEnd - rise / 0.75;
  const colour = colourOf(ctx, "action");
  const headCtx = { ...ctx, u: geo.unit };
  return (
    <g data-part="swap">
      <path
        d={`M ${xa} ${shaftEnd} C ${xa} ${control} ${xb} ${control} ${xb} ${shaftEnd}`}
        fill="none"
        stroke={colour}
        strokeWidth={strokeWidth(ctx, "accent")}
        opacity={state.opacity}
        {...drawStyle(state, Math.abs(xb - xa) + 2 * rise)}
      />
      {[xa, xb].map((x) => (
        <ArrowHead
          key={x}
          ctx={headCtx}
          tip={[x, tipY]}
          from={[x, tipY - 1]}
          colour={colour}
          opacity={labelOpacity(state)}
        />
      ))}
    </g>
  );
}

function Pointer({ ctx, state, geo, step }: LayerProps) {
  if (!step.probe) return null;
  const x = cellCentre(geo, step.probe.index);
  const tip = geo.cellTop - TIP_GAP_U * geo.unit;
  const base = tip - POINTER_HEIGHT_U * geo.unit;
  const half = POINTER_HALF_U * geo.unit;
  return (
    <polygon
      data-part="mid"
      points={`${x},${tip} ${x - half},${base} ${x + half},${base}`}
      fill={colourOf(ctx, "quantity")}
      opacity={labelOpacity(state)}
    />
  );
}

function Bracket({
  ctx,
  state,
  geo,
  x,
  side,
  partName,
}: {
  ctx: SceneContext;
  state: ElementState;
  geo: Geometry;
  x: number;
  side: 1 | -1;
  partName: "low" | "high";
}) {
  const top = geo.cellTop - BRACKET_REACH_U * geo.unit;
  const bottom = geo.cellBottom + BRACKET_REACH_U * geo.unit;
  const serif = side * BRACKET_SERIF_U * geo.unit;
  return (
    <path
      data-part={partName}
      d={`M ${x + serif} ${top} L ${x} ${top} L ${x} ${bottom} L ${x + serif} ${bottom}`}
      fill="none"
      stroke={ctx.theme.ink}
      strokeWidth={strokeWidth(ctx, "accent")}
      opacity={state.opacity}
      {...drawStyle(state, bottom - top + 2 * Math.abs(serif))}
    />
  );
}

export function ArraySim({ element, ctx }: PrimitiveProps<"sim.array">) {
  const { algorithm, target } = element;
  const steps = arraySteps(algorithm, element.values, target);
  const total = steps.length - 1;
  const raw =
    element.step === undefined ? ctx.state.simTime(element.id) : resolve(element.step, ctx.scope);
  const position = Number.isFinite(raw) ? clamp(raw, 0, total) : 0;
  const index = Math.min(total, Math.round(position));
  const step = steps[index]!;

  const formatted = step.values.map((value) => formatValue(value, ctx.language));
  const geo = arrayGeometry(
    ctx.size,
    ctx.u,
    step.values.length,
    Math.max(1, ...formatted.map((text) => text.length)),
  );
  const part = (name: string): ElementState => ctx.state.of(`${element.id}.${name}`);
  const states = {
    cells: part("cells"),
    compare: part("compare"),
    swap: part("swap"),
    low: part("low"),
    high: part("high"),
    mid: part("mid"),
    counter: part("counter"),
  };
  const shown: Visible = {
    cells: states.cells.visible,
    compare: states.compare.visible,
    swap: states.swap.visible,
    low: states.low.visible,
    high: states.high.visible,
    mid: states.mid.visible,
  };
  const searching = algorithm.endsWith("search");
  const bounds = step.window;
  const crossed = bounds !== null && bounds.low > bounds.high;
  const offset = crossed ? CROSSED_OFFSET_U * geo.unit : 0;

  return (
    <g>
      <Bands ctx={ctx} geo={geo} step={step} states={states} />
      {shown.cells ? (
        <Cells
          ctx={ctx}
          state={states.cells}
          geo={geo}
          step={step}
          shown={shown}
          states={states}
          language={ctx.language}
        />
      ) : null}
      {algorithm === "binary-search" && bounds && shown.low ? (
        <Bracket
          ctx={ctx}
          state={states.low}
          geo={geo}
          x={gapCentre(geo, bounds.low) + offset}
          side={1}
          partName="low"
        />
      ) : null}
      {algorithm === "binary-search" && bounds && shown.high ? (
        <Bracket
          ctx={ctx}
          state={states.high}
          geo={geo}
          x={gapCentre(geo, bounds.high + 1) - offset}
          side={-1}
          partName="high"
        />
      ) : null}
      {shown.compare ? (
        <Compare
          ctx={ctx}
          state={states.compare}
          geo={geo}
          step={step}
          target={searching ? target : undefined}
          language={ctx.language}
        />
      ) : null}
      {shown.swap ? <Swap ctx={ctx} state={states.swap} geo={geo} step={step} /> : null}
      {shown.mid ? <Pointer ctx={ctx} state={states.mid} geo={geo} step={step} /> : null}
      {states.counter.visible && total > 0 ? (
        <Text
          ctx={ctx}
          state={states.counter}
          x={geo.x0 + arrayWidth(geo)}
          y={geo.readoutY}
          size={geo.labelSize}
          fill={ctx.theme.ink}
          anchor="end"
          partName="counter"
        >
          {`${index}/${total}`}
        </Text>
      ) : null}
    </g>
  );
}
