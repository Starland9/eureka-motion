import { resolve, type Scope } from "../expr";
import { createFrame, createProjection, layoutSlots } from "../layouts";
import { sceneMetrics } from "../tokens";
import { WORLD_ELEMENT_TYPES, type Scene, type SceneElement } from "./document";
import { elementExtent, elementLookup, resolvePoint } from "./geometry";
import { visibilityByBeat } from "./inspect";
import { objectLabelOffset, objectLabelSides, type LabelSide } from "./object-labels";

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
  exact: boolean;
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
  const objectSides = new Map<string, Map<string, LabelSide>>();
  for (const element of scene.elements) {
    if (!WORLD_ELEMENT_TYPES.has(element.type)) continue;
    const rect = slots[element.slot];
    const anchor = elementExtent(element, lookup, scope, world).label;
    if (!rect || anchor === null) continue;
    const projection = createProjection(world, rect, { stretch });
    const text = "label" in element && typeof element.label === "string" ? element.label : "";
    if (element.type === "object" && text !== "") {
      let sides = objectSides.get(element.slot);
      if (!sides) {
        sides = objectLabelSides({
          lookup,
          scope,
          slot: element.slot,
          toPx: projection.toPx,
          length: projection.length,
          u: frame.u,
          labelSize: size,
        });
        objectSides.set(element.slot, sides);
      }
      const [x, y] = projection.toPx(resolvePoint(element.at, scope));
      const sizePx = projection.length(Math.abs(resolve(element.size, scope)));
      placed.push({
        element,
        x,
        y: y + objectLabelOffset(sides.get(element.id) ?? 1, sizePx, frame.u),
        width: text.length * ADVANCE_EM * size,
        exact: true,
      });
      continue;
    }
    const [x, y] = projection.toPx(anchor);
    placed.push({
      element,
      x,
      y,
      width: Math.max(UNKNOWN_LABEL_CHARS, text.length) * ADVANCE_EM * size,
      exact: false,
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
      const tolerance = a.exact && b.exact ? 1 : OVERLAP;
      if (
        Math.abs(a.x - b.x) < ((a.width + b.width) / 2) * tolerance &&
        Math.abs(a.y - b.y) < size * HEIGHT_EM * tolerance
      ) {
        pairs.push([a.element, b.element]);
      }
    }
  }
  return pairs;
}
