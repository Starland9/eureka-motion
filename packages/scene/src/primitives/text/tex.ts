import katex from "katex";
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

interface KatexNode {
  classes?: string[];
  children?: KatexNode[];
  text?: string;
  width?: number;
  italic?: number;
  style?: Record<string, string | undefined>;
}

type TreeRenderer = (source: string, options: Record<string, unknown>) => KatexNode;

// Size multipliers of KaTeX's \tiny … \Huge scale, indexed by its sizeN classes.
const SIZES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488];
const ZERO_WIDTH = new Set(["katex-strut", "pstrut", "vlist-s"]);
const WIDTH_CACHE_LIMIT = 500;
const widthCache = new Map<string, number>();

function emOf(value: string | undefined): number {
  const match = /^(-?[\d.]+)em$/.exec(value ?? "");
  return match ? Number(match[1]) : 0;
}

// KaTeX merges a run of \text letters into one node whose width is that of its first letter.
// Advance widths of KaTeX_Main-Regular (Computer Modern), in em.
const LOWER = [
  0.5, 0.556, 0.444, 0.556, 0.444, 0.306, 0.5, 0.556, 0.278, 0.306, 0.528, 0.278, 0.833, 0.556, 0.5,
  0.556, 0.528, 0.392, 0.394, 0.389, 0.556, 0.528, 0.722, 0.528, 0.528, 0.444,
];
const UPPER = [
  0.75, 0.708, 0.722, 0.764, 0.681, 0.653, 0.785, 0.75, 0.361, 0.514, 0.778, 0.625, 0.917, 0.75,
  0.778, 0.681, 0.778, 0.736, 0.556, 0.722, 0.75, 0.75, 1.028, 0.75, 0.75, 0.611,
];
const NARROW = new Set([".", ",", ":", ";", "'", "’", "!", "|"]);

function letterEm(letter: string): number {
  const base = letter.normalize("NFD")[0] ?? letter;
  const code = base.charCodeAt(0);
  if (code >= 97 && code <= 122) return LOWER[code - 97]!;
  if (code >= 65 && code <= 90) return UPPER[code - 65]!;
  if (/\s/.test(base)) return 0.333;
  if (/\d/.test(base)) return 0.5;
  if (NARROW.has(base)) return 0.278;
  if (base === "-" || base === "(" || base === ")") return 0.389;
  return 0.6;
}

function nodeWidthEm(node: KatexNode, scale: number): number {
  const classes = node.classes ?? [];
  if (classes.some((name) => ZERO_WIDTH.has(name))) return 0;
  const own =
    emOf(node.style?.marginLeft) + emOf(node.style?.marginRight) + emOf(node.style?.width);
  if (node.text !== undefined) {
    const letters = [...node.text];
    const glyphs =
      letters.length === 1 && node.width !== undefined
        ? node.width + (node.italic ?? 0)
        : letters.reduce((total, letter) => total + letterEm(letter), 0);
    return (glyphs + own) * scale;
  }
  let inner = scale;
  const reset = classes.find((name) => name.startsWith("reset-size"));
  const size = classes.find((name) => /^size\d+$/.test(name));
  if (reset && size) {
    inner = (scale * SIZES[Number(size.slice(4)) - 1]!) / SIZES[Number(reset.slice(10)) - 1]!;
  }
  const widths = (node.children ?? []).map((child) => nodeWidthEm(child, inner));
  const content = classes.includes("vlist")
    ? Math.max(0, ...widths)
    : widths.reduce((total, width) => total + width, 0);
  return own * scale + content;
}

export function katexWidthEm(source: string, options: Record<string, unknown>): number {
  const cached = widthCache.get(source);
  if (cached !== undefined) return cached;
  const render = (katex as unknown as { __renderToHTMLTree: TreeRenderer }).__renderToHTMLTree;
  const width = nodeWidthEm(render(source, { ...options, displayMode: true }), 1) * KATEX_SCALE;
  if (widthCache.size >= WIDTH_CACHE_LIMIT) widthCache.delete(widthCache.keys().next().value!);
  widthCache.set(source, width);
  return width;
}
