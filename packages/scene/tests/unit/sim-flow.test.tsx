// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PictogramProps } from "../../src/pictograms";
import {
  bandWidth,
  flowLayout,
  flowOutline,
  flowRatios,
  wrapMono,
  type BranchGeometry,
  type FlowBranchInput,
  type FlowGeometry,
} from "../../src/primitives/sim/flow-layout";
import type { ElementOf, Model, Param, Scene } from "../../src/schema/document";
import type { ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext } from "../helpers/scene";

vi.mock("../../src/pictograms", async () => {
  const { createElement } = await import("react");
  return {
    Pictogram: ({ kind, x, y, size, opacity }: PictogramProps) =>
      createElement("circle", { "data-kind": kind, cx: x, cy: y, r: size / 2, opacity }),
  };
});

const param = (id: string, symbol: string, value: number): Param => ({
  id,
  symbol,
  label: id,
  unit: "%",
  min: 0,
  max: 100,
  step: 1,
  default: value,
  role: "quantity",
});

const PARAMS: Param[] = [param("light", "I", 60), param("water", "W", 40), param("co2", "C", 50)];
const MODEL: Model = {
  constants: [],
  derived: [
    {
      id: "sugar",
      expr: "100 * min(light / 60, water / 40, co2 / 50)",
      unit: "",
      label: "Sugar",
    },
  ],
};

type Flow = ElementOf<"sim.flow">;
const LEAF: Flow = {
  id: "leaf",
  slot: "figure",
  type: "sim.flow",
  node: { label: "Feuille", object: "leaf" },
  inputs: [
    { id: "light", label: "Lumière", rate: { expr: "light" } },
    { id: "water", label: "Eau", rate: { expr: "water" } },
    { id: "co2", label: "CO₂", rate: { expr: "co2" } },
  ],
  outputs: [
    { id: "glucose", label: "Glucose", rate: { expr: "sugar" } },
    { id: "o2", label: "O₂", rate: { expr: "sugar" } },
  ],
};

const showing = (targets: string[], how: "fade" | "draw" = "fade"): Scene["beats"] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [{ do: "show", targets, how, at: 0 }],
  },
];

interface Setup {
  element?: Flow;
  values?: Record<string, number>;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
}

function setup({ element = LEAF, ...rest }: Setup = {}) {
  const scene = sceneOf([element], { beats: rest.beats });
  const ctx = testContext({
    scene,
    params: PARAMS,
    model: MODEL,
    values: rest.values,
    theme: rest.theme,
    frame: rest.frame,
  });
  return { ctx, ...renderElement(element, ctx) };
}

const num = (element: Element | null | undefined, name: string): number => {
  if (!element) throw new Error(`missing element for ${name}`);
  return Number(element.getAttribute(name));
};
const part = (container: Element, name: string): Element | null =>
  container.querySelector(`[data-part="${name}"]`);
const pointsOf = (group: Element | null): [number, number][] =>
  (group?.querySelector("polygon")?.getAttribute("points") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((pair) => pair.split(",").map(Number) as [number, number]);

function bandOf(container: Element, id: string) {
  const points = pointsOf(part(container, id));
  if (points.length === 0) return { width: 0, from: 0, tip: 0 };
  return {
    width: points[6]![1] - points[0]![1],
    from: points[0]![0],
    tip: points[3]![0],
  };
}

const widths = (container: Element, ids: string[]): number[] =>
  ids.map((id) => bandOf(container, id).width);
const OUTPUTS = ["glucose", "o2"];
const INPUTS = ["light", "water", "co2"];

describe("flowRatios", () => {
  it("limits every output by the scarcest input", () => {
    const rates = flowRatios([1, 0.4, 2], [1, 1.5, 0.2]);
    expect(rates.limiting).toBe(0.4);
    expect(rates.outputs).toEqual([0.4, 0.4, 0.2]);
    expect(rates.inputs).toEqual([1, 0.4, 2]);
  });

  it("follows the limiting input as it changes, and ignores the other inputs", () => {
    const outputsFor = (inputs: number[]) => flowRatios(inputs, [5, 5]).outputs;
    expect(outputsFor([0.25, 1, 1])).toEqual([0.25, 0.25]);
    expect(outputsFor([0.5, 1, 1])).toEqual([0.5, 0.5]);
    expect(outputsFor([2, 1, 1])).toEqual([1, 1]);
    expect(outputsFor([2, 1.6, 3])).toEqual([1.6, 1.6]);
    expect(outputsFor([0.25, 3, 9])).toEqual(outputsFor([0.25, 1, 1]));
  });

  it("stops every output when an input is missing", () => {
    expect(flowRatios([1, 0, 1], [1, 2]).outputs).toEqual([0, 0]);
    expect(flowRatios([-3], [1]).outputs).toEqual([0]);
    expect(flowRatios([-3], [1]).inputs).toEqual([0]);
  });

  it("leaves an output that is already below the limit alone", () => {
    expect(flowRatios([2, 3], [0.5, 1.9]).outputs).toEqual([0.5, 1.9]);
  });
});

describe("bandWidth", () => {
  const u = 16;
  const max = 8 * u;

  it("is zero without flow", () => {
    expect(bandWidth(0, max, u)).toBe(0);
    expect(bandWidth(-1, max, u)).toBe(0);
    expect(bandWidth(Number.NaN, max, u)).toBe(0);
  });

  it("is proportional to the rate between the floor and the cap", () => {
    const a = bandWidth(0.5, max, u);
    expect(bandWidth(1, max, u) / a).toBeCloseTo(2, 9);
    expect(bandWidth(2, max, u) / a).toBeCloseTo(4, 9);
    expect(bandWidth(1.5, max, u) / bandWidth(0.75, max, u)).toBeCloseTo(2, 9);
  });

  it("keeps a thin flow visible and caps a strong one", () => {
    expect(bandWidth(0.001, max, u)).toBeCloseTo(0.25 * u, 9);
    expect(bandWidth(50, max, u)).toBe(max);
    expect(bandWidth(2.4, max, u)).toBeLessThan(max);
    expect(bandWidth(2.6, max, u)).toBe(max);
  });

  it("never exceeds a band narrower than the floor", () => {
    expect(bandWidth(1, 0.1 * u, u)).toBeLessThanOrEqual(0.1 * u);
  });
});

describe("wrapMono", () => {
  it("breaks between words and never exceeds the capacity", () => {
    expect(wrapMono("Dioxyde de carbone libre", 10)).toEqual(["Dioxyde de", "carbone", "libre"]);
    expect(wrapMono("Glucose", 10)).toEqual(["Glucose"]);
  });

  it("cuts a word that is longer than a line", () => {
    expect(wrapMono("Chloroplaste", 5)).toEqual(["Chlor", "oplas", "te"]);
  });

  it("copes with a capacity below one character and with blank text", () => {
    expect(wrapMono("ab", 0.2)).toEqual(["a", "b"]);
    expect(wrapMono("  ", 4)).toEqual(["  "]);
  });
});

const U = 16;
const SLOTS = [
  { width: 1088, height: 648 },
  { width: 1088, height: 392 },
  { width: 832, height: 648 },
  { width: 1728, height: 648 },
];
const SHORT = ["Lumière", "Eau", "CO₂"];
const LONG = ["Dioxyde de carbone libre", "Glucose et amidon mis", "Lumière"];

const branches = (labels: string[], count: number, ratio: number): FlowBranchInput[] =>
  labels.slice(0, count).map((label) => ({ label, ratio }));

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function labelRect(branch: BranchGeometry, lineHeight: number): Rect {
  const reach = Math.max(...branch.lines.map((line) => line.length)) * 0.6 * 4 * U;
  return {
    left: branch.anchor === "start" ? branch.labelX : branch.labelX - reach,
    right: branch.anchor === "start" ? branch.labelX + reach : branch.labelX,
    top: branch.labelY - lineHeight / 2,
    bottom: branch.labelY + (branch.lines.length - 0.5) * lineHeight,
  };
}

function nodeLabelRect(geometry: FlowGeometry): Rect {
  const { node, lineHeight } = geometry;
  const reach = Math.max(...node.lines.map((line) => line.length)) * 0.6 * 4 * U;
  return {
    left: node.labelX - reach / 2,
    right: node.labelX + reach / 2,
    top: node.labelY - lineHeight / 2,
    bottom: node.labelY + (node.lines.length - 0.5) * lineHeight,
  };
}

function checkInside(
  geometry: FlowGeometry,
  slot: { width: number; height: number },
  context: string,
) {
  const { node, lineHeight } = geometry;
  const within = (rect: Rect, what: string) => {
    expect(rect.left, `${context} ${what} left`).toBeGreaterThanOrEqual(-1e-6);
    expect(rect.right, `${context} ${what} right`).toBeLessThanOrEqual(slot.width + 1e-6);
    expect(rect.top, `${context} ${what} top`).toBeGreaterThanOrEqual(-1e-6);
    expect(rect.bottom, `${context} ${what} bottom`).toBeLessThanOrEqual(slot.height + 1e-6);
  };
  within(
    { left: node.x, right: node.x + node.width, top: node.y, bottom: node.y + node.height },
    "box",
  );
  within(nodeLabelRect(geometry), "node label");
  for (const [side, list] of [
    ["input", geometry.inputs],
    ["output", geometry.outputs],
  ] as const) {
    list.forEach((branch, k) => {
      within(labelRect(branch, lineHeight), `${side} ${k} label`);
      within(
        {
          left: branch.from,
          right: branch.to,
          top: branch.y - branch.headHalf,
          bottom: branch.y + branch.headHalf,
        },
        `${side} ${k} band`,
      );
      expect(branch.y - branch.headHalf).toBeGreaterThanOrEqual(node.y - 1e-6);
      expect(branch.y + branch.headHalf).toBeLessThanOrEqual(node.y + node.height + 1e-6);
      expect(labelRect(branch, lineHeight).right).toBeLessThanOrEqual(
        Math.max(branch.to, branch.from) + 1e-6,
      );
    });
  }
}

function checkClear(geometry: FlowGeometry, context: string) {
  const { lineHeight, node } = geometry;
  const labelOf = nodeLabelRect(geometry);
  for (const list of [geometry.inputs, geometry.outputs]) {
    list.forEach((branch, k) => {
      const mine = labelRect(branch, lineHeight);
      expect(branch.y - branch.headHalf, `${context} label over own band`).toBeGreaterThanOrEqual(
        mine.bottom - 1e-6,
      );
      expect(overlaps(mine, labelOf), `${context} label ${k} vs node label`).toBe(false);
      const previous = list[k - 1];
      if (previous) {
        const bottom = previous.y + previous.headHalf;
        expect(mine.top, `${context} label ${k} under the band above`).toBeGreaterThanOrEqual(
          bottom - 1e-6,
        );
        expect(branch.y - branch.headHalf).toBeGreaterThanOrEqual(bottom - 1e-6);
      }
    });
  }
  expect(geometry.inputs.every((b) => b.to === node.x)).toBe(true);
  expect(geometry.outputs.every((b) => b.from === node.x + node.width)).toBe(true);
}

describe("flow layout", () => {
  it("keeps labels, bands and node inside the slot, clear of one another", () => {
    const cases = [
      { labels: SHORT, counts: [1, 2, 3], slots: SLOTS },
      {
        labels: LONG,
        counts: [1, 2],
        slots: SLOTS.filter((s) => s.height > 500 && s.width > 1000),
      },
      { labels: LONG, counts: [1], slots: [SLOTS[2]!] },
    ];
    for (const { labels, counts, slots } of cases) {
      for (const slot of slots) {
        for (const nIn of counts) {
          for (const nOut of counts) {
            for (const ratio of [0, 0.05, 1, 2.4, 40]) {
              const geometry = flowLayout(slot, U, {
                node: "Feuille",
                inputs: branches(labels, nIn, ratio),
                outputs: branches(labels, nOut, ratio),
              });
              const context = `${slot.width}x${slot.height} ${nIn}in ${nOut}out ratio ${ratio}`;
              checkInside(geometry, slot, context);
              checkClear(geometry, context);
            }
          }
        }
      }
    }
  });

  it("keeps a long node label inside the slot and clear of the flows", () => {
    for (const slot of SLOTS.filter((s) => s.height > 500)) {
      const geometry = flowLayout(slot, U, {
        node: "Cellule de la feuille",
        inputs: branches(SHORT, 3, 1),
        outputs: branches(SHORT, 2, 1),
      });
      checkInside(geometry, slot, `${slot.width}`);
      checkClear(geometry, `${slot.width}`);
    }
  });

  it("writes the node label above the box when no flow label is in the way, below otherwise", () => {
    const wide = flowLayout(SLOTS[3]!, U, {
      node: "Feuille",
      inputs: branches(SHORT, 3, 1),
      outputs: branches(SHORT, 2, 1),
    });
    expect(wide.node.labelY).toBeLessThan(wide.node.y);
    const narrow = flowLayout(SLOTS[2]!, U, {
      node: "Chloroplaste",
      inputs: branches(SHORT, 3, 1),
      outputs: branches(SHORT, 2, 1),
    });
    expect(narrow.node.labelY).toBeGreaterThan(narrow.node.y + narrow.node.height);
  });

  it("draws each band in strict proportion to the rate, with the same scale on both sides", () => {
    const slot = SLOTS[0]!;
    const at = (ratio: number) =>
      flowLayout(slot, U, {
        node: "Feuille",
        inputs: branches(SHORT, 3, ratio),
        outputs: branches(SHORT, 2, ratio),
      });
    const [low, mid, high] = [at(0.4), at(0.8), at(1.6)];
    expect(mid.inputs[0]!.width / low.inputs[0]!.width).toBeCloseTo(2, 9);
    expect(high.inputs[0]!.width / mid.inputs[0]!.width).toBeCloseTo(2, 9);
    expect(mid.outputs[1]!.width).toBeCloseTo(mid.inputs[2]!.width, 9);
    expect(low.bandMax).toBe(high.bandMax);
  });

  it("gives a lane the same room whatever the rate, so that nothing moves between lanes", () => {
    const slot = SLOTS[0]!;
    const at = (ratio: number) =>
      flowLayout(slot, U, {
        node: "Feuille",
        inputs: branches(SHORT, 3, ratio),
        outputs: branches(SHORT, 2, 1),
      });
    const thin = at(0.1);
    const thick = at(2);
    expect(thick.inputs.map((b) => b.y)).toEqual(thin.inputs.map((b) => b.y));
    expect(thick.node).toEqual(thin.node);
    expect(thick.inputs[0]!.labelY).toBeLessThan(thin.inputs[0]!.labelY);
  });

  it("centres a side that has fewer flows on the box", () => {
    const geometry = flowLayout(SLOTS[0]!, U, {
      node: "Feuille",
      inputs: branches(SHORT, 3, 1),
      outputs: branches(SHORT, 1, 1),
    });
    expect(geometry.outputs[0]!.y).toBeCloseTo(geometry.inputs[1]!.y, 9);
  });

  it("flows from left to right and wraps long labels to the room beside the box", () => {
    const geometry = flowLayout(SLOTS[2]!, U, {
      node: "Feuille",
      inputs: branches(LONG, 1, 1),
      outputs: branches(LONG, 1, 1),
    });
    expect(geometry.inputs[0]!.lines.length).toBeGreaterThan(1);
    for (const branch of [...geometry.inputs, ...geometry.outputs]) {
      expect(branch.to).toBeGreaterThan(branch.from);
      for (const line of branch.lines) {
        expect(line.length * 0.6 * 4 * U).toBeLessThanOrEqual(branch.to - branch.from + 1e-6);
      }
    }
    expect(geometry.inputs[0]!.anchor).toBe("start");
    expect(geometry.outputs[0]!.anchor).toBe("end");
  });

  it("omits the pictogram when the box is too small for it", () => {
    const roomy = flowLayout(SLOTS[0]!, U, {
      node: "Feuille",
      inputs: branches(SHORT, 1, 1),
      outputs: branches(SHORT, 1, 1),
    });
    expect(roomy.node.icon.size).toBeGreaterThan(0);
    expect(roomy.node.icon.size).toBeLessThanOrEqual(roomy.node.width);
    const tiny = flowLayout({ width: 1088, height: 60 }, U, {
      node: "Feuille",
      inputs: branches(SHORT, 1, 1),
      outputs: branches(SHORT, 1, 1),
    });
    expect(tiny.node.icon.size).toBe(0);
  });
});

describe("flowOutline", () => {
  const branch = flowLayout(SLOTS[0]!, U, {
    node: "Feuille",
    inputs: branches(SHORT, 1, 1),
    outputs: branches(SHORT, 1, 1),
  }).inputs[0]!;

  it("is a shaft ending in a head whose tip is the end of the flow", () => {
    const points = flowOutline(branch)!;
    expect(points).toHaveLength(7);
    expect(points[3]).toEqual([branch.to, branch.y]);
    expect(points[0]![0]).toBe(branch.from);
    expect(points[6]![1] - points[0]![1]).toBeCloseTo(branch.width, 9);
    expect(points[4]![1] - points[2]![1]).toBeCloseTo(2 * branch.headHalf, 9);
  });

  it("grows from the source and shows nothing for a flow of zero or before it starts", () => {
    const half = flowOutline(branch, 0.5)!;
    expect(half[3]![0]).toBeCloseTo(branch.from + (branch.to - branch.from) / 2, 9);
    expect(flowOutline(branch, 0)).toBeNull();
    expect(flowOutline({ ...branch, width: 0 })).toBeNull();
  });

  it("shrinks its head on a stretch shorter than the head", () => {
    const points = flowOutline(branch, 0.01)!;
    expect(points[1]![0]).toBeGreaterThanOrEqual(branch.from - 1e-9);
    expect(points[3]![0] - points[1]![0]).toBeLessThanOrEqual(points[3]![0] - branch.from + 1e-9);
  });
});

describe("FlowSim", () => {
  it("draws the node and every flow at the end of the entrance", () => {
    const { container } = setup();
    for (const name of ["node", ...INPUTS, ...OUTPUTS]) {
      expect(part(container, name), name).not.toBeNull();
    }
    const texts = [...container.querySelectorAll("text")].map((text) => text.textContent);
    expect(texts.sort()).toEqual(["CO₂", "Eau", "Feuille", "Glucose", "Lumière", "O₂"].sort());
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
  });

  it("shows a single part on its own, and removes a part once hidden", () => {
    const one = setup({ beats: showing(["leaf.co2"]) });
    expect(part(one.container, "co2")).not.toBeNull();
    for (const name of ["node", "light", "water", ...OUTPUTS]) {
      expect(part(one.container, name), name).toBeNull();
    }
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["leaf"], how: "fade", at: 0 },
          { do: "hide", targets: ["leaf.o2"], at: 0.1 },
        ],
      },
    ];
    const hidden = setup({ beats });
    expect(part(hidden.container, "o2")).toBeNull();
    expect(part(hidden.container, "glucose")).not.toBeNull();
    expect(part(hidden.container, "node")).not.toBeNull();
  });

  it("puts the same width on every flow at the default values", () => {
    const { container } = setup();
    const all = widths(container, [...INPUTS, ...OUTPUTS]);
    expect(all[0]).toBeGreaterThan(0);
    for (const width of all) expect(width).toBeCloseTo(all[0]!, 9);
  });

  it("makes the outputs follow the limiting input, here the light", () => {
    const base = setup();
    const dim = setup({ values: { light: 15 } });
    const ratio = 15 / 60;
    const baseWidth = bandOf(base.container, "light").width;
    expect(bandOf(dim.container, "light").width / baseWidth).toBeCloseTo(ratio, 9);
    for (const id of OUTPUTS) {
      expect(bandOf(dim.container, id).width / baseWidth).toBeCloseTo(ratio, 9);
    }
    expect(bandOf(dim.container, "water").width).toBeCloseTo(baseWidth, 9);
    expect(bandOf(dim.container, "co2").width).toBeCloseTo(baseWidth, 9);
  });

  it("makes the outputs follow the water when it becomes the scarcest input", () => {
    const base = setup();
    const baseWidth = bandOf(base.container, "water").width;
    const dry = setup({ values: { water: 10 } });
    for (const id of OUTPUTS) {
      expect(bandOf(dry.container, id).width / baseWidth).toBeCloseTo(10 / 40, 9);
    }
    expect(bandOf(dry.container, "light").width).toBeCloseTo(baseWidth, 9);
  });

  it("does not raise the outputs when a non-limiting input grows", () => {
    const base = setup();
    const baseOutputs = widths(base.container, OUTPUTS);
    const bright = setup({ values: { light: 100 } });
    expect(bandOf(bright.container, "light").width).toBeGreaterThan(
      bandOf(base.container, "light").width,
    );
    expect(widths(bright.container, OUTPUTS)).toEqual(baseOutputs);
  });

  it("raises the outputs only as far as the scarcest input has risen", () => {
    const outputAt = (values: Record<string, number>) =>
      bandOf(setup({ values }).container, "glucose").width;
    const base = outputAt({});
    expect(outputAt({ water: 50 }) / base).toBeCloseTo(1, 9);
    expect(outputAt({ light: 90, water: 50, co2: 75 }) / base).toBeCloseTo(1.25, 9);
    expect(outputAt({ light: 90, water: 60, co2: 55 }) / base).toBeCloseTo(1.1, 9);
    expect(outputAt({ light: 90, water: 60, co2: 75 }) / base).toBeCloseTo(1.5, 9);
  });

  it("stops the outputs when an input dries up, and keeps the empty channel visible", () => {
    const { container } = setup({ values: { co2: 0 } });
    for (const id of [...OUTPUTS, "co2"]) {
      const group = part(container, id)!;
      expect(group.querySelector("polygon"), id).toBeNull();
      expect(group.querySelector("line"), id).not.toBeNull();
      expect(group.querySelector("text"), id).not.toBeNull();
    }
    expect(part(container, "light")!.querySelector("polygon")).not.toBeNull();
  });

  it("caps an output that the document binds above what the inputs allow", () => {
    const generous: Flow = {
      ...LEAF,
      outputs: [{ id: "glucose", label: "Glucose", rate: { expr: "light" } }],
    };
    const view = setup({ element: generous, values: { light: 90, co2: 25 } });
    const base = bandOf(setup({ element: generous }).container, "light").width;
    expect(bandOf(view.container, "light").width / base).toBeCloseTo(1.5, 9);
    expect(bandOf(view.container, "glucose").width / base).toBeCloseTo(0.5, 9);
  });

  it("scales a plain number rate against itself, so that only the limit moves it", () => {
    const plain: Flow = {
      ...LEAF,
      inputs: [{ id: "light", label: "Lumière", rate: { expr: "light" } }],
      outputs: [{ id: "glucose", label: "Glucose", rate: 3 }],
    };
    const base = setup({ element: plain });
    const dim = setup({ element: plain, values: { light: 30 } });
    expect(
      bandOf(dim.container, "glucose").width / bandOf(base.container, "glucose").width,
    ).toBeCloseTo(0.5, 9);
  });

  it("places the inputs on the left and the outputs on the right of the box, flowing rightwards", () => {
    const { container } = setup();
    const box = part(container, "node")!.querySelector("rect")!;
    const left = num(box, "x");
    const right = left + num(box, "width");
    for (const id of INPUTS) {
      const band = bandOf(container, id);
      expect(band.tip).toBeCloseTo(left, 6);
      expect(band.from).toBeLessThan(left);
    }
    for (const id of OUTPUTS) {
      const band = bandOf(container, id);
      expect(band.from).toBeCloseTo(right, 6);
      expect(band.tip).toBeGreaterThan(right);
    }
  });

  it("draws the node outline with the pictogram inside it and the label outside", () => {
    const { container, ctx } = setup();
    const group = part(container, "node")!;
    const box = group.querySelector("rect")!;
    const icon = group.querySelector('circle[data-kind="leaf"]')!;
    expect(num(icon, "cx")).toBeCloseTo(num(box, "x") + num(box, "width") / 2, 6);
    expect(num(icon, "cy")).toBeCloseTo(num(box, "y") + num(box, "height") / 2, 6);
    expect(num(icon, "r") * 2).toBeLessThanOrEqual(num(box, "width"));
    expect(box.getAttribute("stroke")).toBe(ctx.theme.ink);
    expect(box.getAttribute("fill")).toBe("none");
    expect(group.querySelector("text")!.textContent).toBe("Feuille");
  });

  it("omits the pictogram when the node has none", () => {
    const bare: Flow = { ...LEAF, node: { label: "Tige" } };
    const { container } = setup({ element: bare });
    expect(container.querySelector("circle")).toBeNull();
    expect(part(container, "node")!.querySelector("text")!.textContent).toBe("Tige");
  });

  it("fades a part in, and traces a flow from its source with its label after the stroke", () => {
    const fading = setup({ frame: 4, beats: showing(["leaf.light"]) });
    const opacity = num(part(fading.container, "light")!.querySelector("polygon"), "opacity");
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);

    const full = bandOf(setup().container, "light");
    const drawing = setup({ frame: 9, beats: showing(["leaf.light"], "draw") });
    const partial = bandOf(drawing.container, "light");
    expect(partial.from).toBe(full.from);
    expect(partial.tip).toBeGreaterThan(full.from);
    expect(partial.tip).toBeLessThan(full.tip);
    expect(num(part(drawing.container, "light")!.querySelector("text"), "opacity")).toBe(0);

    const done = setup({ beats: showing(["leaf.light"], "draw") });
    expect(bandOf(done.container, "light").tip).toBeCloseTo(full.tip, 9);
    expect(num(part(done.container, "light")!.querySelector("text"), "opacity")).toBe(1);
  });

  it("traces the node outline", () => {
    const { container } = setup({ frame: 9, beats: showing(["leaf.node"], "draw") });
    const box = part(container, "node")!.querySelector("rect")!;
    expect(box.hasAttribute("stroke-dasharray")).toBe(true);
    expect(num(part(container, "node")!.querySelector("text"), "opacity")).toBe(0);
  });

  it("draws a flat result band behind a highlighted flow and behind a highlighted node", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["leaf"], how: "fade", at: 0 },
          { do: "highlight", targets: ["leaf.co2", "leaf.node"], at: 0.1 },
        ],
      },
    ];
    const { container, ctx } = setup({ beats });
    const band = part(container, "co2")!.querySelector("rect")!;
    expect(band.getAttribute("fill")).toBe(ctx.theme.role.result);
    expect(num(band, "width")).toBeGreaterThan(0);
    const fills = [...part(container, "node")!.querySelectorAll("rect")].map((rect) =>
      rect.getAttribute("fill"),
    );
    expect(fills).toContain(ctx.theme.role.result);
    expect(part(container, "water")!.querySelector("rect")).toBeNull();
    expect(
      setup().container.querySelector("rect[fill='" + ctx.theme.role.result + "']"),
    ).toBeNull();
  });

  it("dims a flow that is out of focus and leaves the others alone", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["leaf"], how: "fade", at: 0 },
          { do: "focus", targets: ["leaf.light"], at: 0 },
        ],
      },
    ];
    const { container } = setup({ beats });
    const opacityOf = (id: string) => num(part(container, id)!.querySelector("polygon"), "opacity");
    expect(opacityOf("light")).toBe(1);
    expect(opacityOf("water")).toBeLessThan(1);
    expect(opacityOf("glucose")).toBeCloseTo(opacityOf("water"), 9);
  });

  describe.each<ThemeName>(["paper", "board"])("in the %s theme", (theme) => {
    it("takes every colour from the theme tokens", () => {
      const { container, ctx } = setup({
        theme,
        beats: [
          {
            id: "b1",
            narration: "Test.",
            duration_ms: 4000,
            actions: [
              { do: "show", targets: ["leaf"], how: "fade", at: 0 },
              { do: "highlight", targets: ["leaf.co2"], at: 0.1 },
            ],
          },
        ],
      });
      const tokens = new Set([
        ctx.theme.ink,
        ctx.theme.surfaceRaised,
        ctx.theme.rule,
        ...Object.values(ctx.theme.role),
      ]);
      const used = new Set<string>();
      for (const element of container.querySelectorAll("[fill], [stroke]")) {
        for (const name of ["fill", "stroke"]) {
          const value = element.getAttribute(name);
          if (value && value !== "none") used.add(value);
        }
      }
      expect(used.size).toBeGreaterThan(0);
      for (const colour of used) expect(tokens.has(colour), colour).toBe(true);
    });

    it("colours a flow with the action role by default and with its own role when it has one", () => {
      const coded: Flow = {
        ...LEAF,
        inputs: [
          { id: "light", label: "Lumière", rate: { expr: "light" }, role: "quantity" },
          { id: "water", label: "Eau", rate: { expr: "water" } },
          { id: "co2", label: "CO₂", rate: { expr: "co2" }, role: "result" },
        ],
      };
      const { container, ctx } = setup({ theme, element: coded });
      const { role } = ctx.theme;
      const fill = (id: string) =>
        part(container, id)!.querySelector("polygon")!.getAttribute("fill");
      const ink = (id: string) => part(container, id)!.querySelector("text")!.getAttribute("fill");
      expect(fill("water")).toBe(role.action);
      expect(ink("water")).toBe(role.actionText);
      expect(fill("light")).toBe(role.quantity);
      expect(ink("light")).toBe(role.quantity);
      expect(fill("co2")).toBe(role.result);
      expect(ink("co2")).toBe(ctx.theme.ink);
      expect(fill("glucose")).toBe(role.action);
      expect(part(container, "node")!.querySelector("text")!.getAttribute("fill")).toBe(
        ctx.theme.ink,
      );
      expect(part(container, "water")!.querySelector("line")!.getAttribute("stroke")).toBe(
        ctx.theme.rule,
      );
    });
  });
});
