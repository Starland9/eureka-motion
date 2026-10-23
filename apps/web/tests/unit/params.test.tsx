import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentSchema, type Param } from "scene";
import { describe, expect, it, vi } from "vitest";
import { Params, type ParamsProps } from "@/components/controls/Params";
import {
  clampToRange,
  commitEntry,
  currentValue,
  deriveResults,
  editText,
  formatResult,
  formatValue,
  fractionOf,
  parseEntry,
  snapToStep,
  type ParamResult,
} from "@/components/controls/params-values";
import { messages } from "@/i18n/messages";
import reference from "../../../../content/reference/physics.universal-gravitation.fr.json";

const NNBSP = String.fromCharCode(0x202f);
const document = DocumentSchema.parse(reference.payload);
const [mass, moon, distance] = document.params as [Param, Param, Param];

function plain(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function render(locale: "fr" | "en", props: Partial<ParamsProps> = {}): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <Params
        params={document.params}
        values={{}}
        results={deriveResults(document.params, document.model, {})}
        onChange={vi.fn()}
        onReset={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map((match) => match[0]);
}

function textNodes(html: string): string[] {
  return [...html.matchAll(/>([^<]+)</g)].map((match) => plain(match[1] ?? "")).filter(Boolean);
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return plain(match?.[1] ?? "");
}

const ranges = (html: string) => tags(html, "input").filter((tag) => /type="range"/.test(tag));
const fields = (html: string) => tags(html, "input").filter((tag) => /type="text"/.test(tag));

describe("Params rendering", () => {
  it("renders nothing when there is no parameter", () => {
    expect(render("fr", { params: [], results: [] })).toBe("");
    expect(render("en", { params: [] })).toBe("");
  });

  it("renders one row per parameter, with symbol, name, unit and value", () => {
    const html = render("fr");
    expect(html.match(/<li\b/g)?.length).toBeGreaterThanOrEqual(document.params.length);
    expect(ranges(html)).toHaveLength(3);
    expect(fields(html)).toHaveLength(3);
    const text = textNodes(html);
    for (const param of document.params) {
      expect(text, param.id).toContain(param.symbol);
      expect(text, param.id).toContain(param.label);
      expect(text, param.id).toContain(param.unit);
    }
    expect(fields(html).map((tag) => attribute(tag, "value"))).toEqual([
      "5,97 × 10²⁴",
      "7,35 × 10²²",
      "3,84 × 10⁸",
    ]);
  });

  it("writes the symbol in italics, apart from its name", () => {
    const html = render("fr");
    expect(html).toMatch(/<i class="[^"]*">m₁<\/i>Masse de la Terre/);
    expect(html).toMatch(/<i class="[^"]*">r<\/i>Distance entre les centres/);
  });

  it("uses the comma in French and the point in English, in the field and in the announcement", () => {
    const fr = render("fr");
    const en = render("en");
    expect(ranges(fr).map((tag) => attribute(tag, "aria-valuetext"))).toEqual([
      "5,97 × 10²⁴ kg",
      "7,35 × 10²² kg",
      "3,84 × 10⁸ m",
    ]);
    expect(ranges(en).map((tag) => attribute(tag, "aria-valuetext"))).toEqual([
      "5.97 × 10²⁴ kg",
      "7.35 × 10²² kg",
      "3.84 × 10⁸ m",
    ]);
    expect(attribute(fields(en)[0]!, "value")).toBe("5.97 × 10²⁴");
    expect(textNodes(fr)).toContain("1,2 × 10²⁵");
    expect(textNodes(en)).toContain("1.2 × 10²⁵");
  });

  it("gives every range its bounds and step, and the grid value nearest to the current one", () => {
    const [first, , third] = ranges(render("fr")) as [string, string, string];
    expect(attribute(first, "min")).toBe("1e+24");
    expect(attribute(first, "max")).toBe("1.2e+25");
    expect(attribute(first, "step")).toBe("1e+23");
    expect(attribute(first, "value")).toBe("6e+24");
    expect(attribute(first, "aria-valuetext")).toBe("5,97 × 10²⁴ kg");
    expect(attribute(third, "value")).toBe("385000000");
  });

  it("names every range with its visible label, and every field with it plus 'direct entry'", () => {
    const html = render("fr");
    const labels = [...html.matchAll(/<label\b([^>]*)>/g)].map((match) => match[1] ?? "");
    const rangeIds = ranges(html).map((tag) => attribute(tag, "id"));
    expect(labels.map((tag) => attribute(`<label${tag}>`, "for"))).toEqual(rangeIds);
    const entryTag = messages.fr.Params.entryTag;
    expect(html.match(new RegExp(`>${entryTag}<`, "g"))).toHaveLength(3);
    for (const tag of fields(html)) {
      const refs = attribute(tag, "aria-labelledby").split(" ");
      expect(refs).toHaveLength(2);
      expect(html).toContain(`id="${refs[0]}"`);
      expect(html).toContain(`id="${refs[1]}"`);
      expect(tag).toContain('inputMode="decimal"');
      expect(attribute(tag, "aria-describedby")).not.toBe("");
    }
    expect(textNodes(html)).toContain(
      plain(
        messages.fr.Params.entryRange
          .replace("{min}", "1 × 10²⁴ kg")
          .replace("{max}", "1,2 × 10²⁵ kg"),
      ),
    );
  });

  it("hides the graduated ruler from assistive technology and keeps the controls out of it", () => {
    const html = render("fr");
    for (const tag of ranges(html)) expect(tag).not.toContain("aria-hidden");
    for (const tag of fields(html)) expect(tag).not.toContain("aria-hidden");
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2 * document.params.length);
    const major = html.match(/class="[^"]*\bh-3\b[^"]*"/g) ?? [];
    expect(major).toHaveLength(3 * document.params.length);
    expect(html.match(/bg-role-quantity/g)?.length).toBeGreaterThan(document.params.length);
  });

  it("offers a native 44 px range, a 44 px field and a link-styled reset button", () => {
    const html = render("fr");
    for (const tag of ranges(html)) expect(attribute(tag, "class")).toMatch(/\bh-11\b/);
    for (const tag of fields(html)) expect(attribute(tag, "class")).toMatch(/\btouch-target\b/);
    const [button] = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
    expect(button).toBeDefined();
    expect(button![0]).toContain('type="button"');
    expect(button![0]).toMatch(/data-variant="link"/);
    expect(plain(button![1] ?? "")).toBe("Réinitialiser");
  });

  it("titles the section and links it to its heading", () => {
    const html = render("fr");
    const section = tags(html, "section")[0]!;
    const heading = /<h2 id="([^"]*)"[^>]*>([^<]*)<\/h2>/.exec(html)!;
    expect(attribute(section, "aria-labelledby")).toBe(heading[1]);
    expect(heading[2]).toBe("Fais varier");
    expect(/<h2[^>]*>([^<]*)<\/h2>/.exec(render("en"))![1]).toBe(messages.en.Params.title);
    expect(html).toContain('role="status"');
  });

  it("clamps the values it is given and falls back on the default", () => {
    const html = render("fr", { values: { m1: 9e99, m2: Number.NaN, r: -5 } });
    expect(fields(html).map((tag) => attribute(tag, "value"))).toEqual([
      "1,2 × 10²⁵",
      "7,35 × 10²²",
      "1,5 × 10⁸",
    ]);
  });

  it("follows the given values", () => {
    const html = render("fr", { values: { m1: 8e24, r: 4e8 } });
    expect(attribute(ranges(html)[0]!, "value")).toBe("8e+24");
    expect(attribute(ranges(html)[0]!, "aria-valuetext")).toBe("8 × 10²⁴ kg");
    expect(attribute(fields(html)[2]!, "value")).toBe("4 × 10⁸");
  });
});

describe("Params results", () => {
  it("highlights the first result only, and lists the others below it", () => {
    const html = render("fr");
    expect(html.match(/bg-role-result/g)).toHaveLength(1);
    const output = /<output\b[^>]*>([\s\S]*?)<\/output>/.exec(html)!;
    expect(output[0]).toContain("bg-role-result");
    expect(textNodes(output[0])).toEqual(["F", "Force d'attraction", "1,99 × 10²⁰ N"]);
    const rest = html.slice(html.indexOf("</output>"));
    expect(textNodes(rest)).toEqual(
      expect.arrayContaining([
        "Distance",
        "384 000 km",
        "Force à distance double",
        "4,97 × 10¹⁹ N",
      ]),
    );
    expect(rest).not.toContain("bg-role-result");
    expect(html).toContain("dark:text-surface");
    expect(textNodes(html)).toContain(messages.fr.Params.results.title);
  });

  it("formats results with the language of the page", () => {
    expect(textNodes(render("en"))).toEqual(
      expect.arrayContaining(["1.99 × 10²⁰ N", "384,000 km", "4.97 × 10¹⁹ N"]),
    );
  });

  it("shows no result block when there is no result", () => {
    const html = render("fr", { results: [] });
    expect(html).not.toContain("<output");
    expect(html).not.toContain(messages.fr.Params.results.title);
    expect(html).not.toContain("bg-role-result");
    expect(ranges(html)).toHaveLength(3);
  });

  it("recomputes from the values", () => {
    const results = deriveResults(document.params, document.model, { r: 7.68e8 });
    expect(textNodes(render("fr", { values: { r: 7.68e8 }, results }))).toContain("4,97 × 10¹⁹ N");
  });
});

describe("Params design rules", () => {
  it("has no decoration: no icon, image, rounded corner, shadow, gradient or fixed size", () => {
    const html = render("fr");
    expect(html).not.toMatch(/<(svg|img|picture|canvas)\b/);
    expect(html).not.toMatch(/rounded|shadow|gradient|blur|ring-|backdrop|\bp-6\b/);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/font-(sans|serif)|\btext-\[|\bfont-\[|px\]/);
  });

  it.each(["fr", "en"] as const)("shows no hard-coded text in %s", (locale) => {
    const html = render(locale);
    const t = messages[locale].Params;
    const allowed = new Set<string>([
      t.title,
      t.reset,
      t.entryTag,
      t.results.title,
      ...document.params.flatMap((param) => [param.symbol, param.label, param.unit]),
      ...document.model.derived.flatMap((derived) => [
        derived.symbol ?? "",
        derived.label,
        derived.unit,
      ]),
    ]);
    const numeric = /^[\d\s.,×⁰¹²³⁴⁵⁶⁷⁸⁹⁻−-]+( (kg|m|N|km))?$/;
    const unknown = textNodes(html).filter(
      (text) =>
        !allowed.has(text) &&
        !numeric.test(text) &&
        !text.startsWith(plain(t.entryRange.split("{")[0] ?? "")),
    );
    expect(unknown).toEqual([]);
  });
});

describe("number entry", () => {
  it.each([
    ["5,97e24", "fr", 5.97e24],
    ["5.97e24", "fr", 5.97e24],
    ["5,97E24", "fr", 5.97e24],
    ["6,5 × 10^24", "fr", 6.5e24],
    ["6,5x10^24", "fr", 6.5e24],
    ["6,5 × 10²⁴", "fr", 6.5e24],
    ["2 × 10⁻³", "fr", 0.002],
    [`1${NNBSP}000,5`, "fr", 1000.5],
    ["−3", "fr", -3],
    ["  42  ", "fr", 42],
    [".5", "fr", 0.5],
    ["5.97e24", "en", 5.97e24],
    ["1,000.5", "en", 1000.5],
    ["6.5 × 10^24", "en", 6.5e24],
    ["1,5", "en", 15],
  ] as const)("reads %j in %s as %d", (text, language, expected) => {
    expect(parseEntry(text, language)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "abc",
    "1e",
    "e5",
    "--1",
    "1.2.3",
    "1,2,3",
    "5 × 10",
    "10^3",
    "NaN",
    "1e999",
  ])("rejects %j", (text) => {
    expect(parseEntry(text, "fr")).toBeNull();
  });

  it("keeps validated entries inside the bounds and says when it had to", () => {
    expect(commitEntry("99e30", mass, "fr")).toEqual({
      kind: "value",
      value: 1.2e25,
      clamped: true,
    });
    expect(commitEntry("0", mass, "fr")).toEqual({ kind: "value", value: 1e24, clamped: true });
    expect(commitEntry("5e24", mass, "fr")).toEqual({ kind: "value", value: 5e24, clamped: false });
    expect(commitEntry("1e24", mass, "fr")).toEqual({ kind: "value", value: 1e24, clamped: false });
    expect(commitEntry("1,2e25", mass, "fr")).toEqual({
      kind: "value",
      value: 1.2e25,
      clamped: false,
    });
    expect(commitEntry("pas un nombre", mass, "fr")).toEqual({ kind: "invalid" });
  });

  it("does not snap a typed value to the step", () => {
    expect(commitEntry("5,97e24", mass, "fr")).toEqual({
      kind: "value",
      value: 5.97e24,
      clamped: false,
    });
  });

  it.each([5.97e24, 7.35e22, 3.84e8, 1234, 0.25, 0, -2.5, 1e-7, 12345.678, 6e24])(
    "gives back %d from the text offered for editing",
    (value) => {
      for (const language of ["fr", "en"] as const) {
        expect(parseEntry(editText(value, language), language)).toBe(value);
      }
    },
  );

  it("offers a plain edit text, without grouping or superscripts", () => {
    expect(editText(5.97e24, "fr")).toBe("5,97e24");
    expect(editText(5.97e24, "en")).toBe("5.97e24");
    expect(editText(1234, "fr")).toBe("1234");
    expect(editText(12345.678, "en")).toBe("12345.678");
    expect(editText(0.002, "fr")).toBe("0,002");
  });
});

describe("value formatting and ruler arithmetic", () => {
  it("never hides a digit of the value", () => {
    expect(plain(formatValue(1234, "fr"))).toBe("1 234");
    expect(formatValue(1234, "en")).toBe("1,234");
    expect(formatValue(0.25, "fr")).toBe("0,25");
    expect(formatValue(0.125, "en")).toBe("0.125");
    expect(formatValue(10, "fr")).toBe("10");
    expect(formatValue(0, "fr")).toBe("0");
    expect(formatValue(-2.5, "fr")).toBe("−2,5");
    expect(formatValue(5.97e24, "fr")).toBe("5,97 × 10²⁴");
    expect(formatValue(4e8, "fr")).toBe("4 × 10⁸");
    expect(formatValue(1.5e-7, "fr")).toBe("1,5 × 10⁻⁷");
  });

  it("snaps to the step grid starting at the minimum", () => {
    expect(snapToStep(5.97e24, mass)).toBe(6e24);
    expect(snapToStep(5.94e24, mass)).toBe(5.9e24);
    expect(snapToStep(-1, mass)).toBe(mass.min);
    expect(snapToStep(1e99, mass)).toBe(mass.max);
    expect(snapToStep(9.9, { min: 0, max: 10, step: 3 })).toBe(9);
    expect(snapToStep(0.3, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  });

  it("measures the position on the ruler", () => {
    expect(fractionOf(mass.min, mass)).toBe(0);
    expect(fractionOf(mass.max, mass)).toBe(1);
    expect(fractionOf((distance.min + distance.max) / 2, distance)).toBeCloseTo(0.5);
    expect(fractionOf(99, { min: 1, max: 1 })).toBe(0);
    expect(clampToRange(5, { min: 0, max: 3 })).toBe(3);
  });

  it("reads the current value from the values, then from the default", () => {
    expect(currentValue(moon, {})).toBe(moon.default);
    expect(currentValue(moon, { m2: 5e22 })).toBe(5e22);
    expect(currentValue(moon, { m2: 1 })).toBe(moon.min);
    expect(currentValue(moon, { m2: Number.POSITIVE_INFINITY })).toBe(moon.default);
  });
});

describe("results from the model", () => {
  const { G } = { G: 6.674e-11 };

  it("computes the derived values of the reference explanation", () => {
    const results = deriveResults(document.params, document.model, {});
    expect(results.map((result) => result.id)).toEqual(["F", "r_km", "F_2r", "F_3r"]);
    const force = (G * mass.default * moon.default) / distance.default ** 2;
    expect(results[0]).toMatchObject({ symbol: "F", unit: "N", label: "Force d'attraction" });
    expect(results[0]!.value).toBeCloseTo(force, -15);
    expect(results[1]!.value).toBeCloseTo(384000, 6);
    expect(results[2]!.value).toBeCloseTo(force / 4, -15);
    expect(results[3]!.value).toBeCloseTo(force / 9, -15);
  });

  it("follows the values and keeps them inside the bounds", () => {
    const [double] = deriveResults(document.params, document.model, { r: 7.68e8 });
    const [clamped] = deriveResults(document.params, document.model, { r: 1e99 });
    const [atMax] = deriveResults(document.params, document.model, { r: distance.max });
    expect(double!.value).toBeCloseTo((G * mass.default * moon.default) / 7.68e8 ** 2, -15);
    expect(clamped!.value).toBe(atMax!.value);
  });

  it("leaves out the derived values that have no name", () => {
    const model = {
      ...document.model,
      derived: [...document.model.derived, { id: "tmp", expr: "m1 * 2", unit: "", label: "" }],
    };
    expect(deriveResults(document.params, model, {}).map((result) => result.id)).toEqual([
      "F",
      "r_km",
      "F_2r",
      "F_3r",
    ]);
  });

  it("formats a result with its format, and falls back on three significant digits", () => {
    const base: ParamResult = { id: "x", label: "x", unit: "", value: 1234.5678 };
    expect(formatResult({ ...base, format: "sci:2" }, "fr")).toBe("1,23 × 10³");
    expect(formatResult({ ...base, format: "int" }, "en")).toBe("1,235");
    expect(plain(formatResult({ ...base, format: "fixed:1" }, "fr"))).toBe("1 234,6");
    expect(plain(formatResult(base, "fr"))).toBe("1 230");
    expect(plain(formatResult({ ...base, format: "nonsense" }, "fr"))).toBe("1 230");
    expect(formatResult({ ...base, value: Number.NaN }, "fr")).toBe("—");
  });
});
