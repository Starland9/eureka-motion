// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createSceneRuntime, SceneFrame } from "../../src/composition/SceneFrame";
import { createFrame, layoutSlots } from "../../src/layouts";
import { planReadouts, type ReadoutSpec } from "../../src/primitives/text/readout-fit";
import { readoutHeight } from "../../src/primitives/text/readout";
import type {
  ElementOf,
  LayoutName,
  Model,
  Param,
  SceneElement,
  SlotName,
} from "../../src/schema/document";
import { CANVAS, sceneMetrics } from "../../src/tokens";
import { frameProps, sceneOf, testContext } from "../helpers/scene";

const MONO_EM = 0.6;
const SUPERSCRIPT_EM = 0.6;

const param = (id: string, value: number): Param => ({
  id,
  symbol: id,
  label: id,
  unit: "m",
  min: 0,
  max: 1e6,
  step: 1,
  default: value,
  role: "quantity",
});

interface Flavour {
  unit: string;
  expr: string;
  format: string;
}

const PLAIN: Flavour = { unit: "m²", expr: "a ^ 2", format: "fixed:2" };
const SCIENTIFIC: Flavour = { unit: "kg·m²/s", expr: "a * 1.98e-20", format: "sci:2" };

function build(layout: LayoutName, labels: string[], flavour: Flavour, base = 3) {
  const slot: SlotName = layout === "formula-focus" ? "readout" : "notes";
  const params = [param("a", base)];
  const model: Model = {
    constants: [],
    derived: labels.map((label, index) => ({
      id: `q${index}`,
      expr: flavour.expr,
      unit: flavour.unit,
      label,
      format: flavour.format,
    })),
  };
  const elements: SceneElement[] = labels.map((label, index) => ({
    id: `r${index}`,
    slot,
    type: "readout",
    value: `q${index}`,
    label,
  }));
  return { slot, params, model, scene: sceneOf(elements, { layout }) };
}

interface Rendered {
  boxes: { height: number; widest: number; estimate: number }[];
  gap: number;
  scale: number;
  slotHeight: number;
  slotWidth: number;
}

function advanceOf(node: Element): number {
  let em = 0;
  node.childNodes.forEach((child) => {
    const chars = (child.textContent ?? "").length;
    em += chars * MONO_EM * (child.nodeName === "SUP" ? SUPERSCRIPT_EM : 1);
  });
  return em;
}

function wrapLines(label: string, perLine: number): number {
  let lines = 1;
  let used = 0;
  for (const word of label.split(" ").filter(Boolean)) {
    if (used === 0) used = word.length;
    else if (used + 1 + word.length <= perLine) used += 1 + word.length;
    else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

// Height of a readout as a browser lays out its inline styles: mono advances, a value that
// does not share the line with its label drops under it.
function boxOf(root: Element, width: number) {
  const line = [...root.querySelectorAll<HTMLElement>("span")].find(
    (node) => node.style.display === "flex",
  ) as HTMLElement;
  const label = line.children[0] as HTMLElement;
  const value = line.children[1] as HTMLElement;
  const labelSize = Number.parseFloat(label.style.fontSize);
  const valueSize = Number.parseFloat(value.style.fontSize);
  const labelAdvance = (MONO_EM + Number.parseFloat(label.style.letterSpacing)) * labelSize;
  const text = label.textContent ?? "";
  const labelWidth = text.length * labelAdvance;
  const mantissaWidth = advanceOf(value.children[0] as Element) * valueSize;
  const unitWidth = value.children[1] ? advanceOf(value.children[1]) * labelSize : 0;
  const columnGap = Number.parseFloat(line.style.columnGap);
  const pad = 2 * Number.parseFloat(line.style.paddingTop);
  const labelLine = Number.parseFloat(label.style.lineHeight);
  const valueLine = Number.parseFloat(value.style.lineHeight);
  const oneLine = labelWidth + columnGap + mantissaWidth + unitWidth <= width;
  const row = line.style.flexDirection === "row" && oneLine;
  const labelLines = wrapLines(text, Math.floor(width / labelAdvance));
  const valueLines = mantissaWidth + unitWidth <= width ? 1 : 2;
  const height = row
    ? Math.max(labelSize * labelLine, valueSize * valueLine) + pad
    : labelLines * labelSize * labelLine + valueLines * valueSize * valueLine + pad;
  const longestWord = Math.max(...text.split(" ").map((word) => word.length)) * labelAdvance;
  const widest = Math.max(
    row ? labelWidth + columnGap + mantissaWidth + unitWidth : 0,
    longestWord,
  );
  return { height, widest: row ? widest : Math.max(widest, mantissaWidth, unitWidth) };
}

function renderSlot(
  layout: LayoutName,
  labels: string[],
  flavour: Flavour,
  width: number = CANVAS.width,
  values: Record<string, number> = {},
): Rendered {
  const { slot, params, model, scene } = build(layout, labels, flavour);
  const options = { scene, params, model, width, values };
  const { container } = render(<SceneFrame {...frameProps(options)} />);
  const stack = [...container.querySelectorAll<HTMLElement>("div")].find(
    (node) => node.style.display === "flex" && node.style.flexDirection === "column",
  ) as HTMLElement;
  const scale = Number(/scale\(([\d.]+)\)/.exec(stack.style.transform)?.[1] ?? 1);
  const containerWidth = Number.parseFloat(stack.style.width);
  const rect = createSceneRuntime(frameProps(options)).slots[slot]!;
  const ctx = testContext({ ...options, slot });
  const boxes = [...stack.children].map((root, index) => ({
    ...boxOf(root, containerWidth),
    estimate: readoutHeight(scene.elements[index] as ElementOf<"readout">, ctx, containerWidth),
  }));
  return {
    boxes,
    gap: Number.parseFloat(stack.style.gap),
    scale,
    slotHeight: rect.height,
    slotWidth: rect.width,
  };
}

const totalOf = (rendered: Rendered): number =>
  (rendered.boxes.reduce((sum, box) => sum + box.height, 0) +
    (rendered.boxes.length - 1) * rendered.gap) *
  rendered.scale;

describe("readouts of a slot", () => {
  it("keeps the three readouts of the Pythagorean scene inside the readout slot", () => {
    const rendered = renderSlot(
      "formula-focus",
      ["Carré sur a", "Carré sur b", "Carré sur c"],
      PLAIN,
    );
    expect(rendered.slotHeight).toBe(392);
    expect(totalOf(rendered)).toBeLessThanOrEqual(rendered.slotHeight);
    for (const box of rendered.boxes) {
      expect(box.widest).toBeLessThanOrEqual(rendered.slotWidth);
      expect(box.height).toBeLessThanOrEqual(box.estimate);
    }
  });

  it("leaves a lone readout at its full size", () => {
    const { container } = render(
      <SceneFrame {...frameProps(build("formula-focus", ["Carré sur a"], PLAIN))} />,
    );
    const sizes = [...container.querySelectorAll<HTMLElement>("span")]
      .map((node) => node.style.fontSize)
      .filter(Boolean);
    expect(sizes).toContain(`${sceneMetrics.text.label * 16}px`);
    expect(sizes.some((size) => Number.parseFloat(size) > sceneMetrics.text.body * 16)).toBe(true);
  });

  const layouts: LayoutName[] = ["formula-focus", "figure-notes"];
  const labels = [
    ["Carré sur a", "Carré sur b", "Carré sur c"],
    ["Longueur du plus grand côté", "Vitesse de la voiture", "Énergie cinétique totale"],
    [
      "Nombre de bases lues par la machine",
      "Acides aminés pour un gène deux fois plus long",
      "Taux de variation entre deux points",
    ],
  ];

  describe.each(layouts)("in %s", (layout) => {
    describe.each([CANVAS.width, CANVAS.width / 2])("on a canvas %i px wide", (width) => {
      for (const flavour of [PLAIN, SCIENTIFIC]) {
        for (const set of labels) {
          for (const count of [1, 2, 3]) {
            const names = set.slice(0, count);
            it(`fits ${count} readout(s) of ${flavour.format}, longest label ${Math.max(...names.map((name) => name.length))} characters`, () => {
              const rendered = renderSlot(layout, names, flavour, width);
              expect(totalOf(rendered)).toBeLessThanOrEqual(rendered.slotHeight);
              for (const box of rendered.boxes) {
                expect(box.widest * rendered.scale).toBeLessThanOrEqual(rendered.slotWidth);
                expect(box.estimate).toBeGreaterThanOrEqual(box.height - 0.5);
              }
            });
          }
        }
      }
    });
  });

  it("keeps its size when a slider takes a value to a narrower width", () => {
    const names = ["Carré sur a", "Carré sur b", "Carré sur c"];
    const sizesOf = (values: Record<string, number>) => {
      const { container } = render(
        <SceneFrame {...frameProps({ ...build("formula-focus", names, PLAIN, 300), values })} />,
      );
      return [...container.querySelectorAll<HTMLElement>("span")]
        .map((node) => node.style.fontSize)
        .filter(Boolean)
        .join(" ");
    };
    expect(sizesOf({ a: 1 })).toBe(sizesOf({ a: 300 }));
  });
});

describe("planReadouts", () => {
  const frame = createFrame(CANVAS.width, CANVAS.height);
  const slots = layoutSlots("formula-focus", frame);
  const readout = slots.readout!;
  const box = { width: readout.width, height: readout.height, u: frame.u };
  const spec = (label: string): ReadoutSpec => ({
    label,
    mantissaChars: 5,
    exponentChars: 0,
    unitChars: 2,
  });

  it("stacks a label above a value as long as everything fits", () => {
    const plan = planReadouts([spec("Carré sur a")], box);
    expect(plan).toMatchObject({ stacked: true, fits: true });
    expect(plan.labelSize).toBe(sceneMetrics.text.label * frame.u);
  });

  it("shares the line of a label and a value, then shrinks, when the slot is short", () => {
    const plan = planReadouts([spec("Carré sur a"), spec("Carré sur b"), spec("Carré sur c")], box);
    expect(plan.stacked).toBe(false);
    expect(plan.fits).toBe(true);
    expect(plan.labelSize).toBeLessThan(sceneMetrics.text.label * frame.u);
    expect(plan.labelSize).toBeGreaterThanOrEqual((sceneMetrics.text.label * frame.u) / 2);
  });

  it("reports that a stack does not fit even at the smallest size", () => {
    const long = spec("Acides aminés pour un gène deux fois plus long");
    const plan = planReadouts([long, long, long], box);
    expect(plan.fits).toBe(false);
    expect(plan.labelSize).toBe((sceneMetrics.text.label * frame.u) / 2);
  });
});
