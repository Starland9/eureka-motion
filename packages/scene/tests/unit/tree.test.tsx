// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isImplemented } from "../../src/composition/registry";
import {
  BLOCK_ELEMENT_TYPES,
  describeCatalog,
  DocumentSchema,
  ELEMENT_SLOTS,
  ElementSchema,
  elementLabelCount,
  elementParts,
  validateScene,
  type Scene,
  type SceneElement,
} from "../../src/schema";
import { getTheme, sceneMetrics, THEME_NAMES, unitPx, type ThemeName } from "../../src/tokens";
import { renderElement, sceneOf, testContext, type ContextOptions } from "../helpers/scene";

type Tree = Extract<SceneElement, { type: "tree" }>;
type Action = Scene["beats"][number]["actions"][number];

const U = unitPx(1920);
const raw = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/structure.json"), "utf8"),
);
const document = DocumentSchema.parse(raw.payload);
const outline = { plan: document.plan, params: document.params, model: document.model };
const minimax = document.scenes.find((scene) => scene.id === "minimax")!;
const tree = minimax.elements[0] as Tree;
const LEAVES = ["f1", "f2", "f3", "f4"];
const INNER = ["racine", "min_g", "min_d"];
const parts = (ids: string[]) => ids.map((id) => `arbre.${id}`);

function show(
  targets: string[],
  extra: Action[] = [],
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

const highlight = (...ids: string[]): Action => ({
  do: "highlight",
  targets: parts(ids),
  at: 0,
});

function mount(beats: Scene["beats"], options: Partial<ContextOptions> & { element?: Tree } = {}) {
  const { element = tree, ...context } = options;
  const scene = sceneOf([element], { beats });
  return renderElement(element, testContext({ scene, frame: "end", ...context }));
}

const nodeOf = (c: HTMLElement, id: string) => c.querySelector<SVGGElement>(`[data-node="${id}"]`);
const valueOf = (c: HTMLElement, id: string) =>
  c.querySelector<SVGTextElement>(`[data-value="${id}"]`);
const edgeOf = (c: HTMLElement, id: string) => c.querySelector<SVGGElement>(`[data-edge="${id}"]`);
const ringOf = (c: HTMLElement, id: string) => {
  const circles = nodeOf(c, id)!.querySelectorAll("circle");
  return circles[circles.length - 1]!;
};
const lineOf = (c: HTMLElement, id: string) => {
  const lines = edgeOf(c, id)!.querySelectorAll("line");
  return lines[lines.length - 1]!;
};
const nodeIds = (c: HTMLElement) =>
  [...c.querySelectorAll<SVGGElement>("[data-node]")].map((node) => node.dataset.node);
const valueIds = (c: HTMLElement) =>
  [...c.querySelectorAll<SVGTextElement>("[data-value]")].map((node) => node.dataset.value);

const whole: Scene["beats"] = [
  {
    id: "b1",
    narration: "Test.",
    actions: [{ do: "show", targets: ["arbre"], how: "fade", at: 0 }],
  },
];

describe("tree validation", () => {
  const problems = (nodes: Tree["nodes"], levels?: string[]): string[] => {
    const element: Tree = { ...tree, nodes, levels };
    const result = validateScene({ ...minimax, elements: [element], beats: whole }, outline);
    return result.ok ? [] : result.issues.map((issue) => issue.message);
  };
  const base = tree.nodes.filter((node) => node.id !== "f4");

  it("accepts the minimax scene of the fixture without a world", () => {
    expect(minimax.world).toBeUndefined();
    expect(validateScene(minimax, outline).ok).toBe(true);
  });

  it("rejects a second root and names the roots", () => {
    const found = problems([...base, { id: "f4", value: "9" }]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('2 nodes have no "parent"');
    expect(found[0]).toContain('"racine", "f4"');
    expect(found[0]).toContain("exactly one root");
  });

  it("rejects a parent that is not a node of the tree", () => {
    const found = problems([...base, { id: "f4", parent: "ghost", value: "9" }]);
    expect(found).toEqual([
      expect.stringContaining('no node "ghost", named as the parent of "f4"; nodes are "racine"'),
    ]);
  });

  it("rejects a cycle that does not reach the root", () => {
    const found = problems([
      ...base,
      { id: "f4", parent: "g2", value: "9" },
      { id: "g2", parent: "f4" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"f4", "g2" forms a cycle');
  });

  it("rejects a node that is its own parent", () => {
    const found = problems([...base, { id: "f4", parent: "f4" }]);
    expect(found[0]).toContain('"f4" forms a cycle');
  });

  it("rejects a tree without a root", () => {
    const found = problems([
      { id: "a", parent: "b" },
      { id: "b", parent: "a" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("there is no root");
  });

  it("rejects a fifth level and names the nodes that are too deep", () => {
    const chain: Tree["nodes"] = ["a", "b", "c", "d", "e"].map((id, i, all) => ({
      id,
      ...(i > 0 ? { parent: all[i - 1] } : {}),
    }));
    const found = problems(chain);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("5 levels, at most 4");
    expect(found[0]).toContain('"e" is too deep');
    expect(problems(chain.slice(0, 4))).toEqual([]);
  });

  it("rejects an uppercase node id and says which characters are allowed", () => {
    const found = problems(
      tree.nodes.map((node) => (node.id === "f1" ? { ...node, id: "F1" } : node)),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"F1" must be lowercase letters, digits and underscores');
  });

  it("rejects an id that starts with a digit or ends with _value", () => {
    const digit = problems(
      tree.nodes.map((node) => (node.id === "f1" ? { ...node, id: "1f" } : node)),
    );
    expect(digit[0]).toContain("starting with a letter");
    const suffix = problems([...base, { id: "f4_value", parent: "min_d", value: "9" }]);
    expect(suffix).toEqual([expect.stringContaining('cannot end with "_value"')]);
  });

  it("rejects a repeated node id", () => {
    const found = problems([...base, { id: "f3", parent: "min_d" }]);
    expect(found).toEqual([expect.stringContaining('node id "f3" is used more than once')]);
  });

  it("rejects more captions than levels", () => {
    expect(problems(tree.nodes, ["a", "b", "c", "d"])[0]).toContain(
      "4 captions but the tree has 3 levels",
    );
    expect(problems(tree.nodes, ["a", "b"])).toEqual([]);
  });

  it("makes the tree fill its figure slot alone", () => {
    const other: Tree = { ...tree, id: "autre" };
    const result = validateScene({ ...minimax, elements: [tree, other] }, outline);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain("fills the slot");
  });

  it("goes only in figure slots", () => {
    expect(ELEMENT_SLOTS.tree).toEqual(["figure", "figure_a", "figure_b"]);
    expect(BLOCK_ELEMENT_TYPES.has("tree")).toBe(true);
    const result = validateScene(
      { ...minimax, layout: "figure-notes", elements: [{ ...tree, slot: "notes" }] },
      outline,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain('a "tree" cannot go in "notes"');
  });

  it("accepts the part of a node and of its value as targets, and rejects others", () => {
    const withBeat = (target: string): boolean =>
      validateScene(
        {
          ...minimax,
          beats: [
            {
              id: "b1",
              narration: "Test.",
              actions: [{ do: "show", targets: [target, "arbre"], how: "fade", at: 0 }],
            },
          ],
        },
        outline,
      ).ok;
    expect(withBeat("arbre.racine_value")).toBe(true);
    expect(withBeat("arbre.f1_value")).toBe(true);
    expect(withBeat("arbre.f9")).toBe(false);
  });
});

describe("tree schema", () => {
  it("exposes a node and its value as parts, in the order declared", () => {
    expect(elementParts(tree)).toEqual(tree.nodes.flatMap((node) => [node.id, `${node.id}_value`]));
    expect(elementParts(tree)).toContain("racine_value");
  });

  it("counts no label, as relations does", () => {
    expect(elementLabelCount(tree)).toBe(0);
  });

  it("bounds the number of nodes, the label and value lengths and the captions", () => {
    const parse = (patch: Partial<Tree>) => ElementSchema.safeParse({ ...tree, ...patch });
    expect(parse({}).success).toBe(true);
    expect(parse({ nodes: [{ id: "a" }] }).success).toBe(false);
    expect(parse({ nodes: Array.from({ length: 16 }, (_, i) => ({ id: `n${i}` })) }).success).toBe(
      false,
    );
    expect(
      parse({
        nodes: [
          { id: "a", label: "x".repeat(17) },
          { id: "b", parent: "a" },
        ],
      }).success,
    ).toBe(false);
    expect(
      parse({
        nodes: [
          { id: "a", value: "x".repeat(9) },
          { id: "b", parent: "a" },
        ],
      }).success,
    ).toBe(false);
    expect(parse({ levels: ["x".repeat(25)] }).success).toBe(false);
  });

  it("is described in the catalog with the rule about the value part", () => {
    const catalog = describeCatalog({ types: ["tree"] });
    expect(catalog).toContain("### tree — slots: figure, figure_a, figure_b");
    expect(catalog).toContain("_value");
    expect(catalog).toContain("lowercase");
    expect(catalog).toContain("levels?: string(≤24)[]");
  });

  it("is implemented", () => {
    expect(isImplemented("tree")).toBe(true);
  });

  it("is part of the structure fixture, which still parses", () => {
    expect(document.scenes.map((scene) => scene.id)).toContain("minimax");
    expect(minimax.beats).toHaveLength(4);
  });
});

describe("tree state", () => {
  it("shows nothing before the tree is shown and everything after", () => {
    const early = mount(show(["arbre"]), { frame: 0 });
    expect(early.container.querySelectorAll("[data-node], [data-edge], [data-value]")).toHaveLength(
      0,
    );
    early.unmount();
    const late = mount(show(["arbre"]));
    expect(nodeIds(late.container)).toHaveLength(7);
    expect(late.container.querySelectorAll("[data-edge]")).toHaveLength(6);
  });

  it("shows a node alone, without its edge while the parent is hidden", () => {
    const { container } = mount(show(parts(["min_g"])));
    expect(nodeIds(container)).toEqual(["min_g"]);
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(0);
  });

  it("draws the edge to a parent together with the child and no other edge", () => {
    const { container } = mount(show(parts(["racine", "min_g"])));
    expect(nodeIds(container)).toEqual(["racine", "min_g"]);
    expect(edgeOf(container, "racine>min_g")).not.toBeNull();
    expect(edgeOf(container, "racine>min_d")).toBeNull();
  });

  it("shows the value of a leaf as soon as the leaf is visible", () => {
    const { container } = mount(show(parts(["racine", "min_g", "f1"])));
    expect(valueIds(container)).toEqual(["f1"]);
    expect(valueOf(container, "f1")).toHaveTextContent("3");
    expect(Number(valueOf(container, "f1")!.getAttribute("opacity"))).toBe(1);
  });

  it("hides the value of an inner node until its _value part is shown", () => {
    const nodes = show(parts([...INNER, ...LEAVES]));
    const before = mount(nodes);
    expect(valueIds(before.container)).toEqual(LEAVES);
    before.unmount();

    const after = mount([
      ...nodes,
      {
        id: "b2",
        narration: "Test.",
        duration_ms: 4000,
        actions: [{ do: "show", targets: parts(["min_g_value"]), how: "fade", at: 0 }],
      },
    ]);
    expect(valueIds(after.container).sort()).toEqual([...LEAVES, "min_g"].sort());
    expect(valueOf(after.container, "min_g")).toHaveTextContent("3");
    expect(valueOf(after.container, "min_d")).toBeNull();
    expect(valueOf(after.container, "racine")).toBeNull();
  });

  it("does not show an inner value in the beat that shows only its _value part before the node", () => {
    const { container } = mount(show(parts(["min_g_value", "f1"])));
    expect(valueOf(container, "min_g")).toBeNull();
    expect(nodeOf(container, "min_g")).toBeNull();
  });

  it("shows the inner values too when the whole tree is shown", () => {
    const { container } = mount(show(["arbre"]));
    expect(valueIds(container).sort()).toEqual([...INNER, ...LEAVES].sort());
    expect(valueOf(container, "racine")).toHaveTextContent("3");
    expect(valueOf(container, "min_d")).toHaveTextContent("2");
  });

  it("writes no value for a node that has none", () => {
    const bare: Tree = {
      ...tree,
      nodes: tree.nodes.map((node) => ({ ...node, value: undefined })),
    };
    const { container } = mount(show(["arbre"]), { element: bare });
    expect(valueIds(container)).toEqual([]);
    expect(nodeIds(container)).toHaveLength(7);
  });

  it("hides a node again when it is hidden", () => {
    const { container } = mount([
      ...show(["arbre"]),
      {
        id: "b2",
        narration: "Test.",
        duration_ms: 4000,
        actions: [{ do: "hide", targets: parts(["f4"]), at: 0 }],
      },
    ]);
    expect(nodeOf(container, "f4")).toBeNull();
    expect(edgeOf(container, "min_d>f4")).toBeNull();
    expect(nodeOf(container, "f3")).not.toBeNull();
  });

  it("keeps the value of a focused node at the full opacity of its circle", () => {
    const { container } = mount(
      show(["arbre"], [{ do: "focus", targets: parts(["racine", "min_g"]), at: 0 }]),
    );
    expect(Number(nodeOf(container, "racine")!.getAttribute("opacity"))).toBe(1);
    expect(Number(valueOf(container, "racine")!.getAttribute("opacity"))).toBe(1);
    expect(Number(nodeOf(container, "min_d")!.getAttribute("opacity"))).toBeCloseTo(0.35, 2);
    expect(Number(valueOf(container, "min_d")!.getAttribute("opacity"))).toBeLessThan(1);
  });
});

describe("tree motion", () => {
  it("traces the edge and the ring while a node is drawn, and nothing remains at the end", () => {
    const beats = show(parts(["racine", "min_g"]), [], "draw");
    const mid = mount(beats, { frame: 9 });
    expect(ringOf(mid.container, "racine").getAttribute("stroke-dasharray")).not.toBeNull();
    expect(lineOf(mid.container, "racine>min_g").getAttribute("stroke-dasharray")).not.toBeNull();
    expect(nodeOf(mid.container, "min_g")).toBeNull();
    mid.unmount();
    const later = mount(beats, { frame: 14 });
    expect(nodeOf(later.container, "min_g")).not.toBeNull();
    expect(ringOf(later.container, "min_g").getAttribute("stroke-dasharray")).not.toBeNull();
    later.unmount();
    const end = mount(beats);
    expect(ringOf(end.container, "min_g").getAttribute("stroke-dasharray")).toBeNull();
    expect(lineOf(end.container, "racine>min_g").getAttribute("stroke-dasharray")).toBeNull();
  });

  it("draws a whole tree level by level", () => {
    const beats = show(["arbre"], [], "draw");
    const early = mount(beats, { frame: 4 });
    expect(nodeIds(early.container)).toEqual(["racine"]);
    early.unmount();
    const middle = mount(beats, { frame: 10 });
    expect(nodeIds(middle.container)).toContain("racine");
    expect(nodeIds(middle.container)).not.toContain("f1");
    middle.unmount();
    const end = mount(beats);
    expect(nodeIds(end.container)).toHaveLength(7);
  });

  it("writes a leaf value only once its circle is nearly drawn", () => {
    const beats = show(parts(["racine", "min_g", "f1"]), [], "draw");
    const mid = mount(beats, { frame: 12 });
    expect(nodeOf(mid.container, "f1")).not.toBeNull();
    expect(valueOf(mid.container, "f1")).toBeNull();
    mid.unmount();
    expect(valueOf(mount(beats).container, "f1")).not.toBeNull();
  });

  it("falls back to a fade under reduced motion", () => {
    const beats = show(["arbre"], [], "draw");
    const { container } = mount(beats, { frame: 3, reducedMotion: true });
    expect(container.querySelectorAll("[stroke-dasharray]")).toHaveLength(0);
    expect(nodeIds(container)).toHaveLength(7);
    for (const node of container.querySelectorAll<SVGGElement>("[data-node]")) {
      expect(Number(node.getAttribute("opacity"))).toBeLessThan(1);
    }
  });
});

describe("tree highlight", () => {
  const all = show(["arbre"], [highlight("racine", "min_g", "f1")]);
  const bands = (c: HTMLElement, id: string, theme: ThemeName) =>
    [...edgeOf(c, id)!.querySelectorAll("line")].filter(
      (line) => line.getAttribute("stroke") === getTheme(theme).role.result,
    );

  it("lights the edge between a node and its parent when both are highlighted", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(all, { theme: name });
      for (const id of ["racine>min_g", "min_g>f1"]) {
        expect(bands(container, id, name)).toHaveLength(1);
        const line = lineOf(container, id);
        expect(line.getAttribute("stroke")).toBe(theme.ink);
        expect(Number(line.getAttribute("stroke-width"))).toBeCloseTo(
          sceneMetrics.stroke.accent * U,
          5,
        );
        expect(Number(bands(container, id, name)[0]!.getAttribute("stroke-width"))).toBeGreaterThan(
          Number(line.getAttribute("stroke-width")),
        );
      }
      unmount();
    }
  });

  it("leaves a regular edge alone when only one of its ends is highlighted", () => {
    const { container } = mount(all);
    for (const id of ["racine>min_d", "min_g>f2", "min_d>f3"]) {
      expect(bands(container, id, "paper")).toHaveLength(0);
      expect(Number(lineOf(container, id).getAttribute("stroke-width"))).toBeCloseTo(
        sceneMetrics.stroke.regular * U,
        5,
      );
    }
  });

  it("puts the highlight behind the highlighted nodes only", () => {
    const { container } = mount(all);
    const yellow = (id: string) =>
      [...nodeOf(container, id)!.querySelectorAll("circle")].filter(
        (circle) => circle.getAttribute("fill") === getTheme("paper").role.result,
      );
    expect(yellow("racine")).toHaveLength(1);
    expect(yellow("f1")).toHaveLength(1);
    expect(yellow("f2")).toHaveLength(0);
    expect(yellow("min_d")).toHaveLength(0);
  });

  it("lights a node whose value part is highlighted", () => {
    const { container } = mount(
      show(["arbre"], [{ do: "highlight", targets: parts(["min_d_value", "racine"]), at: 0 }]),
    );
    expect(bands(container, "racine>min_d", "paper")).toHaveLength(1);
  });

  it("grows the highlight with the state", () => {
    const disc = (frame: number) => {
      const { container, unmount } = mount(show(["arbre"], [{ ...highlight("f1"), at: 0.5 }]), {
        frame,
      });
      const found = [...nodeOf(container, "f1")!.querySelectorAll("circle")].find(
        (circle) => circle.getAttribute("fill") === getTheme("paper").role.result,
      );
      const ring = Number(ringOf(container, "f1").getAttribute("r"));
      const radius = found ? Number(found.getAttribute("r")) : 0;
      unmount();
      return { radius, ring };
    };
    expect(disc(59).radius).toBe(0);
    const during = disc(63);
    expect(during.radius).toBeGreaterThan(0);
    expect(during.radius).toBeLessThan(during.ring);
    expect(disc(119).radius).toBeCloseTo(disc(119).ring, 5);
  });
});

describe("tree look", () => {
  it("draws ink circles filled with the surface colour, in both themes", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(show(["arbre"]), { theme: name });
      const circles = nodeOf(container, "f2")!.querySelectorAll("circle");
      expect(circles).toHaveLength(2);
      expect(circles[0]!.getAttribute("fill")).toBe(theme.surfaceRaised);
      const ring = ringOf(container, "f2");
      expect(ring.getAttribute("fill")).toBe("none");
      expect(ring.getAttribute("stroke")).toBe(theme.ink);
      expect(Number(ring.getAttribute("stroke-width"))).toBeCloseTo(
        sceneMetrics.stroke.regular * U,
        5,
      );
      expect(lineOf(container, "min_g>f2").getAttribute("stroke")).toBe(theme.ink);
      const text = valueOf(container, "f2")!;
      expect(text.getAttribute("fill")).toBe(theme.ink);
      expect(text.getAttribute("font-family")).toContain("Plex Mono");
      expect(text.style.fontVariantNumeric).toBe("tabular-nums");
      expect(Number(text.getAttribute("font-size"))).toBeGreaterThanOrEqual(
        sceneMetrics.text.min * U,
      );
      unmount();
    }
  });

  it("colours the ring with the role, and draws a result node as ink over the highlight", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const roles: Tree = {
        ...tree,
        nodes: tree.nodes.map((node) =>
          node.id === "f2"
            ? { ...node, role: "result" }
            : node.id === "f4"
              ? { ...node, role: "valid" }
              : node,
        ),
      };
      const { container, unmount } = mount(show(["arbre"]), { element: roles, theme: name });
      expect(ringOf(container, "racine").getAttribute("stroke")).toBe(theme.role.quantity);
      expect(ringOf(container, "min_g").getAttribute("stroke")).toBe(theme.role.action);
      expect(ringOf(container, "f4").getAttribute("stroke")).toBe(theme.role.valid);
      expect(ringOf(container, "f2").getAttribute("stroke")).toBe(theme.ink);
      const fills = [...nodeOf(container, "f2")!.querySelectorAll("circle")].map((c) =>
        c.getAttribute("fill"),
      );
      expect(fills).toContain(theme.role.result);
      unmount();
    }
  });

  it("switches the value to the dark text on a highlighted node, as other primitives do", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(show(["arbre"], [highlight("f1")]), { theme: name });
      expect(valueOf(container, "f1")!.getAttribute("fill")).toBe(
        name === "paper" ? theme.ink : theme.surface,
      );
      expect(valueOf(container, "f2")!.getAttribute("fill")).toBe(theme.ink);
      unmount();
    }
  });

  it("writes the label of a leaf under it and the label of an inner node beside it", () => {
    const labelled: Tree = {
      ...tree,
      nodes: tree.nodes.map((node) => (node.id === "f1" ? { ...node, label: "Gain" } : node)),
    };
    const { container } = mount(show(["arbre"]), { element: labelled });
    const text = (id: string) => container.querySelector(`[data-label="${id}"] text`)!;
    expect(text("racine")).toHaveTextContent("MAX");
    expect(text("f1")).toHaveTextContent("Gain");
    const circleY = Number(ringOf(container, "f1").getAttribute("cy"));
    expect(Number(text("f1").getAttribute("y"))).toBeGreaterThan(circleY);
    expect(text("racine").getAttribute("text-anchor")).toBe("start");
    expect(text("f1").getAttribute("text-anchor")).toBe("middle");
    expect(Number(text("racine").getAttribute("font-size"))).toBeGreaterThanOrEqual(
      sceneMetrics.text.min * U,
    );
  });

  it("writes the level captions in the caption style once a node of the level is visible", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const { container, unmount } = mount(show(parts(["racine", "min_g"])), { theme: name });
      const levels = [...container.querySelectorAll<SVGGElement>("[data-level]")];
      expect(levels.map((node) => node.dataset.level)).toEqual(["0", "1"]);
      expect(levels[0]).toHaveTextContent("TOI : LE");
      const text = levels[0]!.querySelector("text")!;
      expect(text.getAttribute("fill")).toBe(theme.inkSoft);
      expect(text.getAttribute("letter-spacing")).toBe("0.06em");
      expect(text.getAttribute("font-family")).toContain("Plex Mono");
      expect(Number(text.getAttribute("x"))).toBeLessThan(
        Number(ringOf(container, "racine").getAttribute("cx")),
      );
      unmount();
    }
  });

  it("keeps every circle inside the slot", () => {
    const { container } = mount(show(["arbre"]));
    const width = 108 * U;
    const height = 40.5 * U;
    for (const circle of container.querySelectorAll("circle")) {
      const r = Number(circle.getAttribute("r"));
      expect(Number(circle.getAttribute("cx")) - r).toBeGreaterThanOrEqual(0);
      expect(Number(circle.getAttribute("cx")) + r).toBeLessThanOrEqual(width);
      expect(Number(circle.getAttribute("cy")) - r).toBeGreaterThanOrEqual(0);
      expect(Number(circle.getAttribute("cy")) + r).toBeLessThanOrEqual(height);
    }
  });
});
