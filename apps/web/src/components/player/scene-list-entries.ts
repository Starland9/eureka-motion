import type { Scene, Timeline } from "scene";

export type SceneEntry =
  | { kind: "ready"; number: number; position: number; title: string; seconds: number }
  | { kind: "pending"; number: number }
  | { kind: "missing"; number: number };

// Planned slot of each received scene: the index it carries, else its position.
export function sceneSlots(scenes: readonly Scene[]): number[] {
  const taken = new Set<number>();
  const own = scenes.map((scene) => {
    const usable = Number.isInteger(scene.index) && scene.index >= 0 && !taken.has(scene.index);
    if (usable) taken.add(scene.index);
    return usable ? scene.index : null;
  });
  return own.map((slot, position) => {
    if (slot !== null) return slot;
    let next = position;
    while (taken.has(next)) next += 1;
    taken.add(next);
    return next;
  });
}

export function buildSceneEntries(
  scenes: readonly Scene[],
  timeline: Timeline,
  plannedCount: number | undefined,
  dropped: readonly number[],
): SceneEntry[] {
  const slots = sceneSlots(scenes);
  const positionOf = new Map(slots.map((slot, position) => [slot, position]));
  const total = Math.max(
    plannedCount ?? 0,
    ...slots.map((s) => s + 1),
    ...dropped.map((i) => i + 1),
  );
  return Array.from({ length: total }, (_, slot): SceneEntry => {
    const number = slot + 1;
    const position = positionOf.get(slot);
    const scene = position === undefined ? undefined : scenes[position];
    const timing = position === undefined ? undefined : timeline.scenes[position];
    if (position !== undefined && scene && timing) {
      return {
        kind: "ready",
        number,
        position,
        title: scene.title,
        seconds: Math.round(timing.duration / timeline.fps),
      };
    }
    return { kind: dropped.includes(slot) ? "missing" : "pending", number };
  });
}

export function formatFigureNumber(number: number): string {
  return String(number).padStart(2, "0");
}

export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
