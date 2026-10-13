import type { SceneContext } from "../../composition/context";
import type { SceneElement } from "../../schema/document";
import { formulaHeight } from "./formula";
import { readoutHeight } from "./readout";
import { listHeight, textHeight } from "./support";

const MIN_SCALE = 0.6;
const SCALE_STEP = 0.05;

function blockHeight(element: SceneElement, ctx: SceneContext, width: number): number | null {
  switch (element.type) {
    case "text":
      return textHeight(element.text, ctx, width);
    case "list":
      return listHeight(element.items, ctx, width);
    case "readout":
      return readoutHeight(element, ctx, width);
    case "formula":
      return formulaHeight(element.tex, ctx);
    default:
      return null;
  }
}

// Blocks stacked in a slot are scaled down together when they would run past its height.
// A scaled stack is laid out wider, so its lines hold more text: the height is estimated
// again at each scale.
export function stackScale(
  elements: readonly SceneElement[],
  ctx: SceneContext,
  gap: number,
): number {
  const heightAt = (scale: number): number | null => {
    let total = (elements.length - 1) * gap;
    for (const element of elements) {
      const height = blockHeight(element, ctx, ctx.size.width / scale);
      if (height === null) return null;
      total += height;
    }
    return total * scale;
  };
  for (let scale = 1; scale > MIN_SCALE; scale -= SCALE_STEP) {
    const height = heightAt(scale);
    if (height === null || height <= ctx.size.height) return scale;
  }
  return MIN_SCALE;
}
