import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ExplanationDocument } from "scene";
import { exportDurationInFrames } from "scene/export";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareDocument } from "../src/document";
import { bundleComposition, createRenderer, type ExportRenderer } from "../src/render";
import { REFERENCE_DIR, findBrowser, scratchDir } from "./helpers/support";

const run = promisify(execFile);
const FPS = 30;
const TEN_MINUTES = 10 * 60_000;
const SC_008_MS = 3 * 60_000;

interface Stream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

async function probe(file: string) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    file,
  ]);
  const data = JSON.parse(stdout) as { streams: Stream[]; format: { duration: string } };
  return {
    video: data.streams.filter((stream) => stream.codec_type === "video"),
    audio: data.streams.filter((stream) => stream.codec_type === "audio"),
    duration: Number(data.format.duration),
  };
}

async function meanVolume(file: string): Promise<number> {
  const { stderr } = await run("ffmpeg", [
    "-i",
    file,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const match = /mean_volume: (-?[\d.]+|-inf) dB/.exec(stderr);
  if (!match) throw new Error("ffmpeg did not report a mean volume");
  return Number(match[1]);
}

describe("export render", () => {
  let serveUrl: string;
  let render: ExportRenderer;
  let workDir: string;
  let mediaDir: string;
  let gravity: ExplanationDocument;

  beforeAll(async () => {
    workDir = await scratchDir("render");
    mediaDir = path.join(workDir, "media");
    await mkdir(mediaDir, { recursive: true });
    const file = JSON.parse(
      await readFile(path.join(REFERENCE_DIR, "physics.universal-gravitation.fr.json"), "utf8"),
    );
    gravity = prepareDocument(file.payload, file.language);
    serveUrl = await bundleComposition();
    render = createRenderer({
      serveUrl,
      mediaDir,
      referenceDir: REFERENCE_DIR,
      browserExecutable: await findBrowser(),
    });
  }, 120_000);

  afterAll(async () => {
    await rm(serveUrl, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  it(
    "renders the gravity document as a 1080p, 30 fps H.264 and AAC file of the length of the document",
    async () => {
      const outFile = path.join(workDir, "gravity", "export.mp4");
      const percents: number[] = [];
      const began = Date.now();

      await render({
        document: gravity,
        language: "fr",
        outFile,
        onProgress: (percent) => percents.push(percent),
      });

      const elapsed = Date.now() - began;
      const expected = exportDurationInFrames(gravity) / FPS;
      const seconds = (elapsed / 1000).toFixed(1);
      console.info(
        `Gravity export: ${expected.toFixed(1)} s of video rendered in ${seconds} s (SC-008 target: ${SC_008_MS / 1000} s), ${outFile}`,
      );

      const { video, audio, duration } = await probe(outFile);
      expect(video).toHaveLength(1);
      expect(video[0]).toMatchObject({
        codec_name: "h264",
        width: 1920,
        height: 1080,
        r_frame_rate: "30/1",
      });
      expect(audio).toHaveLength(1);
      expect(audio[0]!.codec_name).toBe("aac");
      expect(Math.abs(duration - expected)).toBeLessThanOrEqual(0.5);

      expect(percents.length).toBeGreaterThan(10);
      expect(percents.at(-1)).toBeCloseTo(100, 0);
      expect(await readdir(path.dirname(outFile))).toEqual(["export.mp4"]);
    },
    TEN_MINUTES,
  );

  it(
    "mixes the narration served from the media folder into the audio track",
    async () => {
      const id = "aaaaaaaaaaab";
      const tone = path.join(mediaDir, id, "tone.mp3");
      await mkdir(path.dirname(tone), { recursive: true });
      await run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:a",
        "libmp3lame",
        tone,
      ]);
      const [scene] = gravity.scenes;
      const narrated: ExplanationDocument = {
        ...gravity,
        scenes: [
          {
            ...scene!,
            beats: scene!.beats.map((beat) => ({
              ...beat,
              audio: { url: `/media/${id}/tone.mp3`, duration_ms: 2000 },
            })),
          },
        ],
      };
      const outFile = path.join(workDir, "narrated", "export.mp4");

      await render({ document: narrated, language: "fr", outFile });

      const { audio, duration } = await probe(outFile);
      expect(audio).toHaveLength(1);
      expect(await meanVolume(outFile)).toBeGreaterThan(-45);
      expect(Math.abs(duration - exportDurationInFrames(narrated) / FPS)).toBeLessThanOrEqual(0.5);
    },
    TEN_MINUTES,
  );

  it(
    "keeps a silent audio track when the document has no narration, and no partial file when it fails",
    async () => {
      const outFile = path.join(workDir, "silent", "export.mp4");
      const [scene] = gravity.scenes;
      const short: ExplanationDocument = {
        ...gravity,
        scenes: [{ ...scene!, beats: scene!.beats.slice(0, 1) }],
      };

      await render({ document: short, language: "fr", outFile });
      expect((await probe(outFile)).audio).toHaveLength(1);
      expect((await stat(outFile)).size).toBeGreaterThan(0);

      const cancelled = new AbortController();
      const failed = path.join(workDir, "failed", "export.mp4");
      await expect(
        render({
          document: short,
          language: "fr",
          outFile: failed,
          signal: cancelled.signal,
          onProgress: (percent) => {
            if (percent > 5) cancelled.abort();
          },
        }),
      ).rejects.toThrow();
      expect(await readdir(path.dirname(failed))).toEqual([]);
    },
    TEN_MINUTES,
  );
});
