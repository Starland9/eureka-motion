import { describe, expect, it } from "vitest";
import {
  beatEndFrames,
  nextStepFrame,
  previousSceneTarget,
  previousStepFrame,
  sceneLandingFrame,
  type StepScene,
} from "@/components/player/step-targets";

const FPS = 30;
const SCENES: StepScene[] = [
  {
    start: 0,
    beats: [
      { start: 0, duration: 134 },
      { start: 134, duration: 146 },
      { start: 280, duration: 20 },
    ],
  },
  {
    start: 300,
    beats: [
      { start: 0, duration: 45 },
      { start: 45, duration: 45 },
    ],
  },
  { start: 390, beats: [{ start: 0, duration: 60 }] },
];
const ENDS = [133, 279, 299, 344, 389, 449];

describe("beatEndFrames", () => {
  it("lists the last frame of every beat in order, across scenes", () => {
    expect(beatEndFrames(SCENES)).toEqual(ENDS);
  });

  it("gives the last frame of the whole timeline last", () => {
    expect(ENDS.at(-1)).toBe(450 - 1);
  });

  it("is empty without a scene", () => {
    expect(beatEndFrames([])).toEqual([]);
  });
});

describe("nextStepFrame", () => {
  it("goes to the end of the first beat from the very start", () => {
    expect(nextStepFrame(ENDS, 0)).toBe(133);
  });

  it("goes to the end of the following beat from the end of a beat", () => {
    expect(nextStepFrame(ENDS, 133)).toBe(279);
    expect(nextStepFrame(ENDS, 299)).toBe(344);
  });

  it("ends the beat in progress from the middle of it", () => {
    expect(nextStepFrame(ENDS, 134)).toBe(279);
    expect(nextStepFrame(ENDS, 278)).toBe(279);
    expect(nextStepFrame(ENDS, 300)).toBe(344);
  });

  it("has nothing after the last frame", () => {
    expect(nextStepFrame(ENDS, 449)).toBeNull();
    expect(nextStepFrame([], 0)).toBeNull();
  });
});

describe("previousStepFrame", () => {
  it("goes to the end of the previous beat, across scenes", () => {
    expect(previousStepFrame(ENDS, 279)).toBe(133);
    expect(previousStepFrame(ENDS, 344)).toBe(299);
    expect(previousStepFrame(ENDS, 449)).toBe(389);
  });

  it("goes to the end of the previous beat from the middle of a beat", () => {
    expect(previousStepFrame(ENDS, 200)).toBe(133);
    expect(previousStepFrame(ENDS, 300)).toBe(299);
  });

  it("goes to frame 0 from the first beat", () => {
    expect(previousStepFrame(ENDS, 133)).toBe(0);
    expect(previousStepFrame(ENDS, 50)).toBe(0);
  });

  it("has nothing before frame 0", () => {
    expect(previousStepFrame(ENDS, 0)).toBeNull();
  });

  it("walks back over exactly what the walk forward went over", () => {
    const forward = [0];
    for (let next = nextStepFrame(ENDS, 0); next !== null; next = nextStepFrame(ENDS, next)) {
      forward.push(next);
    }
    const backward = [forward.at(-1)!];
    for (let prev = previousStepFrame(ENDS, backward[0]!); prev !== null;) {
      backward.push(prev);
      prev = previousStepFrame(ENDS, prev);
    }
    expect(forward).toEqual([0, ...ENDS]);
    expect(backward).toEqual([...ENDS].reverse().concat(0));
  });
});

describe("sceneLandingFrame", () => {
  it("is the first frame of the scene without the preference", () => {
    expect(sceneLandingFrame(SCENES[1]!, false)).toBe(300);
  });

  it("is the last frame of the first beat under reduced motion", () => {
    expect(sceneLandingFrame(SCENES[0]!, true)).toBe(133);
    expect(sceneLandingFrame(SCENES[1]!, true)).toBe(344);
    expect(sceneLandingFrame(SCENES[2]!, true)).toBe(449);
  });

  it("falls back to the first frame for a scene without a beat", () => {
    expect(sceneLandingFrame({ start: 12, beats: [] }, true)).toBe(12);
  });
});

describe("previousSceneTarget", () => {
  it("keeps the restart rule of the ruler without the preference", () => {
    expect(previousSceneTarget(SCENES, 380, FPS, false)).toBe(1);
    expect(previousSceneTarget(SCENES, 301, FPS, false)).toBe(0);
  });

  it("goes back one scene from the landing frame of a scene", () => {
    expect(previousSceneTarget(SCENES, 344, FPS, true)).toBe(0);
    expect(previousSceneTarget(SCENES, 133, FPS, true)).toBe(0);
  });

  it("restarts the scene once past its landing frame", () => {
    expect(previousSceneTarget(SCENES, 345, FPS, true)).toBe(1);
    expect(previousSceneTarget(SCENES, 280, FPS, true)).toBe(0);
  });

  it("goes back from before the landing frame, such as the first frame", () => {
    expect(previousSceneTarget(SCENES, 300, FPS, true)).toBe(0);
    expect(previousSceneTarget(SCENES, 0, FPS, true)).toBe(0);
  });

  it("has no target without a scene", () => {
    expect(previousSceneTarget([], 0, FPS, true)).toBeNull();
  });
});
