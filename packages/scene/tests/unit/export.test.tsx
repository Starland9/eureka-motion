// @vitest-environment jsdom
import { Thumbnail } from "@remotion/player";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EXPORT_COMPOSITION_ID,
  EXPORT_DEFAULT_PROPS,
  EXPORT_FPS,
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  ExportComposition,
  exportDurationInFrames,
  type ExportDocument,
  type ExportInputProps,
} from "../../src/composition/Export";
import { buildTimeline } from "../../src/composition/timeline";
import { RemotionRoot, calculateExportMetadata } from "../../src/remotion/Root";
import {
  beatDurationMs,
  DocumentSchema,
  typesetTexts,
  type ExplanationDocument,
  type Scene,
} from "../../src/schema";
import { createFrame } from "../../src/layouts";
import { getTheme, msToFrames, sceneMetrics } from "../../src/tokens";

vi.mock("@remotion/media", async () => {
  const { createElement } = await import("react");
  const { useCurrentFrame } = await import("remotion");
  return {
    Audio: ({ src }: { src: string }) =>
      createElement("audio", { src, "data-frame": useCurrentFrame() }),
  };
});

const REFERENCE = path.resolve(
  import.meta.dirname,
  "../../../../content/reference/physics.universal-gravitation.fr.json",
);
const gravity: ExplanationDocument = typesetTexts(
  DocumentSchema.parse(JSON.parse(readFileSync(REFERENCE, "utf8")).payload),
  "fr",
);

const NBSP = " ";
const paper = getTheme("paper");
const board = getTheme("board");
const geometry = createFrame(EXPORT_WIDTH, EXPORT_HEIGHT);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function inputs(document: ExportDocument, extra: Partial<ExportInputProps> = {}): ExportInputProps {
  return { document, language: "fr", ...extra };
}

function markupAt(props: ExportInputProps, frame: number): string {
  return renderToStaticMarkup(
    <Thumbnail
      component={ExportComposition}
      inputProps={props}
      compositionWidth={EXPORT_WIDTH}
      compositionHeight={EXPORT_HEIGHT}
      durationInFrames={exportDurationInFrames(props.document)}
      fps={EXPORT_FPS}
      frameToDisplay={frame}
      noSuspense
    />,
  );
}

function frameAt(props: ExportInputProps, frame: number): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markupAt(props, frame);
  return host;
}

function part(host: HTMLElement, name: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-export="${name}"]`);
}

const timeline = buildTimeline(gravity.scenes, EXPORT_FPS);
const sceneTiming = (id: string) => timeline.scenes.find((scene) => scene.id === id)!;

function middleOfBeat(sceneId: string, beatIndex: number): number {
  const scene = sceneTiming(sceneId);
  const beat = scene.beats[beatIndex]!;
  return scene.start + beat.start + Math.floor(beat.duration / 2);
}

function withAudio(url: string, durationMs: number): ExplanationDocument {
  const document = clone(gravity);
  const first = document.scenes[0] as Scene;
  (first.beats[1] as Scene["beats"][number]).audio = { url, duration_ms: durationMs };
  return document;
}

describe("export duration", () => {
  it("is the sum of the beat durations of all scenes at 30 frames per second", () => {
    const expected = gravity.scenes.reduce(
      (sceneTotal, scene) =>
        sceneTotal +
        scene.beats.reduce((total, beat) => total + msToFrames(beatDurationMs(beat), 30), 0),
      0,
    );
    expect(EXPORT_FPS).toBe(30);
    expect(exportDurationInFrames(gravity)).toBe(expected);
    expect(exportDurationInFrames(gravity)).toBe(timeline.duration);
    expect(timeline.scenes.reduce((total, scene) => total + scene.duration, 0)).toBe(expected);
  });

  it("follows the declared duration of a beat, else the estimate, else the audio", () => {
    const base = exportDurationInFrames(gravity);
    const first = gravity.scenes[0]!.beats[0]!;
    const before = msToFrames(beatDurationMs(first), 30);

    const declared = clone(gravity);
    declared.scenes[0]!.beats[0]!.duration_ms = 5000;
    expect(exportDurationInFrames(declared)).toBe(base - before + 150);

    const spoken = withAudio("/media/e1/s1-b2.mp3", 2000);
    const second = gravity.scenes[0]!.beats[1]!;
    const audioFrames = msToFrames(2000 + 250, 30);
    expect(exportDurationInFrames(spoken)).toBe(
      base - msToFrames(beatDurationMs(second), 30) + audioFrames,
    );
  });

  it("never drops under one frame", () => {
    expect(exportDurationInFrames({ scenes: [] })).toBe(1);
  });
});

describe("remotion root", () => {
  it("declares one 1920 x 1080 composition at 30 frames per second", () => {
    const composition = RemotionRoot();
    expect(composition.props).toMatchObject({
      id: EXPORT_COMPOSITION_ID,
      width: 1920,
      height: 1080,
      fps: 30,
      component: ExportComposition,
      defaultProps: EXPORT_DEFAULT_PROPS,
    });
    expect(composition.props.calculateMetadata).toBe(calculateExportMetadata);
  });

  it("fixes the duration from the document passed as input props", async () => {
    const options = {
      defaultProps: EXPORT_DEFAULT_PROPS,
      abortSignal: new AbortController().signal,
      compositionId: EXPORT_COMPOSITION_ID,
      isRendering: true,
    };
    expect(await calculateExportMetadata({ ...options, props: inputs(gravity) })).toEqual({
      durationInFrames: timeline.duration,
    });
    expect(await calculateExportMetadata({ ...options, props: EXPORT_DEFAULT_PROPS })).toEqual({
      durationInFrames: 1,
    });
  });
});

describe("export frames", () => {
  const first = sceneTiming("s1");
  const keyFrames: [string, number][] = [
    ["the first frame", 0],
    ["the middle of the first scene", first.start + Math.floor(first.duration / 2)],
    ["the last frame", timeline.duration - 1],
  ];

  it.each(keyFrames)("renders %s with its subtitle in the bottom band", (_name, frame) => {
    const host = frameAt(inputs(gravity), frame);
    const subtitle = part(host, "subtitles");
    expect(subtitle).not.toBeNull();
    const location = timeline.scenes.find(
      (scene) => frame >= scene.start && frame < scene.start + scene.duration,
    )!;
    const beat = location.beats.find(
      (candidate) =>
        frame - location.start >= candidate.start &&
        frame - location.start < candidate.start + candidate.duration,
    )!;
    expect(subtitle!.textContent).toBe(beat.narration);
    expect(subtitle!.style.top).toBe(`${geometry.band.y}px`);
    expect(subtitle!.style.height).toBe(`${geometry.band.height}px`);
    expect(subtitle!.style.left).toBe(`${geometry.band.x}px`);
    expect(subtitle!.style.width).toBe(`${geometry.band.width}px`);
    expect(geometry.band.y + geometry.band.height).toBe(EXPORT_HEIGHT);
  });

  it("shows the narration of every beat of the document in turn", () => {
    for (const scene of gravity.scenes) {
      scene.beats.forEach((beat, index) => {
        const host = frameAt(inputs(gravity), middleOfBeat(scene.id, index));
        expect(part(host, "subtitles")!.textContent).toBe(beat.narration);
      });
    }
  });

  it("sets a long narration smaller instead of letting it overflow the band", () => {
    const long = clone(gravity);
    const narration = "Une phrase très longue, ".repeat(8).slice(0, 200);
    long.scenes[0]!.beats[0]!.narration = narration;
    const size = (document: ExportDocument, frame: number) =>
      Number.parseFloat(part(frameAt(inputs(document), frame), "subtitles")!.style.fontSize);
    const nominal = size(gravity, 10);
    const fitted = size(long, 10);
    expect(nominal).toBeCloseTo(3.2 * geometry.u, 5);
    expect(fitted).toBeLessThan(nominal);
    expect(fitted).toBeGreaterThanOrEqual(2 * geometry.u);
    const lines = Math.ceil((200 * 0.44 * fitted) / geometry.band.width);
    expect(lines).toBeLessThanOrEqual(2);
  });

  it("draws no cursor and no control", () => {
    const host = frameAt(inputs(gravity), middleOfBeat("s3", 1));
    expect(host.querySelector("input, button, select, textarea, [role=slider]")).toBeNull();
  });
});

describe("export theme", () => {
  it("is always the Paper theme", () => {
    const hostile = { ...inputs(gravity), theme: "board" } as ExportInputProps;
    for (const props of [inputs(gravity), hostile]) {
      const markup = markupAt(props, middleOfBeat("s3", 1)).toLowerCase();
      expect(markup).toContain(paper.surfaceRaised.toLowerCase());
      expect(markup).toContain(paper.ink.toLowerCase());
      expect(markup).not.toContain(board.surfaceRaised.toLowerCase());
      expect(markup).not.toContain(board.ink.toLowerCase());
    }
  });

  it("sets the subtitles in ink on the page, without shadow, blur, gradient or radius", () => {
    const host = frameAt(inputs(gravity), 10);
    const subtitle = part(host, "subtitles")!;
    expect(subtitle.style.color).toBe("rgb(22, 23, 26)");
    for (const element of Array.from(host.querySelectorAll<HTMLElement>("[style]"))) {
      expect(element.getAttribute("style")).not.toMatch(
        /shadow|blur|gradient|border-radius|backdrop/i,
      );
    }
  });
});

describe("print marks", () => {
  it("draws a crop mark in each corner of the plate", () => {
    const host = frameAt(inputs(gravity), 10);
    const marks = part(host, "marks")!;
    const paths = Array.from(marks.querySelectorAll("path"));
    expect(paths).toHaveLength(4);
    const inset = 1.5 * geometry.u;
    const arm = 3 * geometry.u;
    for (const path of paths) {
      expect(path.getAttribute("stroke")).toBe(paper.ink);
      expect(Number(path.getAttribute("stroke-width"))).toBeCloseTo(
        sceneMetrics.stroke.regular * geometry.u,
        5,
      );
      const numbers = (path.getAttribute("d") ?? "").match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (let index = 0; index < numbers.length; index += 2) {
        expect(numbers[index]!).toBeGreaterThanOrEqual(inset);
        expect(numbers[index]!).toBeLessThanOrEqual(EXPORT_WIDTH - inset);
        expect(numbers[index + 1]!).toBeGreaterThanOrEqual(inset);
        expect(numbers[index + 1]!).toBeLessThanOrEqual(EXPORT_HEIGHT - inset);
      }
    }
    expect(inset + arm).toBeLessThan(sceneMetrics.safeMargin * geometry.u);
  });

  it("captions the figure with its number and the scene title", () => {
    for (const scene of gravity.scenes) {
      const host = frameAt(inputs(gravity), middleOfBeat(scene.id, 0));
      const legend = part(host, "legend")!;
      const number = String(scene.index + 1).padStart(2, "0");
      expect(legend.textContent).toBe(`Fig.${NBSP}${number}${NBSP}— ${scene.title}`);
      expect(legend.style.textTransform).toBe("uppercase");
    }
  });

  it("numbers a partial explanation like the player does", () => {
    const partial = clone(gravity);
    partial.scenes = [gravity.scenes[0]!, gravity.scenes[2]!];
    const at = buildTimeline(partial.scenes, EXPORT_FPS).scenes[1]!;
    const host = frameAt(inputs(partial), at.start + 5);
    expect(part(host, "legend")!.textContent).toBe(
      `Fig.${NBSP}03${NBSP}— ${gravity.scenes[2]!.title}`,
    );
  });

  it("keeps the legend on one line, even for the longest title", () => {
    const longTitle = clone(gravity);
    longTitle.scenes[0]!.title = "T".repeat(60);
    const legend = part(frameAt(inputs(longTitle), 10), "legend")!;
    const size = Number.parseFloat(legend.style.fontSize);
    const width = (legend.textContent ?? "").length * size * (0.6 + 0.06);
    expect(width).toBeLessThanOrEqual(EXPORT_WIDTH - 2 * sceneMetrics.safeMargin * geometry.u + 1);
  });
});

describe("parameters", () => {
  const sweeping = middleOfBeat("s3", 2);
  const readout = (host: HTMLElement) => (host.textContent ?? "").replace(/\s+/g, "");

  it("starts from the defaults of the document and runs its sweeps", () => {
    const start = sceneTiming("s3");
    expect(readout(frameAt(inputs(gravity), start.start + 20))).toContain("384");
    const midway = readout(frameAt(inputs(gravity), sweeping));
    expect(midway).toContain("768");
    expect(midway).not.toContain("384000km");
  });

  it("takes the values passed in, and nothing else, as an override", () => {
    const frame = sceneTiming("s3").start + 20;
    const plain = markupAt(inputs(gravity), frame);
    expect(markupAt(inputs(gravity, { values: {} }), frame)).toBe(plain);
    const moved = readout(frameAt(inputs(gravity, { values: { r: 2.5e8 } }), frame));
    expect(moved).toContain("250");
    expect(moved).not.toContain("384");
  });
});

describe("narration audio", () => {
  const audioUrl = "/media/e1/s1-b2.mp3";

  it("is silent when no beat has audio", () => {
    for (const scene of gravity.scenes) {
      scene.beats.forEach((_beat, index) => {
        const host = frameAt(inputs(gravity), middleOfBeat(scene.id, index));
        expect(host.querySelector("audio")).toBeNull();
      });
    }
  });

  it("plays the audio of a beat from its first frame, and only during that beat", () => {
    const spoken = withAudio(audioUrl, 2000);
    const props = inputs(spoken);
    const at = buildTimeline(spoken.scenes, EXPORT_FPS).scenes[0]!;
    const beat = at.beats[1]!;
    expect(beat.duration).toBe(msToFrames(2250, 30));

    const during = frameAt(props, at.start + beat.start + 12).querySelector("audio");
    expect(during).not.toBeNull();
    expect(during!.getAttribute("src")).toBe(audioUrl);
    expect(during!.getAttribute("data-frame")).toBe("12");

    expect(frameAt(props, at.start + at.beats[0]!.start + 12).querySelector("audio")).toBeNull();
    expect(frameAt(props, at.start + at.beats[2]!.start + 12).querySelector("audio")).toBeNull();
    const last = frameAt(props, at.start + beat.start + beat.duration - 1).querySelector("audio");
    expect(last!.getAttribute("data-frame")).toBe(String(beat.duration - 1));
  });

  it("forms the URL with the base given, and leaves an absolute URL alone", () => {
    const frame = (document: ExportDocument) =>
      sceneTiming("s1").start + timelineOf(document).scenes[0]!.beats[1]!.start + 12;
    const timelineOf = (document: ExportDocument) => buildTimeline(document.scenes, EXPORT_FPS);
    const srcOf = (document: ExportDocument, base?: string) =>
      frameAt(inputs(document, { assetBaseUrl: base }), frame(document))
        .querySelector("audio")!
        .getAttribute("src");

    const relative = withAudio(audioUrl, 2000);
    expect(srcOf(relative, "http://web:3000")).toBe(`http://web:3000${audioUrl}`);
    expect(srcOf(relative, "http://web:3000/")).toBe(`http://web:3000${audioUrl}`);
    expect(srcOf(relative)).toBe(audioUrl);

    const absolute = withAudio("https://cdn.example/s1-b2.mp3", 2000);
    expect(srcOf(absolute, "http://web:3000")).toBe("https://cdn.example/s1-b2.mp3");
  });
});
