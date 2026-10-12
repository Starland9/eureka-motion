import type { SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { TIME_IDENTIFIER, type Scope } from "../../expr";
import type { ElementOf } from "../../schema/document";
import type { Rect } from "../../layouts";
import { plotDomain, samplePlot, type Vec } from "../../schema/geometry";
import { drawStyle } from "../shared";
import { clamp, clamp01, fixed, type Figure } from "./a-frame";

const SAMPLE_SPACING_PX = 3;
const MIN_SAMPLES = 48;
const MAX_SAMPLES = 900;
const OFF_FRAME_PX = 0.5;
const JUMP_IN_FRAMES = 2;
const BACK_LOOK_U = 1.5;

export type Run = Vec[];

export function plotElement(ctx: SceneContext, id: string): ElementOf<"plot"> | null {
  const element = ctx.lookup.get(id);
  return element?.type === "plot" ? element : null;
}

export function plotScope(ctx: SceneContext, plotId: string): Scope {
  return { ...ctx.scope, [TIME_IDENTIFIER]: ctx.state.simTime(plotId) };
}

export function plotRange(
  plot: ElementOf<"plot">,
  scope: Scope,
  figure: Figure,
): [number, number] | null {
  const [from, to] = plotDomain(plot, figure.world, scope);
  const range: [number, number] = [
    Math.max(from, figure.world.x[0]),
    Math.min(to, figure.world.x[1]),
  ];
  return range[0] < range[1] ? range : null;
}

export function sampleCurve(
  fn: string,
  range: readonly [number, number],
  scope: Scope,
  figure: Figure,
): Run[] {
  const { projection, rect, world } = figure;
  const samples = clamp(
    Math.ceil(((range[1] - range[0]) * projection.scale) / SAMPLE_SPACING_PX),
    MIN_SAMPLES,
    MAX_SAMPLES,
  );
  const reach = OFF_FRAME_PX * rect.height;
  const jump = JUMP_IN_FRAMES * (world.y[1] - world.y[0]);
  const runs: Run[] = [];
  let run: Run = [];
  let previous: Vec | null = null;
  const close = (): void => {
    if (run.length > 1) runs.push(run);
    run = [];
  };
  for (const point of samplePlot(fn, range, scope, samples)) {
    if (!Number.isFinite(point[1])) {
      close();
      previous = null;
      continue;
    }
    // A sign change over more than two frame heights is an asymptote, not a line.
    if (previous && previous[1] * point[1] < 0 && Math.abs(point[1] - previous[1]) > jump) {
      close();
    }
    const [x, y] = projection.toPx(point);
    // Clamped so that off-frame values never put huge coordinates in the path.
    run.push([x, clamp(y, rect.y - reach, rect.y + rect.height + reach)]);
    previous = point;
  }
  close();
  return runs;
}

export function pathData(run: Run): string {
  return run.map(([x, y], i) => `${i === 0 ? "M" : "L"}${fixed(x)},${fixed(y)}`).join("");
}

export function regionData(run: Run, base: number): string {
  const first = run[0] as Vec;
  const last = run[run.length - 1] as Vec;
  const edge = (x: number): string => `${fixed(x)},${fixed(base)}`;
  return `M${edge(first[0])}${pathData(run).replace("M", "L")}L${edge(last[0])}Z`;
}

export function runLength(run: Run): number {
  let total = 0;
  for (let i = 1; i < run.length; i += 1) {
    const a = run[i - 1] as Vec;
    const b = run[i] as Vec;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

export function traceStyles(
  state: ElementState,
  lengths: readonly number[],
): ReturnType<typeof drawStyle>[] {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let before = 0;
  return lengths.map((length) => {
    const done = length > 0 ? clamp01((state.progress * total - before) / length) : 1;
    before += length;
    return drawStyle({ ...state, progress: done }, length);
  });
}

export interface CurveEnd {
  at: Vec;
  from: Vec;
}

export function visibleEnd(runs: readonly Run[], figure: Figure, u: number): CurveEnd | null {
  const { rect } = figure;
  const inside = ([x, y]: Vec): boolean =>
    x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  for (let r = runs.length - 1; r >= 0; r -= 1) {
    const run = runs[r] as Run;
    for (let i = run.length - 1; i >= 0; i -= 1) {
      const at = run[i] as Vec;
      if (!inside(at)) continue;
      let j = i;
      while (
        j > 0 &&
        Math.hypot(at[0] - (run[j] as Vec)[0], at[1] - (run[j] as Vec)[1]) < BACK_LOOK_U * u
      ) {
        j -= 1;
      }
      return { at, from: run[j] as Vec };
    }
  }
  return null;
}

export interface EndLabel {
  x: number;
  y: number;
  anchor: "start" | "end";
}

export function endLabel(
  end: CurveEnd,
  width: number,
  height: number,
  gap: number,
  rect: Rect,
): EndLabel {
  const bottom = rect.y + rect.height;
  if (end.at[0] + gap + width <= rect.x + rect.width) {
    const y = clamp(end.at[1], rect.y + height / 2, bottom - height / 2);
    return { x: end.at[0] + gap, y, anchor: "start" };
  }
  const lift = height / 2 + gap;
  const roomAbove = end.at[1] - lift >= rect.y;
  const roomBelow = end.at[1] + lift <= bottom;
  const rising = end.from[1] >= end.at[1];
  const above = rising ? roomAbove || !roomBelow : !roomBelow && roomAbove;
  return { x: end.at[0], y: end.at[1] + (above ? -lift : lift), anchor: "end" };
}
