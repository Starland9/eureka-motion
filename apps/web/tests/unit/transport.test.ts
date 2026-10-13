import { describe, expect, it } from "vitest";
import {
  handledByTarget,
  isRepeatable,
  shortcutFor,
  type Shortcut,
} from "@/components/player/transport-keys";
import {
  clockSeconds,
  formatClock,
  fractionOfFrame,
  frameAtFraction,
  minorTickFrames,
  nextSceneIndex,
  previousSceneIndex,
  rulerLayout,
  sceneIndexAt,
  totalSeconds,
} from "@/components/player/transport-time";

const FPS = 30;
const SCENES = [{ start: 0 }, { start: 300 }, { start: 900 }];

function keyEvent(
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey", true>> = {},
) {
  return { key, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
}

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [9.9, "0:09"],
    [34, "0:34"],
    [91, "1:31"],
    [600, "10:00"],
    [3725, "1:02:05"],
    [-4, "0:00"],
  ])("formats %s s as %s", (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });
});

describe("clockSeconds", () => {
  it("floors the elapsed time and caps it at the rounded total", () => {
    expect(totalSeconds(2742, FPS)).toBe(91);
    expect(clockSeconds(1050, false, 2742, FPS)).toBe(35);
  });

  it("reads the total at the last frame and once ended", () => {
    expect(clockSeconds(2741, false, 2742, FPS)).toBe(91);
    expect(clockSeconds(10, true, 2742, FPS)).toBe(91);
  });
});

describe("rulerLayout", () => {
  it("is the sum of the scenes when nothing is planned", () => {
    const layout = rulerLayout([300, 600, 300], 0);
    expect(layout).toMatchObject({ known: 1200, total: 1200, pendingCount: 0 });
  });

  it("gives each scene in preparation the mean duration of the scenes received", () => {
    const layout = rulerLayout([300, 500], 6);
    expect(layout.pendingCount).toBe(4);
    expect(layout.pendingWeight).toBe(400);
    expect(layout.known).toBe(800);
    expect(layout.total).toBe(2400);
  });

  it("keeps the ruler the same length when a scene as long as the mean arrives", () => {
    const before = rulerLayout([300, 500], 6);
    const after = rulerLayout([300, 500, 400], 6);
    expect(after.total).toBe(before.total);
    expect(after.pendingCount).toBe(3);
  });

  it("shares the width equally when no scene is known yet", () => {
    const layout = rulerLayout([], 6);
    expect(layout).toMatchObject({ known: 0, pendingCount: 6, pendingWeight: 1, total: 6 });
  });

  it("adds no section when more scenes arrive than planned", () => {
    expect(rulerLayout([100, 100, 100], 2).pendingCount).toBe(0);
  });
});

describe("ruler positions", () => {
  const layout = rulerLayout([300, 500], 6);

  it("maps a frame to a fraction of the whole ruler", () => {
    expect(fractionOfFrame(400, layout)).toBeCloseTo(400 / 2400);
    expect(fractionOfFrame(0, rulerLayout([], 0))).toBe(0);
  });

  it("maps a fraction to a frame inside the known part", () => {
    expect(frameAtFraction(0, layout, false)).toBe(0);
    expect(frameAtFraction(0.2, layout, false)).toBe(480);
  });

  it("ignores a press on a section in preparation but clamps a drag to the end", () => {
    expect(frameAtFraction(0.6, layout, false)).toBeNull();
    expect(frameAtFraction(0.6, layout, true)).toBe(799);
    expect(frameAtFraction(5, layout, true)).toBe(799);
  });

  it("has nothing to seek to without a scene", () => {
    expect(frameAtFraction(0.5, rulerLayout([], 6), true)).toBeNull();
  });
});

describe("minorTickFrames", () => {
  it("places a tick every 10 s inside the known part", () => {
    expect(minorTickFrames([0], 1000, FPS)).toEqual([300, 600, 900]);
  });

  it("skips a tick that falls within a second of a scene boundary", () => {
    expect(minorTickFrames([0, 310], 1000, FPS)).toEqual([600, 900]);
  });
});

describe("scene stepping", () => {
  it("finds the scene a frame belongs to", () => {
    expect(sceneIndexAt(SCENES, 0)).toBe(0);
    expect(sceneIndexAt(SCENES, 299)).toBe(0);
    expect(sceneIndexAt(SCENES, 300)).toBe(1);
    expect(sceneIndexAt(SCENES, 5000)).toBe(2);
    expect(sceneIndexAt([], 10)).toBe(-1);
  });

  it("restarts the scene when more than two seconds in, otherwise goes back one", () => {
    expect(previousSceneIndex(SCENES, 400, FPS)).toBe(1);
    expect(previousSceneIndex(SCENES, 330, FPS)).toBe(0);
    expect(previousSceneIndex(SCENES, 10, FPS)).toBe(0);
    expect(previousSceneIndex([], 10, FPS)).toBeNull();
  });

  it("has no next scene after the last one", () => {
    expect(nextSceneIndex(SCENES, 0)).toBe(1);
    expect(nextSceneIndex(SCENES, 950)).toBeNull();
    expect(nextSceneIndex([], 0)).toBeNull();
  });
});

describe("shortcutFor", () => {
  it.each<[string, Shortcut]>([
    [" ", "toggle"],
    ["ArrowLeft", "back"],
    ["ArrowRight", "forward"],
    ["m", "mute"],
    ["M", "mute"],
    ["c", "captions"],
    ["F", "fullscreen"],
  ])("maps %j to %s", (key, expected) => {
    expect(shortcutFor(keyEvent(key))).toBe(expected);
  });

  it("ignores other keys and any Ctrl, Meta or Alt combination", () => {
    expect(shortcutFor(keyEvent("a"))).toBeNull();
    expect(shortcutFor(keyEvent("ArrowUp"))).toBeNull();
    expect(shortcutFor(keyEvent("m", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(keyEvent(" ", { metaKey: true }))).toBeNull();
    expect(shortcutFor(keyEvent("ArrowLeft", { altKey: true }))).toBeNull();
  });

  it("repeats only the seek shortcuts", () => {
    expect(isRepeatable("back")).toBe(true);
    expect(isRepeatable("forward")).toBe(true);
    expect(isRepeatable("toggle")).toBe(false);
    expect(isRepeatable("mute")).toBe(false);
  });
});

describe("handledByTarget", () => {
  it("leaves every key to text fields and modal dialogs", () => {
    for (const shortcut of ["toggle", "back", "mute", "fullscreen"] as const) {
      expect(handledByTarget("text", shortcut)).toBe(true);
      expect(handledByTarget("modal", shortcut)).toBe(true);
    }
  });

  it("leaves the arrows to a slider and Space to a button", () => {
    expect(handledByTarget("slider", "back")).toBe(true);
    expect(handledByTarget("slider", "toggle")).toBe(false);
    expect(handledByTarget("pressable", "toggle")).toBe(true);
    expect(handledByTarget("pressable", "mute")).toBe(false);
    expect(handledByTarget("other", "toggle")).toBe(false);
  });
});
