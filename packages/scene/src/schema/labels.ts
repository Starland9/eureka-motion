import type { Scope } from "../expr";
import { createFrame, createProjection, layoutSlots } from "../layouts";
import { sceneMetrics } from "../tokens";
import { WORLD_ELEMENT_TYPES, type Scene, type SceneElement } from "./document";
import { elementExtent, elementLookup } from "./geometry";
import { visibilityByBeat } from "./inspect";

const REFERENCE_FRAME = { width: 1920, height: 1080 };
const ADVANCE_EM = 0.6;
const HEIGHT_EM = 1.1;
const UNKNOWN_LABEL_CHARS = 4;
// Labels are not always centred on their anchor: only a clear overlap counts.
const OVERLAP = 0.8;

interface Placed {
  element: SceneElement;
  x: number;
  y: number;
  width: number;
}

export function collidingLabels(scene: Scene, scope: Scope): [SceneElement, SceneElement][] {
  const world = scene.world;
  if (!world) return [];
  const frame = createFrame(REFERENCE_FRAME.width, REFERENCE_FRAME.height);
  const slots = layoutSlots(scene.layout, frame);
  const stretch = scene.elements.some((element) => element.type === "axes");
  const size = sceneMetrics.text.label * frame.u;
  const lookup = elementLookup(scene);
  const visibility = visibilityByBeat(scene);

  const placed: Placed[] = [];
  for (const element of scene.elements) {
    if (!WORLD_ELEMENT_TYPES.has(element.type)) continue;
    const rect = slots[element.slot];
    const anchor = elementExtent(element, lookup, scope, world).label;
    if (!rect || anchor === null) continue;
    const [x, y] = createProjection(world, rect, { stretch }).toPx(anchor);
    const text = "label" in element && typeof element.label === "string" ? element.label : "";
    placed.push({
      element,
      x,
      y,
      width: Math.max(UNKNOWN_LABEL_CHARS, text.length) * ADVANCE_EM * size,
    });
  }

  const pairs: [SceneElement, SceneElement][] = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i] as Placed;
      const b = placed[j] as Placed;
      if (a.element.slot !== b.element.slot) continue;
      const together = [...(visibility.get(a.element.id) ?? [])].some((beat) =>
        visibility.get(b.element.id)?.has(beat),
      );
      if (!together) continue;
      if (
        Math.abs(a.x - b.x) < ((a.width + b.width) / 2) * OVERLAP &&
        Math.abs(a.y - b.y) < size * HEIGHT_EM * OVERLAP
      ) {
        pairs.push([a.element, b.element]);
      }
    }
  }
  return pairs;
}
