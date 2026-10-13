// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rectContains, rectsOverlap, type Rect } from "../../src/layouts";
import {
  layoutRelations,
  type RelationsInput,
  type RelationsLayout,
} from "../../src/primitives/structure/relations-layout";
import { DocumentSchema, type Scene, type SceneElement } from "../../src/schema";
import {
  contrastRatio,
  getTheme,
  sceneMetrics,
  THEME_NAMES,
  unitPx,
  type ThemeName,
} from "../../src/tokens";
import { renderElement, sceneOf, testContext, type ContextOptions } from "../helpers/scene";

type Of<T extends SceneElement["type"]> = Extract<SceneElement, { type: T }>;

const U = unitPx(1920);
const rgb = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

function show(
  targets: string[],
  extra: Scene["beats"][number]["actions"] = [],
  how: "fade" | "draw" = "fade",
): Scene["beats"] {
  return [
    {
      id: "b1",
      narration: "Test.",
      duration_ms: 4000,
      actions: [{ do: "show", targets, how, at: 0 }, ...extra],
    },
  ];
}

function mount(
  element: SceneElement,
  options: Partial<ContextOptions> & {
    layout?: Scene["layout"];
    beats?: Scene["beats"];
    otherSlots?: SceneElement[];
  } = {},
) {
  const { layout, beats, otherSlots = [], ...context } = options;
  const scene = sceneOf([element, ...otherSlots], { layout, beats });
  return renderElement(element, testContext({ scene, slot: element.slot, ...context }));
}

const timeline: Of<"timeline"> = {
  id: "tl",
  slot: "track",
  type: "timeline",
  events: [
    { at: "1789", label: "Prise de la Bastille", detail: "Paris se soulève" },
    { at: "1791", label: "Fuite à Varennes" },
    { at: "1792", label: "Chute du roi", detail: "Fin de la monarchie" },
    { at: "1793", label: "Terreur" },
    { at: "1794", label: "Thermidor", detail: "Fin de la Terreur" },
  ],
};

const steps: Of<"steps"> = {
  id: "st",
  slot: "track",
  type: "steps",
  items: [
    { label: "Transcription", detail: "ADN vers ARN" },
    { label: "Traduction", detail: "ARN vers protéine" },
    { label: "Repliement" },
  ],
};

const table: Of<"table"> = {
  id: "tb",
  slot: "figure",
  type: "table",
  columns: ["Ordre", "Part", "Impôt"],
  rows: [
    ["Clergé", "0,5 %", "non"],
    ["Noblesse", "1,5 %", "non"],
    ["Tiers état", "98 %", "oui"],
  ],
};

const relations: Of<"relations"> = {
  id: "rel",
  slot: "figure",
  type: "relations",
  nodes: [
    { id: "a", label: "Crise financière" },
    { id: "b", label: "Colère du peuple", role: "action" },
    { id: "c", label: "Révolution", role: "result" },
  ],
  edges: [
    { from: "a", to: "b", label: "impôts" },
    { from: "b", to: "c" },
  ],
};

const parts = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("[data-part]")].map((node) => ({
    id: node.dataset.part,
    opacity: Number(node.style.opacity),
    node,
  }));

const highlightBars = (container: HTMLElement, theme: ThemeName) =>
  [...container.querySelectorAll<HTMLElement>("span")].filter(
    (node) => node.style.backgroundColor === rgb(getTheme(theme).role.result),
  );

describe("timeline", () => {
  it("renders every event in order, date above and label below", () => {
    const { container } = mount(timeline, {
      layout: "sequence",
      beats: show(["tl"]),
      frame: "end",
    });
    const items = parts(container);
    expect(items.map((item) => item.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    items.forEach((item, i) => {
      const event = timeline.events[i]!;
      const cells = item.node.querySelectorAll(":scope > div");
      expect(cells).toHaveLength(3);
      expect(cells[0]).toHaveTextContent(event.at);
      expect(cells[2]).toHaveTextContent(event.label);
      if (event.detail) expect(cells[2]).toHaveTextContent(event.detail);
      expect(item.node.style.gridColumn).toBe(String(i + 1));
      expect(item.opacity).toBe(1);
    });
    expect(container.querySelectorAll('[data-role="tick"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-role="line"]')).toHaveLength(1);
  });

  it("keeps the columns equal and wraps text inside them", () => {
    const { container } = mount(timeline, { layout: "sequence", beats: show(["tl"]) });
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    for (const item of parts(container)) {
      expect(item.node.style.minWidth).toBe("0px");
      expect(item.node.style.overflowWrap).toBe("anywhere");
    }
  });

  it("uses the token styles: mono capitals for dates, weight 600 labels, soft details", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(timeline, {
        layout: "sequence",
        beats: show(["tl"]),
        theme: name,
        frame: "end",
      });
      const first = parts(container)[0]!.node.querySelectorAll<HTMLElement>(":scope > div");
      const date = first[0]!;
      expect(date.style.fontFamily).toContain("IBM Plex Mono");
      expect(date.style.textTransform).toBe("uppercase");
      expect(date.style.color).toBe(rgb(theme.ink));
      expect(Number.parseFloat(date.style.fontSize)).toBeGreaterThanOrEqual(
        sceneMetrics.text.min * U,
      );
      const label = first[2]!.firstElementChild as HTMLElement;
      expect(label.style.fontWeight).toBe("600");
      expect(label.style.color).toBe(rgb(theme.ink));
      expect(Number.parseFloat(label.style.fontSize)).toBeGreaterThanOrEqual(
        sceneMetrics.text.min * U,
      );
      const detail = first[2]!.lastElementChild as HTMLElement;
      expect(detail.style.color).toBe(rgb(theme.inkSoft));
      expect(
        (container.querySelector('[data-role="tick"]') as HTMLElement).style.backgroundColor,
      ).toBe(rgb(theme.ink));
      expect(
        (container.querySelector('[data-role="line"]') as HTMLElement).style.backgroundColor,
      ).toBe(rgb(theme.ink));
      unmount();
    }
  });

  it("is hidden before it is shown, whatever the theme", () => {
    for (const name of THEME_NAMES) {
      const early = mount(timeline, {
        layout: "sequence",
        beats: show(["tl"]),
        frame: 0,
        theme: name,
      });
      expect(parts(early.container).map((item) => item.opacity)).toEqual([0, 0, 0, 0, 0]);
      expect(
        Number((early.container.querySelector('[data-role="line"]') as HTMLElement).style.opacity),
      ).toBe(0);
      early.unmount();
      const never = mount(timeline, {
        layout: "sequence",
        beats: show(["other"]),
        otherSlots: [{ id: "other", slot: "track", type: "steps", items: steps.items }],
        frame: "end",
        theme: name,
      });
      expect(parts(never.container).map((item) => item.opacity)).toEqual([0, 0, 0, 0, 0]);
      never.unmount();
    }
  });

  it("shows one event and leaves the others hidden", () => {
    const { container } = mount(timeline, {
      layout: "sequence",
      beats: show(["tl.e2"]),
      frame: "end",
    });
    expect(parts(container).map((item) => item.opacity)).toEqual([0, 1, 0, 0, 0]);
  });

  it("traces the line from the left and reveals each event as the line reaches it", () => {
    const { container } = mount(timeline, {
      layout: "sequence",
      beats: show(["tl"], [], "draw"),
      frame: 9,
    });
    const scale = Number(
      /scaleX\(([\d.]+)\)/.exec(
        (container.querySelector('[data-role="line"]') as HTMLElement).style.transform,
      )?.[1],
    );
    expect(scale).toBeGreaterThan(0.2);
    expect(scale).toBeLessThan(0.9);
    const opacities = parts(container).map((item) => item.opacity);
    expect(opacities[0]).toBe(1);
    expect(opacities.at(-1)).toBe(0);
    expect([...opacities].sort((a, b) => b - a)).toEqual(opacities);
    for (const [i, opacity] of opacities.entries()) {
      if (opacity > 0) expect(i / 5).toBeLessThanOrEqual(scale);
    }
  });

  it("highlights the label of one event only", () => {
    const { container } = mount(timeline, {
      layout: "sequence",
      beats: show(["tl"], [{ do: "highlight", targets: ["tl.e3"], at: 0 }]),
      frame: "end",
    });
    const bars = highlightBars(container, "paper");
    expect(bars).toHaveLength(1);
    expect(parts(container)[2]!.node.contains(bars[0]!)).toBe(true);
  });
});

describe("steps", () => {
  it("renders numbered columns in order with a hairline rule under each numeral", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(steps, {
        layout: "sequence",
        beats: show(["st"]),
        theme: name,
        frame: "end",
      });
      const items = parts(container);
      expect(items.map((item) => item.id)).toEqual(["s1", "s2", "s3"]);
      const root = container.firstElementChild as HTMLElement;
      expect(root.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
      items.forEach((item, i) => {
        const [numeral, rule, body] = [...item.node.children] as HTMLElement[];
        expect(numeral).toHaveTextContent(`0${i + 1}`);
        expect(numeral!.style.fontFamily).toContain("IBM Plex Mono");
        expect(numeral!.style.color).toBe(rgb(theme.inkFaint));
        expect(rule!.style.backgroundColor).toBe(rgb(theme.rule));
        expect(Number.parseFloat(rule!.style.height)).toBeCloseTo(
          sceneMetrics.stroke.construction * U,
        );
        const label = body!.firstElementChild!.firstElementChild as HTMLElement;
        expect(label.style.fontWeight).toBe("600");
        expect(label).toHaveTextContent(steps.items[i]!.label);
        const detail = steps.items[i]!.detail;
        if (detail) {
          expect(body).toHaveTextContent(detail);
          expect((body!.firstElementChild!.lastElementChild as HTMLElement).style.color).toBe(
            rgb(theme.inkSoft),
          );
        }
        expect(item.opacity).toBe(1);
      });
      unmount();
    }
  });

  it("lays the steps out as a ruled vertical list in the notes", () => {
    const element: Of<"steps"> = { ...steps, slot: "notes" };
    const { container } = mount(element, {
      layout: "figure-notes",
      beats: show(["st"]),
      frame: "end",
    });
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
    const rows = parts(container);
    expect(rows).toHaveLength(3);
    const [rule, row] = [...rows[0]!.node.children] as HTMLElement[];
    expect(rule!.style.backgroundColor).toBe(rgb(getTheme("paper").rule));
    expect(row!.style.gridTemplateColumns).toMatch(/^\d+(\.\d+)?px minmax\(0, 1fr\)$/);
    const numeralWidth = Number.parseFloat(row!.style.gridTemplateColumns);
    expect(numeralWidth).toBeLessThan(8 * U);
    const label = row!.querySelector<HTMLElement>("[style*='font-weight: 600']")!;
    expect(Number.parseFloat(label.style.fontSize)).toBe(sceneMetrics.text.min * U);
  });

  it("shows one step and leaves the others hidden", () => {
    const { container } = mount(steps, {
      layout: "sequence",
      beats: show(["st.s3"]),
      frame: "end",
    });
    expect(parts(container).map((item) => item.opacity)).toEqual([0, 0, 1]);
  });

  it("is hidden before it is shown", () => {
    const { container } = mount(steps, { layout: "sequence", beats: show(["st"]), frame: 0 });
    expect(parts(container).map((item) => item.opacity)).toEqual([0, 0, 0]);
  });

  it("traces each rule in turn when drawn", () => {
    const { container } = mount(steps, {
      layout: "sequence",
      beats: show(["st"], [], "draw"),
      frame: 8,
    });
    const traces = parts(container).map((item) =>
      Number(
        /scaleX\(([\d.]+)\)/.exec(
          (item.node.querySelector('[data-role="rule"]') as HTMLElement).style.transform,
        )?.[1],
      ),
    );
    expect(traces[0]).toBeGreaterThan(traces[2]!);
    expect(traces[0]).toBeGreaterThan(0);
  });

  it("highlights one step label", () => {
    const { container } = mount(steps, {
      layout: "sequence",
      beats: show(["st"], [{ do: "highlight", targets: ["st.s2"], at: 0 }]),
      frame: "end",
    });
    const bars = highlightBars(container, "paper");
    expect(bars).toHaveLength(1);
    expect(parts(container)[1]!.node.contains(bars[0]!)).toBe(true);
  });
});

describe("table", () => {
  it("renders the header and the rows in order", () => {
    const { container } = mount(table, { beats: show(["tb"]), frame: "end" });
    const headers = [...container.querySelectorAll("th")].map((cell) => cell.textContent);
    expect(headers).toEqual(table.columns);
    const rows = [...container.querySelectorAll("tbody tr:not([data-role])")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );
    expect(rows).toEqual(table.rows);
  });

  it("rules the header in ink and the rows in hairlines, without cell borders", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(table, {
        beats: show(["tb"]),
        theme: name,
        frame: "end",
      });
      const header = container.querySelector<HTMLElement>("thead [data-role='rule'] div")!;
      expect(header.style.backgroundColor).toBe(rgb(theme.ink));
      expect(Number.parseFloat(header.style.height)).toBeGreaterThanOrEqual(
        sceneMetrics.stroke.regular * U,
      );
      const hairlines = [
        ...container.querySelectorAll<HTMLElement>("tbody [data-role='rule'] div"),
      ];
      expect(hairlines).toHaveLength(table.rows.length);
      for (const line of hairlines) {
        expect(line.style.backgroundColor).toBe(rgb(theme.rule));
        expect(Number.parseFloat(line.style.height)).toBeCloseTo(
          sceneMetrics.stroke.construction * U,
        );
      }
      for (const cell of container.querySelectorAll<HTMLElement>("th, td")) {
        expect(cell.style.border).toBe("");
        expect(cell.style.borderBottom).toBe("");
      }
      unmount();
    }
  });

  it("sets the header in mono capitals and the first column in weight 600", () => {
    const { container } = mount(table, { beats: show(["tb"]), frame: "end" });
    for (const cell of container.querySelectorAll<HTMLElement>("th")) {
      expect(cell.style.fontFamily).toContain("IBM Plex Mono");
      expect(cell.style.textTransform).toBe("uppercase");
    }
    for (const row of container.querySelectorAll("tbody tr:not([data-role])")) {
      const cells = [...row.querySelectorAll<HTMLElement>("td")];
      expect(cells.map((cell) => cell.style.fontWeight)).toEqual(["600", "400", "400"]);
      for (const cell of cells) expect(cell.style.fontFamily).toContain("STIX Two Text");
    }
  });

  it("stays at or above the minimum text size in the notes and in a narrow figure slot", () => {
    const notes: Of<"table"> = {
      ...table,
      slot: "notes",
      columns: ["Si", "Alors"],
      rows: [["demande +", "prix +"]],
    };
    const inNotes = mount(notes, { layout: "figure-notes", beats: show(["tb"]), frame: "end" });
    const narrow = mount(
      { ...table, slot: "figure_a" },
      {
        layout: "compare",
        beats: show(["tb"]),
        frame: "end",
      },
    );
    for (const { container } of [inNotes, narrow]) {
      for (const cell of container.querySelectorAll<HTMLElement>("th, tr:not([data-role]) > td")) {
        expect(Number.parseFloat(cell.style.fontSize)).toBeGreaterThanOrEqual(
          sceneMetrics.text.min * U,
        );
      }
    }
    const body = inNotes.container.querySelector<HTMLElement>("tbody tr:not([data-role]) td")!;
    expect(Number.parseFloat(body.style.fontSize)).toBe(sceneMetrics.text.min * U);
    const wide = mount({ ...table, slot: "figure" }, { beats: show(["tb"]), frame: "end" });
    expect(
      Number.parseFloat(
        wide.container.querySelector<HTMLElement>("tbody tr:not([data-role]) td")!.style.fontSize,
      ),
    ).toBe(sceneMetrics.text.body * U);
  });

  it("is hidden before it is shown and visible after", () => {
    const early = mount(table, { beats: show(["tb"]), frame: 0 });
    expect(Number((early.container.firstElementChild as HTMLElement).style.opacity)).toBe(0);
    const late = mount(table, { beats: show(["tb"]), frame: "end" });
    expect(Number((late.container.firstElementChild as HTMLElement).style.opacity)).toBe(1);
  });

  it("highlights its cells with the result colour", () => {
    const { container } = mount(table, {
      beats: show(["tb"], [{ do: "highlight", targets: ["tb"], at: 0 }]),
      frame: "end",
    });
    expect(highlightBars(container, "paper")).toHaveLength(
      table.rows.flat().length + table.columns.length,
    );
  });
});

const BODY: Rect = { x: 0, y: 0, width: 108 * U, height: 40.5 * U };

function layoutOf(
  nodes: { id: string; label: string }[],
  edges: [string, string, string?][],
  size: { width: number; height: number } = BODY,
): RelationsLayout {
  const input: RelationsInput = {
    nodes,
    edges: edges.map(([from, to, label]) => ({ from, to, label })),
    width: size.width,
    height: size.height,
    u: U,
    inset: (sceneMetrics.stroke.regular * U) / 2,
    sizes: {
      body: sceneMetrics.text.body * U,
      min: sceneMetrics.text.min * U,
      label: sceneMetrics.text.label * U,
    },
    headSize: 1.6 * U,
  };
  return layoutRelations(input);
}

const named = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Notion ${i + 1}` }));
const rectOf = (layout: RelationsLayout, id: string): Rect => {
  const node = layout.nodes.find((candidate) => candidate.id === id)!;
  return { x: node.x, y: node.y, width: node.width, height: node.height };
};
const chain = (count: number): [string, string][] =>
  Array.from({ length: count - 1 }, (_, i) => [`n${i}`, `n${i + 1}`]);
const fan = (count: number): [string, string][] =>
  Array.from({ length: count - 1 }, (_, i) => ["n0", `n${i + 1}`]);
const cycle = (count: number): [string, string][] =>
  Array.from({ length: count }, (_, i) => [`n${i}`, `n${(i + 1) % count}`]);

const CASES: { name: string; nodes: number; edges: [string, string][] }[] = [
  { name: "two nodes", nodes: 2, edges: chain(2) },
  { name: "a chain of five", nodes: 5, edges: chain(5) },
  { name: "a chain of seven", nodes: 7, edges: chain(7) },
  { name: "a fan-out of seven", nodes: 7, edges: fan(7) },
  { name: "a cycle of five", nodes: 5, edges: cycle(5) },
  { name: "seven unrelated nodes", nodes: 7, edges: [] },
];

describe("relations layout", () => {
  for (const slot of [BODY, { x: 0, y: 0, width: 68 * U, height: 40.5 * U }]) {
    for (const item of CASES) {
      it(`keeps ${item.name} inside a ${slot.width / U}u slot without overlap`, () => {
        const layout = layoutOf(named(item.nodes), item.edges, slot);
        expect(layout.nodes).toHaveLength(item.nodes);
        for (const node of layout.nodes) {
          expect(rectContains(slot, rectOf(layout, node.id), 0.01)).toBe(true);
        }
        for (const a of layout.nodes) {
          for (const b of layout.nodes) {
            if (a.id < b.id)
              expect(rectsOverlap(rectOf(layout, a.id), rectOf(layout, b.id))).toBe(false);
          }
        }
      });
    }
  }

  it("places a node to the right of every predecessor", () => {
    const layout = layoutOf(named(5), [
      ["n0", "n1"],
      ["n0", "n2"],
      ["n1", "n3"],
      ["n2", "n3"],
      ["n3", "n4"],
      ["n0", "n4"],
    ]);
    const layers = Object.fromEntries(layout.nodes.map((node) => [node.id, node.layer]));
    expect(layers).toEqual({ n0: 0, n1: 1, n2: 1, n3: 2, n4: 3 });
    for (const [from, to] of [
      ["n0", "n1"],
      ["n0", "n2"],
      ["n1", "n3"],
      ["n2", "n3"],
      ["n3", "n4"],
      ["n0", "n4"],
    ] as const) {
      const a = rectOf(layout, from);
      expect(rectOf(layout, to).x).toBeGreaterThanOrEqual(a.x + a.width);
    }
  });

  it("starts nodes without predecessor on the left and ignores the back edge of a cycle", () => {
    const layout = layoutOf(named(4), [...chain(4), ["n3", "n0"]]);
    expect(layout.nodes.map((node) => node.layer)).toEqual([0, 1, 2, 3]);
    const xs = layout.nodes.map((node) => node.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(layout.edges).toHaveLength(4);
  });

  it("spreads the nodes of a layer evenly in height", () => {
    const layout = layoutOf(named(7), fan(7));
    const leaves = layout.nodes
      .filter((node) => node.layer === 1)
      .map((node) => node.y + node.height / 2)
      .sort((a, b) => a - b);
    expect(leaves).toHaveLength(6);
    const steps = leaves.slice(1).map((y, i) => y - leaves[i]!);
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 5);
    const root = layout.nodes.find((node) => node.layer === 0)!;
    expect(root.y + root.height / 2).toBeCloseTo(BODY.height / 2, 0);
  });

  it("is stable between two computations and keeps the document order of independent nodes", () => {
    const nodes = named(6);
    const edges: [string, string][] = [
      ["n0", "n3"],
      ["n1", "n3"],
      ["n2", "n4"],
      ["n3", "n5"],
      ["n4", "n5"],
    ];
    expect(layoutOf(nodes, edges)).toEqual(layoutOf(nodes, edges));
    const flat = layoutOf(named(4), []);
    const order = [...flat.nodes].sort((a, b) => a.y - b.y).map((node) => node.id);
    expect(order).toEqual(["n0", "n1", "n2", "n3"]);
  });

  it("orders each layer to avoid crossing edges", () => {
    const layout = layoutOf(named(4), [
      ["n0", "n3"],
      ["n1", "n2"],
    ]);
    const y = (id: string) => rectOf(layout, id).y;
    expect(y("n0") < y("n1")).toBe(y("n3") < y("n2"));
  });

  it("keeps a long edge away from the nodes it passes", () => {
    const layout = layoutOf(named(4), [...chain(3), ["n0", "n2"], ["n0", "n3"]]);
    const edge = layout.edges.find(
      (candidate) => candidate.from === "n0" && candidate.to === "n2",
    )!;
    for (const id of ["n1", "n3"]) {
      const box = rectOf(layout, id);
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const x = edge.start[0] + ((edge.tip[0] - edge.start[0]) * i) / steps;
        const y = edge.start[1] + ((edge.tip[1] - edge.start[1]) * i) / steps;
        const inside = x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height;
        expect(inside).toBe(false);
      }
    }
  });

  it("ends every edge on the border of its target and starts it on the border of its source", () => {
    const layout = layoutOf(named(6), [...fan(4), ["n1", "n4"], ["n4", "n5"], ["n5", "n0"]]);
    expect(layout.edges.length).toBeGreaterThan(0);
    const onBorder = (point: readonly [number, number], box: Rect): boolean => {
      const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
      const withinX = point[0] >= box.x - 0.01 && point[0] <= box.x + box.width + 0.01;
      const withinY = point[1] >= box.y - 0.01 && point[1] <= box.y + box.height + 0.01;
      return (
        ((near(point[0], box.x) || near(point[0], box.x + box.width)) && withinY) ||
        ((near(point[1], box.y) || near(point[1], box.y + box.height)) && withinX)
      );
    };
    for (const edge of layout.edges) {
      expect(onBorder(edge.tip, rectOf(layout, edge.to))).toBe(true);
      expect(onBorder(edge.start, rectOf(layout, edge.from))).toBe(true);
      expect(
        Math.hypot(edge.tip[0] - edge.shaftEnd[0], edge.tip[1] - edge.shaftEnd[1]),
      ).toBeCloseTo(1.6 * U);
    }
  });

  it("separates two opposite edges between the same nodes", () => {
    const layout = layoutOf(named(2), [
      ["n0", "n1"],
      ["n1", "n0"],
    ]);
    expect(layout.edges).toHaveLength(2);
    const [forward, backward] = layout.edges as [
      (typeof layout.edges)[0],
      (typeof layout.edges)[0],
    ];
    expect(Math.abs(forward.start[1] - backward.tip[1])).toBeGreaterThan(U / 2);
  });

  it("makes room for the edge labels between layers", () => {
    const labelled = layoutOf(named(2), [["n0", "n1", "financement"]]);
    const plain = layoutOf(named(2), [["n0", "n1"]]);
    const gap = (layout: RelationsLayout) =>
      rectOf(layout, "n1").x - (rectOf(layout, "n0").x + rectOf(layout, "n0").width);
    expect(gap(labelled)).toBeGreaterThan(gap(plain));
    const edge = labelled.edges[0]!;
    expect(edge.plate.width).toBeLessThanOrEqual(gap(labelled));
  });

  it("wraps long labels inside the node at the minimum text size or above when there is room", () => {
    const layout = layoutOf(
      [
        { id: "n0", label: "Inégalités sociales et fiscales" },
        { id: "n1", label: "Colère du peuple" },
      ],
      [["n0", "n1"]],
    );
    expect(layout.textSize).toBeGreaterThanOrEqual(sceneMetrics.text.min * U);
    expect(layout.nodes[0]!.lines.length).toBeGreaterThan(1);
    expect(layout.nodes[0]!.lines.join(" ")).toBe("Inégalités sociales et fiscales");
  });

  it("shrinks the text rather than letting a label spill out of a narrow box", () => {
    const layout = layoutOf(
      [
        { id: "a", label: "Équipe A veut le plus grand" },
        { id: "c1", label: "Choix 1" },
        { id: "c2", label: "Choix 2" },
        { id: "b", label: "Équipe B veut le plus petit" },
        { id: "v4", label: "v₄" },
        { id: "v1", label: "v₁" },
        { id: "v2", label: "v₂" },
      ],
      [
        ["a", "c1"],
        ["a", "c2"],
        ["c1", "b"],
        ["c2", "v4"],
        ["b", "v1"],
        ["b", "v2"],
      ],
      { width: 62 * U, height: 34 * U },
    );
    expect(layout.textSize).toBeLessThan(sceneMetrics.text.min * U);
    const box = layout.nodes.find((node) => node.id === "a")!;
    expect(box.lines.join(" ")).toBe("Équipe A veut le plus grand");
    expect(box.lines.length * layout.textSize * layout.lineHeight).toBeLessThanOrEqual(box.height);
  });
});

describe("relations", () => {
  const nodeOf = (container: HTMLElement, id: string) =>
    container.querySelector<SVGGElement>(`[data-node="${id}"]`);
  const edgeOf = (container: HTMLElement, id: string) =>
    container.querySelector<SVGGElement>(`[data-edge="${id}"]`);

  it("renders every node and edge, and none before it is shown", () => {
    const shown = mount(relations, { beats: show(["rel"]), frame: "end" });
    expect(nodeOf(shown.container, "a")).not.toBeNull();
    expect(nodeOf(shown.container, "b")).not.toBeNull();
    expect(nodeOf(shown.container, "c")).not.toBeNull();
    expect(edgeOf(shown.container, "a>b")).not.toBeNull();
    expect(edgeOf(shown.container, "b>c")).not.toBeNull();
    shown.unmount();
    const hidden = mount(relations, { beats: show(["rel"]), frame: 0 });
    expect(hidden.container.querySelectorAll("[data-node], [data-edge]")).toHaveLength(0);
  });

  it("shows one node and leaves the others and their edges hidden", () => {
    const { container } = mount(relations, { beats: show(["rel.b"]), frame: "end" });
    expect(nodeOf(container, "b")).not.toBeNull();
    expect(nodeOf(container, "a")).toBeNull();
    expect(nodeOf(container, "c")).toBeNull();
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(0);
  });

  it("draws an edge once both of its nodes are visible", () => {
    const { container } = mount(relations, { beats: show(["rel.a", "rel.b"]), frame: "end" });
    expect(edgeOf(container, "a>b")).not.toBeNull();
    expect(edgeOf(container, "b>c")).toBeNull();
    expect(nodeOf(container, "c")).toBeNull();
  });

  it("renders squared rectangles, ink outlines, a flat fill and a role fill with readable text", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(relations, {
        beats: show(["rel"]),
        theme: name,
        frame: "end",
      });
      const fillOf = (id: string) =>
        nodeOf(container, id)!.querySelectorAll("rect")[0]!.getAttribute("fill")!;
      const outline = [...nodeOf(container, "a")!.querySelectorAll("rect")].at(-1)!;
      expect(outline.getAttribute("stroke")).toBe(theme.ink);
      expect(outline.getAttribute("rx")).toBeNull();
      expect(fillOf("a")).toBe(theme.surfaceRaised);
      expect(fillOf("b")).toBe(theme.role.action);
      expect(fillOf("c")).toBe(theme.role.result);
      for (const id of ["a", "b", "c"]) {
        const text = nodeOf(container, id)!.querySelector("text")!;
        expect(contrastRatio(text.getAttribute("fill")!, fillOf(id))).toBeGreaterThanOrEqual(4.5);
        expect(Number(text.getAttribute("font-size"))).toBeGreaterThanOrEqual(
          sceneMetrics.text.min * U,
        );
        expect(text.getAttribute("font-weight")).toBe("600");
      }
      const line = edgeOf(container, "a>b")!.querySelector("line")!;
      expect(line.getAttribute("stroke")).toBe(theme.ink);
      expect(edgeOf(container, "a>b")!.querySelector("polygon")!.getAttribute("fill")).toBe(
        theme.ink,
      );
      unmount();
    }
  });

  it("puts the edge label on a raised plate at the middle of the edge", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(relations, {
        beats: show(["rel"]),
        theme: name,
        frame: "end",
      });
      const edge = edgeOf(container, "a>b")!;
      const plate = [...edge.querySelectorAll("rect")].find(
        (rect) => rect.getAttribute("fill") === theme.surfaceRaised,
      )!;
      expect(plate).toBeDefined();
      const text = [...edge.querySelectorAll("text")].find(
        (node) => node.textContent === "impôts",
      )!;
      const centre = Number(plate.getAttribute("x")) + Number(plate.getAttribute("width")) / 2;
      expect(Number(text.getAttribute("x"))).toBeCloseTo(centre, 3);
      expect(edgeOf(container, "b>c")!.querySelector("text")).toBeNull();
      unmount();
    }
  });

  it("ends the arrow head on the border of the target node", () => {
    const { container } = mount(relations, { beats: show(["rel"]), frame: "end" });
    const rect = [...nodeOf(container, "b")!.querySelectorAll("rect")].at(-1)!;
    const box = {
      x: Number(rect.getAttribute("x")),
      y: Number(rect.getAttribute("y")),
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height")),
    };
    const tip = edgeOf(container, "a>b")!
      .querySelector("polygon")!
      .getAttribute("points")!
      .split(" ")[0]!
      .split(",")
      .map(Number) as [number, number];
    const onVertical =
      Math.abs(tip[0] - box.x) < 0.01 || Math.abs(tip[0] - box.x - box.width) < 0.01;
    const onHorizontal =
      Math.abs(tip[1] - box.y) < 0.01 || Math.abs(tip[1] - box.y - box.height) < 0.01;
    expect(onVertical || onHorizontal).toBe(true);
    expect(tip[0]).toBeGreaterThanOrEqual(box.x - 0.01);
    expect(tip[0]).toBeLessThanOrEqual(box.x + box.width + 0.01);
    expect(tip[1]).toBeGreaterThanOrEqual(box.y - 0.01);
    expect(tip[1]).toBeLessThanOrEqual(box.y + box.height + 0.01);
  });

  it("renders the same markup twice", () => {
    const first = mount(relations, { beats: show(["rel"]), frame: "end" });
    const markup = first.container.innerHTML;
    first.unmount();
    const second = mount(relations, { beats: show(["rel"]), frame: "end" });
    expect(second.container.innerHTML).toBe(markup);
  });

  it("highlights a node with a flat result fill and readable text", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(relations, {
        beats: show(["rel"], [{ do: "highlight", targets: ["rel.a"], at: 0 }]),
        theme: name,
        frame: "end",
      });
      const rects = nodeOf(container, "a")!.querySelectorAll("rect");
      expect(rects).toHaveLength(3);
      expect(rects[1]!.getAttribute("fill")).toBe(theme.role.result);
      const text = nodeOf(container, "a")!.querySelector("text")!;
      expect(contrastRatio(text.getAttribute("fill")!, theme.role.result)).toBeGreaterThanOrEqual(
        4.5,
      );
      const other = nodeOf(container, "b")!.querySelectorAll("rect");
      expect(other).toHaveLength(2);
      unmount();
    }
  });

  it("highlights every node when the whole element is highlighted", () => {
    const { container } = mount(relations, {
      beats: show(["rel"], [{ do: "highlight", targets: ["rel"], at: 0 }]),
      frame: "end",
    });
    for (const id of ["a", "b", "c"])
      expect(nodeOf(container, id)!.querySelectorAll("rect")).toHaveLength(3);
  });

  it("traces the edges after their nodes have appeared", () => {
    const early = mount(relations, { beats: show(["rel"], [], "draw"), frame: 3 });
    expect(nodeOf(early.container, "a")).not.toBeNull();
    expect(edgeOf(early.container, "a>b")).toBeNull();
    early.unmount();
    const middle = mount(relations, { beats: show(["rel"], [], "draw"), frame: 12 });
    const line = edgeOf(middle.container, "a>b")!.querySelector("line")!;
    expect(Number(line.getAttribute("stroke-dasharray"))).toBeGreaterThan(0);
    expect(Number(line.getAttribute("stroke-dashoffset"))).toBeGreaterThan(0);
    middle.unmount();
    const end = mount(relations, { beats: show(["rel"], [], "draw"), frame: "end" });
    expect(
      edgeOf(end.container, "a>b")!.querySelector("line")!.getAttribute("stroke-dasharray"),
    ).toBeNull();
  });
});

describe("structure snapshot document", () => {
  const FIXTURE = join(import.meta.dirname, "../fixtures/structure.json");
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const document = DocumentSchema.parse(raw.payload);

  it("satisfies the document schema with one scene per layout of the structure primitives", () => {
    expect(raw.language).toBe("fr");
    expect(document.scenes.map((scene) => scene.layout)).toEqual([
      "sequence",
      "sequence",
      "figure",
      "figure-notes",
      "figure",
      "compare",
    ]);
    const types = new Set(document.scenes.flatMap((scene) => scene.elements.map((e) => e.type)));
    expect([...types].sort()).toEqual(["relations", "steps", "table", "timeline", "tree"]);
  });

  it("renders every scene in both themes at the end of its last beat", () => {
    for (const scene of document.scenes) {
      for (const name of THEME_NAMES) {
        for (const element of scene.elements) {
          const { container, unmount } = renderElement(
            element,
            testContext({ scene, slot: element.slot, theme: name, frame: "end" }),
          );
          expect(container.innerHTML.length).toBeGreaterThan(0);
          unmount();
        }
      }
    }
  });
});
