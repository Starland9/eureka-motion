import type { Beat, Scene } from "./document";

export const WORDS_PER_SECOND = 2.6;
export const BEAT_PAUSE_MS = 250;
export const MIN_BEAT_MS = 1500;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function beatDurationMs(beat: Pick<Beat, "narration" | "audio" | "duration_ms">): number {
  if (beat.duration_ms !== undefined) return beat.duration_ms;
  if (beat.audio) return beat.audio.duration_ms + BEAT_PAUSE_MS;
  const spoken = (countWords(beat.narration) / WORDS_PER_SECOND) * 1000;
  return Math.max(MIN_BEAT_MS, Math.round(spoken + BEAT_PAUSE_MS));
}

export function sceneDurationMs(scene: Pick<Scene, "beats">): number {
  return scene.beats.reduce((total, beat) => total + beatDurationMs(beat), 0);
}

export function totalDurationMs(scenes: readonly Pick<Scene, "beats">[]): number {
  return scenes.reduce((total, scene) => total + sceneDurationMs(scene), 0);
}
