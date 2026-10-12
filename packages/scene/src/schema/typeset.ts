import type { Language } from "../expr";

const NBSP = " ";
const NARROW_NBSP = " ";

const TEXT_KEYS: ReadonlySet<string> = new Set([
  "title",
  "text",
  "detail",
  "columns",
  "items",
  "rows",
  "narration",
  "notes",
  "objective",
  "prerequisites",
  "name",
  "mapping",
  "statement",
  "intent",
  "visual",
  "prompt",
  "explanation",
  "reason",
]);

const UNIT_AHEAD = "(?=[A-Za-zµΩ°%]{1,3}(?![A-Za-zÀ-ÿ]))";
const APOSTROPHE = /(?<=\p{L})'(?=\p{L})/gu;
const DIGIT_GROUP = /(?<=\d) (?=\d{3}(?!\d))/g;
const NUMBER_UNIT = new RegExp(`(?<=\\d) ${UNIT_AHEAD}`, "g");
const VALUE_UNIT = new RegExp(`(?<=\\}\\}) ${UNIT_AHEAD}`, "g");

export function typeset(text: string, language: Language): string {
  let out = text
    .replace(APOSTROPHE, "’")
    .replace(DIGIT_GROUP, NARROW_NBSP)
    .replace(NUMBER_UNIT, NBSP)
    .replace(VALUE_UNIT, NBSP);
  if (language === "fr") {
    out = out
      .replace(/ (?=:(?!\S))/g, NBSP)
      .replace(/ (?=[;!?»])/g, NARROW_NBSP)
      .replace(/(?<=«) /g, NARROW_NBSP);
  }
  return out;
}

function isTextKey(key: string): boolean {
  return TEXT_KEYS.has(key) || /label/i.test(key);
}

function walk(value: unknown, language: Language, isText: boolean): unknown {
  if (typeof value === "string") return isText ? typeset(value, language) : value;
  if (Array.isArray(value)) return value.map((item) => walk(item, language, isText));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, walk(child, language, isTextKey(key))]),
    );
  }
  return value;
}

export function typesetTexts<T>(value: T, language: Language): T {
  return walk(value, language, false) as T;
}
