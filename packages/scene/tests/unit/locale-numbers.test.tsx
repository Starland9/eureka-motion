// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScope, formatNumber, interpolate, parseFormat, type Language } from "../../src/expr";
import { DocumentSchema, type ExplanationDocument, type Scene } from "../../src/schema";
import { renderElement, testContext } from "../helpers/scene";

const REFERENCE = resolve(
  import.meta.dirname,
  "../../../../content/reference/physics.universal-gravitation.fr.json",
);
const document: ExplanationDocument = DocumentSchema.parse(
  JSON.parse(readFileSync(REFERENCE, "utf8")).payload,
);
const { params, model } = document;
const earthMoon = document.scenes.find((scene) => scene.id === "s5") as Scene;
const elementOf = (id: string) => earthMoon.elements.find((element) => element.id === id)!;

const NNBSP = String.fromCharCode(0x202f);
const LANGUAGES: Language[] = ["fr", "en"];

function render(id: string, language: Language, values: Record<string, number> = {}): string {
  const element = elementOf(id);
  const ctx = testContext({
    scene: earthMoon,
    slot: element.slot,
    params,
    model,
    values,
    language,
    frame: "end",
  });
  return renderElement(element, ctx).container.textContent ?? "";
}

describe("numbers in the scenes follow the language of the explanation", () => {
  it("writes the derived force of the reference document with the decimal separator of the language", () => {
    expect(render("value", "fr")).toBe("Force Terre-Lune : 1,99 × 10²⁰ N.");
    expect(render("value", "en")).toBe("Force Terre-Lune : 1.99 × 10²⁰ N.");
  });

  it("shows 1,98 in French and 1.98 in English for the same model", () => {
    const values = { m2: 7.32e22 };
    const scope = buildScope(
      { params, constants: model.constants, derived: model.derived },
      values,
    );
    expect(scope.F).toBeCloseTo(1.978e20, -17);
    const text = (elementOf("value") as { text: string }).text;
    expect(text).toContain("{{F|sci:2}}");
    const rendered = LANGUAGES.map((language) => interpolate(text, scope, { language }));
    expect(rendered).toEqual([
      "Force Terre-Lune : 1,98 × 10²⁰ N.",
      "Force Terre-Lune : 1.98 × 10²⁰ N.",
    ]);
    expect(render("value", "fr", values)).toBe(rendered[0]);
    expect(render("value", "en", values)).toBe(rendered[1]);
  });

  it("uses the format declared by the model when the text gives none", () => {
    const scope = buildScope(
      { params, constants: model.constants, derived: model.derived },
      {
        m2: 7.32e22,
      },
    );
    const declared = Object.fromEntries(
      model.derived.map((derived) => [derived.id, parseFormat(derived.format ?? "sig:3")]),
    );
    const options = (language: Language) => ({ language, formats: declared });
    expect(interpolate("{{F}}", scope, options("fr"))).toBe("1,98 × 10²⁰");
    expect(interpolate("{{F}}", scope, options("en"))).toBe("1.98 × 10²⁰");
  });

  it("groups the thousands with a narrow no-break space in French and a comma in English", () => {
    expect(render("where", "fr")).toBe(`Distance : 384${NNBSP}000 km.`);
    expect(render("where", "en")).toBe("Distance : 384,000 km.");
  });

  it("changes only the separators between the two languages", () => {
    const normalise = (text: string) => text.replaceAll(NNBSP, ",").replaceAll(".", ",");
    for (const id of ["value", "where"]) {
      expect(normalise(render(id, "fr"))).toBe(normalise(render(id, "en")));
    }
  });
});

describe("number formats in both languages", () => {
  it.each([
    ["int", 1234567.4, `1${NNBSP}234${NNBSP}567`, "1,234,567"],
    ["fixed:2", 1234.5678, `1${NNBSP}234,57`, "1,234.57"],
    ["fixed:1", -2.54, "−2,5", "−2.5"],
    ["sig:3", 0.012345, "0,0123", "0.0123"],
    ["sci:2", 1.98e20, "1,98 × 10²⁰", "1.98 × 10²⁰"],
    ["sci:1", 6.674e-11, "6,7 × 10⁻¹¹", "6.7 × 10⁻¹¹"],
    ["percent:1", 0.256, `25,6${NNBSP}%`, "25.6%"],
  ])("formats %s", (spec, value, fr, en) => {
    const format = parseFormat(spec);
    expect(formatNumber(value, format, "fr")).toBe(fr);
    expect(formatNumber(value, format, "en")).toBe(en);
  });
});
