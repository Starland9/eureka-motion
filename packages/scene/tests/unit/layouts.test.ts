import { describe, expect, it } from "vitest";
import {
  createFrame,
  createProjection,
  layoutSlots,
  rectContains,
  rectsOverlap,
  type Rect,
} from "../../src/layouts";
import { LAYOUT_NAMES, LAYOUT_SLOTS } from "../../src/schema/document";
import { CANVAS, sceneMetrics } from "../../src/tokens";

describe("frame", () => {
  const frame = createFrame(CANVAS.width, CANVAS.height);

  it("derives the unit from the canvas width", () => {
    expect(frame.u).toBe(16);
    expect(createFrame(360, 202.5).u).toBe(3);
  });

  it("keeps the safe margins and reserves the bottom band", () => {
    const margin = sceneMetrics.safeMargin * frame.u;
    expect(frame.title.x).toBe(margin);
    expect(frame.title.y).toBe(margin);
    expect(frame.body.x + frame.body.width).toBe(CANVAS.width - margin);
    expect(frame.body.y + frame.body.height).toBe(
      CANVAS.height - sceneMetrics.bottomBand * frame.u,
    );
    expect(frame.band.y + frame.band.height).toBe(CANVAS.height);
  });

  it("stacks title, body and band without overlap", () => {
    expect(rectsOverlap(frame.title, frame.body)).toBe(false);
    expect(rectsOverlap(frame.body, frame.band)).toBe(false);
  });
});

describe("layout slots", () => {
  for (const size of [CANVAS, { width: 360, height: 202.5 }]) {
    const frame = createFrame(size.width, size.height);
    for (const layout of LAYOUT_NAMES) {
      it(`${layout} at ${size.width} px: declares its slots, inside the body, without overlap`, () => {
        const slots = layoutSlots(layout, frame);
        expect(Object.keys(slots).sort()).toEqual([...LAYOUT_SLOTS[layout]].sort());
        const rects = Object.values(slots) as Rect[];
        for (const rect of rects) {
          expect(rect.width).toBeGreaterThan(0);
          expect(rect.height).toBeGreaterThan(0);
          expect(rectContains(frame.body, rect)).toBe(true);
        }
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            expect(rectsOverlap(rects[i] as Rect, rects[j] as Rect)).toBe(false);
          }
        }
      });
    }
  }
});

describe("projection", () => {
  const size = { width: 1088, height: 648 };

  it("fits the world into the slot without distortion, centred", () => {
    const p = createProjection({ x: [-6, 6], y: [-3, 3] }, size);
    expect(p.scale).toBeCloseTo(1088 / 12, 6);
    const [cx, cy] = p.toPx([0, 0]);
    expect(cx).toBeCloseTo(size.width / 2, 6);
    expect(cy).toBeCloseTo(size.height / 2, 6);
    expect(p.length(2)).toBeCloseTo(2 * p.scale, 6);
  });

  it("puts positive y upwards", () => {
    const p = createProjection({ x: [0, 10], y: [0, 10] }, size);
    expect(p.toPx([0, 10])[1]).toBeLessThan(p.toPx([0, 0])[1]);
  });

  it("keeps the corners of any world inside the slot", () => {
    for (const world of [
      { x: [-5, 5], y: [-3, 3] },
      { x: [0, 1], y: [0, 100] },
      { x: [-1000, 3000], y: [2, 4] },
    ] as const) {
      const p = createProjection(world, size);
      for (const corner of [
        [world.x[0], world.y[0]],
        [world.x[1], world.y[1]],
      ] as const) {
        const [x, y] = p.toPx(corner);
        expect(x).toBeGreaterThanOrEqual(-1e-6);
        expect(x).toBeLessThanOrEqual(size.width + 1e-6);
        expect(y).toBeGreaterThanOrEqual(-1e-6);
        expect(y).toBeLessThanOrEqual(size.height + 1e-6);
      }
    }
  });
});
