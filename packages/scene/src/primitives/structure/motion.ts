import type { SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { textSize } from "../shared";
import { longestWord } from "./measure";

const CAPTION_FROM = 0.4;

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function fadeOf(state: ElementState): number {
  return state.how === "type" ? state.opacity * state.progress : state.opacity;
}

interface Sequenced {
  opacity: number;
  trace: number;
  caption: number;
}

export function sequenced(
  part: ElementState,
  whole: ElementState,
  index: number,
  count: number,
): Sequenced {
  if (part.how !== "draw") return { opacity: fadeOf(part), trace: 1, caption: 1 };
  const progress =
    whole.how === "draw" ? clamp01((part.progress - index / count) * count) : part.progress;
  return {
    opacity: progress > 0 ? part.opacity : 0,
    trace: progress,
    caption: clamp01((progress - CAPTION_FROM) / (1 - CAPTION_FROM)),
  };
}

export function proseSize(
  ctx: SceneContext,
  texts: readonly string[],
  columnPx: number,
): "body" | "min" {
  if (ctx.slot === "notes") return "min";
  return longestWord(texts, textSize(ctx, "body")) <= columnPx ? "body" : "min";
}

export const partId = (prefix: string, index: number): string => `${prefix}${index + 1}`;
