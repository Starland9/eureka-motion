export const SEEK_STEP_SECONDS = 5;
export const RESTART_AFTER_SECONDS = 2;
export const TICK_SECONDS = 10;

export interface RulerLayout {
  pendingCount: number;
  pendingWeight: number;
  known: number;
  total: number;
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function totalSeconds(durationInFrames: number, fps: number): number {
  return Math.round(durationInFrames / fps);
}

export function clockSeconds(
  frame: number,
  ended: boolean,
  durationInFrames: number,
  fps: number,
): number {
  const total = totalSeconds(durationInFrames, fps);
  const atEnd = ended || frame >= durationInFrames - 1;
  return atEnd ? total : Math.min(total, Math.floor(frame / fps));
}

export function rulerLayout(durations: readonly number[], planned: number): RulerLayout {
  const known = durations.reduce((sum, duration) => sum + duration, 0);
  const pendingCount = Math.max(0, planned - durations.length);
  const pendingWeight = durations.length > 0 ? known / durations.length : 1;
  return {
    pendingCount,
    pendingWeight,
    known,
    total: known + pendingCount * pendingWeight,
  };
}

export function fractionOfFrame(frame: number, layout: RulerLayout): number {
  if (layout.total <= 0) return 0;
  return Math.min(1, Math.max(0, frame / layout.total));
}

export function frameAtFraction(
  fraction: number,
  layout: RulerLayout,
  clampToKnown: boolean,
): number | null {
  if (layout.known <= 0) return null;
  const position = Math.min(1, Math.max(0, fraction)) * layout.total;
  if (position > layout.known && !clampToKnown) return null;
  return Math.min(Math.round(position), layout.known - 1);
}

export function minorTickFrames(
  sceneStarts: readonly number[],
  known: number,
  fps: number,
): number[] {
  const step = TICK_SECONDS * fps;
  const ticks: number[] = [];
  for (let frame = step; frame < known; frame += step) {
    if (sceneStarts.every((start) => Math.abs(start - frame) >= fps)) ticks.push(frame);
  }
  return ticks;
}

export function sceneIndexAt(scenes: readonly { start: number }[], frame: number): number {
  let found = -1;
  for (const [index, scene] of scenes.entries()) {
    if (scene.start <= frame) found = index;
  }
  return found;
}

export function previousSceneIndex(
  scenes: readonly { start: number }[],
  frame: number,
  fps: number,
): number | null {
  const current = sceneIndexAt(scenes, frame);
  const scene = scenes[current];
  if (!scene) return null;
  const restart = frame - scene.start > RESTART_AFTER_SECONDS * fps;
  return restart ? current : Math.max(0, current - 1);
}

export function nextSceneIndex(scenes: readonly { start: number }[], frame: number): number | null {
  const current = sceneIndexAt(scenes, frame);
  return current >= 0 && current < scenes.length - 1 ? current + 1 : null;
}
