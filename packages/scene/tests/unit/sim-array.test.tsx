// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { arraySteps, type ArrayAlgorithm } from "../../src/primitives/sim/array-steps";
import type { ElementOf, LayoutName, Param, Scene, SlotName } from "../../src/schema/document";
import type { ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext } from "../helpers/scene";

const last = <T,>(items: readonly T[]): T => items[items.length - 1]!;
const sortedCopy = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);
const inversions = (values: readonly number[]): number =>
  values.reduce(
    (count, value, i) => count + values.slice(i + 1).filter((other) => other < value).length,
    0,
  );
const isPermutation = (a: readonly number[], b: readonly number[]): boolean =>
  JSON.stringify(sortedCopy(a)) === JSON.stringify(sortedCopy(b));

const SAMPLES: number[][] = [
  [5, 2, 9, 1, 7, 3],
  [1, 2, 3, 4],
  [9, 7, 5, 3, 1],
  [3, 1, 3, 2, 1],
  [4, 4, 4],
  [2.5, -1, 0.75, 10, -3.25],
  [8, 6, 7, 5, 3, 0, 9, 1, 2, 4],
];

describe("bubble sort steps", () => {
  it("sorts every sample and settles every index at the last step", () => {
    for (const values of SAMPLES) {
      const steps = arraySteps("bubble-sort", values);
      expect(last(steps).values).toEqual(sortedCopy(values));
      expect(last(steps).settled).toEqual(values.map((_, i) => i));
    }
  });

  it("leaves the input untouched and starts from it", () => {
    const values = [5, 2, 9, 1];
    const steps = arraySteps("bubble-sort", values);
    expect(values).toEqual([5, 2, 9, 1]);
    expect(steps[0]!.values).toEqual([5, 2, 9, 1]);
    expect(steps[0]!.compare).toBeNull();
    expect(steps[0]!.swap).toBeNull();
    expect(steps[0]!.settled).toEqual([]);
  });

  it("swaps exactly once per inversion, and each swap exchanges only its two cells", () => {
    for (const values of SAMPLES) {
      const steps = arraySteps("bubble-sort", values);
      const swaps = steps.filter((step) => step.swap);
      expect(swaps).toHaveLength(inversions(values));
      steps.forEach((step, i) => {
        expect(isPermutation(step.values, values)).toBe(true);
        if (!step.swap || i === 0) return;
        const [a, b] = step.swap;
        const before = steps[i - 1]!.values;
        expect(step.values[a]).toBe(before[b]);
        expect(step.values[b]).toBe(before[a]);
        step.values.forEach((value, k) => {
          if (k !== a && k !== b) expect(value).toBe(before[k]);
        });
        expect(before[a]).toBeGreaterThan(before[b]!);
      });
    }
  });

  it("compares neighbours and reports the relation of their values", () => {
    for (const values of SAMPLES) {
      for (const step of arraySteps("bubble-sort", values)) {
        if (!step.compare) continue;
        const { left, right, relation } = step.compare;
        expect(right).toBe(left + 1);
        const [a, b] = [step.values[left]!, step.values[right]!];
        expect(relation).toBe(a < b ? "<" : a > b ? ">" : "=");
      }
    }
  });

  it("does not compare and swap in the same step", () => {
    for (const step of arraySteps("bubble-sort", SAMPLES[0]!)) {
      expect(Boolean(step.compare) && Boolean(step.swap)).toBe(false);
      expect(step.probe).toBeNull();
      expect(step.window).toBeNull();
    }
  });

  it("follows the expected sequence on three values", () => {
    const steps = arraySteps("bubble-sort", [3, 1, 2]);
    const summary = steps.map((step) =>
      step.compare
        ? `cmp ${step.compare.left}${step.compare.right}${step.compare.relation}`
        : step.swap
          ? `swap ${step.swap.join("")}`
          : "start",
    );
    expect(summary).toEqual(["start", "cmp 01>", "swap 01", "cmp 12>", "swap 12", "cmp 01<"]);
    expect(steps.map((step) => step.settled)).toEqual([[], [], [], [], [2], [0, 1, 2]]);
    expect(steps.map((step) => step.values)).toEqual([
      [3, 1, 2],
      [3, 1, 2],
      [1, 3, 2],
      [1, 3, 2],
      [1, 2, 3],
      [1, 2, 3],
    ]);
  });

  it("stops after one pass without a swap on a sorted array", () => {
    const steps = arraySteps("bubble-sort", [1, 2, 3, 4]);
    expect(steps).toHaveLength(4);
    expect(steps.some((step) => step.swap)).toBe(false);
    expect(last(steps).settled).toEqual([0, 1, 2, 3]);
  });

  it("settles the largest values from the right, one pass at a time", () => {
    const steps = arraySteps("bubble-sort", [5, 2, 9, 1, 7, 3]);
    const sizes = steps.map((step) => step.settled.length);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    for (const step of steps) {
      const { settled, values } = step;
      if (settled.length === values.length) continue;
      expect(settled).toEqual(settled.map((_, k) => values.length - settled.length + k));
    }
  });
});

describe("selection sort steps", () => {
  it("sorts every sample, in at most n - 1 swaps", () => {
    for (const values of SAMPLES) {
      const steps = arraySteps("selection-sort", values);
      expect(last(steps).values).toEqual(sortedCopy(values));
      expect(last(steps).settled).toEqual(values.map((_, i) => i));
      expect(steps.filter((step) => step.swap).length).toBeLessThanOrEqual(values.length - 1);
      for (const step of steps) expect(isPermutation(step.values, values)).toBe(true);
    }
  });

  it("compares the current minimum with each later cell, on the left of it", () => {
    for (const values of SAMPLES) {
      for (const step of arraySteps("selection-sort", values)) {
        if (!step.compare) continue;
        const { left, right, relation } = step.compare;
        expect(left).toBeLessThan(right);
        const [a, b] = [step.values[left]!, step.values[right]!];
        expect(relation).toBe(a < b ? "<" : a > b ? ">" : "=");
      }
    }
  });

  it("follows the expected sequence on three values", () => {
    const steps = arraySteps("selection-sort", [3, 1, 2]);
    const summary = steps.map((step) =>
      step.compare
        ? `cmp ${step.compare.left}${step.compare.right}${step.compare.relation}`
        : step.swap
          ? `swap ${step.swap.join("")}`
          : "start",
    );
    expect(summary).toEqual(["start", "cmp 01>", "cmp 12<", "swap 01", "cmp 12>", "swap 12"]);
    expect(steps.map((step) => step.settled)).toEqual([[], [], [], [0], [0], [0, 1, 2]]);
  });

  it("grows the settled prefix and never swaps into the settled part", () => {
    const steps = arraySteps("selection-sort", [5, 2, 9, 1, 7, 3]);
    for (const step of steps) {
      expect(step.settled).toEqual(step.settled.map((_, k) => k));
    }
    steps.forEach((step, i) => {
      if (!step.swap || i === 0) return;
      const prefix = steps[i - 1]!.settled.length;
      expect(step.swap[0]).toBeGreaterThanOrEqual(prefix);
    });
  });
});

describe("binary search steps", () => {
  const SORTED = [1, 3, 5, 7, 9, 11, 13];

  it("halves the window until it finds the target", () => {
    const steps = arraySteps("binary-search", SORTED, 11);
    expect(steps.map((step) => step.probe && [step.probe.index, step.probe.relation])).toEqual([
      null,
      [3, "<"],
      [5, "="],
    ]);
    expect(steps.map((step) => step.window)).toEqual([
      { low: 0, high: 6 },
      { low: 0, high: 6 },
      { low: 4, high: 6 },
    ]);
    expect(last(steps).found).toBe(5);
    expect(steps.slice(0, -1).every((step) => step.found === null)).toBe(true);
  });

  it("ends on an empty window when the target is absent", () => {
    const steps = arraySteps("binary-search", SORTED, 6);
    const end = last(steps);
    expect(end.found).toBeNull();
    expect(end.probe).toBeNull();
    expect(end.window!.low).toBe(end.window!.high + 1);
    expect(steps.some((step) => step.probe?.relation === "=")).toBe(false);
  });

  it("finds a value exactly when it is in the array, within log2(n) + 1 probes", () => {
    for (let target = -1; target <= 15; target += 1) {
      const steps = arraySteps("binary-search", SORTED, target);
      const end = last(steps);
      const present = SORTED.includes(target);
      expect(end.found !== null).toBe(present);
      if (end.found !== null) expect(end.values[end.found]).toBe(target);
      expect(steps.filter((step) => step.probe).length).toBeLessThanOrEqual(3);
    }
  });

  it("probes the middle of the window and moves the right bound", () => {
    for (const target of [-5, 0, 4, 6, 14, 99]) {
      const steps = arraySteps("binary-search", SORTED, target);
      steps.forEach((step, i) => {
        if (!step.probe || !step.window) return;
        const { low, high } = step.window;
        expect(step.probe.index).toBe(Math.floor((low + high) / 2));
        const next = steps[i + 1]?.window;
        if (!next || step.probe.relation === "=") return;
        expect(next.low).toBeGreaterThanOrEqual(low);
        expect(next.high).toBeLessThanOrEqual(high);
        if (step.probe.relation === "<") expect(next).toEqual({ low: step.probe.index + 1, high });
        else expect(next).toEqual({ low, high: step.probe.index - 1 });
      });
    }
  });

  it("searches the values in ascending order, whatever order they come in", () => {
    const steps = arraySteps("binary-search", [9, 1, 5], 5);
    expect(steps[0]!.values).toEqual([1, 5, 9]);
    expect(last(steps).found).toBe(1);
  });

  it("works on a single value", () => {
    expect(last(arraySteps("binary-search", [4], 4)).found).toBe(0);
    expect(last(arraySteps("binary-search", [4], 5)).found).toBeNull();
  });
});

describe("linear search steps", () => {
  it("scans from the left and stops on the first match", () => {
    const steps = arraySteps("linear-search", [4, 9, 2, 7, 2], 2);
    expect(steps.map((step) => step.probe && [step.probe.index, step.probe.relation])).toEqual([
      null,
      [0, "≠"],
      [1, "≠"],
      [2, "="],
    ]);
    expect(last(steps).found).toBe(2);
    expect(steps.map((step) => step.window?.low)).toEqual([0, 0, 1, 2]);
  });

  it("looks at every cell, then ends on an empty window, when the target is absent", () => {
    const steps = arraySteps("linear-search", [4, 9, 2, 7], 8);
    expect(steps).toHaveLength(6);
    expect(steps.filter((step) => step.probe)).toHaveLength(4);
    const end = last(steps);
    expect(end.found).toBeNull();
    expect(end.window).toEqual({ low: 4, high: 3 });
  });

  it("keeps the order of the values", () => {
    expect(arraySteps("linear-search", [9, 1, 5], 5)[0]!.values).toEqual([9, 1, 5]);
  });
});

describe("search without a target", () => {
  it.each<ArrayAlgorithm>(["binary-search", "linear-search"])("%s shows the array only", (name) => {
    const steps = arraySteps(name, [1, 2, 3]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.probe).toBeNull();
  });
});

type ArrayElement = ElementOf<"sim.array">;

const ARRAY: ArrayElement = {
  id: "arr",
  slot: "figure",
  type: "sim.array",
  values: [5, 2, 9, 1, 7, 3],
  algorithm: "bubble-sort",
  step: 0,
};
const SEARCH: ArrayElement = {
  ...ARRAY,
  values: [3, 8, 12, 17, 23, 31, 42, 56],
  algorithm: "binary-search",
  target: 31,
};

const param = (id: string): Param => ({
  id,
  symbol: id,
  label: id,
  unit: "",
  min: 0,
  max: 100,
  step: 1,
  default: 0,
  role: "quantity",
});

const at = (element: ArrayElement, step: number): ArrayElement => ({ ...element, step });

interface Setup {
  element?: ArrayElement;
  theme?: ThemeName;
  frame?: number | "end";
  beats?: Scene["beats"];
  layout?: LayoutName;
  slot?: SlotName;
  language?: "fr" | "en";
  values?: Record<string, number>;
}

function setup({ element = ARRAY, slot = "figure", layout, ...rest }: Setup = {}) {
  const placed: ArrayElement = { ...element, slot };
  const scene = sceneOf([placed], { beats: rest.beats, layout });
  const ctx = testContext({
    scene,
    slot,
    params: [param("s")],
    values: rest.values,
    theme: rest.theme,
    frame: rest.frame,
    language: rest.language,
  });
  return { ctx, ...renderElement(placed, ctx) };
}

const num = (element: Element | null | undefined, name: string): number => {
  if (!element) throw new Error(`missing element for ${name}`);
  return Number(element.getAttribute(name));
};
const part = (container: Element, name: string): Element | null =>
  container.querySelector(`[data-part="${name}"]`);
const cells = (container: Element): Element[] => [...container.querySelectorAll("[data-cell]")];
const states = (container: Element): string[] =>
  cells(container).map((cell) => cell.getAttribute("data-state")!);
const rectOf = (cell: Element): Element => cell.querySelector("rect")!;
const valueOf = (cell: Element): string => cell.querySelector("text")!.textContent!;
const centreOf = (cell: Element): number => num(rectOf(cell), "x") + num(rectOf(cell), "width") / 2;
const pointsOf = (d: string): [number, number][] => {
  const numbers = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
  return Array.from({ length: numbers.length / 2 }, (_, i) => [
    numbers[2 * i]!,
    numbers[2 * i + 1]!,
  ]);
};

describe("ArraySim cells", () => {
  it("draws one boxed cell per value, in order, with its index below", () => {
    const { container } = setup();
    const row = cells(container);
    expect(row.map(valueOf)).toEqual(["5", "2", "9", "1", "7", "3"]);
    expect(row.map((cell) => cell.querySelectorAll("text")[1]!.textContent)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    const xs = row.map((cell) => num(rectOf(cell), "x"));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    const widths = new Set(row.map((cell) => num(rectOf(cell), "width")));
    expect(widths.size).toBe(1);
    expect(states(container).every((state) => state === "normal")).toBe(true);
  });

  it("writes decimals and negative numbers with the language of the document", () => {
    const element: ArrayElement = { ...ARRAY, values: [2.5, -1, 0.75, 10, 1.004] };
    expect(cells(setup({ element }).container).map(valueOf)).toEqual([
      "2,5",
      "−1",
      "0,75",
      "10",
      "1",
    ]);
    expect(cells(setup({ element, language: "en" }).container).map(valueOf)).toEqual([
      "2.5",
      "−1",
      "0.75",
      "10",
      "1",
    ]);
  });

  it("draws the values in a single size, shrunk to the widest one", () => {
    const sizes = (element: ArrayElement) => [
      ...new Set(
        cells(setup({ element }).container).map((cell) =>
          num(cell.querySelector("text"), "font-size"),
        ),
      ),
    ];
    const short = sizes(ARRAY);
    const long = sizes({ ...ARRAY, values: [5, 2, 9, 1, 7, 12345.5] });
    expect(short).toHaveLength(1);
    expect(long).toHaveLength(1);
    expect(long[0]!).toBeLessThan(short[0]!);
  });

  it("draws nothing before the entrance starts", () => {
    const { container } = setup({ frame: 0 });
    expect(container.querySelector("[data-part]")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("traces the cell outlines before their values", () => {
    const { container } = setup({
      frame: 9,
      beats: [
        {
          id: "b1",
          narration: "Test.",
          duration_ms: 4000,
          actions: [{ do: "show", targets: ["arr"], how: "draw", at: 0 }],
        },
      ],
    });
    for (const cell of cells(container)) {
      expect(rectOf(cell).hasAttribute("stroke-dasharray")).toBe(true);
      expect(num(cell.querySelector("text"), "opacity")).toBe(0);
    }
  });
});

describe("ArraySim step", () => {
  it("shows the step given by a number, clamped to the steps that exist", () => {
    const counter = (step: number) =>
      part(setup({ element: at(ARRAY, step) }).container, "counter");
    expect(counter(0)!.textContent).toBe("0/22");
    expect(counter(7)!.textContent).toBe("7/22");
    expect(counter(22)!.textContent).toBe("22/22");
    expect(counter(500)!.textContent).toBe("22/22");
    expect(counter(-4)!.textContent).toBe("0/22");
  });

  it("rounds a fractional step to the nearest one", () => {
    const counter = (step: number) =>
      part(setup({ element: at(ARRAY, step) }).container, "counter");
    expect(counter(4.4)!.textContent).toBe("4/22");
    expect(counter(4.6)!.textContent).toBe("5/22");
  });

  it("follows an expression, so that a slider can drive it", () => {
    const element: ArrayElement = { ...ARRAY, step: { expr: "s" } };
    expect(part(setup({ element, values: { s: 6 } }).container, "counter")!.textContent).toBe(
      "6/22",
    );
    expect(part(setup({ element, values: { s: 0 } }).container, "counter")!.textContent).toBe(
      "0/22",
    );
  });

  it("advances with a play action, from the first step to the one asked for", () => {
    const element: ArrayElement = { ...ARRAY };
    delete element.step;
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["arr"], how: "fade", at: 0 },
          { do: "play", target: "arr", to: 22, at: 0 },
        ],
      },
    ];
    const reached = ([1, 30, 60, 90, "end"] as const).map((frame) =>
      Number(
        part(setup({ element, beats, frame }).container, "counter")!.textContent!.split("/")[0],
      ),
    );
    expect(reached[0]).toBe(0);
    expect(reached).toEqual([...reached].sort((a, b) => a - b));
    expect(new Set(reached).size).toBe(reached.length);
    expect(reached.at(-1)).toBe(22);
  });

  it("shows the starting array when nothing drives the step", () => {
    const element: ArrayElement = { ...ARRAY };
    delete element.step;
    const { container } = setup({ element });
    expect(cells(container).map(valueOf)).toEqual(["5", "2", "9", "1", "7", "3"]);
    expect(part(container, "counter")!.textContent).toBe("0/22");
  });

  it("hides the counter when the algorithm has no step to show", () => {
    const element: ArrayElement = { ...SEARCH };
    delete element.target;
    const { container } = setup({ element });
    expect(part(container, "counter")).toBeNull();
    expect(cells(container)).toHaveLength(8);
  });
});

describe("ArraySim sorting", () => {
  it("starts with no mark at all", () => {
    const { container } = setup();
    for (const name of ["bridge", "relation", "mid", "low", "high", "swap"]) {
      expect(part(container, name), name).toBeNull();
    }
    expect(container.querySelector("[data-run]")).toBeNull();
  });

  it("joins the two compared cells with a bridge and names the relation of their values", () => {
    const { container, ctx } = setup({ element: at(ARRAY, 4) });
    expect(states(container)).toEqual([
      "normal",
      "normal",
      "compared",
      "compared",
      "normal",
      "normal",
    ]);
    const row = cells(container);
    expect(valueOf(row[2]!)).toBe("9");
    expect(valueOf(row[3]!)).toBe("1");
    expect(num(rectOf(row[2]!), "stroke-width")).toBeGreaterThan(
      num(rectOf(row[0]!), "stroke-width"),
    );
    expect(rectOf(row[2]!).getAttribute("stroke")).toBe(ctx.theme.role.quantity);
    expect(part(container, "relation")!.textContent).toBe(">");
    const bridge = pointsOf(part(container, "bridge")!.getAttribute("d")!);
    expect(bridge[0]![0]).toBeCloseTo(centreOf(row[2]!), 6);
    expect(bridge.at(-1)![0]).toBeCloseTo(centreOf(row[3]!), 6);
    const cellTop = num(rectOf(row[2]!), "y");
    expect(Math.max(...bridge.map(([, y]) => y))).toBeLessThan(cellTop);
    expect(part(container, "swap")).toBeNull();
  });

  it("puts the relation above the middle of the bridge", () => {
    const { container } = setup({ element: at(ARRAY, 4) });
    const row = cells(container);
    expect(num(part(container, "relation"), "x")).toBeCloseTo(
      (centreOf(row[2]!) + centreOf(row[3]!)) / 2,
      6,
    );
  });

  it("draws the two values exchanged, and an arc from one cell to the other, at a swap step", () => {
    const { container, ctx } = setup({ element: at(ARRAY, 5) });
    const row = cells(container);
    expect(row.map(valueOf)).toEqual(["2", "5", "1", "9", "7", "3"]);
    expect(states(container)).toEqual([
      "normal",
      "normal",
      "swapped",
      "swapped",
      "normal",
      "normal",
    ]);
    expect(rectOf(row[2]!).getAttribute("stroke")).toBe(ctx.theme.role.action);
    const swap = part(container, "swap")!;
    const arc = pointsOf(swap.querySelector("path")!.getAttribute("d")!);
    expect(arc[0]![0]).toBeCloseTo(centreOf(row[2]!), 6);
    expect(arc.at(-1)![0]).toBeCloseTo(centreOf(row[3]!), 6);
    expect(swap.querySelectorAll("polygon")).toHaveLength(2);
    expect(part(container, "bridge")).toBeNull();
    expect(container.querySelector("[data-part=relation]")).toBeNull();
  });

  it("joins cells that are not neighbours when selection sort compares them", () => {
    const element: ArrayElement = { ...ARRAY, algorithm: "selection-sort", step: 5 };
    const { container } = setup({ element });
    const row = cells(container);
    expect(states(container)).toEqual([
      "normal",
      "normal",
      "normal",
      "compared",
      "normal",
      "compared",
    ]);
    const bridge = pointsOf(part(container, "bridge")!.getAttribute("d")!);
    expect(bridge[0]![0]).toBeCloseTo(centreOf(row[3]!), 6);
    expect(bridge.at(-1)![0]).toBeCloseTo(centreOf(row[5]!), 6);
    expect(part(container, "relation")!.textContent).toBe("<");
  });

  it("marks the cells that are in place with a rule under the whole run", () => {
    const { container, ctx } = setup({ element: at(ARRAY, 11) });
    expect(states(container)).toEqual([
      "normal",
      "compared",
      "compared",
      "normal",
      "normal",
      "settled",
    ]);
    expect(rectOf(cells(container)[5]!).getAttribute("stroke")).toBe(ctx.theme.role.valid);
    const runs = [...container.querySelectorAll("[data-run]")];
    expect(runs.map((run) => run.getAttribute("data-run"))).toEqual(["5-5"]);
    expect(runs[0]!.getAttribute("stroke")).toBe(ctx.theme.role.valid);
  });

  it("ends with every cell in place under a single rule, values in order", () => {
    const { container } = setup({ element: at(ARRAY, 99) });
    expect(cells(container).map(valueOf)).toEqual(["1", "2", "3", "5", "7", "9"]);
    const runs = [...container.querySelectorAll("[data-run]")];
    expect(runs.map((run) => run.getAttribute("data-run"))).toEqual(["0-5"]);
    const row = cells(container);
    const [start, , , end] = pointsOf(runs[0]!.getAttribute("d")!);
    expect(start![0]).toBeCloseTo(num(rectOf(row[0]!), "x"), 6);
    expect(end![0]).toBeCloseTo(num(rectOf(row[5]!), "x") + num(rectOf(row[5]!), "width"), 6);
  });

  it("does not show the target of a sort", () => {
    expect(
      part(setup({ element: { ...ARRAY, target: 4, step: 4 } }).container, "target"),
    ).toBeNull();
  });
});

describe("ArraySim searching", () => {
  it("names the value looked for, in italic", () => {
    const { container } = setup({ element: at(SEARCH, 0) });
    const target = part(container, "target")!;
    expect(target.textContent).toBe("x = 31");
    expect(target.querySelector("tspan")!.getAttribute("font-style")).toBe("italic");
  });

  it("brackets the window, points at the probed cell, and sets the others apart", () => {
    const { container, ctx } = setup({ element: at(SEARCH, 2) });
    expect(states(container)).toEqual([
      "excluded",
      "excluded",
      "excluded",
      "excluded",
      "normal",
      "found",
      "normal",
      "normal",
    ]);
    const row = cells(container);
    const low = pointsOf(part(container, "low")!.getAttribute("d")!);
    const high = pointsOf(part(container, "high")!.getAttribute("d")!);
    const edge = (cell: Element, side: "left" | "right") =>
      num(rectOf(cell), "x") + (side === "right" ? num(rectOf(cell), "width") : 0);
    expect(low[1]![0]).toBeGreaterThan(edge(row[3]!, "right"));
    expect(low[1]![0]).toBeLessThan(edge(row[4]!, "left"));
    expect(high[1]![0]).toBeGreaterThan(edge(row[7]!, "right"));
    expect(low[2]![0]).toBe(low[1]![0]);
    expect(low[0]![0]).toBeGreaterThan(low[1]![0]);
    expect(high[0]![0]).toBeLessThan(high[1]![0]);
    const pointer = pointsOf(part(container, "mid")!.getAttribute("points")!.replaceAll(",", " "));
    expect(pointer[0]![0]).toBeCloseTo(centreOf(row[5]!), 6);
    expect(pointer[0]![1]).toBeLessThan(num(rectOf(row[5]!), "y"));
    expect(part(container, "relation")!.textContent).toBe("=");
    expect(num(part(container, "relation"), "x")).toBeCloseTo(centreOf(row[5]!), 6);
    expect(rectOf(row[5]!).getAttribute("stroke")).toBe(ctx.theme.role.valid);
  });

  it("tells the cells apart by something other than their colour", () => {
    const { container } = setup({ element: at(SEARCH, 2) });
    const row = cells(container);
    const signature = (cell: Element) => {
      const rect = rectOf(cell);
      return [
        cell.querySelectorAll("rect").length,
        rect.getAttribute("stroke-width"),
        rect.getAttribute("stroke-dasharray"),
      ].join("|");
    };
    const byState = new Map<string, string>();
    row.forEach((cell) => byState.set(cell.getAttribute("data-state")!, signature(cell)));
    expect(byState.size).toBe(3);
    expect(new Set(byState.values()).size).toBe(3);
    expect(rectOf(row[0]!).hasAttribute("stroke-dasharray")).toBe(true);
    expect(row[5]!.querySelectorAll("rect")).toHaveLength(2);
    expect(row[4]!.querySelectorAll("rect")).toHaveLength(1);
  });

  it("tells the bounds apart from each other by their shape", () => {
    const { container } = setup({ element: at(SEARCH, 1) });
    const low = pointsOf(part(container, "low")!.getAttribute("d")!);
    const high = pointsOf(part(container, "high")!.getAttribute("d")!);
    expect(low[0]![0]).toBeGreaterThan(low[1]![0]);
    expect(high[0]![0]).toBeLessThan(high[1]![0]);
    expect(part(container, "low")!.getAttribute("stroke")).toBe(
      part(container, "high")!.getAttribute("stroke"),
    );
  });

  it("closes in on the target: the window narrows from one probe to the next", () => {
    const widths = [1, 2, 3].map((step) => {
      const { container } = setup({ element: { ...at(SEARCH, step), target: 20 } });
      return states(container).filter((state) => state !== "excluded").length;
    });
    expect(widths).toEqual([8, 4, 1]);
  });

  it("ends on crossed brackets and no cell left when the target is absent", () => {
    const { container } = setup({ element: { ...at(SEARCH, 99), target: 20 } });
    expect(states(container).every((state) => state === "excluded")).toBe(true);
    expect(part(container, "mid")).toBeNull();
    expect(container.querySelector("[data-part=relation]")).toBeNull();
    const low = pointsOf(part(container, "low")!.getAttribute("d")!);
    const high = pointsOf(part(container, "high")!.getAttribute("d")!);
    expect(low[1]![0]).toBeGreaterThan(high[1]![0]);
    expect(low[0]![0]).toBeGreaterThan(low[1]![0]);
    expect(high[0]![0]).toBeLessThan(high[1]![0]);
  });

  it("ends on the cell that holds the target", () => {
    const { container } = setup({ element: at(SEARCH, 99) });
    const found = cells(container).filter((cell) => cell.getAttribute("data-state") === "found");
    expect(found.map(valueOf)).toEqual(["31"]);
  });

  it("scans a linear search cell by cell, dropping the ones already seen", () => {
    const element: ArrayElement = {
      ...ARRAY,
      values: [4, 9, 2, 7, 6],
      algorithm: "linear-search",
      target: 7,
    };
    const third = setup({ element: at(element, 3) });
    expect(states(third.container)).toEqual([
      "excluded",
      "excluded",
      "compared",
      "normal",
      "normal",
    ]);
    expect(part(third.container, "relation")!.textContent).toBe("≠");
    expect(part(third.container, "low")).toBeNull();
    expect(part(third.container, "high")).toBeNull();
    const done = setup({ element: at(element, 4) });
    expect(states(done.container)).toEqual(["excluded", "excluded", "excluded", "found", "normal"]);
    expect(part(done.container, "relation")!.textContent).toBe("=");
    const absent = setup({ element: { ...at(element, 99), target: 8 } });
    expect(states(absent.container).every((state) => state === "excluded")).toBe(true);
  });

  it("sorts the values of a binary search for display", () => {
    const element: ArrayElement = { ...SEARCH, values: [42, 3, 17, 8], target: 17, step: 0 };
    expect(cells(setup({ element }).container).map(valueOf)).toEqual(["3", "8", "17", "42"]);
  });
});

describe("ArraySim parts", () => {
  const only = (...targets: string[]): Scene["beats"] => [
    {
      id: "b1",
      narration: "Test.",
      duration_ms: 4000,
      actions: [{ do: "show", targets, how: "fade", at: 0 }],
    },
  ];

  it("draws every part of a step when the whole simulation is shown", () => {
    const { container } = setup({ element: at(SEARCH, 1) });
    for (const name of ["cells", "compare", "low", "high", "mid", "counter"]) {
      expect(part(container, name), name).not.toBeNull();
    }
  });

  it("draws the cells alone, without any mark, when only the cells are shown", () => {
    const { container } = setup({ element: at(ARRAY, 4), beats: only("arr.cells") });
    expect(part(container, "cells")).not.toBeNull();
    for (const name of ["compare", "swap", "counter", "bridge"]) {
      expect(part(container, name), name).toBeNull();
    }
    expect(states(container).every((state) => state === "normal")).toBe(true);
  });

  it("shows the bounds of a search only when they are shown", () => {
    const { container } = setup({
      element: at(SEARCH, 2),
      beats: only("arr.cells", "arr.low", "arr.high"),
    });
    expect(part(container, "low")).not.toBeNull();
    expect(part(container, "high")).not.toBeNull();
    expect(part(container, "mid")).toBeNull();
    expect(part(container, "compare")).toBeNull();
    expect(states(container)).toEqual([
      "excluded",
      "excluded",
      "excluded",
      "excluded",
      "normal",
      "found",
      "normal",
      "normal",
    ]);
  });

  it("shows a swap on its own", () => {
    const { container } = setup({ element: at(ARRAY, 5), beats: only("arr.cells", "arr.swap") });
    expect(part(container, "swap")).not.toBeNull();
    expect(states(container)[2]).toBe("swapped");
    expect(part(container, "compare")).toBeNull();
  });

  it("draws a flat result band behind a highlighted comparison, and dark values on it in the board theme", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["arr"], how: "fade", at: 0 },
          { do: "highlight", targets: ["arr.compare"], at: 0.1 },
        ],
      },
    ];
    const { container, ctx } = setup({ element: at(ARRAY, 4), beats, theme: "board" });
    const bands = [...container.querySelectorAll("rect")].filter(
      (rect) => rect.getAttribute("fill") === ctx.theme.role.result,
    );
    expect(bands).toHaveLength(2);
    const row = cells(container);
    expect(row[2]!.querySelector("text")!.getAttribute("fill")).toBe(ctx.theme.surface);
    expect(row[0]!.querySelector("text")!.getAttribute("fill")).toBe(ctx.theme.ink);
    const plain = setup({ element: at(ARRAY, 4), theme: "board" });
    expect(
      [...plain.container.querySelectorAll("rect")].some(
        (rect) => rect.getAttribute("fill") === plain.ctx.theme.role.result,
      ),
    ).toBe(false);
  });
});

describe.each<ThemeName>(["paper", "board"])("ArraySim in the %s theme", (theme) => {
  it("takes every colour from the theme tokens", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [
          { do: "show", targets: ["arr"], how: "fade", at: 0 },
          { do: "highlight", targets: ["arr.mid"], at: 0.1 },
        ],
      },
    ];
    for (const element of [at(SEARCH, 2), at(SEARCH, 99), at(ARRAY, 5), at(ARRAY, 11)]) {
      const { container, ctx } = setup({ element, theme, beats });
      const tokens = new Set([
        ctx.theme.ink,
        ctx.theme.inkFaint,
        ctx.theme.surface,
        ctx.theme.surfaceRaised,
        ...Object.values(ctx.theme.role),
      ]);
      const used = new Set<string>();
      for (const node of container.querySelectorAll("[fill], [stroke]")) {
        for (const name of ["fill", "stroke"]) {
          const value = node.getAttribute(name);
          if (value && value !== "none") used.add(value);
        }
      }
      expect(used.size).toBeGreaterThan(0);
      for (const colour of used) expect(tokens.has(colour), colour).toBe(true);
    }
  });

  it("keeps the roles: quantity for what is compared, action for what moves, valid for what is done", () => {
    const { container: compared, ctx } = setup({ element: at(ARRAY, 4), theme });
    expect(part(compared, "bridge")!.getAttribute("stroke")).toBe(ctx.theme.role.quantity);
    expect(part(compared, "relation")!.getAttribute("fill")).toBe(ctx.theme.role.quantity);
    const { container: swapped } = setup({ element: at(ARRAY, 5), theme });
    expect(part(swapped, "swap")!.querySelector("path")!.getAttribute("stroke")).toBe(
      ctx.theme.role.action,
    );
    expect(part(swapped, "swap")!.querySelector("polygon")!.getAttribute("fill")).toBe(
      ctx.theme.role.action,
    );
    const { container: done } = setup({ element: at(ARRAY, 99), theme });
    for (const run of done.querySelectorAll("[data-run]")) {
      expect(run.getAttribute("stroke")).toBe(ctx.theme.role.valid);
    }
  });

  it("uses at most three colour roles besides the ink, whatever the step", () => {
    for (const element of [at(SEARCH, 2), at(ARRAY, 5), at(ARRAY, 11), at(ARRAY, 99)]) {
      const { container, ctx } = setup({ element, theme });
      const roles = new Set<string>();
      for (const node of container.querySelectorAll("[fill], [stroke]")) {
        for (const name of ["fill", "stroke"]) {
          const value = node.getAttribute(name);
          if (value && Object.values(ctx.theme.role).includes(value)) roles.add(value);
        }
      }
      expect(roles.size).toBeLessThanOrEqual(3);
      expect(roles.has(ctx.theme.role.result)).toBe(false);
    }
  });
});

describe("ArraySim fits its slot", () => {
  const SLOTS: { layout: LayoutName; slot: SlotName }[] = [
    { layout: "figure", slot: "figure" },
    { layout: "formula-focus", slot: "figure" },
    { layout: "compare", slot: "figure_a" },
  ];
  const valuesOf = (count: number, wide: boolean): number[] =>
    Array.from(
      { length: count },
      (_, i) => ((i * 37 + 11) % 97) * (wide ? 12.5 : 1) + (wide ? 1000 : 0),
    );

  function assertInside(container: Element, width: number, height: number, label: string) {
    const within = (x: number, y: number, what: string) => {
      expect(x, `${label} ${what} x`).toBeGreaterThanOrEqual(-1e-6);
      expect(x, `${label} ${what} x`).toBeLessThanOrEqual(width + 1e-6);
      expect(y, `${label} ${what} y`).toBeGreaterThanOrEqual(-1e-6);
      expect(y, `${label} ${what} y`).toBeLessThanOrEqual(height + 1e-6);
    };
    for (const rect of container.querySelectorAll("rect")) {
      within(num(rect, "x"), num(rect, "y"), "rect");
      within(num(rect, "x") + num(rect, "width"), num(rect, "y") + num(rect, "height"), "rect");
    }
    for (const text of container.querySelectorAll("text")) {
      within(num(text, "x"), num(text, "y"), "text");
    }
    for (const path of container.querySelectorAll("path")) {
      for (const [x, y] of pointsOf(path.getAttribute("d")!)) within(x, y, "path");
    }
    for (const polygon of container.querySelectorAll("polygon")) {
      for (const [x, y] of pointsOf(polygon.getAttribute("points")!.replaceAll(",", " "))) {
        within(x, y, "polygon");
      }
    }
  }

  it("keeps every mark inside the slot, from 3 to 10 cells, in every layout", () => {
    for (const { layout, slot } of SLOTS) {
      for (let count = 3; count <= 10; count += 1) {
        for (const wide of [false, true]) {
          const values = valuesOf(count, wide);
          const marked: ArrayElement[] = [
            { ...ARRAY, values, step: 5 },
            { ...ARRAY, values, algorithm: "selection-sort", step: 4 },
            { ...SEARCH, values, step: 1 },
            { ...SEARCH, values, target: -1, step: 99 },
            { ...ARRAY, values, step: 99 },
          ];
          for (const element of marked) {
            const view = setup({ element, layout, slot });
            assertInside(
              view.container,
              view.ctx.size.width,
              view.ctx.size.height,
              `${layout} n=${count} wide=${wide} ${element.algorithm} step ${element.step}`,
            );
          }
        }
      }
    }
  });

  it("keeps the cells apart and every value inside its own cell", () => {
    for (const { layout, slot } of SLOTS) {
      for (let count = 3; count <= 10; count += 1) {
        for (const wide of [false, true]) {
          const { container } = setup({
            element: { ...ARRAY, values: valuesOf(count, wide), step: 0 },
            layout,
            slot,
          });
          const row = cells(container);
          expect(row).toHaveLength(count);
          row.forEach((cell, i) => {
            const rect = rectOf(cell);
            const text = cell.querySelector("text")!;
            const advance = 0.6 * num(text, "font-size");
            expect(text.textContent!.length * advance).toBeLessThanOrEqual(num(rect, "width"));
            if (i === 0) return;
            const previous = rectOf(row[i - 1]!);
            expect(num(rect, "x")).toBeGreaterThan(num(previous, "x") + num(previous, "width"));
          });
        }
      }
    }
  });

  it("centres the row in the slot", () => {
    const { container, ctx } = setup();
    const row = cells(container).map(rectOf);
    const left = num(row[0], "x");
    const right = num(row.at(-1), "x") + num(row.at(-1), "width");
    expect((left + right) / 2).toBeCloseTo(ctx.size.width / 2, 6);
  });

  it("draws larger cells in a larger slot, never wider than 10 units", () => {
    const wide = setup({ layout: "figure", slot: "figure" });
    const narrow = setup({ layout: "compare", slot: "figure_a" });
    const width = (view: typeof wide) => num(rectOf(cells(view.container)[0]!), "width");
    expect(width(narrow)).toBeLessThanOrEqual(width(wide));
    expect(width(wide)).toBeLessThanOrEqual(10 * wide.ctx.u + 1e-6);
  });
});
