import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceChain, isPocketConfigured } from "@/server/tts";

const FRENCH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-fr.mp3"));

let mediaDir: string;
beforeEach(async () => {
  mediaDir = await mkdtemp(path.join(tmpdir(), "voice-config-"));
});
afterEach(async () => {
  await rm(mediaDir, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}) => ({ MEDIA_DIR: mediaDir, ...extra });

describe("voice configuration", () => {
  it("does not use Pocket unless TTS_PROVIDERS names it", () => {
    expect(createVoiceChain(env()).providers).toEqual(["kokoro"]);
    expect(isPocketConfigured(env())).toBe(false);
    expect(isPocketConfigured(env({ TTS_PROVIDERS: "azure,kokoro" }))).toBe(false);
  });

  it("builds Pocket in the order given", () => {
    const chain = createVoiceChain(env({ TTS_PROVIDERS: "pocket,kokoro" }));
    expect(chain.providers).toEqual(["pocket", "kokoro"]);
    expect(isPocketConfigured(env({ TTS_PROVIDERS: "kokoro, Pocket" }))).toBe(true);
    expect(createVoiceChain(env({ TTS_PROVIDERS: "kokoro,pocket" })).providers).toEqual([
      "kokoro",
      "pocket",
    ]);
  });

  it("keeps rejecting unknown names and honouring none", () => {
    expect(() => createVoiceChain(env({ TTS_PROVIDERS: "pocket,piper" }))).toThrow(
      'Unknown voice provider "piper" in TTS_PROVIDERS.',
    );
    expect(createVoiceChain(env({ TTS_PROVIDERS: "none" })).providers).toEqual([]);
    expect(isPocketConfigured(env({ TTS_PROVIDERS: "none" }))).toBe(false);
  });

  it("asks the Pocket service for the configured voice of each language", async () => {
    const send = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array(FRENCH), { status: 200 }),
    );
    const chain = createVoiceChain(
      env({
        TTS_PROVIDERS: "pocket",
        POCKET_BASE_URL: "http://pocket.test:8890/",
        POCKET_VOICE_EN: "cosette",
      }),
      { fetch: send },
    );
    const french = await chain
      .forExplanation("e1")
      .synthesize({ text: "Bonjour la Terre.", language: "fr" });
    const english = await chain
      .forExplanation("e1")
      .synthesize({ text: "Hello Earth.", language: "en" });

    expect(french).toMatchObject({ provider: "pocket", voice: "estelle" });
    expect(english).toMatchObject({ provider: "pocket", voice: "cosette" });
    expect(String(send.mock.calls[0]![0])).toBe("http://pocket.test:8890/v1/audio/speech");
    expect(JSON.parse(String(send.mock.calls[0]![1]!.body))).toEqual({
      model: "pocket",
      input: "Bonjour la Terre.",
      voice: "estelle",
      response_format: "mp3",
      stream: false,
    });
  });
});
