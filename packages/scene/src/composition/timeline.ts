import type { Scene } from "../schema/document";
import { beatDurationMs } from "../schema/timing";
import { FPS, msToFrames } from "../tokens";

export interface BeatTiming {
  id: string;
  index: number;
  start: number;
  duration: number;
  narration: string;
  audioUrl: string | undefined;
}

export interface SceneTiming {
  id: string;
  index: number;
  start: number;
  duration: number;
  beats: BeatTiming[];
}

export interface Timeline {
  fps: number;
  duration: number;
  scenes: SceneTiming[];
}

export function buildTimeline(scenes: readonly Scene[], fps: number = FPS): Timeline {
  let cursor = 0;
  const timings = scenes.map((scene, index): SceneTiming => {
    let inScene = 0;
    const beats = scene.beats.map((beat, beatIndex): BeatTiming => {
      const duration = msToFrames(beatDurationMs(beat), fps);
      const timing: BeatTiming = {
        id: beat.id,
        index: beatIndex,
        start: inScene,
        duration,
        narration: beat.narration,
        audioUrl: beat.audio?.url,
      };
      inScene += duration;
      return timing;
    });
    const timing: SceneTiming = { id: scene.id, index, start: cursor, duration: inScene, beats };
    cursor += inScene;
    return timing;
  });
  return { fps, duration: cursor, scenes: timings };
}

export interface Location {
  scene: SceneTiming;
  beat: BeatTiming;
  frameInScene: number;
  frameInBeat: number;
}

export function locate(timeline: Timeline, frame: number): Location | null {
  if (timeline.scenes.length === 0) return null;
  const clamped = Math.min(Math.max(0, frame), Math.max(0, timeline.duration - 1));
  const scene =
    timeline.scenes.find((s) => clamped >= s.start && clamped < s.start + s.duration) ??
    (timeline.scenes.at(-1) as SceneTiming);
  const frameInScene = clamped - scene.start;
  const beat =
    scene.beats.find((b) => frameInScene >= b.start && frameInScene < b.start + b.duration) ??
    (scene.beats.at(-1) as BeatTiming);
  return { scene, beat, frameInScene, frameInBeat: frameInScene - beat.start };
}

export function sceneStartFrame(timeline: Timeline, sceneId: string): number | null {
  return timeline.scenes.find((scene) => scene.id === sceneId)?.start ?? null;
}
