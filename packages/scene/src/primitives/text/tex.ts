import type { SceneContext } from "../../composition/context";
import {
  DEFAULT_FORMAT,
  formatNumberParts,
  templateReferences,
  type TemplateReference,
} from "../../expr";

// .katex sets font-size: 1.21em and line-height: 1.2.
const KATEX_SCALE = 1.21;
const KATEX_LINE_EM = 1.2;
const STRUT = /class="katex-strut" style="height:([\d.]+)em;(?:vertical-align:(-?[\d.]+)em;)?"/g;

function texNumber(reference: TemplateReference, ctx: SceneContext): string {
  const value = ctx.scope[reference.id];
  if (value === undefined) throw new Error(`Unknown value "${reference.id}" in formula`);
  const format = reference.format ?? ctx.valueInfo(reference.id)?.format ?? DEFAULT_FORMAT;
  const parts = formatNumberParts(value, format, ctx.language);
  const mantissa = parts.mantissa.replaceAll(",", "{,}").replace(/[\u202F\u00A0]/g, "\\,");
  const exponent = parts.exponent === null ? "" : `\\times 10^{${parts.exponent}}`;
  const suffix = parts.suffix.replace(/\u202F/g, "\\,").replaceAll("%", "\\%");
  return `{${mantissa}${exponent}${suffix}}`;
}

export function texSource(tex: string, ctx: SceneContext): string {
  let source = tex;
  for (const reference of templateReferences(tex)) {
    source = source.replaceAll(reference.raw, texNumber(reference, ctx));
  }
  return source;
}

export function katexHeightEm(html: string): number {
  let above = 0;
  let below = 0;
  for (const strut of html.matchAll(STRUT)) {
    const depth = strut[2] === undefined ? 0 : -Number(strut[2]);
    above = Math.max(above, Number(strut[1]) - depth);
    below = Math.max(below, depth);
  }
  return Math.max(above + below, KATEX_LINE_EM) * KATEX_SCALE;
}
