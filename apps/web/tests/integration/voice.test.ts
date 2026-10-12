import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SceneSchema, type Scene } from "scene";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceService } from "@/server/pipeline/voice";
import {
  createChain,
  createVoiceChain,
  mp3DurationMs,
  TtsError,
  type SynthesizeRequest,
  type SynthesizedAudio,
  type VoiceProvider,
} from "@/server/tts";

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const FRENCH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-fr.mp3"));
const KOKORO_URL = process.env.KOKORO_BASE_URL || "http://127.0.0.1:8880";
const kokoroUp = await fetch(`${KOKORO_URL}/health`, { signal: AbortSignal.timeout(2_000) })
  .then((response) => response.ok)
  .catch(() => false);

function scene(texts: string[], id = "s1"): Scene {
  return {
    id,
    index: 0,
    role: "hook",
    title: "Test",
    layout: "figure_caption",
    elements: [{ id: "e1", kind: "text", text: "x" }],
    beats: texts.map((narration, index) => ({ id: `b${index + 1}`, narration, actions: [] })),
  } as unknown as Scene;
}

interface Scripted extends VoiceProvider {
  calls: string[];
  peak: () => number;
}

function scripted(name: string, fails: (text: string) => boolean = () => false): Scripted {
  const calls: string[] = [];
  let active = 0;
  let peak = 0;
  return {
    name,
    calls,
    peak: () => peak,
    voiceFor: (language) => `${name}-${language}`,
    health: async () => true,
    async synthesize({ text, language }: SynthesizeRequest): Promise<SynthesizedAudio> {
      calls.push(text);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (fails(text)) throw new TtsError("unavailable", name, "down");
      return {
        audio: new Uint8Array(FRENCH),
        durationMs: mp3DurationMs(FRENCH),
        provider: name,
        voice: `${name}-${language}`,
      };
    },
  };
}

describe("narration with a scripted voice", () => {
  let mediaDir: string;
  beforeEach(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), "narrate-"));
  });
  afterEach(() => rm(mediaDir, { recursive: true, force: true }));

  it("writes one file per beat and returns a copy carrying the audio", async () => {
    const voice = scripted("kokoro");
    const service = createVoiceService({ chain: createChain([voice]), mediaDir });
    const input = scene(["Un.", "Deux.", "Trois."]);
    const before = structuredClone(input);

    const output = await service.narrate("exp1", input, "fr");

    expect(input).toEqual(before);
    expect(output).not.toBe(input);
    expect(output.beats[0]).not.toBe(input.beats[0]);
    const duration = mp3DurationMs(FRENCH);
    expect(output.beats.map((beat) => beat.audio)).toEqual(
      ["b1", "b2", "b3"].map((id) => ({ url: `/media/exp1/s1-${id}.mp3`, duration_ms: duration })),
    );
    expect((await readdir(path.join(mediaDir, "exp1"))).sort()).toEqual([
      "s1-b1.mp3",
      "s1-b2.mp3",
      "s1-b3.mp3",
    ]);
    expect(new Uint8Array(await readFile(path.join(mediaDir, "exp1", "s1-b2.mp3")))).toEqual(
      new Uint8Array(FRENCH),
    );
    const stripped = structuredClone(output);
    for (const beat of stripped.beats) delete beat.audio;
    expect(stripped).toEqual(before);
  });

  it("returns the scene without audio when the voice fails, and does not throw", async () => {
    const service = createVoiceService({
      chain: createChain([scripted("azure", () => true), scripted("kokoro", () => true)]),
      mediaDir,
    });
    const output = await service.narrate("exp1", scene(["Un.", "Deux."]), "fr");
    expect(output.beats.every((beat) => beat.audio === undefined)).toBe(true);
    expect(output.beats.map((beat) => beat.narration)).toEqual(["Un.", "Deux."]);
    await expect(readdir(path.join(mediaDir, "exp1"))).rejects.toThrow();
  });

  it("leaves without audio only the beat whose synthesis failed", async () => {
    const service = createVoiceService({
      chain: createChain([scripted("kokoro", (text) => text === "Deux.")]),
      mediaDir,
    });
    const output = await service.narrate("exp1", scene(["Un.", "Deux.", "Trois."]), "fr");
    expect(output.beats.map((beat) => beat.audio !== undefined)).toEqual([true, false, true]);
    expect((await readdir(path.join(mediaDir, "exp1"))).sort()).toEqual(["s1-b1.mp3", "s1-b3.mp3"]);
  });

  it("returns a scene without audio when the voice is disabled", async () => {
    const service = createVoiceService({
      chain: createVoiceChain({ TTS_PROVIDERS: "none", MEDIA_DIR: mediaDir }),
      mediaDir,
    });
    const output = await service.narrate("exp1", scene(["Un."]), "fr");
    expect(output.beats[0]!.audio).toBeUndefined();
  });

  it("removes a stale audio field when the new synthesis fails", async () => {
    const service = createVoiceService({
      chain: createChain([scripted("kokoro", () => true)]),
      mediaDir,
    });
    const input = scene(["Un."]);
    input.beats[0]!.audio = { url: "/media/old/s1-b1.mp3", duration_ms: 1000 };
    const output = await service.narrate("exp1", input, "fr");
    expect(output.beats[0]!.audio).toBeUndefined();
    expect(input.beats[0]!.audio).toBeDefined();
  });

  it("synthesises at most four beats at a time", async () => {
    const voice = scripted("kokoro");
    const service = createVoiceService({ chain: createChain([voice]), mediaDir });
    const texts = ["Un.", "Deux.", "Trois.", "Quatre.", "Cinq.", "Six."];
    const output = await service.narrate("exp1", scene(texts), "fr");
    expect(voice.peak()).toBe(4);
    expect(output.beats.every((beat) => beat.audio)).toBe(true);
  });

  it("speaks a whole scene with one voice when the provider changes part-way", async () => {
    const azure = scripted("azure", (text) => text !== "Un.");
    const kokoro = scripted("kokoro");
    const service = createVoiceService({ chain: createChain([azure, kokoro]), mediaDir });

    const output = await service.narrate("exp1", scene(["Un.", "Deux.", "Trois."]), "fr");

    expect(output.beats.every((beat) => beat.audio)).toBe(true);
    expect(kokoro.calls.sort()).toEqual(["Deux.", "Trois.", "Un."]);
    expect(azure.calls.filter((text) => text === "Un.")).toHaveLength(1);
  });

  it("keeps the same voice for the next scene of the explanation", async () => {
    const azure = scripted("azure", () => true);
    const kokoro = scripted("kokoro");
    const service = createVoiceService({ chain: createChain([azure, kokoro]), mediaDir });
    await service.narrate("exp1", scene(["Un."], "s1"), "fr");
    await service.narrate("exp1", scene(["Deux."], "s2"), "fr");
    expect(azure.calls).toEqual(["Un."]);
    expect(kokoro.calls).toEqual(["Un.", "Deux."]);
  });

  it("does not write outside the media directory for an unsafe explanation id", async () => {
    const voice = scripted("kokoro");
    const service = createVoiceService({ chain: createChain([voice]), mediaDir });
    const output = await service.narrate("../escape", scene(["Un."]), "fr");
    expect(output.beats[0]!.audio).toBeUndefined();
    expect(voice.calls).toEqual([]);
    expect(await readdir(path.dirname(mediaDir))).not.toContain("escape");
  });
});

const SKIPPED = `SKIPPED: nothing answers at ${KOKORO_URL}/health, start it with: docker compose -f deploy/docker-compose.dev.yml up -d tts`;

describe.skipIf(!kokoroUp)(
  kokoroUp ? "narration against the Kokoro container" : `narration against Kokoro (${SKIPPED})`,
  () => {
    let mediaDir: string;
    beforeEach(async () => {
      mediaDir = await mkdtemp(path.join(tmpdir(), "narrate-kokoro-"));
    });
    afterEach(() => rm(mediaDir, { recursive: true, force: true }));

    function ffprobeMs(file: string): number {
      const out = execFileSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
        { encoding: "utf8" },
      );
      return Math.round(Number(out.trim()) * 1000);
    }

    it("narrates scene s1 of the gravitation explanation, then serves it from the cache", async () => {
      const reference = JSON.parse(
        await readFile(
          path.join(ROOT, "content", "reference", "physics.universal-gravitation.fr.json"),
          "utf8",
        ),
      ) as { payload: { scenes: Scene[] } };
      const s1 = reference.payload.scenes.find((candidate) => candidate.id === "s1")!;
      expect(s1.beats).toHaveLength(3);

      const realFetch = globalThis.fetch;
      const network = vi.fn<typeof fetch>((input, init) => realFetch(input, init));
      const chain = createVoiceChain(
        { TTS_PROVIDERS: "kokoro", KOKORO_BASE_URL: KOKORO_URL, MEDIA_DIR: mediaDir },
        { fetch: network },
      );
      const service = createVoiceService({ chain, mediaDir });

      const first = await service.narrate("exp-physics", s1, "fr");
      expect(network).toHaveBeenCalledTimes(3);
      expect(SceneSchema.parse(first)).toBeTruthy();
      expect((await readdir(path.join(mediaDir, "exp-physics"))).sort()).toEqual([
        "s1-b1.mp3",
        "s1-b2.mp3",
        "s1-b3.mp3",
      ]);
      for (const beat of first.beats) {
        const file = path.join(mediaDir, "exp-physics", `s1-${beat.id}.mp3`);
        expect(beat.audio!.url).toBe(`/media/exp-physics/s1-${beat.id}.mp3`);
        expect((await stat(file)).size).toBeGreaterThan(5_000);
        expect(Math.abs(beat.audio!.duration_ms - ffprobeMs(file))).toBeLessThanOrEqual(30);
      }

      network.mockClear();
      const second = await service.narrate("exp-physics", s1, "fr");
      expect(network).not.toHaveBeenCalled();
      expect(second).toEqual(first);
    }, 30_000);
  },
);
