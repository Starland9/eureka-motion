import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { messages } from "@/i18n/messages";

const MESSAGES_DIR = path.resolve(import.meta.dirname, "../../messages");
const LOCALES = ["fr", "en"] as const;
// French agrees the participle with the kind of the thing checked; English needs no such argument.
const FRENCH_AGREEMENT = /^Colophon\.verification\.status\./;

const filesOf = (locale: string): string[] =>
  readdirSync(path.join(MESSAGES_DIR, locale)).filter((file) => file.endsWith(".json"));

const readFile = (locale: string, file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(MESSAGES_DIR, locale, file), "utf8"));

function leaves(tree: unknown, trail = ""): [string, string][] {
  if (typeof tree === "string") return [[trail, tree]];
  if (typeof tree === "object" && tree !== null) {
    return Object.entries(tree).flatMap(([key, value]) =>
      leaves(value, trail === "" ? key : `${trail}.${key}`),
    );
  }
  return [[trail, String(tree)]];
}

// Names of the ICU arguments and rich-text tags a message needs from its caller.
function placeholders(message: string): string[] {
  const names = new Set<string>();
  const scan = (text: string): void => {
    let depth = 0;
    let start = 0;
    for (const [index, char] of [...text].entries()) {
      if (char === "{") {
        if (depth === 0) start = index + 1;
        depth += 1;
      } else if (char === "}" && depth > 0) {
        depth -= 1;
        if (depth === 0) argument([...text].slice(start, index).join(""));
      }
    }
  };
  const argument = (body: string): void => {
    const [name = "", type = "", ...rest] = body.split(",");
    names.add(name.trim());
    if (/^\s*(plural|select|selectordinal)\s*$/.test(type)) {
      let depth = 0;
      let option = "";
      for (const char of rest.join(",")) {
        if (char === "{") depth += 1;
        if (depth > 0) option += char;
        if (char === "}" && --depth === 0) {
          scan(option.slice(1, -1));
          option = "";
        }
      }
    }
  };
  scan(message);
  for (const tag of message.matchAll(/<(\w+)>/g)) names.add(`<${tag[1]}>`);
  return [...names].sort();
}

describe("the placeholder scanner", () => {
  it("reads arguments, plural and select options, and tags", () => {
    expect(placeholders("Aucun argument.")).toEqual([]);
    expect(placeholders("{a} et {b}")).toEqual(["a", "b"]);
    expect(placeholders("{n, plural, one {# scène sur {total}} other {# scènes}}")).toEqual([
      "n",
      "total",
    ]);
    expect(placeholders("[{kind, select, plan {validé} other {validée}}]")).toEqual(["kind"]);
    expect(placeholders("Scène <n>{number}</n>")).toEqual(["<n>", "number"]);
  });
});

describe("translation files", () => {
  it("exist in both languages under the same names", () => {
    expect(filesOf("en")).toEqual(filesOf("fr"));
  });

  it.each(filesOf("fr"))(
    "%s declares the same namespaces in both languages, all loaded",
    (file) => {
      expect(Object.keys(readFile("en", file))).toEqual(Object.keys(readFile("fr", file)));
      for (const locale of LOCALES) {
        for (const namespace of Object.keys(readFile(locale, file))) {
          expect(messages[locale], `${locale}/${file}`).toHaveProperty(namespace);
        }
      }
    },
  );

  it("give every message the same arguments and tags in French and in English", () => {
    const en = new Map(leaves(messages.en));
    const mismatches = leaves(messages.fr)
      .map(([key, fr]) => ({ key, fr: placeholders(fr), en: placeholders(en.get(key) ?? "") }))
      .filter(({ key, fr, en }) =>
        FRENCH_AGREEMENT.test(key)
          ? en.some((name) => !fr.includes(name))
          : fr.join() !== en.join(),
      );
    expect(mismatches).toEqual([]);
  });

  it("keep the French typography in the French messages", () => {
    const faults = leaves(messages.fr).flatMap(([key, text]) => {
      const found: string[] = [];
      if (/ [:;!?]/.test(text)) found.push("regular space before : ; ! ?");
      if (/«[^\u00a0\u202f]|[^\u00a0\u202f]»/.test(text)) found.push("no no-break space in « »");
      if (text.includes("'")) found.push("straight apostrophe");
      return found.map((fault) => `${key}: ${fault}`);
    });
    expect(faults).toEqual([]);
  });

  it("keep French guillemets out of the English messages", () => {
    expect(leaves(messages.en).filter(([, text]) => /[«»]/.test(text))).toEqual([]);
  });
});
