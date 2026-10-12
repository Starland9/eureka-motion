import { resolve, type Scope } from "../expr";
import type { Action, Scene } from "../schema/document";
import { resolvePoint, type Vec } from "../schema/geometry";
import { splitTarget } from "../schema/inspect";
import {
  ease,
  FPS,
  LEAVE_DURATION_RATIO,
  lerp,
  msToFrames,
  REDUCED_MOTION_FADE_MS,
  durationsMs,
} from "../tokens";
import type { SceneTiming } from "./timeline";

export type ShowHow = "fade" | "draw" | "type";

export interface ElementState {
  visible: boolean;
  opacity: number;
  progress: number;
  how: ShowHow;
  highlight: number;
  dim: number;
  move: { to: Vec; progress: number } | null;
}

export interface SceneState {
  beatIndex: number;
  beatProgress: number;
  paramValues: Readonly<Record<string, number>>;
  of(target: string): ElementState;
  simTime(elementId: string): number;
}

export const DIM_OPACITY = 0.35;
export const DEFAULT_SPREAD = 0.6;
const SWEEP_PHASES = { go: 0.42, stay: 0.2, back: 0.33 };
const SWEEP_HOLD_GO = 0.6;

const HIDDEN: ElementState = {
  visible: false,
  opacity: 0,
  progress: 0,
  how: "fade",
  highlight: 0,
  dim: 0,
  move: null,
};

interface Scheduled {
  action: Action;
  start: number;
  beatIndex: number;
  beatEnd: number;
}

export function scheduleActions(scene: Pick<Scene, "beats">, timing: SceneTiming): Scheduled[] {
  const scheduled: Scheduled[] = [];
  scene.beats.forEach((beat, beatIndex) => {
    const beatTiming = timing.beats[beatIndex];
    if (!beatTiming) return;
    const count = beat.actions.length;
    beat.actions.forEach((action, i) => {
      const fraction = action.at ?? (count <= 1 ? 0 : (i / count) * DEFAULT_SPREAD);
      scheduled.push({
        action,
        start: beatTiming.start + Math.round(fraction * beatTiming.duration),
        beatIndex,
        beatEnd: beatTiming.start + beatTiming.duration,
      });
    });
  });
  return scheduled;
}

export interface SceneStateInput {
  scene: Pick<Scene, "beats" | "elements">;
  timing: SceneTiming;
  frame: number;
  baseScope: Scope;
  params: Readonly<Record<string, number>>;
  fps?: number;
  reducedMotion?: boolean;
  disableSweeps?: boolean;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function computeSceneState(input: SceneStateInput): SceneState {
  const { scene, timing, baseScope, params } = input;
  const fps = input.fps ?? FPS;
  const reduced = input.reducedMotion ?? false;
  const frame = Math.min(Math.max(0, input.frame), Math.max(0, timing.duration - 1));
  const scheduled = scheduleActions(scene, timing).filter((item) => item.start <= frame);

  const frames = (ms: number): number => msToFrames(ms, fps);
  const showFrames = (how: ShowHow): number => {
    if (reduced) return frames(REDUCED_MOTION_FADE_MS);
    if (how === "draw") return frames(durationsMs.draw);
    if (how === "type") return frames(durationsMs.settle);
    return frames(durationsMs.base);
  };
  const hideFrames = Math.max(1, Math.round(frames(durationsMs.base) * LEAVE_DURATION_RATIO));

  const currentBeat =
    timing.beats.find((beat) => frame >= beat.start && frame < beat.start + beat.duration) ??
    timing.beats.at(-1);
  const beatIndex = currentBeat?.index ?? 0;
  const beatProgress = currentBeat
    ? clamp01((frame - currentBeat.start) / currentBeat.duration)
    : 0;

  const shown = new Map<string, { start: number; how: ShowHow }>();
  const hidden = new Map<string, number>();
  const highlighted = new Map<string, number>();
  const moved = new Map<string, { start: number; to: Vec }>();
  const played = new Map<string, { start: number; end: number; from: number; to: number }>();
  let focus: { start: number; keys: Set<string> } | null = null;
  const paramValues: Record<string, number> = { ...params };

  for (const item of scheduled) {
    const { action, start, beatEnd } = item;
    switch (action.do) {
      case "show":
        for (const target of action.targets) {
          shown.set(target, { start, how: reduced ? "fade" : (action.how ?? "fade") });
          hidden.delete(target);
        }
        break;
      case "hide":
        for (const target of action.targets) hidden.set(target, start);
        break;
      case "highlight":
        for (const target of action.targets) highlighted.set(target, start);
        break;
      case "focus":
        if (item.beatIndex === beatIndex) focus = { start, keys: new Set(action.targets) };
        break;
      case "move":
        moved.set(action.target, { start, to: resolvePoint(action.to, baseScope) });
        break;
      case "play":
        played.set(action.target, { start, end: beatEnd, from: action.from ?? 0, to: action.to });
        break;
      case "sweep": {
        if (input.disableSweeps || reduced) break;
        const base = paramValues[action.param] ?? (baseScope[action.param] as number | undefined);
        if (base === undefined) break;
        const target = resolve(action.to, baseScope);
        const span = Math.max(1, beatEnd - start);
        const t = clamp01((frame - start) / span);
        let k: number;
        if (action.hold) {
          k = ease("trace", t / SWEEP_HOLD_GO);
        } else if (frame >= beatEnd) {
          k = 0;
        } else if (t < SWEEP_PHASES.go) {
          k = ease("trace", t / SWEEP_PHASES.go);
        } else if (t < SWEEP_PHASES.go + SWEEP_PHASES.stay) {
          k = 1;
        } else {
          const back = (t - SWEEP_PHASES.go - SWEEP_PHASES.stay) / SWEEP_PHASES.back;
          k = back >= 1 ? 0 : 1 - ease("trace", back);
        }
        paramValues[action.param] = lerp(base, target, k);
        break;
      }
    }
  }

  const partsShownOf = (id: string): boolean => {
    for (const key of shown.keys()) if (splitTarget(key).id === id && key !== id) return true;
    return false;
  };

  const inFocus = (target: string): boolean => {
    if (!focus) return true;
    const { id, part } = splitTarget(target);
    if (focus.keys.has(target) || focus.keys.has(id)) return true;
    if (part === undefined) {
      for (const key of focus.keys) if (splitTarget(key).id === id) return true;
    }
    return false;
  };

  const of = (target: string): ElementState => {
    const { id, part } = splitTarget(target);
    const own = shown.get(target);
    const inherited = part === undefined ? undefined : shown.get(id);
    const show = own ?? inherited;
    const containerOnly = part === undefined && !own && partsShownOf(id);
    if (!show && !containerOnly) return HIDDEN;

    const how: ShowHow = show?.how ?? "fade";
    const raw = show ? clamp01((frame - show.start) / showFrames(how)) : 1;
    const progress =
      how === "draw" ? ease("trace", raw) : how === "type" ? raw : ease("arrive", raw);
    let opacity = how === "fade" ? progress : 1;

    const hideStart = hidden.get(target) ?? (part === undefined ? undefined : hidden.get(id));
    if (hideStart !== undefined && (!show || hideStart >= show.start)) {
      opacity *= 1 - ease("leave", clamp01((frame - hideStart) / hideFrames));
    }

    let dim = 0;
    if (focus && !inFocus(target)) {
      dim = ease("arrive", clamp01((frame - focus.start) / frames(durationsMs.fast)));
      opacity *= 1 - (1 - DIM_OPACITY) * dim;
    }

    const highlightStart =
      highlighted.get(target) ?? (part === undefined ? undefined : highlighted.get(id));
    const highlight =
      highlightStart === undefined
        ? 0
        : ease("arrive", clamp01((frame - highlightStart) / frames(durationsMs.base)));

    const moving = moved.get(id);
    const move = moving
      ? {
          to: moving.to,
          progress: reduced
            ? 1
            : ease("arrive", clamp01((frame - moving.start) / frames(durationsMs.slow))),
        }
      : null;

    return { visible: opacity > 0, opacity, progress, how, highlight, dim, move };
  };

  const simTime = (elementId: string): number => {
    const play = played.get(elementId);
    if (!play) return 0;
    const t = clamp01((frame - play.start) / Math.max(1, play.end - play.start));
    return lerp(play.from, play.to, reduced ? 1 : t);
  };

  return { beatIndex, beatProgress, paramValues, of, simTime };
}
