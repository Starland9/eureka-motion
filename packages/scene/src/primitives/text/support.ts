import type { SceneContext } from "../../composition/context";
import { templateReferences, type NumberFormat } from "../../expr";
import type { SceneColour } from "../../tokens";
import { colourOf, px, textSize } from "../shared";

export const LINE_HEIGHT = 1.3;
export const BLOCK_GAP_EM = 0.45;
const READING_UNITS = 6;
const FIT_STEP_UNITS = 0.5;
const NUMERAL_COLUMN_EM = 1.25;
// Average advance of STIX Two Text in French prose, plus slack for ragged line ends.
const CHARACTER_EM = 0.44;
const WRAP_SLACK = 1.1;
// Width stand-in for a {{value}}, so the size does not change while a slider moves.
const INTERPOLATION_CHARS = 8;

const charactersOf = (text: string): number =>
  text.replace(/\{\{[^}]*\}\}/g, "0".repeat(INTERPOLATION_CHARS)).length;

export function formatsOf(ctx: SceneContext, source: string): Record<string, NumberFormat> {
  const formats: Record<string, NumberFormat> = {};
  for (const reference of templateReferences(source)) {
    const info = ctx.valueInfo(reference.id);
    if (info) formats[reference.id] = info.format;
  }
  return formats;
}

export function textColour(ctx: SceneContext, role: SceneColour | undefined): string {
  if (role === "action") return ctx.theme.role.actionText;
  if (role === "result") return ctx.theme.ink;
  return colourOf(ctx, role);
}

export function numeralColumn(ctx: SceneContext): number {
  return textSize(ctx, "label") * NUMERAL_COLUMN_EM;
}

function linesOf(length: number, width: number, size: number): number {
  return Math.max(1, Math.ceil((length * CHARACTER_EM * WRAP_SLACK * size) / width));
}

export function textHeight(text: string, ctx: SceneContext, width = ctx.size.width): number {
  const size = readingSize(ctx);
  return linesOf(charactersOf(text), width, size) * size * LINE_HEIGHT;
}

export function listHeight(
  items: readonly string[],
  ctx: SceneContext,
  slotWidth = ctx.size.width,
): number {
  const size = readingSize(ctx);
  const width = slotWidth - numeralColumn(ctx);
  const lines = items.reduce((sum, item) => sum + linesOf(charactersOf(item), width, size), 0);
  return lines * size * LINE_HEIGHT + (items.length - 1) * BLOCK_GAP_EM * size;
}

// Reading size of the text and list elements that share this slot: large enough for the
// slot, small enough for all of them to fit its height together.
export function readingSize(ctx: SceneContext): number {
  const floor = textSize(ctx, "body");
  const nominal = ctx.slot === "text" ? px(ctx, READING_UNITS) : floor;
  const blocks: { length: number; width: number }[] = [];
  for (const element of ctx.lookup.values()) {
    if (element.slot !== ctx.slot) continue;
    if (element.type === "text") {
      blocks.push({ length: charactersOf(element.text), width: ctx.size.width });
    }
    if (element.type === "list") {
      for (const item of element.items) {
        blocks.push({ length: charactersOf(item), width: ctx.size.width - numeralColumn(ctx) });
      }
    }
  }
  const heightAt = (size: number): number => {
    const lines = blocks.reduce((sum, block) => sum + linesOf(block.length, block.width, size), 0);
    return lines * size * LINE_HEIGHT + (blocks.length - 1) * BLOCK_GAP_EM * size;
  };
  for (let size = nominal; size > floor; size -= px(ctx, FIT_STEP_UNITS)) {
    if (heightAt(size) <= ctx.size.height) return size;
  }
  return floor;
}
