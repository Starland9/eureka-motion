import { createHash } from "node:crypto";
import type { Language } from "scene";

interface Patterns {
  lead: RegExp;
  trail: RegExp;
  rewrites: readonly (readonly [RegExp, string])[];
}

function patterns(
  leading: readonly string[],
  politeness: readonly string[],
  trailing: readonly string[],
  rewrites: Patterns["rewrites"] = [],
): Patterns {
  const end = String.raw`(?:(?=\s|$)|(?<='))\s*`;
  return {
    lead: new RegExp(String.raw`^(?:${[...leading, ...politeness].join("|")})${end}`, "u"),
    trail: new RegExp(String.raw`(?:^|\s)(?:${[...politeness, ...trailing].join("|")})$`, "u"),
    rewrites,
  };
}

const PATTERNS: Record<Language, Patterns> = {
  fr: patterns(
    [
      "je n'ai (?:pas|rien) compris(?: à)?",
      "j'ai (?:pas|rien) compris(?: à)?",
      "je ne comprends? (?:pas|rien)(?: à)?",
      "je comprends? (?:pas|rien)(?: à)?",
      "(?:peux[- ]tu|pouvez[- ]vous|pourrais[- ]tu|pourriez[- ]vous|tu peux|vous pouvez|tu pourrais|vous pourriez) (?:m'|me )?expliquer",
      "explique(?:z)?[- ]moi",
      "explique(?:z|r)?",
      "comment (?:fonctionn|march)(?:e|ent)",
      "qu'est[- ]ce (?:que c'est que|que c'est|que|qu')",
      "c'est quoi",
      "ce que c'est que",
      "ce que c'est",
      "ce qu'est",
    ],
    ["s'il (?:te|vous) pla[iî]t", "stp", "svp", "merci(?: d'avance| beaucoup)?"],
    ["c'est quoi"],
  ),
  en: patterns(
    [
      "i (?:do not|don't|dont|did not|didn't|didnt|can't|cant|cannot|can not) (?:really |quite )?(?:understand|get)",
      "(?:can|could|would|will) you (?:please )?explain(?: to me| me)?",
      "explain(?: to me| me)?",
      "what(?:'s|s| is| are)",
    ],
    ["please", "pls", "plz", "thanks(?: a lot)?", "thank you(?: very much)?"],
    [],
    [[/^how (?:does|do|did) (.+?) works?$/u, "$1"]],
  ),
};

const APOSTROPHES = /[‘’‛ʼ`´′]/gu;
const DASHES = /[\p{Pd}−]/gu;
const OTHER_PUNCTUATION = /(?![-'.,%/*])[\p{P}\p{C}]/gu;
const LOOSE_APOSTROPHE = /(?<![\p{L}\p{N}])'|'(?![\p{L}\p{N}])/gu;
const TRAILING_HYPHEN = /-(?![\p{L}\p{N}])/gu;
const LEADING_HYPHEN = /(?<![\p{L}\p{N}])-(?!\p{N})/gu;
const NON_DECIMAL_SEPARATOR = /(?<!\p{N})[.,]|[.,](?!\p{N})/gu;

function clean(text: string): string {
  return text
    .replace(APOSTROPHES, "'")
    .normalize("NFKC")
    .toLowerCase()
    .replace(DASHES, "-")
    .replace(OTHER_PUNCTUATION, " ")
    .replace(LOOSE_APOSTROPHE, " ")
    .replace(TRAILING_HYPHEN, " ")
    .replace(LEADING_HYPHEN, " ")
    .replace(NON_DECIMAL_SEPARATOR, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeQuestion(text: string, language: Language): string {
  const { lead, trail, rewrites } = PATTERNS[language];
  const cleaned = clean(text);
  let current = cleaned;
  for (;;) {
    let next = current.replace(lead, "").replace(trail, "").trim();
    for (const [pattern, replacement] of rewrites) next = next.replace(pattern, replacement);
    if (next === current) break;
    current = next;
  }
  return current || cleaned;
}

export function questionHash(text: string, language: Language): string {
  return createHash("sha256").update(normalizeQuestion(text, language), "utf8").digest("hex");
}
