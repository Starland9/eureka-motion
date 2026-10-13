import type { Scope } from "../expr";
import { WORLD_ELEMENT_TYPES, type Scene, type SceneElement } from "./document";
import { elementExtent, elementLookup } from "./geometry";
import { visibilityByBeat } from "./inspect";

const LABEL_COLLISION = { x: 0.03, y: 0.04 };

export function collidingLabels(scene: Scene, scope: Scope): [SceneElement, SceneElement][] {
  const world = scene.world;
  if (!world) return [];
  const width = world.x[1] - world.x[0];
  const height = world.y[1] - world.y[0];
  const lookup = elementLookup(scene);
  const visibility = visibilityByBeat(scene);
  const labelled = scene.elements
    .filter((element) => WORLD_ELEMENT_TYPES.has(element.type))
    .map((element) => ({ element, label: elementExtent(element, lookup, scope, world).label }))
    .filter(
      (entry): entry is { element: SceneElement; label: readonly [number, number] } =>
        entry.label !== null,
    );
  const pairs: [SceneElement, SceneElement][] = [];
  for (let i = 0; i < labelled.length; i += 1) {
    for (let j = i + 1; j < labelled.length; j += 1) {
      const a = labelled[i] as (typeof labelled)[number];
      const b = labelled[j] as (typeof labelled)[number];
      if (a.element.slot !== b.element.slot) continue;
      const together = [...(visibility.get(a.element.id) ?? [])].some((beat) =>
        visibility.get(b.element.id)?.has(beat),
      );
      if (!together) continue;
      if (
        Math.abs(a.label[0] - b.label[0]) < width * LABEL_COLLISION.x &&
        Math.abs(a.label[1] - b.label[1]) < height * LABEL_COLLISION.y
      ) {
        pairs.push([a.element, b.element]);
      }
    }
  }
  return pairs;
}
