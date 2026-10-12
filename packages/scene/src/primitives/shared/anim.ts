import type { SceneContext } from "../../composition/context";
import type { ElementState } from "../../composition/state";
import { sceneMetrics } from "../../tokens";

const LABEL_AFTER_DRAW = 0.8;

export function drawStyle(
  state: ElementState,
  length: number,
): { strokeDasharray?: number; strokeDashoffset?: number } {
  if (state.how !== "draw" || state.progress >= 1) return {};
  return { strokeDasharray: length, strokeDashoffset: length * (1 - state.progress) };
}

export function labelOpacity(state: ElementState): number {
  if (state.how !== "draw") return state.opacity;
  const appear = Math.min(
    1,
    Math.max(0, (state.progress - LABEL_AFTER_DRAW) / (1 - LABEL_AFTER_DRAW)),
  );
  return appear * state.opacity;
}

export function labelRise(ctx: Pick<SceneContext, "u">, state: ElementState): number {
  const appear =
    state.how === "draw" ? labelOpacity(state) / Math.max(state.opacity, 1e-6) : state.progress;
  return (1 - Math.min(1, appear)) * sceneMetrics.labelRise * ctx.u;
}

export function typedText(text: string, state: ElementState): string {
  if (state.how !== "type" || state.progress >= 1) return text;
  return [...text].slice(0, Math.ceil([...text].length * state.progress)).join("");
}
