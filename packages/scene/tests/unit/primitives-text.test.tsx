// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { registry } from "../../src/composition/registry";
import type {
  Action,
  ElementOf,
  LayoutName,
  Model,
  Param,
  Scene,
  SceneElement,
} from "../../src/schema/document";
import { THEME_NAMES, getTheme, sceneMetrics } from "../../src/tokens";
import { renderElement, sceneOf, testContext, type ContextOptions } from "../helpers/scene";

const param = (id: string, label: string, unit: string, value: number): Param => ({
  id,
  symbol: id,
  label,
  unit,
  min: 0,
  max: 1e6,
  step: 1,
  default: value,
  role: "quantity",
});
const params = [
  param("m", "Masse de la voiture", "kg", 1200),
  param("v", "Vitesse", "m/s", 27.5),
  param("r", "Résistance", "Ω", 47),
];
const model: Model = {
  constants: [],
  derived: [
    { id: "E", expr: "0.5 * m * v^2", unit: "J", label: "Énergie cinétique", format: "sci:2" },
    { id: "k", expr: "1 / (m * 1e12)", unit: "", label: "Coefficient", format: "sci:2" },
    { id: "E_kJ", expr: "E / 1000", unit: "kJ", label: "Énergie", format: "int" },
  ],
};

const px = (units: number): number => units * 16;
const rgb = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
};

const show = (id: string, how: "fade" | "type", at = 0): Action => ({
  do: "show",
  targets: [id],
  how,
  at,
});
const highlight = (id: string): Action => ({ do: "highlight", targets: [id], at: 0 });
const beatOf = (...actions: Action[]): Scene["beats"] => [
  { id: "b1", narration: "Test.", duration_ms: 4000, actions },
];

interface MountOptions extends Partial<Omit<ContextOptions, "scene">> {
  layout?: LayoutName;
  beats?: Scene["beats"];
}

function mount(element: SceneElement, options: MountOptions = {}, siblings: SceneElement[] = []) {
  const { layout = "figure-notes", beats, ...context } = options;
  const scene = sceneOf([element, ...siblings], { layout, beats });
  const ctx = testContext({ params, model, ...context, scene, slot: element.slot });
  const result = renderElement(element, ctx);
  return { ...result, root: result.container.firstElementChild as HTMLElement, ctx };
}

const fills = (container: HTMLElement, colour: string): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>("span")].filter(
    (node) => node.style.backgroundColor === colour,
  );

describe("text", () => {
  const text: ElementOf<"text"> = {
    id: "t",
    slot: "notes",
    type: "text",
    text: "À {{v|fixed:1}} m/s : {{E|sci:2}} J.",
  };

  it("interpolates the model with the decimal separator of the language", () => {
    expect(mount(text, { language: "fr" }).container.textContent).toBe(
      "À 27,5 m/s : 4,54 × 10⁵ J.",
    );
    expect(mount(text, { language: "en" }).container.textContent).toBe(
      "À 27.5 m/s : 4.54 × 10⁵ J.",
    );
  });

  it("formats a value with its own format and follows a changed parameter", () => {
    const own: ElementOf<"text"> = { ...text, text: "{{E}} et {{E_kJ}}" };
    expect(mount(own).container.textContent).toBe("4,54 × 10⁵ et 454");
    expect(mount(own, { values: { v: 30 } }).container.textContent).toBe("5,40 × 10⁵ et 540");
  });

  it("sets the weight from the emphasis", () => {
    expect(mount(text).root.style.fontWeight).toBe("400");
    expect(mount({ ...text, emphasis: "strong" }).root.style.fontWeight).toBe("600");
  });

  it("sizes the text by slot", () => {
    const statement: ElementOf<"text"> = { ...text, slot: "text", text: "Une phrase courte." };
    expect(mount(statement, { layout: "statement" }).root.style.fontSize).toBe(`${px(6)}px`);
    expect(mount(text).root.style.fontSize).toBe(`${px(sceneMetrics.text.body)}px`);
    expect(mount(text).root.style.lineHeight).toBe("1.3");
  });

  it("takes the same smaller size as the list sharing its slot", () => {
    const statement: ElementOf<"text"> = { ...text, slot: "text", text: "x".repeat(50) };
    const list: ElementOf<"list"> = {
      id: "l",
      slot: "text",
      type: "list",
      items: ["y".repeat(25), "y".repeat(25), "y".repeat(25)],
    };
    const alone = mount(list, { layout: "statement" }).root;
    const together = mount(statement, { layout: "statement" }, [list]).root;
    expect(alone.style.fontSize).toBe(`${px(6)}px`);
    expect(Number.parseFloat(together.style.fontSize)).toBeLessThan(px(6));
    expect(mount(list, { layout: "statement" }, [statement]).root.style.fontSize).toBe(
      together.style.fontSize,
    );
  });

  it("never goes below the body size", () => {
    const long: ElementOf<"text"> = { ...text, slot: "text", text: "x".repeat(140) };
    const list: ElementOf<"list"> = {
      id: "l",
      slot: "text",
      type: "list",
      items: Array.from({ length: 4 }, () => "y".repeat(80)),
    };
    const size = Number.parseFloat(
      mount(long, { layout: "statement" }, [list]).root.style.fontSize,
    );
    expect(size).toBe(px(sceneMetrics.text.body));
  });

  it.each(THEME_NAMES)("takes its colours from the %s tokens", (name) => {
    const theme = getTheme(name);
    const colour = (element: ElementOf<"text">) => mount(element, { theme: name }).root.style.color;
    expect(colour(text)).toBe(rgb(theme.ink));
    expect(colour({ ...text, role: "inkSoft" })).toBe(rgb(theme.inkSoft));
    expect(colour({ ...text, role: "quantity" })).toBe(rgb(theme.role.quantity));
    expect(colour({ ...text, role: "valid" })).toBe(rgb(theme.role.valid));
    expect(colour({ ...text, role: "action" })).toBe(rgb(theme.role.actionText));
  });

  it.each(THEME_NAMES)("sets the result role as a flat fill behind ink in %s", (name) => {
    const theme = getTheme(name);
    const { root, container } = mount({ ...text, role: "result" }, { theme: name });
    expect(fills(container, rgb(theme.role.result))).toHaveLength(1);
    expect(root.style.color).toBe(rgb(name === "paper" ? theme.ink : theme.surface));
  });

  it("is hidden before its show and visible after", () => {
    const beats = beatOf(show("t", "fade", 0.5));
    expect(mount(text, { beats, frame: 0 }).root.style.opacity).toBe("0");
    expect(mount(text, { beats, frame: "end" }).root.style.opacity).toBe("1");
  });

  describe("typed entrance", () => {
    const full = "À 27,5 m/s : 4,54 × 10⁵ J.";
    const halves = (frame: number | "end") => {
      const { container } = mount(text, { beats: beatOf(show("t", "type")), frame });
      const rest = container.querySelector('[aria-hidden="true"]') as HTMLElement;
      const shown = rest.previousElementSibling as HTMLElement;
      return { container, shown: shown.textContent ?? "", rest: rest.textContent ?? "" };
    };

    it("shows a prefix of the text midway and all of it at the end", () => {
      const midway = halves(13);
      expect(midway.shown.length).toBeGreaterThan(0);
      expect(midway.shown.length).toBeLessThan(full.length);
      expect(full.startsWith(midway.shown)).toBe(true);
      expect(midway.shown + midway.rest).toBe(full);
      expect(halves("end")).toMatchObject({ shown: full, rest: "" });
    });

    it("keeps the final text in the layout so that nothing jumps", () => {
      expect(halves(13).container.textContent).toBe(full);
      expect(halves(13).rest).not.toBe("");
    });
  });

  it("changes the background when highlighted", () => {
    const result = getTheme("paper").role.result;
    expect(fills(mount(text).container, rgb(result))).toHaveLength(0);
    const marked = mount(text, { beats: beatOf(show("t", "fade"), highlight("t")) });
    expect(fills(marked.container, rgb(result))).toHaveLength(1);
    const board = mount(text, { beats: beatOf(show("t", "fade"), highlight("t")), theme: "board" });
    expect(board.root.style.color).toBe(rgb(getTheme("board").surface));
  });
});

describe("list", () => {
  const list: ElementOf<"list"> = {
    id: "l",
    slot: "text",
    type: "list",
    items: ["Première idée.", "Deuxième idée.", "Troisième idée."],
  };
  const statement = { layout: "statement" } as const;

  it.each(THEME_NAMES)("sets each item after a mono numeral in the faint ink of %s", (name) => {
    const theme = getTheme(name);
    const { root } = mount(list, { ...statement, theme: name });
    const rows = [...root.children] as HTMLElement[];
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      const numeral = row.firstElementChild as HTMLElement;
      expect(numeral.textContent).toBe(String(index + 1));
      expect(numeral.style.color).toBe(rgb(theme.inkFaint));
      expect(numeral.style.fontFamily).toContain("IBM Plex Mono");
      expect(row.textContent).toBe(`${index + 1}${list.items[index]}`);
      expect(row.style.color).toBe(rgb(theme.ink));
    });
  });

  it("uses the reading size when it fits and a smaller one when it does not", () => {
    expect(mount(list, statement).root.style.fontSize).toBe(`${px(6)}px`);
    const long: ElementOf<"list"> = {
      ...list,
      items: Array.from({ length: 4 }, () => "z".repeat(60)),
    };
    const size = Number.parseFloat(mount(long, statement).root.style.fontSize);
    expect(size).toBeLessThan(px(6));
    expect(size).toBeGreaterThanOrEqual(px(sceneMetrics.text.body));
  });

  it("brings the items in one after another when typed", () => {
    const beats = beatOf(show("l", "type"));
    const opacities = (frame: number | "end") =>
      [...mount(list, { ...statement, beats, frame }).root.children].map((row) =>
        Number((row as HTMLElement).style.opacity),
      );
    const midway = opacities(13);
    expect(midway[0]).toBe(1);
    expect(midway[1]).toBeGreaterThan(0);
    expect(midway[1]).toBeLessThan(1);
    expect(midway[2]).toBe(0);
    expect(opacities("end")).toEqual([1, 1, 1]);
  });

  it("is hidden before its show", () => {
    const beats = beatOf(show("l", "fade", 0.5));
    const opacities = (frame: number | "end") =>
      [...mount(list, { ...statement, beats, frame }).root.children].map(
        (row) => (row as HTMLElement).style.opacity,
      );
    expect(opacities(0)).toEqual(["0", "0", "0"]);
    expect(opacities("end")).toEqual(["1", "1", "1"]);
  });

  it("changes the background when highlighted", () => {
    const beats = beatOf(show("l", "fade"), highlight("l"));
    const result = rgb(getTheme("paper").role.result);
    expect(fills(mount(list, statement).container, result)).toHaveLength(0);
    expect(fills(mount(list, { ...statement, beats }).container, result)).toHaveLength(3);
  });

  it("highlights a single item when the action targets it", () => {
    const beats = beatOf(show("l", "fade"), highlight("l.i2"));
    const result = rgb(getTheme("paper").role.result);
    const rows = [...mount(list, { ...statement, beats }).root.children] as HTMLElement[];
    expect(rows.map((row) => fills(row, result).length)).toEqual([0, 1, 0]);
  });
});

describe("formula", () => {
  const formula: ElementOf<"formula"> = {
    id: "f",
    slot: "formula",
    type: "formula",
    tex: "\\a{E} = \\dfrac{1}{2} \\, \\q{m} \\, \\q{v}^2",
  };
  const focus = { layout: "formula-focus" } as const;
  const textOf = (container: HTMLElement) =>
    container.querySelector(".katex-html")?.textContent ?? "";

  it.each(THEME_NAMES)("renders KaTeX with the role colours of the %s theme", (name) => {
    const theme = getTheme(name);
    const { container, root } = mount(formula, { ...focus, theme: name });
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.innerHTML).toContain(`color:${theme.role.action}`);
    expect(container.innerHTML).toContain(`color:${theme.role.quantity}`);
    expect(root.style.color).toBe(rgb(theme.ink));
  });

  it("sets the result role as a flat fill", () => {
    const marked: ElementOf<"formula"> = { ...formula, tex: "\\res{E = m c^2}" };
    const { container } = mount(marked, focus);
    expect(container.innerHTML).toContain(`background-color:${getTheme("paper").role.result}`);
  });

  it("interpolates values with a typeset decimal separator", () => {
    const valued: ElementOf<"formula"> = {
      ...formula,
      tex: "v = {{v|fixed:1}} \\, \\mathrm{m/s} \\quad E = {{E|sci:2}}",
    };
    const fr = mount(valued, { ...focus, language: "fr" }).container;
    expect(fr.querySelector("annotation")?.textContent).toContain("{27{,}5}");
    expect(textOf(fr)).toContain("27,5");
    expect(textOf(fr)).toContain("4,54×10");
    expect(textOf(mount(valued, { ...focus, language: "en" }).container)).toContain("27.5");
    expect(textOf(mount(valued, { ...focus, values: { v: 40 } }).container)).toContain("40,0");
  });

  it("rejects a value that is not in the model", () => {
    expect(() => mount({ ...formula, tex: "{{ghost}}" }, focus)).toThrow(/ghost/);
  });

  it("sizes the formula by slot and keeps it inside the slot", () => {
    const flat: ElementOf<"formula"> = { ...formula, tex: "F = G m_1 m_2 / r^2" };
    expect(mount(flat, focus).root.style.fontSize).toBe(`${px(sceneMetrics.text.formula)}px`);
    const tall = mount(formula, focus);
    const size = Number.parseFloat(tall.root.style.fontSize);
    expect(size).toBeLessThan(px(sceneMetrics.text.formula));
    expect(size * 1.21 * 1.8).toBeLessThanOrEqual(tall.ctx.size.height);
    const inNotes = mount({ ...flat, slot: "notes" });
    expect(inNotes.root.style.fontSize).toBe(`${px(5)}px`);
    expect(inNotes.root.style.justifyContent).toBe("flex-start");
  });

  it("is hidden before its show and visible after", () => {
    const beats = beatOf(show("f", "fade", 0.5));
    expect(mount(formula, { ...focus, beats, frame: 0 }).root.style.opacity).toBe("0");
    expect(mount(formula, { ...focus, beats, frame: "end" }).root.style.opacity).toBe("1");
  });

  it("reveals from left to right when typed, then removes the clip", () => {
    const scene = sceneOf([formula], { layout: "formula-focus", beats: beatOf(show("f", "type")) });
    const markup = (frame: number | "end") => {
      const ctx = testContext({ params, model, scene, frame, slot: "formula" });
      const { Component } = registry.formula;
      return renderToStaticMarkup(<Component element={formula} ctx={ctx} />);
    };
    const hiddenOnRight = (html: string) => Number(/clip-path:inset\(0 ([\d.]+)%/.exec(html)?.[1]);
    expect(hiddenOnRight(markup(6))).toBeGreaterThan(hiddenOnRight(markup(20)));
    expect(hiddenOnRight(markup(20))).toBeGreaterThan(0);
    expect(markup("end")).not.toContain("clip-path");
  });

  it("changes the background when highlighted", () => {
    const beats = beatOf(show("f", "fade"), highlight("f"));
    const result = rgb(getTheme("paper").role.result);
    expect(fills(mount(formula, focus).container, result)).toHaveLength(0);
    expect(fills(mount(formula, { ...focus, beats }).container, result)).toHaveLength(1);
  });
});

describe("readout", () => {
  const energy: ElementOf<"readout"> = {
    id: "e",
    slot: "notes",
    type: "readout",
    value: "E",
    label: "Énergie",
  };
  const partsOf = (container: HTMLElement, label: string) => {
    const labelNode = [...container.querySelectorAll<HTMLElement>("span")].find(
      (node) => node.textContent === label,
    ) as HTMLElement;
    const value = labelNode.nextElementSibling as HTMLElement;
    return {
      label: labelNode,
      line: labelNode.parentElement as HTMLElement,
      value,
      unit: value.lastElementChild as HTMLElement,
    };
  };

  it("shows the label, the value with a superscript exponent and the unit", () => {
    const { container } = mount(energy);
    const sup = container.querySelector("sup");
    expect(container.textContent).toBe("Énergie4,54 × 105 J");
    expect(sup?.textContent).toBe("5");
    expect(sup?.previousSibling?.textContent).toBe(" × 10");
    expect(partsOf(container, "Énergie").unit.textContent).toBe(" J");
  });

  it("labels with the value's own label by default", () => {
    const unlabelled = { ...energy, label: undefined };
    expect(mount(unlabelled).container.textContent).toContain("Énergie cinétique");
  });

  it("follows a changed parameter value", () => {
    expect(mount(energy, { values: { v: 60 } }).container.textContent).toBe("Énergie2,16 × 106 J");
    expect(mount(energy, { values: { m: 2000 } }).container.textContent).toBe(
      "Énergie7,56 × 105 J",
    );
  });

  it("types a negative exponent with a true minus sign", () => {
    const small: ElementOf<"readout"> = { ...energy, value: "k", label: "Coefficient" };
    expect(mount(small).container.querySelector("sup")?.textContent).toBe("−16");
  });

  it("uses the decimal separator of the language and no exponent for plain values", () => {
    const speed: ElementOf<"readout"> = { ...energy, value: "v", label: "Vitesse" };
    expect(mount(speed, { language: "fr" }).container.textContent).toBe("Vitesse27,5 m/s");
    const english = mount(speed, { language: "en" });
    expect(english.container.textContent).toBe("Vitesse27.5 m/s");
    expect(english.container.querySelector("sup")).toBeNull();
  });

  it("sets the unit in glyphs the mono face has", () => {
    const resistance: ElementOf<"readout"> = { ...energy, value: "r", label: "Résistance" };
    expect(mount(resistance).container.textContent).toContain("\u2126");
  });

  it.each(THEME_NAMES)("sets label, value and unit in the %s tokens", (name) => {
    const theme = getTheme(name);
    const { label, value, unit } = partsOf(mount(energy, { theme: name }).container, "Énergie");
    expect(label.style.color).toBe(rgb(theme.inkFaint));
    expect(label.style.textTransform).toBe("uppercase");
    expect(label.style.letterSpacing).toBe("0.06em");
    expect(label.style.fontSize).toBe(`${px(sceneMetrics.text.label)}px`);
    expect(value.style.color).toBe(rgb(theme.ink));
    expect(value.style.fontVariantNumeric).toBe("tabular-nums");
    expect(unit.style.color).toBe(rgb(theme.inkSoft));
  });

  it("stacks the label above the value, or shares a line at a smaller size when the slot is short", () => {
    const readout = (id: string, value: string): ElementOf<"readout"> => ({
      ...energy,
      id,
      value,
      slot: "readout",
    });
    const options = { layout: "formula-focus" } as const;
    const lone = partsOf(mount(readout("a", "m"), options).container, "Énergie");
    const crowded = partsOf(
      mount(readout("a", "m"), options, [readout("b", "v"), readout("c", "E_kJ")]).container,
      "Énergie",
    );
    expect(lone.line.style.flexDirection).toBe("column");
    expect(crowded.line.style.flexDirection).toBe("row");
    expect(Number.parseFloat(lone.value.style.fontSize)).toBeGreaterThan(
      Number.parseFloat(crowded.value.style.fontSize),
    );
    expect(Number.parseFloat(crowded.value.style.fontSize)).toBeLessThanOrEqual(
      px(sceneMetrics.text.body),
    );
  });

  it("is hidden before its show and visible after", () => {
    const beats = beatOf(show("e", "fade", 0.5));
    expect(mount(energy, { beats, frame: 0 }).root.style.opacity).toBe("0");
    expect(mount(energy, { beats, frame: "end" }).root.style.opacity).toBe("1");
  });

  it("changes the background when highlighted", () => {
    const result = rgb(getTheme("paper").role.result);
    const beats = beatOf(show("e", "fade"), highlight("e"));
    expect(fills(mount(energy).container, result)).toHaveLength(0);
    expect(fills(mount(energy, { beats }).container, result)).toHaveLength(1);
  });
});
