import { describe, expect, it } from "vitest";
import { typeset, typesetTexts } from "../../src/schema/typeset";

const NBSP = " ";
const NARROW = " ";

describe("typeset", () => {
  it("turns straight apostrophes between letters into typographic ones", () => {
    expect(typeset("C'est l'attraction", "fr")).toBe("C’est l’attraction");
    expect(typeset("It's Newton's law", "en")).toBe("It’s Newton’s law");
  });

  it("leaves primes and quotes that are not apostrophes", () => {
    expect(typeset("f'(x) et 5' de marche", "fr")).toBe("f'(x) et 5' de marche");
  });

  it("binds French double punctuation to the word before it", () => {
    expect(typeset("Deux fois plus loin : quatre fois moins", "fr")).toBe(
      `Deux fois plus loin${NBSP}: quatre fois moins`,
    );
    expect(typeset("Pourquoi ? Parce que ; voilà !", "fr")).toBe(
      `Pourquoi${NARROW}? Parce que${NARROW}; voilà${NARROW}!`,
    );
    expect(typeset("« oui »", "fr")).toBe(`«${NARROW}oui${NARROW}»`);
  });

  it("does not touch English punctuation", () => {
    expect(typeset("Twice as far : four times less ?", "en")).toBe(
      "Twice as far : four times less ?",
    );
  });

  it("binds a number to its unit and groups of three digits together", () => {
    expect(typeset("Distance : 384 000 km.", "fr")).toBe(
      `Distance${NBSP}: 384${NARROW}000${NBSP}km.`,
    );
    expect(typeset("à 2 m du sol", "fr")).toBe(`à 2${NBSP}m du sol`);
    expect(typeset("après 2 secondes", "fr")).toBe("après 2 secondes");
  });

  it("binds an interpolated value to its unit and keeps the placeholder intact", () => {
    expect(typeset("Force : {{F|sci:2}} N", "fr")).toBe(`Force${NBSP}: {{F|sci:2}}${NBSP}N`);
  });

  it("keeps the length of the text", () => {
    const text = "L'eau bout à 100 °C : c'est connu ! « Vraiment » ?";
    expect(typeset(text, "fr")).toHaveLength(text.length);
  });
});

describe("typesetTexts", () => {
  it("typesets display texts and leaves ids, expressions and formulas alone", () => {
    const scene = {
      id: "s1",
      title: "L'idée",
      elements: [
        { id: "t", type: "text", text: "C'est 2 m : voilà" },
        { id: "f", type: "formula", tex: "f'(x) = 2 x" },
        { id: "v", type: "vector", label: "l'effort", dx: "2 r", from: "a" },
        { id: "l", type: "list", items: ["d'abord", "puis : ensuite"] },
        { id: "tb", type: "table", columns: ["l'un"], rows: [["l'autre", "3 kg"]] },
        { id: "sim", type: "sim.two-body", labelA: "l'astre" },
      ],
      beats: [{ id: "b1", narration: "C'est tout ?", actions: [{ do: "show", target: "t" }] }],
    };
    const out = typesetTexts(scene, "fr");
    expect(out.title).toBe("L’idée");
    expect(out.elements[0]).toMatchObject({ text: `C’est 2${NBSP}m${NBSP}: voilà` });
    expect(out.elements[1]).toMatchObject({ tex: "f'(x) = 2 x" });
    expect(out.elements[2]).toMatchObject({ label: "l’effort", dx: "2 r", from: "a" });
    expect(out.elements[3]).toMatchObject({ items: ["d’abord", `puis${NBSP}: ensuite`] });
    expect(out.elements[4]).toMatchObject({ columns: ["l’un"], rows: [["l’autre", `3${NBSP}kg`]] });
    expect(out.elements[5]).toMatchObject({ labelA: "l’astre" });
    expect(out.beats[0]).toMatchObject({ narration: `C’est tout${NARROW}?` });
    expect(out.beats[0]?.actions[0]).toEqual({ do: "show", target: "t" });
    expect(scene.title).toBe("L'idée");
  });
});
