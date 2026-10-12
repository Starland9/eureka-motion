import type { SceneContext } from "../../composition/context";
import { monoSafe, type SceneColour } from "../../tokens";
import { colourOf, textSize } from "../shared";
import type { Px } from "./b-geometry";

type Role = "ink" | "inkSoft" | "quantity" | "action" | "result" | "valid";

const MONO_ADVANCE = 0.6;
const ITALIC_ADVANCE = 0.5;
const TEXT_HEIGHT = 0.8;
const GAP_U = 0.6;
const GAP_OVER_BAND_U = 1.4;

export const BAND_WIDTH_U = 2.2;

export interface LabelBox {
  width: number;
  height: number;
}

export function labelBox(ctx: Pick<SceneContext, "u">, text: string, italic = false): LabelBox {
  const size = textSize(ctx, "label");
  return {
    width: [...text].length * size * (italic ? ITALIC_ADVANCE : MONO_ADVANCE),
    height: size * TEXT_HEIGHT,
  };
}

export function reach(box: LabelBox, direction: Px): number {
  return (box.width / 2) * Math.abs(direction[0]) + (box.height / 2) * Math.abs(direction[1]);
}

export function labelText(text: string, italic = false): string {
  return italic ? text : monoSafe(text);
}

function effective(role: Role | undefined, fallback: SceneColour): SceneColour {
  if (role === undefined) return fallback;
  return role === "result" ? "ink" : role;
}

export function lineColour(
  ctx: Pick<SceneContext, "theme">,
  role: Role | undefined,
  fallback: SceneColour = "ink",
): string {
  return colourOf(ctx, effective(role, fallback));
}

export function labelColour(role: Role | undefined, fallback: SceneColour = "ink"): SceneColour {
  const colour = effective(role, fallback);
  return colour === "action" ? "actionText" : colour;
}

export function clearance(ctx: Pick<SceneContext, "u">, highlight: number): number {
  return (GAP_U + (GAP_OVER_BAND_U - GAP_U) * highlight) * ctx.u;
}
