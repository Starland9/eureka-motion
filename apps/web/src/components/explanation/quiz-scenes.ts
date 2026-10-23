import type { Scene } from "scene";
import { sceneSlots } from "@/components/player/scene-list-entries";

export function sceneNumbersOf(scenes: readonly Scene[]): Record<string, number> {
  const slots = sceneSlots(scenes);
  return Object.fromEntries(
    scenes.map((scene, position) => [scene.id, (slots[position] ?? position) + 1]),
  );
}

export function scenePositionOf(scenes: readonly Scene[], sceneId: string): number | null {
  const position = scenes.findIndex((scene) => scene.id === sceneId);
  return position < 0 ? null : position;
}

export function isFullyVisible(
  rect: Pick<DOMRect, "top" | "bottom">,
  viewportHeight: number,
): boolean {
  return rect.top >= 0 && rect.bottom <= viewportHeight;
}
