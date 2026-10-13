import { describe, expect, it } from "vitest";
import { layoutTree, wrapMono, type TreeInput } from "../../src/primitives/structure/tree-layout";
import { sceneMetrics, typeScale, unitPx } from "../../src/tokens";

const U = unitPx(1920);
const STROKE = sceneMetrics.stroke.regular * U;
const MIN = sceneMetrics.text.min * U;

interface Spec {
  id: string;
  parent?: string;
  label?: string;
  value?: string;
}

const SLOTS = [
  { name: "figure", width: 108 * U, height: 40.5 * U },
  { name: "figure beside notes", width: 68 * U, height: 40.5 * U },
];

function layoutOf(
  nodes: Spec[],
  options: { levels?: string[]; slot?: { width: number; height: number } } = {},
) {
  const slot = options.slot ?? SLOTS[0]!;
  const input: TreeInput = {
    nodes,
    levels: options.levels ?? [],
    width: slot.width,
    height: slot.height,
    u: U,
    stroke: STROKE,
    sizes: { min: MIN, label: sceneMetrics.text.label * U, value: 6 * U },
  };
  return { layout: layoutTree(input), input };
}

function binary(count: number, extra: (i: number) => Partial<Spec> = () => ({})): Spec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    ...(i === 0 ? {} : { parent: `n${Math.floor((i - 1) / 2)}` }),
    ...extra(i),
  }));
}

function chain(count: number): Spec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    ...(i === 0 ? {} : { parent: `n${i - 1}` }),
  }));
}

function fan(count: number): Spec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    ...(i === 0 ? {} : { parent: "n0" }),
  }));
}

function scattered(count: number, seed: number): Spec[] {
  let state = seed;
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const levels = [0];
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return { id: "n0" };
    const open = levels.flatMap((level, id) => (level < 3 ? [id] : []));
    const parent = open[Math.floor(next() * open.length)] as number;
    levels.push((levels[parent] as number) + 1);
    return { id: `n${i}`, parent: `n${parent}` };
  });
}

const SHAPES: { name: string; build: (count: number) => Spec[] }[] = [
  { name: "a binary tree", build: (count) => binary(count) },
  { name: "a fan", build: fan },
  { name: "a scatter of branches", build: (count) => scattered(count, 7 * count) },
  { name: "another scatter", build: (count) => scattered(count, 31 * count + 5) },
];

const sizes = Array.from({ length: 14 }, (_, i) => i + 2);

describe("tree layout geometry", () => {
  for (const slot of SLOTS) {
    for (const shape of SHAPES) {
      it(`keeps ${shape.name} of 2 to 15 nodes inside the ${slot.name} slot without overlap`, () => {
        for (const count of sizes) {
          const nodes = shape.build(count).map((node) => ({ ...node, value: "7" }));
          const { layout } = layoutOf(nodes, { slot });
          expect(layout.nodes).toHaveLength(count);
          const r = layout.radius;
          for (const node of layout.nodes) {
            expect(node.x - r).toBeGreaterThanOrEqual(-0.01);
            expect(node.x + r).toBeLessThanOrEqual(slot.width + 0.01);
            expect(node.y - r).toBeGreaterThanOrEqual(-0.01);
            expect(node.y + r).toBeLessThanOrEqual(slot.height + 0.01);
          }
          for (const a of layout.nodes) {
            for (const b of layout.nodes) {
              if (a.id < b.id) {
                expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * r);
              }
            }
          }
        }
      });
    }
  }

  it("also keeps a chain down to four levels apart", () => {
    for (const count of [2, 3, 4]) {
      const { layout } = layoutOf(chain(count));
      expect(layout.depth).toBe(count);
      const ys = layout.nodes.map((node) => node.y);
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(2 * layout.radius);
      }
    }
  });

  it("puts the root at the top and spreads the levels evenly over the height", () => {
    const { layout } = layoutOf(binary(15));
    expect(layout.depth).toBe(4);
    const rows = [0, 1, 2, 3].map((level) => layout.nodes.find((n) => n.level === level)!.y);
    const steps = rows.slice(1).map((y, i) => y - rows[i]!);
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 5);
    expect(rows[0]! - layout.radius).toBeCloseTo(STROKE / 2, 5);
    expect(rows[3]! + layout.radius).toBeCloseTo(SLOTS[0]!.height - STROKE / 2, 5);
    for (const node of layout.nodes) expect(node.y).toBeCloseTo(rows[node.level]!, 5);
  });

  it("orders siblings as declared and centres each parent over its children", () => {
    const nodes: Spec[] = [
      { id: "root" },
      { id: "c", parent: "root" },
      { id: "a", parent: "root" },
      { id: "b", parent: "root" },
      { id: "c2", parent: "c" },
      { id: "c1", parent: "c" },
    ];
    const { layout } = layoutOf(nodes);
    const at = (id: string) => layout.nodes.find((node) => node.id === id)!;
    expect(at("c").x).toBeLessThan(at("a").x);
    expect(at("a").x).toBeLessThan(at("b").x);
    expect(at("c2").x).toBeLessThan(at("c1").x);
    expect(at("c").x).toBeCloseTo((at("c2").x + at("c1").x) / 2, 5);
    expect(at("root").x).toBeCloseTo((at("c").x + at("b").x) / 2, 5);
  });

  it("keeps subtrees apart: every node of a subtree is left of the next sibling subtree", () => {
    const { layout } = layoutOf(binary(15));
    const at = (id: string) => layout.nodes.find((node) => node.id === id)!;
    const left = ["n1", "n3", "n4", "n7", "n8", "n9", "n10"].map(at);
    const right = ["n2", "n5", "n6", "n11", "n12", "n13", "n14"].map(at);
    expect(Math.max(...left.map((n) => n.x))).toBeLessThan(Math.min(...right.map((n) => n.x)));
  });

  it("joins every node to its parent with an edge that starts and ends on the circles", () => {
    const { layout } = layoutOf(binary(7));
    expect(layout.edges).toHaveLength(6);
    const at = (id: string) => layout.nodes.find((node) => node.id === id)!;
    for (const edge of layout.edges) {
      const parent = at(edge.parent);
      const child = at(edge.child);
      expect(Math.hypot(edge.start[0] - parent.x, edge.start[1] - parent.y)).toBeCloseTo(
        layout.radius,
        5,
      );
      expect(Math.hypot(edge.end[0] - child.x, edge.end[1] - child.y)).toBeCloseTo(
        layout.radius,
        5,
      );
      expect(edge.length).toBeCloseTo(
        Math.hypot(edge.end[0] - edge.start[0], edge.end[1] - edge.start[1]),
        5,
      );
      expect(edge.length).toBeGreaterThan(0);
    }
  });

  it("grows the circles for fewer nodes and caps them", () => {
    const small = layoutOf(chain(2)).layout.radius;
    const large = layoutOf(binary(15)).layout.radius;
    expect(small).toBeGreaterThan(large);
    expect(small).toBeLessThanOrEqual(6.5 * U + 1e-6);
  });

  it("ignores nodes cut off from the root by a cycle instead of looping", () => {
    const { layout } = layoutOf([
      { id: "root" },
      { id: "a", parent: "root" },
      { id: "x", parent: "y" },
      { id: "y", parent: "x" },
    ]);
    expect(layout.nodes.map((node) => node.id)).toEqual(["root", "a"]);
  });
});

describe("tree layout text", () => {
  const widths = (text: string, size: number) => [...text].length * 0.6 * size;

  it("fits every value inside the circle, never below the minimum text size", () => {
    const cases = [
      { slot: SLOTS[0]!, counts: [3, 7], lengths: [1, 2, 3, 4] },
      { slot: SLOTS[1]!, counts: [3, 7], lengths: [1, 2, 3, 4] },
      { slot: SLOTS[0]!, counts: [15], lengths: [1, 2] },
      { slot: SLOTS[1]!, counts: [15], lengths: [1, 2] },
    ];
    for (const { slot, counts, lengths } of cases) {
      for (const count of counts) {
        for (const length of lengths) {
          const value = "8".repeat(length);
          const { layout } = layoutOf(
            binary(count, () => ({ value })),
            { slot },
          );
          const half = Math.hypot(
            widths(value, layout.valueSize) / 2,
            (0.7 * layout.valueSize) / 2,
          );
          expect(half).toBeLessThanOrEqual(layout.radius - STROKE / 2 + 1e-6);
          expect(layout.valueSize).toBeGreaterThanOrEqual(MIN - 1e-6);
        }
      }
    }
  });

  it("keeps a long value inside its circle even when the text has to shrink", () => {
    const nodes = binary(15, () => ({ value: "+infinity".slice(0, 8) }));
    const { layout } = layoutOf(nodes, { slot: SLOTS[1]! });
    const half = Math.hypot(widths("+infinit", layout.valueSize) / 2, (0.7 * layout.valueSize) / 2);
    expect(half).toBeLessThanOrEqual(layout.radius - STROKE / 2 + 1e-6);
    const pairs = layout.nodes.flatMap((a) => layout.nodes.map((b) => [a, b] as const));
    for (const [a, b] of pairs) {
      if (a.id < b.id)
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * layout.radius);
    }
  });

  it("caps the value text size", () => {
    const { layout } = layoutOf(chain(2).map((node) => ({ ...node, value: "1" })));
    expect(layout.valueSize).toBeCloseTo(6 * U, 5);
  });

  it("places a leaf label under the leaf and an inner label beside the node", () => {
    const nodes = binary(7, (i) => ({ label: `L${i}` }));
    const { layout } = layoutOf(nodes);
    for (const node of layout.nodes) {
      expect(node.label).not.toBeNull();
      const label = node.label!;
      if (node.leaf) {
        expect(label.anchor).toBe("middle");
        expect(label.x).toBeCloseTo(node.x, 5);
        expect(label.y).toBeGreaterThan(node.y + layout.radius);
      } else {
        expect(label.y).toBeCloseTo(node.y, 5);
        expect(["start", "end"]).toContain(label.anchor);
        expect(
          label.anchor === "start"
            ? label.x > node.x + layout.radius
            : label.x < node.x - layout.radius,
        ).toBe(true);
      }
    }
  });

  const labelBoxes = (layout: ReturnType<typeof layoutOf>["layout"]) =>
    layout.nodes.flatMap((node) => {
      if (!node.label) return [];
      const { lines, x, y, anchor } = node.label;
      const w = Math.max(...lines.map((line) => widths(line, layout.labelSize)));
      const lh = layout.labelSize * layout.lineHeight;
      const left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
      return [
        {
          id: node.id,
          left,
          right: left + w,
          top: y - lh / 2,
          bottom: y + (lines.length - 0.5) * lh,
        },
      ];
    });
  const labelled = (count: number) =>
    binary(count, (i) => ({ label: i % 2 ? "Oui" : "Non", value: "3" }));

  it("keeps labels clear of every circle and of each other, and inside the slot", () => {
    const cases = [
      { slot: SLOTS[0]!, counts: [3, 7, 15] },
      { slot: SLOTS[1]!, counts: [3, 7] },
    ];
    for (const { slot, counts } of cases) {
      for (const count of counts) {
        const { layout } = layoutOf(labelled(count), { slot });
        const boxes = labelBoxes(layout);
        expect(boxes).toHaveLength(count);
        for (const box of boxes) {
          expect(box.left).toBeGreaterThanOrEqual(-0.01);
          expect(box.right).toBeLessThanOrEqual(slot.width + 0.01);
          expect(box.bottom).toBeLessThanOrEqual(slot.height + 0.01);
          for (const node of layout.nodes) {
            const dx = Math.max(box.left - node.x, 0, node.x - box.right);
            const dy = Math.max(box.top - node.y, 0, node.y - box.bottom);
            expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(layout.radius - 0.01);
          }
          for (const other of boxes) {
            if (box.id < other.id) {
              const apart =
                box.right <= other.left ||
                other.right <= box.left ||
                box.bottom <= other.top ||
                other.bottom <= box.top;
              expect(apart).toBe(true);
            }
          }
        }
      }
    }
  });

  it("keeps the labels of a crowded tree inside the slot", () => {
    const slot = SLOTS[1]!;
    const { layout } = layoutOf(labelled(15), { slot });
    for (const box of labelBoxes(layout)) {
      expect(box.left).toBeGreaterThanOrEqual(-0.01);
      expect(box.right).toBeLessThanOrEqual(slot.width + 0.01);
      expect(box.top).toBeGreaterThanOrEqual(-0.01);
      expect(box.bottom).toBeLessThanOrEqual(slot.height + 0.01);
    }
  });

  it("reserves room under the deepest leaves for their labels", () => {
    const { layout } = layoutOf(binary(7, (i) => ({ label: i >= 3 ? "Gain" : undefined })));
    const leaf = layout.nodes.find((node) => node.leaf)!;
    const label = layout.nodes.find((node) => node.leaf)!.label!;
    expect(label.y + (layout.labelSize * layout.lineHeight) / 2).toBeLessThanOrEqual(
      SLOTS[0]!.height - STROKE / 2 + 0.01,
    );
    expect(leaf.y + layout.radius).toBeLessThan(label.y);
  });
});

describe("tree layout level captions", () => {
  const captions = ["Toi : le plus grand", "Adversaire : plus petit", "Note de la position"];

  it("writes each caption at the left, centred on its level, and keeps the tree clear of them", () => {
    const { layout } = layoutOf(binary(7), { levels: captions });
    expect(layout.captions.map((caption) => caption.level)).toEqual([0, 1, 2]);
    const tracking = typeScale.caption.tracking;
    const advance = (0.6 + tracking) * layout.labelSize;
    const right = Math.min(...layout.nodes.map((node) => node.x - layout.radius));
    for (const { level, block } of layout.captions) {
      expect(block.anchor).toBe("start");
      expect(block.x).toBeCloseTo(STROKE / 2, 5);
      const row = layout.nodes.find((node) => node.level === level)!.y;
      const lh = layout.labelSize * layout.captionLineHeight;
      expect(block.y + ((block.lines.length - 1) * lh) / 2).toBeCloseTo(row, 5);
      const width = Math.max(...block.lines.map((line) => [...line].length)) * advance;
      expect(block.x + width).toBeLessThanOrEqual(right);
    }
  });

  it("wraps a caption to two lines and never splits a word that fits", () => {
    const { layout } = layoutOf(binary(7), { levels: captions });
    for (const { block } of layout.captions) expect(block.lines.length).toBeLessThanOrEqual(2);
    expect(layout.captions[0]!.block.lines.join(" ")).toBe("Toi : le plus grand");
  });

  it("keeps the captions of a four-level tree on one line so that they never touch", () => {
    const levels = ["Niveau un", "Niveau deux", "Niveau trois", "Niveau quatre"];
    const { layout } = layoutOf(binary(15), { levels });
    expect(layout.captions.map((caption) => caption.block.lines)).toEqual(
      levels.map((level) => [level]),
    );
    const ys = layout.captions.map((caption) => caption.block.y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(layout.labelSize * layout.captionLineHeight);
    }
  });

  it("leaves the tree narrower than without captions", () => {
    const plain = layoutOf(binary(7)).layout;
    const captioned = layoutOf(binary(7), { levels: captions }).layout;
    const span = (nodes: typeof plain.nodes) =>
      Math.max(...nodes.map((n) => n.x)) - Math.min(...nodes.map((n) => n.x));
    expect(span(captioned.nodes)).toBeLessThan(span(plain.nodes));
  });

  it("ignores captions beyond the depth of the tree", () => {
    const { layout } = layoutOf(chain(2), { levels: captions });
    expect(layout.captions).toHaveLength(2);
  });
});

describe("wrapMono", () => {
  it("breaks at spaces and cuts a word only when it cannot fit", () => {
    expect(wrapMono("a bb ccc", 4)).toEqual(["a bb", "ccc"]);
    expect(wrapMono("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapMono("", 4)).toEqual([]);
  });
});
