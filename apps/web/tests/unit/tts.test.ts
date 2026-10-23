import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createAzureProvider,
  createChain,
  createKokoroProvider,
  createVoiceChain,
  mp3DurationMs,
  TtsError,
  withDiskCache,
  type SynthesizeRequest,
  type SynthesizedAudio,
  type VoiceProvider,
} from "@/server/tts";
import { buildSsml, escapeXml } from "@/server/tts/azure";
import { cacheKey } from "@/server/tts/cache";

const SECRET = "azure-secret-key-0123456789";
const FRENCH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-fr.mp3"));
const ENGLISH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-en.mp3"));

type FetchMock = Mock<typeof fetch>;

const mockFetch = (implementation?: typeof fetch): FetchMock => vi.fn<typeof fetch>(implementation);
const audioReply = (bytes: Uint8Array = FRENCH, status = 200): Response =>
  new Response(new Uint8Array(bytes), { status, headers: { "content-type": "audio/mpeg" } });
const initOf = (mock: FetchMock, call = 0): RequestInit => mock.mock.calls[call]![1]!;
const urlOf = (mock: FetchMock, call = 0): string => String(mock.mock.calls[call]![0]);

const voices = { fr: "fr-FR-DeniseNeural", en: "en-US-JennyNeural" };

function azureWith(fetchMock: FetchMock, timeoutMs?: number) {
  return createAzureProvider({
    key: SECRET,
    region: "francecentral",
    voices,
    fetch: fetchMock,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

function kokoroWith(
  fetchMock: FetchMock,
  extra: { timeoutMs?: number; concurrency?: number } = {},
) {
  return createKokoroProvider({
    baseUrl: "http://kokoro.test:8880/",
    voices: { fr: "ff_siwis", en: "af_heart" },
    fetch: fetchMock,
    ...extra,
  });
}

async function failure(promise: Promise<unknown>): Promise<TtsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TtsError);
    return error as TtsError;
  }
  throw new Error("expected the call to fail");
}

const say = (text: string, language: "fr" | "en" = "fr"): SynthesizeRequest => ({ text, language });

describe("Azure Speech provider", () => {
  it("posts SSML to the regional endpoint with the documented headers", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const result = await azureWith(fetchMock).synthesize(say("Bonjour la Terre."));

    expect(urlOf(fetchMock)).toBe(
      "https://francecentral.tts.speech.microsoft.com/cognitiveservices/v1",
    );
    const init = initOf(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Ocp-Apim-Subscription-Key": SECRET,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
    });
    expect(init.body).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="fr-FR">' +
        '<voice name="fr-FR-DeniseNeural">Bonjour la Terre.</voice></speak>',
    );
    expect(result.provider).toBe("azure");
    expect(result.voice).toBe("fr-FR-DeniseNeural");
    expect(result.audio).toEqual(new Uint8Array(FRENCH));
    expect(result.durationMs).toBe(mp3DurationMs(FRENCH));
  });

  it("uses the English voice and its locale for English text", async () => {
    const fetchMock = mockFetch(async () => audioReply(ENGLISH));
    const result = await azureWith(fetchMock).synthesize(say("The apple falls.", "en"));
    expect(initOf(fetchMock).body).toContain('xml:lang="en-US"><voice name="en-US-JennyNeural">');
    expect(result.voice).toBe("en-US-JennyNeural");
  });

  it("escapes the text for XML", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    await azureWith(fetchMock).synthesize(say(`Tom & Jerry <b>"vite"</b> : l'attire`));
    const body = initOf(fetchMock).body as string;
    expect(body).toContain("Tom &amp; Jerry &lt;b&gt;&quot;vite&quot;&lt;/b&gt; : l&apos;attire");
    expect(body).not.toContain("<b>");
    expect(escapeXml("a&b")).toBe("a&amp;b");
    expect(buildSsml("x", "en-GB-RyanNeural", "en")).toContain('xml:lang="en-GB"');
  });

  it.each([
    [401, "unavailable"],
    [403, "unavailable"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [400, "unavailable"],
  ] as const)("maps status %i to %s", async (status, code) => {
    const fetchMock = mockFetch(async () => new Response(`bad ${SECRET}`, { status }));
    const error = await failure(azureWith(fetchMock).synthesize(say("Bonjour.")));
    expect(error.code).toBe(code);
    expect(error.provider).toBe("azure");
  });

  it("maps a slow answer to timeout and aborts the request", async () => {
    const fetchMock = mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        }),
    );
    const error = await failure(azureWith(fetchMock, 20).synthesize(say("Bonjour.")));
    expect(error.code).toBe("timeout");
    expect(initOf(fetchMock).signal!.aborted).toBe(true);
  });

  it("maps a network failure and an unreadable answer to unavailable", async () => {
    const down = mockFetch(async () => Promise.reject(new TypeError(`fetch failed ${SECRET}`)));
    expect((await failure(azureWith(down).synthesize(say("Bonjour.")))).code).toBe("unavailable");
    const html = mockFetch(async () => new Response("<html>login</html>", { status: 200 }));
    expect((await failure(azureWith(html).synthesize(say("Bonjour.")))).code).toBe("unavailable");
  });

  it("never puts the key in an error", async () => {
    const attempts: [string, FetchMock][] = [
      ["rejected", mockFetch(async () => Promise.reject(new Error(`boom ${SECRET}`)))],
      ["401", mockFetch(async () => new Response(`key ${SECRET} rejected`, { status: 401 }))],
      ["429", mockFetch(async () => new Response(SECRET, { status: 429 }))],
      ["garbage", mockFetch(async () => new Response(SECRET, { status: 200 }))],
    ];
    for (const [label, fetchMock] of attempts) {
      const error = await failure(azureWith(fetchMock).synthesize(say("Bonjour.")));
      const printed = [error.message, error.stack, String(error), JSON.stringify(error)].join("|");
      expect(printed, label).not.toContain(SECRET);
      expect(error.cause, label).toBeUndefined();
    }
  });

  it("rejects text over 200 characters or empty without any network call", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const provider = azureWith(fetchMock);
    expect((await failure(provider.synthesize(say("x".repeat(201))))).code).toBe("invalid_input");
    expect((await failure(provider.synthesize(say("   ")))).code).toBe("invalid_input");
    expect(fetchMock).not.toHaveBeenCalled();
    await provider.synthesize(say("x".repeat(200)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports health from the voice list and never throws", async () => {
    const ok = mockFetch(async () => new Response("[]", { status: 200 }));
    expect(await azureWith(ok).health()).toBe(true);
    expect(urlOf(ok)).toBe(
      "https://francecentral.tts.speech.microsoft.com/cognitiveservices/voices/list",
    );
    const denied = mockFetch(async () => new Response("", { status: 401 }));
    expect(await azureWith(denied).health()).toBe(false);
    const down = mockFetch(async () => Promise.reject(new Error("offline")));
    expect(await azureWith(down).health()).toBe(false);
  });
});

describe("Kokoro provider", () => {
  it("posts an OpenAI-style speech request to the service", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const result = await kokoroWith(fetchMock).synthesize(say("Une pomme tombe."));

    expect(urlOf(fetchMock)).toBe("http://kokoro.test:8880/v1/audio/speech");
    const init = initOf(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "kokoro",
      input: "Une pomme tombe.",
      voice: "ff_siwis",
      response_format: "mp3",
      stream: false,
    });
    expect(result).toMatchObject({ provider: "kokoro", voice: "ff_siwis" });
    expect(result.durationMs).toBe(mp3DurationMs(FRENCH));
  });

  it("picks the voice from the language", async () => {
    const fetchMock = mockFetch(async () => audioReply(ENGLISH));
    const result = await kokoroWith(fetchMock).synthesize(say("An apple falls.", "en"));
    expect(JSON.parse(initOf(fetchMock).body as string)).toMatchObject({ voice: "af_heart" });
    expect(result.voice).toBe("af_heart");
  });

  it("maps failures like the other provider and enforces the text limit", async () => {
    const limited = mockFetch(async () => new Response("", { status: 429 }));
    expect((await failure(kokoroWith(limited).synthesize(say("Bonjour.")))).code).toBe(
      "rate_limited",
    );
    const broken = mockFetch(async () => new Response("", { status: 500 }));
    expect((await failure(kokoroWith(broken).synthesize(say("Bonjour.")))).code).toBe(
      "unavailable",
    );
    const never = mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        }),
    );
    expect(
      (await failure(kokoroWith(never, { timeoutMs: 20 }).synthesize(say("Bonjour.")))).code,
    ).toBe("timeout");
    const untouched = mockFetch(async () => audioReply());
    expect((await failure(kokoroWith(untouched).synthesize(say("x".repeat(201))))).code).toBe(
      "invalid_input",
    );
    expect(untouched).not.toHaveBeenCalled();
  });

  it("sends one request at a time so queued calls do not use up their timeout", async () => {
    let active = 0;
    let peak = 0;
    const fetchMock = mockFetch(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return audioReply();
    });
    const provider = kokoroWith(fetchMock);
    await Promise.all([1, 2, 3, 4].map((n) => provider.synthesize(say(`Phrase ${n}.`))));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(peak).toBe(1);

    peak = 0;
    const wide = kokoroWith(fetchMock, { concurrency: 2 });
    await Promise.all([1, 2, 3, 4].map((n) => wide.synthesize(say(`Phrase ${n}.`))));
    expect(peak).toBe(2);
  });

  it("reads health from the service", async () => {
    const ok = mockFetch(async () => Response.json({ status: "healthy" }));
    expect(await kokoroWith(ok).health()).toBe(true);
    expect(urlOf(ok)).toBe("http://kokoro.test:8880/health");
    const sick = mockFetch(async () => new Response("", { status: 503 }));
    expect(await kokoroWith(sick).health()).toBe(false);
    const down = mockFetch(async () => Promise.reject(new Error("refused")));
    expect(await kokoroWith(down).health()).toBe(false);
  });
});

interface FakeProvider extends VoiceProvider {
  calls: SynthesizeRequest[];
}

function fake(
  name: string,
  behaviour: (request: SynthesizeRequest) => Promise<void> | void = () => {},
): FakeProvider {
  const calls: SynthesizeRequest[] = [];
  return {
    name,
    calls,
    voiceFor: (language) => `${name}-${language}`,
    health: async () => true,
    async synthesize(request): Promise<SynthesizedAudio> {
      calls.push(request);
      await behaviour(request);
      return {
        audio: new Uint8Array(FRENCH),
        durationMs: mp3DurationMs(FRENCH),
        provider: name,
        voice: `${name}-${request.language}`,
      };
    },
  };
}

const down =
  (code: TtsError["code"] = "unavailable") =>
  () => {
    throw new TtsError(code, "fake", "down");
  };

describe("voice chain", () => {
  it("answers with the first provider when it works", async () => {
    const first = fake("azure");
    const second = fake("kokoro");
    const result = await createChain([first, second])
      .forExplanation("e1")
      .synthesize(say("Bonjour."));
    expect(result.provider).toBe("azure");
    expect(second.calls).toHaveLength(0);
  });

  it("moves to the next provider when the first fails, whatever the reason", async () => {
    for (const code of ["unavailable", "timeout", "rate_limited"] as const) {
      const first = fake("azure", down(code));
      const second = fake("kokoro");
      const result = await createChain([first, second])
        .forExplanation("e1")
        .synthesize(say("Bonjour."));
      expect(result.provider, code).toBe("kokoro");
      expect(first.calls).toHaveLength(1);
    }
  });

  it("fails with unavailable when every provider fails", async () => {
    const chain = createChain([fake("azure", down("timeout")), fake("kokoro", down())]);
    const error = await failure(chain.forExplanation("e1").synthesize(say("Bonjour.")));
    expect(error.code).toBe("unavailable");
  });

  it("does not try another provider for an invalid text", async () => {
    const first = fake("azure");
    const chain = createChain([first, fake("kokoro")]);
    const error = await failure(chain.forExplanation("e1").synthesize(say("x".repeat(201))));
    expect(error.code).toBe("invalid_input");
    expect(first.calls).toHaveLength(0);
  });

  it("keeps the provider that worked for an explanation and starts over for the next one", async () => {
    let azureUp = false;
    const azure = fake("azure", () => {
      if (!azureUp) down()();
    });
    const kokoro = fake("kokoro");
    const chain = createChain([azure, kokoro]);
    const one = chain.forExplanation("e1");

    expect(one.provider).toBe("azure");
    await one.synthesize(say("Un."));
    expect(one.provider).toBe("kokoro");
    azureUp = true;
    expect((await one.synthesize(say("Deux."))).provider).toBe("kokoro");
    expect((await chain.forExplanation("e1").synthesize(say("Trois."))).provider).toBe("kokoro");
    expect(azure.calls.map((call) => call.text)).toEqual(["Un."]);

    expect((await chain.forExplanation("e2").synthesize(say("Un."))).provider).toBe("azure");
  });

  it("does not move back when a slower call fails after another one moved on", async () => {
    const azure = fake("azure", async (request) => {
      if (request.text === "lent") await new Promise((resolve) => setTimeout(resolve, 20));
      down()();
    });
    const kokoro = fake("kokoro");
    const voice = createChain([azure, kokoro]).forExplanation("e1");
    const results = await Promise.all([
      voice.synthesize(say("vite")),
      voice.synthesize(say("lent")),
    ]);
    expect(results.map((result) => result.provider)).toEqual(["kokoro", "kokoro"]);
    expect(kokoro.calls).toHaveLength(2);
  });

  it("stops trying providers once the caller cancels", async () => {
    const controller = new AbortController();
    const azure = fake("azure", () => {
      controller.abort();
      down()();
    });
    const kokoro = fake("kokoro");
    const voice = createChain([azure, kokoro]).forExplanation("e1");
    const error = await failure(
      voice.synthesize({ ...say("Bonjour."), signal: controller.signal }),
    );
    expect(error.code).toBe("unavailable");
    expect(kokoro.calls).toHaveLength(0);
  });

  it("has no provider and answers unavailable when empty", async () => {
    const chain = createChain([]);
    const voice = chain.forExplanation("e1");
    expect(voice.provider).toBeNull();
    expect((await failure(voice.synthesize(say("Bonjour.")))).code).toBe("unavailable");
    expect(await chain.health()).toBe(false);
  });

  it("is healthy when at least one provider is", async () => {
    const sick = { ...fake("azure"), health: async () => false };
    const throwing = { ...fake("azure"), health: () => Promise.reject(new Error("x")) };
    expect(await createChain([sick, fake("kokoro")]).health()).toBe(true);
    expect(await createChain([sick, throwing]).health()).toBe(false);
  });

  it("reports the state of each provider by name", async () => {
    const sick = { ...fake("pocket"), health: async () => false };
    const throwing = { ...fake("azure"), health: () => Promise.reject(new Error("x")) };
    const chain = createChain([sick, fake("kokoro"), throwing]);
    expect(await chain.healthByProvider()).toEqual({ pocket: false, kokoro: true, azure: false });
    expect(await createChain([]).healthByProvider()).toEqual({});
  });

  it("hands the rest of an explanation to the next voice when the first one stops", async () => {
    let pocketUp = true;
    const pocket = fake("pocket", () => {
      if (!pocketUp) down("timeout")();
    });
    const kokoro = fake("kokoro");
    const voice = createChain([pocket, kokoro]).forExplanation("e1");

    expect((await voice.synthesize(say("Un."))).provider).toBe("pocket");
    pocketUp = false;
    expect((await voice.synthesize(say("Deux."))).provider).toBe("kokoro");
    expect((await voice.synthesize(say("Trois."))).provider).toBe("kokoro");
    expect(pocket.calls.map((call) => call.text)).toEqual(["Un.", "Deux."]);
  });
});

describe("voice chain from the environment", () => {
  let mediaDir: string;
  beforeEach(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), "tts-chain-"));
  });
  afterEach(() => rm(mediaDir, { recursive: true, force: true }));

  const env = (extra: Record<string, string> = {}) => ({
    MEDIA_DIR: mediaDir,
    AZURE_SPEECH_REGION: "francecentral",
    KOKORO_BASE_URL: "http://kokoro.test:8880",
    ...extra,
  });

  it("tries azure then kokoro by default and skips azure without a key, without any call", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const chain = createVoiceChain(env(), { fetch: fetchMock });
    expect(chain.providers).toEqual(["kokoro"]);
    await chain.forExplanation("e1").synthesize(say("Bonjour."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock)).toBe("http://kokoro.test:8880/v1/audio/speech");
  });

  it("uses azure first when it has a key, then falls back to kokoro", async () => {
    const fetchMock = mockFetch(async (url) =>
      String(url).includes("microsoft") ? new Response("", { status: 401 }) : audioReply(),
    );
    const chain = createVoiceChain(env({ AZURE_SPEECH_KEY: SECRET }), { fetch: fetchMock });
    expect(chain.providers).toEqual(["azure", "kokoro"]);
    const result = await chain.forExplanation("e1").synthesize(say("Bonjour."));
    expect(result).toMatchObject({ provider: "kokoro", voice: "ff_siwis" });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
      "francecentral.tts.speech.microsoft.com",
      "kokoro.test",
    ]);
  });

  it("follows the order of TTS_PROVIDERS and reads the voices from the environment", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const chain = createVoiceChain(
      env({
        TTS_PROVIDERS: " Kokoro , azure ,kokoro",
        AZURE_SPEECH_KEY: SECRET,
        KOKORO_VOICE_EN: "bf_emma",
        AZURE_SPEECH_REGION: "westeurope",
      }),
      { fetch: fetchMock },
    );
    expect(chain.providers).toEqual(["kokoro", "azure"]);
    const result = await chain.forExplanation("e1").synthesize(say("Hello.", "en"));
    expect(result.voice).toBe("bf_emma");

    const azureOnly = createVoiceChain(
      env({ TTS_PROVIDERS: "azure", AZURE_SPEECH_KEY: SECRET, AZURE_SPEECH_REGION: "westeurope" }),
      { fetch: fetchMock },
    );
    await azureOnly.forExplanation("e1").synthesize(say("Hello.", "en"));
    expect(urlOf(fetchMock, 1)).toBe(
      "https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1",
    );
  });

  it("is disabled by TTS_PROVIDERS=none and makes no call", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const chain = createVoiceChain(env({ TTS_PROVIDERS: "none", AZURE_SPEECH_KEY: SECRET }), {
      fetch: fetchMock,
    });
    expect(chain.providers).toEqual([]);
    expect((await failure(chain.forExplanation("e1").synthesize(say("Bonjour.")))).code).toBe(
      "unavailable",
    );
    expect(await chain.health()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a provider name it does not know", () => {
    expect(() => createVoiceChain(env({ TTS_PROVIDERS: "azur,kokoro" }))).toThrow("azur");
  });

  it("serves a second identical sentence from the disk cache", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const chain = createVoiceChain(env(), { fetch: fetchMock });
    const first = await chain.forExplanation("e1").synthesize(say("Une pomme tombe."));
    const second = await chain.forExplanation("e2").synthesize(say("Une pomme tombe."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.audio).toEqual(first.audio);
    expect(second).toMatchObject({
      provider: "kokoro",
      voice: "ff_siwis",
      durationMs: first.durationMs,
    });

    const key = createHash("sha256")
      .update(["kokoro", "ff_siwis", "fr", "Une pomme tombe."].join("\0"))
      .digest("hex");
    expect(cacheKey("kokoro", "ff_siwis", "fr", "Une pomme tombe.")).toBe(key);
    expect(await readdir(path.join(mediaDir, ".tts-cache"))).toEqual([`${key}.mp3`]);
  });

  it("keys the cache on provider, voice, language and text", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const chain = createVoiceChain(env(), { fetch: fetchMock });
    const voice = chain.forExplanation("e1");
    await voice.synthesize(say("Une pomme tombe."));
    await voice.synthesize(say("Une pomme tombe!"));
    await voice.synthesize(say("Une pomme tombe.", "en"));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const other = createVoiceChain(env({ KOKORO_VOICE_FR: "ff_other" }), { fetch: fetchMock });
    await other.forExplanation("e1").synthesize(say("Une pomme tombe."));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      new Set([
        cacheKey("kokoro", "ff_siwis", "fr", "t"),
        cacheKey("azure", "ff_siwis", "fr", "t"),
        cacheKey("kokoro", "ff_other", "fr", "t"),
        cacheKey("kokoro", "ff_siwis", "en", "t"),
        cacheKey("kokoro", "ff_siwis", "fr", "u"),
      ]).size,
    ).toBe(5);
  });

  it("synthesises again when a cached file is unreadable, and survives an unwritable cache", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const chain = createVoiceChain(env(), { fetch: fetchMock });
    await chain.forExplanation("e1").synthesize(say("Une pomme tombe."));
    const directory = path.join(mediaDir, ".tts-cache");
    const [file] = await readdir(directory);
    await writeFile(path.join(directory, file!), "not audio");
    const again = await chain.forExplanation("e1").synthesize(say("Une pomme tombe."));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(again.audio).toEqual(new Uint8Array(FRENCH));
    expect(new Uint8Array(await readFile(path.join(directory, file!)))).toEqual(
      new Uint8Array(FRENCH),
    );

    const blocked = path.join(mediaDir, "blocked");
    await writeFile(blocked, "a file where a directory should be");
    const cached = withDiskCache(fake("kokoro"), path.join(blocked, "cache"));
    expect((await cached.synthesize(say("Bonjour."))).provider).toBe("kokoro");
  });
});
