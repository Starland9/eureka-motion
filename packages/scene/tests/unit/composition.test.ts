import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTimeline, locate, sceneStartFrame } from "../../src/composition/timeline";
import { computeSceneState, DIM_OPACITY, scheduleActions } from "../../src/composition/state";
import { buildScope } from "../../src/expr";
import { DocumentSchema, type ExplanationDocument, type Scene } from "../../src/schema";
import { ease, FPS } from "../../src/tokens";

const REFERENCE = fileURLToPath(
  new URL("../../../../content/reference/physics.universal-gravitation.fr.json", import.meta.url),
);
const document: ExplanationDocument = DocumentSchema.parse(
  JSON.parse(readFileSync(REFERENCE, "utf8")).payload,
);
const model = {
  params: document.params,
  constants: document.model.constants,
  derived: document.model.derived,
};
const baseScope = buildScope(model);
const sceneById = (id: string): Scene => document.scenes.find((scene) => scene.id === id) as Scene;

const timeline = buildTimeline(document.scenes);
const timingOf = (id: string) => timeline.scenes.find((scene) => scene.id === id)!;

function stateOf(
  scene: Scene,
  frame: number,
  extra: Partial<Parameters<typeof computeSceneState>[0]> = {},
) {
  return computeSceneState({
    scene,
    timing: buildTimeline([scene]).scenes[0]!,
    frame,
    baseScope,
    params: {},
    ...extra,
  });
}

function sceneWith(
  beats: Scene["beats"],
  elements: Scene["elements"] = sceneById("s1").elements,
): Scene {
  return { ...sceneById("s1"), elements, beats };
}

const beat = (
  id: string,
  actions: Scene["beats"][number]["actions"],
  durationMs = 4000,
): Scene["beats"][number] => ({
  id,
  narration: "Phrase.",
  actions,
  duration_ms: durationMs,
});

describe("timeline", () => {
  it("lays scenes and beats end to end", () => {
    expect(timeline.fps).toBe(FPS);
    expect(timeline.scenes).toHaveLength(6);
    let cursor = 0;
    for (const scene of timeline.scenes) {
      expect(scene.start).toBe(cursor);
      let inScene = 0;
      for (const b of scene.beats) {
        expect(b.start).toBe(inScene);
        inScene += b.duration;
      }
      expect(scene.duration).toBe(inScene);
      cursor += scene.duration;
    }
    expect(timeline.duration).toBe(cursor);
  });

  it("uses the audio length plus a breath when a beat has audio", () => {
    const scene = sceneWith([
      {
        id: "b1",
        narration: "Phrase.",
        actions: [],
        audio: { url: "/media/x.mp3", duration_ms: 3000 },
      },
    ]);
    const built = buildTimeline([scene]);
    expect(built.scenes[0]!.beats[0]!.duration).toBe(Math.round(3.4 * FPS));
    expect(built.scenes[0]!.beats[0]!.audioUrl).toBe("/media/x.mp3");
  });

  it("locates a frame", () => {
    const third = timingOf("s3");
    const location = locate(timeline, third.start + third.beats[1]!.start + 5)!;
    expect(location.scene.id).toBe("s3");
    expect(location.beat.id).toBe("b2");
    expect(location.frameInBeat).toBe(5);
    expect(locate(timeline, 10 ** 9)!.scene.id).toBe("s6");
    expect(locate(buildTimeline([]), 0)).toBeNull();
    expect(sceneStartFrame(timeline, "s2")).toBe(timingOf("s2").start);
    expect(sceneStartFrame(timeline, "nope")).toBeNull();
  });
});

describe("action scheduling", () => {
  it("spreads actions without `at` over the first part of the beat and honours `at`", () => {
    const scene = sceneWith([
      beat("b1", [
        { do: "show", targets: ["apple"] },
        { do: "show", targets: ["earth"] },
        { do: "show", targets: ["moon"], at: 0.9 },
      ]),
    ]);
    const starts = scheduleActions(scene, buildTimeline([scene]).scenes[0]!).map(
      (item) => item.start,
    );
    expect(starts).toEqual([0, 24, 108]);
  });
});

describe("element state", () => {
  const scene = sceneWith([
    beat("b1", [
      { do: "show", targets: ["apple"], how: "fade", at: 0 },
      { do: "show", targets: ["apple_pull"], how: "draw", at: 0.5 },
    ]),
    beat("b2", [
      { do: "highlight", targets: ["apple_pull"], at: 0 },
      { do: "focus", targets: ["apple_pull"], at: 0.25 },
    ]),
    beat("b3", [
      { do: "hide", targets: ["apple"], at: 0 },
      { do: "move", target: "moon", to: [1, 1], at: 0 },
    ]),
  ]);

  it("keeps an element hidden until it is shown", () => {
    expect(stateOf(scene, 0).of("apple_pull").visible).toBe(false);
    expect(stateOf(scene, 59).of("apple_pull").visible).toBe(false);
    expect(stateOf(scene, 0).of("earth").visible).toBe(false);
  });

  it("fades in with the arrive curve", () => {
    const at = stateOf(scene, 3).of("apple");
    expect(at.how).toBe("fade");
    expect(at.opacity).toBeCloseTo(ease("arrive", 3 / 7), 6);
    expect(stateOf(scene, 7).of("apple").opacity).toBe(1);
  });

  it("draws with full opacity and a growing progress", () => {
    const half = stateOf(scene, 60 + 9).of("apple_pull");
    expect(half.how).toBe("draw");
    expect(half.opacity).toBe(1);
    expect(half.progress).toBeCloseTo(0.5, 6);
    expect(stateOf(scene, 60 + 18).of("apple_pull").progress).toBe(1);
  });

  it("keeps a shown element in the following beats", () => {
    expect(stateOf(scene, 200).of("apple_pull").opacity).toBe(1);
  });

  it("highlights and keeps the highlight", () => {
    expect(stateOf(scene, 119).of("apple_pull").highlight).toBe(0);
    expect(stateOf(scene, 120 + 7).of("apple_pull").highlight).toBe(1);
    expect(stateOf(scene, 300).of("apple_pull").highlight).toBe(1);
  });

  it("dims everything but the focus, until the end of the beat only", () => {
    expect(stateOf(scene, 120 + 29).of("apple").opacity).toBe(1);
    const dimmed = stateOf(scene, 120 + 30 + 5).of("apple");
    expect(dimmed.dim).toBe(1);
    expect(dimmed.opacity).toBeCloseTo(DIM_OPACITY, 6);
    expect(stateOf(scene, 120 + 30 + 5).of("apple_pull").opacity).toBe(1);
    expect(stateOf(scene, 240 + 20).of("apple_pull").dim).toBe(0);
  });

  it("fades out on hide", () => {
    expect(stateOf(scene, 240 + 2).of("apple").opacity).toBeLessThan(1);
    expect(stateOf(scene, 240 + 10).of("apple").visible).toBe(false);
  });

  it("reports a move towards its target", () => {
    expect(stateOf(scene, 239).of("moon").move).toBeNull();
    const shownScene = sceneWith([
      beat("b1", [{ do: "show", targets: ["moon"], at: 0 }]),
      beat("b2", [{ do: "move", target: "moon", to: [1, { expr: "r / r" }], at: 0 }]),
    ]);
    const moving = stateOf(shownScene, 120 + 6).of("moon").move!;
    expect(moving.to).toEqual([1, 1]);
    expect(moving.progress).toBeGreaterThan(0);
    expect(moving.progress).toBeLessThan(1);
    expect(stateOf(shownScene, 120 + 12).of("moon").move!.progress).toBe(1);
  });

  it("replaces every entrance by a short fade under reduced motion", () => {
    const state = stateOf(scene, 60 + 4, { reducedMotion: true }).of("apple_pull");
    expect(state.how).toBe("fade");
    expect(state.opacity).toBe(1);
  });
});

describe("parts of a simulation", () => {
  const s3 = sceneById("s3");

  it("shows only the parts that were named", () => {
    const early = stateOf(s3, 10);
    expect(early.of("sys.body_a").visible).toBe(true);
    expect(early.of("sys.distance").visible).toBe(false);
    expect(early.of("sys").visible).toBe(true);
  });

  it("shows every part when the element itself is shown", () => {
    const s4 = sceneById("s4");
    const state = stateOf(s4, buildTimeline([s4]).scenes[0]!.beats[0]!.duration - 1);
    expect(state.of("sys.force_a").visible).toBe(true);
    expect(state.of("sys.distance").visible).toBe(true);
  });

  it("dims the other parts when one part has the focus", () => {
    const scene = sceneWith(
      [
        beat("b1", [{ do: "show", targets: ["sys", "force_now"], at: 0 }]),
        beat("b2", [{ do: "focus", targets: ["sys.force_a"], at: 0 }]),
      ],
      s3.elements,
    );
    const state = stateOf(scene, 120 + 10);
    expect(state.of("sys.force_a").dim).toBe(0);
    expect(state.of("sys.body_b").dim).toBe(1);
    expect(state.of("sys").dim).toBe(0);
    expect(state.of("force_now").dim).toBe(1);
  });
});

describe("sweeps", () => {
  const s3 = sceneById("s3");
  const timing = buildTimeline([s3]).scenes[0]!;
  const third = timing.beats[2]!;
  const r = baseScope.r as number;

  it("leaves parameters alone outside the sweep", () => {
    expect(stateOf(s3, third.start - 1).paramValues.r).toBeUndefined();
  });

  it("takes the parameter to its target, holds, then comes back", () => {
    const peak = stateOf(s3, third.start + Math.round(third.duration * 0.55));
    expect(peak.paramValues.r).toBeCloseTo(2 * r, 0);
    const scope = buildScope(model, peak.paramValues);
    expect((scope.F as number) / (baseScope.F as number)).toBeCloseTo(0.25, 6);
    const midway = stateOf(s3, third.start + Math.round(third.duration * 0.2)).paramValues
      .r as number;
    expect(midway).toBeGreaterThan(r);
    expect(midway).toBeLessThan(2 * r);
    expect(stateOf(s3, third.start + third.duration - 1).paramValues.r).toBeCloseTo(r, -6);
  });

  it("starts from the value the student chose", () => {
    const chosen = 2e8;
    const peak = stateOf(s3, third.start + Math.round(third.duration * 0.55), {
      params: { r: chosen },
    });
    expect(peak.paramValues.r).toBeCloseTo(2 * r, 0);
    const start = stateOf(s3, third.start, { params: { r: chosen } });
    expect(start.paramValues.r).toBeCloseTo(chosen, 0);
  });

  it("keeps the new value with `hold`", () => {
    const scene = sceneWith(
      [
        beat("b1", [{ do: "show", targets: ["sys"], at: 0 }]),
        beat("b2", [{ do: "sweep", param: "r", to: { expr: "2 * r" }, hold: true, at: 0 }]),
        beat("b3", []),
      ],
      s3.elements,
    );
    expect(stateOf(scene, 120 + 100).paramValues.r).toBeCloseTo(2 * r, 0);
    expect(stateOf(scene, 240 + 60).paramValues.r).toBeCloseTo(2 * r, 0);
  });

  it("can be disabled, and is disabled under reduced motion", () => {
    const frame = third.start + Math.round(third.duration * 0.55);
    expect(stateOf(s3, frame, { disableSweeps: true }).paramValues.r).toBeUndefined();
    expect(stateOf(s3, frame, { reducedMotion: true }).paramValues.r).toBeUndefined();
  });
});

describe("simulated time", () => {
  const scene = sceneWith([
    beat("b1", [{ do: "show", targets: ["apple"], at: 0 }]),
    beat("b2", [{ do: "play", target: "apple", from: 1, to: 3, at: 0.5 }]),
    beat("b3", []),
  ]);

  it("is zero before any play", () => {
    expect(stateOf(scene, 100).simTime("apple")).toBe(0);
  });

  it("advances linearly to the end of the beat and stays there", () => {
    expect(stateOf(scene, 180).simTime("apple")).toBe(1);
    expect(stateOf(scene, 210).simTime("apple")).toBeCloseTo(2, 6);
    expect(stateOf(scene, 300).simTime("apple")).toBe(3);
  });

  it("jumps to the end under reduced motion", () => {
    expect(stateOf(scene, 181, { reducedMotion: true }).simTime("apple")).toBe(3);
  });
});

describe("beat position", () => {
  it("reports the current beat and its progress", () => {
    const s3 = sceneById("s3");
    const timing = buildTimeline([s3]).scenes[0]!;
    const second = timing.beats[1]!;
    const state = stateOf(s3, second.start + Math.round(second.duration / 2));
    expect(state.beatIndex).toBe(1);
    expect(state.beatProgress).toBeCloseTo(0.5, 1);
  });
});
