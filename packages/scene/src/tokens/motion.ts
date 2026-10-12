export const FPS = 30;

export const durationsMs = {
  instant: 80,
  fast: 160,
  base: 240,
  slow: 400,
  draw: 600,
  settle: 900,
  stagger: 60,
} as const;

export type DurationName = keyof typeof durationsMs;

export type Bezier = readonly [number, number, number, number];

export const easings = {
  arrive: [0.2, 0, 0, 1],
  leave: [0.4, 0, 1, 1],
  trace: [0.65, 0, 0.35, 1],
  steady: [0, 0, 1, 1],
} as const satisfies Record<string, Bezier>;

export type EasingName = keyof typeof easings;

export const LEAVE_DURATION_RATIO = 0.65;

export const REDUCED_MOTION_FADE_MS = 120;

export const LABEL_RISE_PX = 4;

export const SCENE_SLIDE_PX = 16;

export const MAX_CONCURRENT_ANIMATIONS = 2;

export function msToFrames(ms: number, fps: number = FPS): number {
  return Math.max(1, Math.round((ms / 1000) * fps));
}

export function framesToMs(frames: number, fps: number = FPS): number {
  return (frames / fps) * 1000;
}

export function durationFrames(name: DurationName, fps: number = FPS): number {
  return msToFrames(durationsMs[name], fps);
}

export function cssBezier(name: EasingName): string {
  const [x1, y1, x2, y2] = easings[name];
  return name === "steady" ? "linear" : `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

function bezierAxis(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

function bezierSlope(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * p1 + 6 * inv * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

export function ease(name: EasingName, progress: number): number {
  const x = Math.min(1, Math.max(0, progress));
  if (name === "steady" || x === 0 || x === 1) return x;
  const [x1, y1, x2, y2] = easings[name];
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const error = bezierAxis(t, x1, x2) - x;
    const slope = bezierSlope(t, x1, x2);
    if (Math.abs(error) < 1e-6 || slope === 0) break;
    t = Math.min(1, Math.max(0, t - error / slope));
  }
  return bezierAxis(t, y1, y2);
}

export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}
