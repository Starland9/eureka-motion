// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SceneFrame } from "../../src/composition/SceneFrame";
import { hatch, inCircle, shaded } from "../../src/pictograms/hatch";
import { Pictogram, type PictogramKind } from "../../src/pictograms";
import { PICTOGRAMS, DocumentSchema } from "../../src/schema/document";
import type { Action, ElementOf, Param, Scene } from "../../src/schema/document";
import { getTheme, THEME_NAMES } from "../../src/tokens";
import { strokeWidth } from "../../src/primitives/shared";
import {
  frameProps,
  renderElement,
  sceneOf,
  testContext,
  type ContextOptions,
} from "../helpers/scene";

const world: Scene["world"] = { x: [-10, 10], y: [-5, 5] };
const NUMBER = "(-?[\\d.]+(?:e[+-]?\\d+)?)";
const FORBIDDEN = "linearGradient, radialGradient, filter, image";

function objectOf(patch: Partial<ElementOf<"object">> = {}): ElementOf<"object"> {
  return { id: "o", slot: "figure", type: "object", kind: "apple", at: [0, 0], size: 4, ...patch };
}

const showing = (how: "fade" | "draw" = "fade", ...extra: Action[]): Scene["beats"] => [
  {
    id: "b1",
    narration: "Test.",
    duration_ms: 4000,
    actions: [{ do: "show", targets: ["o"], how, at: 0 }, ...extra],
  },
];

function mount(
  element: ElementOf<"object">,
  options: { beats?: Scene["beats"]; bounded?: boolean } & Partial<ContextOptions> = {},
) {
  const { beats, bounded = true, ...rest } = options;
  const scene = sceneOf([element], { world: bounded ? world : undefined, beats });
  const ctx = testContext({ scene, frame: "end", ...rest });
  return { ctx, ...renderElement(element, ctx) };
}

function placement(container: HTMLElement) {
  const group = container.querySelector("g[transform]");
  const match = new RegExp(`^translate\\(${NUMBER} ${NUMBER}\\) scale\\(${NUMBER}\\)$`).exec(
    group?.getAttribute("transform") ?? "",
  );
  if (!match) throw new Error("no pictogram placement found");
  const [, left, top, scale] = match.map(Number) as [number, number, number, number, number];
  const size = scale * 100;
  return { size, centre: [left + size / 2, top + size / 2] as const, group: group! };
}

const labelOf = (container: HTMLElement) => container.querySelector("text");
const opacityOf = (el: Element | null | undefined): number => Number(el?.getAttribute("opacity"));

const strokedParts = (container: HTMLElement): Element[] =>
  [...container.querySelectorAll("path, circle, ellipse, line, polyline, polygon, rect")].filter(
    (el) => el.hasAttribute("stroke") && el.getAttribute("stroke") !== "none",
  );

function drawing(kind: PictogramKind, theme: "paper" | "board", props: { colour?: string } = {}) {
  const scene = sceneOf([objectOf({ kind })], { world });
  const ctx = testContext({ scene, theme });
  const result = render(
    <svg>
      <Pictogram ctx={ctx} kind={kind} x={50} y={50} size={100} {...props} />
    </svg>,
  );
  return { ctx, ...result };
}

describe("the pictogram library", () => {
  it("has seventeen kinds", () => {
    expect(PICTOGRAMS).toHaveLength(17);
  });

  it("draws every kind differently, with nothing but plain strokes", () => {
    const markups = new Map<string, PictogramKind>();
    for (const kind of PICTOGRAMS) {
      const { container, unmount } = drawing(kind, "paper");
      expect(container.querySelectorAll("path").length, kind).toBeGreaterThan(1);
      expect(container.querySelector(FORBIDDEN), kind).toBeNull();
      markups.set(container.innerHTML, kind);
      unmount();
    }
    expect(markups.size).toBe(PICTOGRAMS.length);
  });

  it.each(THEME_NAMES)(
    "strokes with the theme ink and fills with the raised surface (%s)",
    (name) => {
      const theme = getTheme(name);
      for (const kind of PICTOGRAMS) {
        const { container, unmount } = drawing(kind, name);
        const parts = strokedParts(container);
        expect(parts.length, kind).toBeGreaterThan(0);
        for (const part of parts) expect(part.getAttribute("stroke"), kind).toBe(theme.ink);
        for (const part of container.querySelectorAll("path")) {
          expect([theme.surfaceRaised, "none"], kind).toContain(part.getAttribute("fill"));
        }
        unmount();
      }
    },
  );

  it.each(THEME_NAMES)("strokes with the given colour instead of the ink (%s)", (name) => {
    const theme = getTheme(name);
    for (const kind of PICTOGRAMS) {
      const { container, unmount } = drawing(kind, name, { colour: theme.role.quantity });
      const parts = strokedParts(container);
      expect(parts.length, kind).toBeGreaterThan(0);
      for (const part of parts) expect(part.getAttribute("stroke"), kind).toBe(theme.role.quantity);
      unmount();
    }
  });

  it("keeps a constant, mitred stroke whatever the size", () => {
    for (const kind of PICTOGRAMS) {
      const { ctx, container, unmount } = drawing(kind, "paper");
      const widths = [strokeWidth(ctx, "regular"), strokeWidth(ctx, "construction")];
      for (const part of strokedParts(container)) {
        expect(part.getAttribute("vector-effect"), kind).toBe("non-scaling-stroke");
        expect(part.getAttribute("stroke-linejoin"), kind).toBe("miter");
        expect(part.getAttribute("stroke-linecap"), kind).toBe("butt");
        expect(widths, kind).toContain(Number(part.getAttribute("stroke-width")));
      }
      unmount();
    }
  });

  it("scales a 100 by 100 drawing to the requested size around the requested point", () => {
    const scene = sceneOf([objectOf()], { world });
    const ctx = testContext({ scene });
    const { container } = render(
      <svg>
        <Pictogram ctx={ctx} kind="coin" x={300} y={200} size={80} opacity={0.5} />
      </svg>,
    );
    const group = container.querySelector("g")!;
    expect(group.getAttribute("transform")).toBe("translate(260 160) scale(0.8)");
    expect(group.getAttribute("opacity")).toBe("0.5");
  });

  it("drops fine detail, never stroke weight, when the drawing gets small", () => {
    const scene = sceneOf([objectOf()], { world });
    const ctx = testContext({ scene });
    const strokes = (kind: PictogramKind, size: number) => {
      const { container, unmount } = render(
        <svg>
          <Pictogram ctx={ctx} kind={kind} x={0} y={0} size={size} />
        </svg>,
      );
      const parts = strokedParts(container);
      const widths = new Set(parts.map((part) => part.getAttribute("stroke-width")));
      const segments = parts
        .map((part) => part.getAttribute("d") ?? "")
        .join("")
        .split("M").length;
      unmount();
      return { widths, segments };
    };
    for (const kind of ["planet", "cell", "beaker", "molecule"] as const) {
      const small = strokes(kind, 60);
      const large = strokes(kind, 240);
      expect(small.segments, kind).toBeLessThan(large.segments);
      for (const width of small.widths) expect(large.widths, kind).toContain(width);
    }
  });
});

describe("hatching", () => {
  it("keeps every line inside the region, on the shaded side of a sphere", () => {
    const sphere = inCircle(50, 50, 38);
    const d = hatch(shaded(sphere, [50, 50], 10), 4);
    const points = [...d.matchAll(new RegExp(`${NUMBER} ${NUMBER}`, "g"))].map(
      ([, x, y]) => [Number(x), Number(y)] as const,
    );
    expect(points.length).toBeGreaterThan(8);
    for (const [x, y] of points) {
      expect(Math.hypot(x - 50, y - 50)).toBeLessThanOrEqual(38.2);
      expect(x + y).toBeGreaterThan(100);
    }
  });

  it("returns nothing for an empty region", () => {
    expect(hatch(() => false, 4)).toBe("");
  });
});

describe("object primitive", () => {
  it("sits at its projected position, size world units tall", () => {
    const { ctx, container } = mount(objectOf({ at: [3, -2], size: 4 }));
    const [x, y] = ctx.projection!.toPx([3, -2]);
    const placed = placement(container);
    expect(placed.centre[0]).toBeCloseTo(x, 3);
    expect(placed.centre[1]).toBeCloseTo(y, 3);
    expect(placed.size).toBeCloseTo(ctx.projection!.length(4), 3);
  });

  it("draws the kind it is given", () => {
    const html = (kind: PictogramKind) => mount(objectOf({ kind })).container.innerHTML;
    expect(html("sun")).not.toBe(html("moon"));
  });

  it("scales with a bound size", () => {
    const params: Param[] = [
      {
        id: "s",
        symbol: "s",
        label: "Taille",
        unit: "",
        min: 1,
        max: 6,
        step: 1,
        default: 2,
        role: "quantity",
      },
    ];
    const element = objectOf({ size: { expr: "s" } });
    const small = mount(element, { params });
    const large = mount(element, { params, values: { s: 4 } });
    expect(placement(small.container).size).toBeCloseTo(small.ctx.projection!.length(2), 3);
    expect(placement(large.container).size).toBeCloseTo(2 * placement(small.container).size, 3);
  });

  it("follows a move from its position toward the target", () => {
    const element = objectOf({ at: [-4, 2] });
    const beats = showing("fade", { do: "move", target: "o", to: [6, -3], at: 0 });
    const start = mount(element, { beats, frame: 0 });
    const middle = mount(element, { beats, frame: 6 });
    const end = mount(element, { beats, frame: "end" });
    const px = (point: readonly [number, number]) => start.ctx.projection!.toPx(point);
    const [fromX, fromY] = px([-4, 2]);
    const [toX, toY] = px([6, -3]);
    expect(placement(start.container).centre[0]).toBeCloseTo(fromX, 3);
    const half = placement(middle.container).centre;
    expect(half[0]).toBeGreaterThan(fromX);
    expect(half[0]).toBeLessThan(toX);
    expect(half[1]).toBeGreaterThan(fromY);
    expect(half[1]).toBeLessThan(toY);
    const final = placement(end.container).centre;
    expect(final[0]).toBeCloseTo(toX, 3);
    expect(final[1]).toBeCloseTo(toY, 3);
  });

  it("carries its label along under the pictogram", () => {
    const beats = showing("fade", { do: "move", target: "o", to: [6, -3], at: 0 });
    const { container } = mount(objectOf({ label: "pomme", size: 4 }), { beats });
    const text = labelOf(container)!;
    const placed = placement(container);
    expect(text.textContent).toBe("pomme");
    expect(Number(text.getAttribute("x"))).toBeCloseTo(placed.centre[0], 3);
    expect(Number(text.getAttribute("y"))).toBeGreaterThan(placed.centre[1] + placed.size / 2);
  });

  it("has no label unless it is given one", () => {
    expect(labelOf(mount(objectOf()).container)).toBeNull();
  });

  it.each(THEME_NAMES)("uses the role colour for the strokes only (%s)", (name) => {
    const theme = getTheme(name);
    const { container } = mount(objectOf({ role: "quantity", label: "pomme" }), { theme: name });
    for (const part of strokedParts(container)) {
      expect(part.getAttribute("stroke")).toBe(theme.role.quantity);
    }
    expect(labelOf(container)!.getAttribute("fill")).toBe(theme.ink);
  });

  it.each(THEME_NAMES)("keeps ink for the result role, which is a fill (%s)", (name) => {
    const theme = getTheme(name);
    const { container } = mount(objectOf({ role: "result" }), { theme: name });
    for (const part of strokedParts(container)) expect(part.getAttribute("stroke")).toBe(theme.ink);
  });

  it("is invisible before its show and complete at the end", () => {
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [{ do: "show", targets: ["o"], how: "fade", at: 0.5 }],
      },
    ];
    const element = objectOf({ label: "pomme" });
    const before = mount(element, { beats, frame: 0 });
    expect(opacityOf(placement(before.container).group)).toBe(0);
    expect(opacityOf(labelOf(before.container))).toBe(0);
    const after = mount(element, { beats, frame: "end" });
    expect(opacityOf(placement(after.container).group)).toBe(1);
    expect(opacityOf(labelOf(after.container))).toBe(1);
  });

  it("is not mounted at all while hidden, once placed in a scene", () => {
    const element = objectOf({ label: "pomme" });
    const beats: Scene["beats"] = [
      {
        id: "b1",
        narration: "Test.",
        duration_ms: 4000,
        actions: [{ do: "show", targets: ["o"], how: "fade", at: 0.5 }],
      },
    ];
    const scene = sceneOf([element], { world, beats });
    const hidden = render(<SceneFrame {...frameProps({ scene, frame: 0 })} />);
    expect(hidden.container.querySelector("path")).toBeNull();
    hidden.unmount();
    const shown = render(<SceneFrame {...frameProps({ scene, frame: "end" })} />);
    expect(shown.container.querySelector("path")).not.toBeNull();
  });

  it("fades the pictogram in with the draw progress, its label after it", () => {
    const element = objectOf({ label: "pomme" });
    const beats = showing("draw");
    const middle = mount(element, { beats, frame: 9 });
    const drawn = opacityOf(placement(middle.container).group);
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(1);
    expect(opacityOf(labelOf(middle.container))).toBe(0);
    const end = mount(element, { beats, frame: "end" });
    expect(opacityOf(placement(end.container).group)).toBe(1);
    expect(opacityOf(labelOf(end.container))).toBe(1);
  });

  it("grows a flat result square behind the pictogram while highlighted", () => {
    const element = objectOf({ size: 4 });
    const beats = showing("fade", { do: "highlight", targets: ["o"], at: 0 });
    const plain = mount(element, { beats: showing() });
    expect(plain.container.querySelector("rect")).toBeNull();
    const middle = mount(element, { beats, frame: 4 });
    const end = mount(element, { beats, frame: "end" });
    const theme = getTheme("paper");
    const rect = end.container.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe(theme.role.result);
    expect(rect.getAttribute("stroke")).toBeNull();
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(Number(rect.getAttribute("height")), 3);
    expect(Number(rect.getAttribute("width"))).toBeGreaterThan(
      Number(middle.container.querySelector("rect")!.getAttribute("width")),
    );
    const behind = rect.compareDocumentPosition(placement(end.container).group);
    expect(behind & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws nothing in a scene without a world", () => {
    const { container } = mount(objectOf(), { bounded: false });
    expect(container.querySelector("g")).toBeNull();
  });
});

describe("pictogram snapshot document", () => {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, "../fixtures/pictograms.json"), "utf8"),
  );
  const document = DocumentSchema.parse(raw.payload);
  const objects = document.scenes.flatMap((scene) =>
    scene.elements.filter((element): element is ElementOf<"object"> => element.type === "object"),
  );

  it("satisfies the document schema in figure layout, with at most six labels a scene", () => {
    expect(raw.language).toBe("fr");
    for (const scene of document.scenes) {
      expect(scene.layout).toBe("figure");
      expect(scene.elements.filter((e) => "label" in e && e.label).length).toBeLessThanOrEqual(6);
    }
  });

  it("lays out every kind of the library, labelled", () => {
    const labelled = new Set(objects.filter((object) => object.label).map((object) => object.kind));
    expect([...labelled].sort()).toEqual([...PICTOGRAMS].sort());
  });

  it("renders every scene in both themes without gradient, filter or image", () => {
    for (const scene of document.scenes) {
      for (const name of THEME_NAMES) {
        for (const element of scene.elements) {
          const { container, unmount } = renderElement(
            element,
            testContext({ scene, slot: element.slot, theme: name, frame: "end" }),
          );
          expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
          expect(container.querySelector(FORBIDDEN)).toBeNull();
          unmount();
        }
      }
    }
  });
});
