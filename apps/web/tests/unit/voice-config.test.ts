import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceChain, createVoiceProvider, isPocketConfigured } from "@/server/tts";

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

describe("Deepgram configuration", () => {
  const KEY = "dg-test-key";

  async function pending(count: number, environment: Record<string, string>) {
    let started = 0;
    const releases: (() => void)[] = [];
    const send = vi.fn<typeof fetch>(() => {
      started++;
      return new Promise<Response>((resolve) =>
        releases.push(() => resolve(new Response(new Uint8Array(FRENCH), { status: 200 }))),
      );
    });
    const provider = createVoiceProvider("deepgram", env(environment), { fetch: send })!;
    const calls = Array.from({ length: count }, (_, n) =>
      provider.synthesize({ text: `Phrase ${n}.`, language: "fr" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startedBeforeRelease = started;
    while (releases.length < count) {
      releases.forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    releases.forEach((release) => release());
    await Promise.all(calls);
    return startedBeforeRelease;
  }

  it("accepts deepgram in TTS_PROVIDERS and keeps the order given", () => {
    const chain = createVoiceChain(
      env({ TTS_PROVIDERS: "deepgram,pocket", DEEPGRAM_API_KEY: KEY }),
    );
    expect(chain.providers).toEqual(["deepgram", "pocket"]);
    expect(isPocketConfigured(env({ TTS_PROVIDERS: "deepgram,pocket" }))).toBe(true);
  });

  it("skips deepgram without a key", () => {
    expect(createVoiceProvider("deepgram", env())).toBeNull();
    expect(createVoiceProvider("deepgram", env({ DEEPGRAM_API_KEY: "" }))).toBeNull();
    expect(createVoiceChain(env({ TTS_PROVIDERS: "deepgram,pocket" })).providers).toEqual([
      "pocket",
    ]);
  });

  it("is not in the default providers", () => {
    expect(createVoiceChain(env({ DEEPGRAM_API_KEY: KEY })).providers).toEqual(["kokoro"]);
  });

  it("defaults to the Aura-2 voices and reads them from the environment", () => {
    const standard = createVoiceProvider("deepgram", env({ DEEPGRAM_API_KEY: KEY }))!;
    expect(standard.name).toBe("deepgram");
    expect(standard.voiceFor("fr")).toBe("aura-2-agathe-fr");
    expect(standard.voiceFor("en")).toBe("aura-2-thalia-en");

    const custom = createVoiceProvider(
      "deepgram",
      env({
        DEEPGRAM_API_KEY: KEY,
        DEEPGRAM_VOICE_FR: "aura-2-hector-fr",
        DEEPGRAM_VOICE_EN: "aura-2-apollo-en",
      }),
    )!;
    expect(custom.voiceFor("fr")).toBe("aura-2-hector-fr");
    expect(custom.voiceFor("en")).toBe("aura-2-apollo-en");
  });

  it("sends the key and the configured voice to Deepgram", async () => {
    const send = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array(FRENCH), { status: 200 }),
    );
    const chain = createVoiceChain(
      env({
        TTS_PROVIDERS: "deepgram",
        DEEPGRAM_API_KEY: KEY,
        DEEPGRAM_VOICE_EN: "aura-2-apollo-en",
      }),
      { fetch: send },
    );
    const result = await chain
      .forExplanation("e1")
      .synthesize({ text: "Hello Earth.", language: "en" });
    expect(result).toMatchObject({ provider: "deepgram", voice: "aura-2-apollo-en" });
    expect(String(send.mock.calls[0]![0])).toBe(
      "https://api.deepgram.com/v1/speak?model=aura-2-apollo-en&encoding=mp3",
    );
    expect(send.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: `Token ${KEY}` });
  });

  it("allows ten simultaneous calls by default", async () => {
    expect(await pending(12, { DEEPGRAM_API_KEY: KEY })).toBe(10);
  });

  it("reads the limit from DEEPGRAM_CONCURRENCY", async () => {
    expect(await pending(6, { DEEPGRAM_API_KEY: KEY, DEEPGRAM_CONCURRENCY: "3" })).toBe(3);
  });

  it.each(["0", "-2", "abc", "2.5", "", "  "])(
    "falls back to ten simultaneous calls for DEEPGRAM_CONCURRENCY=%j",
    async (value) => {
      expect(await pending(12, { DEEPGRAM_API_KEY: KEY, DEEPGRAM_CONCURRENCY: value })).toBe(10);
    },
  );
});
