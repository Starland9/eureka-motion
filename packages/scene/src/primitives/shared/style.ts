import type { SceneContext } from "../../composition/context";
import {
  fontStacks,
  resolveColour,
  sceneMetrics,
  type FontRole,
  type SceneColour,
} from "../../tokens";

export function px(ctx: Pick<SceneContext, "u">, units: number): number {
  return units * ctx.u;
}

export function strokeWidth(
  ctx: Pick<SceneContext, "u">,
  kind: keyof typeof sceneMetrics.stroke,
): number {
  return sceneMetrics.stroke[kind] * ctx.u;
}

export function textSize(
  ctx: Pick<SceneContext, "u">,
  kind: keyof typeof sceneMetrics.text,
): number {
  return sceneMetrics.text[kind] * ctx.u;
}

export function colourOf(
  ctx: Pick<SceneContext, "theme">,
  colour: SceneColour | undefined,
  fallback: SceneColour = "ink",
): string {
  return resolveColour(ctx.theme, colour ?? fallback);
}

export function strokeOf(
  ctx: Pick<SceneContext, "theme">,
  colour: SceneColour | undefined,
  fallback: SceneColour = "ink",
): string {
  const chosen = colour ?? fallback;
  return resolveColour(ctx.theme, chosen === "result" ? "ink" : chosen);
}

export function fontOf(role: FontRole): string {
  return fontStacks[role];
}
