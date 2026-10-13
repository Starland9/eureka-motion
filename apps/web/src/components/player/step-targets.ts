import { previousSceneIndex, sceneIndexAt } from "./transport-time";

export interface StepScene {
  start: number;
  beats: readonly { start: number; duration: number }[];
}

export function beatEndFrames(scenes: readonly StepScene[]): number[] {
  return scenes.flatMap((scene) =>
    scene.beats.map((beat) => scene.start + beat.start + beat.duration - 1),
  );
}

export function nextStepFrame(ends: readonly number[], frame: number): number | null {
  return ends.find((end) => end > frame) ?? null;
}

export function previousStepFrame(ends: readonly number[], frame: number): number | null {
  if (frame <= 0) return null;
  let found = 0;
  for (const end of ends) if (end < frame) found = end;
  return found;
}

export function sceneLandingFrame(scene: StepScene, reducedMotion: boolean): number {
  const first = scene.beats[0];
  if (!reducedMotion || !first) return scene.start;
  return scene.start + first.start + first.duration - 1;
}

export function previousSceneTarget(
  scenes: readonly StepScene[],
  frame: number,
  fps: number,
  reducedMotion: boolean,
): number | null {
  if (!reducedMotion) return previousSceneIndex(scenes, frame, fps);
  const current = sceneIndexAt(scenes, frame);
  const scene = scenes[current];
  if (!scene) return null;
  return frame > sceneLandingFrame(scene, true) ? current : Math.max(0, current - 1);
}
