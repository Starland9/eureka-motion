import type { Scope } from "./evaluate";
import {
  DEFAULT_FORMAT,
  formatNumber,
  parseFormat,
  type Language,
  type NumberFormat,
} from "./format";

const REFERENCE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|\s*([a-z]+(?::\d{1,2})?)\s*)?\}\}/g;
const ANY_BRACES = /\{\{[^}]*\}\}/g;

export interface TemplateReference {
  id: string;
  format: NumberFormat | undefined;
  raw: string;
}

export function templateReferences(text: string): TemplateReference[] {
  const found: TemplateReference[] = [];
  const wellFormed = new Set<string>();
  for (const match of text.matchAll(REFERENCE)) {
    const raw = match[0];
    wellFormed.add(raw);
    found.push({
      id: match[1] as string,
      format: match[2] === undefined ? undefined : parseFormat(match[2]),
      raw,
    });
  }
  for (const match of text.matchAll(ANY_BRACES)) {
    if (!wellFormed.has(match[0])) {
      throw new Error(`Malformed interpolation ${match[0]}`);
    }
  }
  return found;
}

export interface InterpolateOptions {
  language: Language;
  formats?: Readonly<Record<string, NumberFormat>>;
}

export function interpolate(text: string, scope: Scope, options: InterpolateOptions): string {
  if (!text.includes("{{")) return text;
  return text.replace(REFERENCE, (_raw, id: string, spec: string | undefined) => {
    if (!Object.hasOwn(scope, id)) {
      throw new Error(`Unknown value "${id}" in text`);
    }
    const format =
      spec === undefined ? (options.formats?.[id] ?? DEFAULT_FORMAT) : parseFormat(spec);
    return formatNumber(scope[id] as number, format, options.language);
  });
}
