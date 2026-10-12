import type { SceneContext } from "../../composition/context";
import type { Language, NumberParts } from "../../expr";
import type { ElementOf } from "../../schema/document";
import { ARROW_HEAD_U, textSize } from "../shared";
import { clamp, fixed, type Figure } from "./a-frame";
import { textWidth } from "./a-label";
import { niceTicks, tickParts } from "./a-ticks";
import { partsWidth } from "./a-value";

export const TICK_U = 0.8;
export const ARROW_BASE = 0.75;
export const PLATE_PAD_U = 0.4;

const LABEL_GAP_U = 0.7;
const NAME_OFFSET_U = 2.6;
const NAME_INSET_U = 1.4;
const NAME_TOP_U = 2.2;
const DEFAULT_TICKS = 5;
const LINE_HEIGHT = 1.25;
const SPACING = 1.3;
const ARROW_CLEARANCE = 1.25;
const EDGE = 0.5;
const BELOW_CENTRE = 0.45;
const ABOVE_CENTRE = 0.3;

type Anchor = "start" | "middle" | "end";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placed {
  x: number;
  y: number;
  anchor: Anchor;
  width: number;
}

export interface Tick {
  value: number;
  position: number;
  parts: NumberParts;
  label: Placed;
}

export interface AxisName extends Placed {
  text: string;
  anchor: "start" | "end";
}

export interface AxisHalf {
  id: string;
  d: string;
  length: number;
}

export interface AxesLayout {
  left: number;
  right: number;
  top: number;
  bottom: number;
  axisX: number;
  axisY: number;
  xTicks: Tick[];
  yTicks: Tick[];
  xName: AxisName | null;
  yName: AxisName | null;
  halves: AxisHalf[];
}

function boxOf(at: Placed, height: number): Box {
  const left =
    at.anchor === "start" ? at.x : at.anchor === "end" ? at.x - at.width : at.x - at.width / 2;
  return { left, right: left + at.width, top: at.y - height / 2, bottom: at.y + height / 2 };
}

function overlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

interface TickOptions {
  min: number;
  max: number;
  count: number;
  language: Language;
  position(value: number): number;
  span(parts: NumberParts): number;
}

interface RawTick {
  value: number;
  position: number;
  parts: NumberParts;
}

function fitTicks(options: TickOptions): RawTick[] {
  for (let count = options.count; count >= 1; count -= 1) {
    const set = niceTicks(options.min, options.max, count);
    const parts = tickParts(set, options.language);
    const ticks = set.values.map((value, i) => ({
      value,
      position: options.position(value),
      parts: parts[i] as NumberParts,
    }));
    const widest = Math.max(0, ...ticks.map((tick) => options.span(tick.parts)));
    const first = ticks[0];
    const second = ticks[1];
    const gap = first && second ? Math.abs(second.position - first.position) : Infinity;
    if (gap >= widest * SPACING) return ticks;
  }
  return [];
}

export function layoutAxes(
  element: ElementOf<"axes">,
  ctx: SceneContext,
  figure: Figure,
): AxesLayout {
  const { rect, projection, world } = figure;
  const { u } = ctx;
  const size = textSize(ctx, "min");
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const [originX, originY] = projection.toPx([0, 0]);
  const axisX = clamp(originX, left, right);
  const axisY = clamp(originY, top, bottom);
  const tickHalf = (TICK_U / 2) * u;
  const labelGap = LABEL_GAP_U * u;
  const pad = PLATE_PAD_U * u;
  const arrow = ARROW_HEAD_U * u;
  const clearance = arrow * ARROW_CLEARANCE;

  const xAll = fitTicks({
    min: world.x[0],
    max: world.x[1],
    count: element.xTicks ?? DEFAULT_TICKS,
    language: ctx.language,
    position: (value) => projection.toPx([value, 0])[0],
    span: (parts) => partsWidth(parts, size),
  });
  const yAll = fitTicks({
    min: world.y[0],
    max: world.y[1],
    count: element.yTicks ?? DEFAULT_TICKS,
    language: ctx.language,
    position: (value) => projection.toPx([0, value])[1],
    span: () => size * LINE_HEIGHT,
  });

  const xBelow = axisY + tickHalf + labelGap + size <= ctx.size.height;
  const yWidest = Math.max(0, ...yAll.map((tick) => partsWidth(tick.parts, size)));
  const yLeft = axisX - tickHalf - labelGap - yWidest >= 0;
  const yAxisCrossesXLabels = xBelow ? axisY < bottom - EDGE : axisY > top + EDGE;
  const xAxisCrossesYLabels = yLeft ? axisX > left + EDGE : axisX < right - EDGE;
  const zeroOnX = !yAxisCrossesXLabels;
  const zeroOnY = !xAxisCrossesYLabels && !zeroOnX;

  const xLabelY = xBelow
    ? axisY + tickHalf + labelGap + size * BELOW_CENTRE
    : axisY - tickHalf - labelGap - size * ABOVE_CENTRE;
  const xName: AxisName | null = element.xLabel
    ? {
        text: element.xLabel,
        x: right - 0.5 * u,
        y: axisY + (axisY - NAME_OFFSET_U * u - size / 2 >= 0 ? -1 : 1) * NAME_OFFSET_U * u,
        anchor: "end",
        width: textWidth(element.xLabel, size, true) + 2 * pad,
      }
    : null;
  const yNameWidth = textWidth(element.yLabel ?? "", size, true) + 2 * pad;
  const yNameRight = axisX + NAME_INSET_U * u + yNameWidth <= ctx.size.width;
  const yName: AxisName | null = element.yLabel
    ? {
        text: element.yLabel,
        x: axisX + (yNameRight ? 1 : -1) * NAME_INSET_U * u,
        y: top + NAME_TOP_U * u,
        anchor: yNameRight ? "start" : "end",
        width: yNameWidth,
      }
    : null;
  const nameBoxes = [xName, yName].flatMap((name) => (name ? [boxOf(name, size)] : []));
  const free = (label: Placed): boolean =>
    !nameBoxes.some((box) => overlap(box, boxOf({ ...label, width: label.width + 2 * pad }, size)));

  const xTicks = xAll
    .filter((tick) => (tick.value !== 0 || zeroOnX) && right - tick.position >= clearance)
    .map((tick): Tick => {
      const width = partsWidth(tick.parts, size);
      const anchor: Anchor =
        tick.position - width / 2 < 0
          ? "start"
          : tick.position + width / 2 > ctx.size.width
            ? "end"
            : "middle";
      return { ...tick, label: { x: tick.position, y: xLabelY, anchor, width } };
    })
    .filter((tick) => free(tick.label));
  const yTicks = yAll
    .filter(
      (tick) =>
        (tick.value !== 0 || zeroOnY) &&
        tick.position - top >= clearance &&
        tick.position - size * 0.5 >= 0 &&
        tick.position + size * 0.5 <= ctx.size.height,
    )
    .map((tick): Tick => ({
      ...tick,
      label: {
        x: yLeft ? axisX - tickHalf - labelGap : axisX + tickHalf + labelGap,
        y: tick.position,
        anchor: yLeft ? "end" : "start",
        width: partsWidth(tick.parts, size),
      },
    }))
    .filter((tick) => free(tick.label));

  const xEnd = right - arrow * ARROW_BASE;
  const yEnd = top + arrow * ARROW_BASE;
  const from = `M${fixed(axisX)},${fixed(axisY)}`;
  const halves: AxisHalf[] = [
    { id: "x+", d: `${from}L${fixed(xEnd)},${fixed(axisY)}`, length: xEnd - axisX },
    { id: "x-", d: `${from}L${fixed(left)},${fixed(axisY)}`, length: axisX - left },
    { id: "y+", d: `${from}L${fixed(axisX)},${fixed(yEnd)}`, length: axisY - yEnd },
    { id: "y-", d: `${from}L${fixed(axisX)},${fixed(bottom)}`, length: bottom - axisY },
  ].filter((half) => half.length > 0);

  return { left, right, top, bottom, axisX, axisY, xTicks, yTicks, xName, yName, halves };
}
