import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createPocketProvider,
  mp3DurationMs,
  TtsError,
  type SynthesizeRequest,
} from "@/server/tts";
import { cacheKey } from "@/server/tts/cache";

const FRENCH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-fr.mp3"));
const ENGLISH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-en.mp3"));

type FetchMock = Mock<typeof fetch>;

const mockFetch = (implementation?: typeof fetch): FetchMock => vi.fn<typeof fetch>(implementation);
const audioReply = (bytes: Uint8Array = FRENCH, status = 200): Response =>
  new Response(new Uint8Array(bytes), { status, headers: { "content-type": "audio/mpeg" } });
const initOf = (mock: FetchMock, call = 0): RequestInit => mock.mock.calls[call]![1]!;
const urlOf = (mock: FetchMock, call = 0): string => String(mock.mock.calls[call]![0]);
const bodyOf = (mock: FetchMock, call = 0): unknown =>
  JSON.parse(initOf(mock, call).body as string);

function pocketWith(
  fetchMock: FetchMock,
  extra: { timeoutMs?: number; concurrency?: number } = {},
) {
  return createPocketProvider({
    baseUrl: "http://pocket.test:8890/",
    voices: { fr: "estelle", en: "alba" },
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

describe("Pocket provider", () => {
  it("posts an OpenAI-style speech request to the service with no credentials", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    await pocketWith(fetchMock).synthesize(say("Une pomme tombe."));

    expect(urlOf(fetchMock)).toBe("http://pocket.test:8890/v1/audio/speech");
    const init = initOf(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(bodyOf(fetchMock)).toEqual({
      model: "pocket",
      input: "Une pomme tombe.",
      voice: "estelle",
      response_format: "mp3",
      stream: false,
    });
  });

  it("returns the provider, the voice and the duration read from the MP3", async () => {
    const result = await pocketWith(mockFetch(async () => audioReply())).synthesize(
      say("Une pomme tombe."),
    );
    expect(result).toMatchObject({ provider: "pocket", voice: "estelle" });
    expect(result.audio).toEqual(new Uint8Array(FRENCH));
    expect(result.durationMs).toBe(mp3DurationMs(FRENCH));
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("picks the voice from the language", async () => {
    const fetchMock = mockFetch(async () => audioReply(ENGLISH));
    const provider = pocketWith(fetchMock);
    const result = await provider.synthesize(say("An apple falls.", "en"));

    expect(bodyOf(fetchMock)).toMatchObject({ input: "An apple falls.", voice: "alba" });
    expect(result).toMatchObject({ provider: "pocket", voice: "alba" });
    expect(result.durationMs).toBe(mp3DurationMs(ENGLISH));
    expect(provider.name).toBe("pocket");
    expect(provider.voiceFor("fr")).toBe("estelle");
    expect(provider.voiceFor("en")).toBe("alba");
  });

  it("maps a slow answer to timeout and aborts the request", async () => {
    const fetchMock = mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        }),
    );
    const error = await failure(
      pocketWith(fetchMock, { timeoutMs: 20 }).synthesize(say("Bonjour.")),
    );
    expect(error.code).toBe("timeout");
    expect(error.provider).toBe("pocket");
    expect(initOf(fetchMock).signal!.aborted).toBe(true);
  });

  it("maps a network failure and a server error to unavailable", async () => {
    const down = mockFetch(async () => Promise.reject(new TypeError("fetch failed")));
    const unreachable = await failure(pocketWith(down).synthesize(say("Bonjour.")));
    expect(unreachable.code).toBe("unavailable");
    expect(unreachable.provider).toBe("pocket");

    const broken = mockFetch(async () => new Response("", { status: 500 }));
    expect((await failure(pocketWith(broken).synthesize(say("Bonjour.")))).code).toBe(
      "unavailable",
    );
    const loading = mockFetch(async () => Response.json({ error: "loading" }, { status: 503 }));
    expect((await failure(pocketWith(loading).synthesize(say("Bonjour.")))).code).toBe(
      "unavailable",
    );
  });

  it("maps a 429 to rate_limited", async () => {
    const limited = mockFetch(async () => new Response("", { status: 429 }));
    const error = await failure(pocketWith(limited).synthesize(say("Bonjour.")));
    expect(error.code).toBe("rate_limited");
    expect(error.provider).toBe("pocket");
  });

  it("maps an empty or unreadable body to unavailable", async () => {
    const empty = mockFetch(async () => new Response(new Uint8Array(), { status: 200 }));
    expect((await failure(pocketWith(empty).synthesize(say("Bonjour.")))).code).toBe("unavailable");
    const html = mockFetch(async () => new Response("<html>oops</html>", { status: 200 }));
    expect((await failure(pocketWith(html).synthesize(say("Bonjour.")))).code).toBe("unavailable");
  });

  it("refuses empty text and text over 200 characters before any network call", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const provider = pocketWith(fetchMock);

    expect((await failure(provider.synthesize(say("")))).code).toBe("invalid_input");
    expect((await failure(provider.synthesize(say("   ")))).code).toBe("invalid_input");
    const tooLong = await failure(provider.synthesize(say("x".repeat(201))));
    expect(tooLong.code).toBe("invalid_input");
    expect(tooLong.provider).toBe("pocket");
    expect(fetchMock).not.toHaveBeenCalled();

    await provider.synthesize(say("x".repeat(200)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("changes the disk cache key with the voice and the provider", () => {
    expect(cacheKey("pocket", "estelle", "fr", "x")).not.toBe(
      cacheKey("pocket", "alba", "fr", "x"),
    );
    expect(cacheKey("pocket", "estelle", "fr", "x")).not.toBe(
      cacheKey("kokoro", "estelle", "fr", "x"),
    );
    expect(cacheKey("pocket", "estelle", "fr", "x")).toBe(cacheKey("pocket", "estelle", "fr", "x"));
  });

  it("reads health from the service", async () => {
    const ok = mockFetch(async () => Response.json({ status: "healthy", languages: ["fr", "en"] }));
    expect(await pocketWith(ok).health()).toBe(true);
    expect(urlOf(ok)).toBe("http://pocket.test:8890/health");

    const loading = mockFetch(async () => Response.json({ status: "loading" }, { status: 503 }));
    expect(await pocketWith(loading).health()).toBe(false);
    const down = mockFetch(async () => Promise.reject(new Error("refused")));
    expect(await pocketWith(down).health()).toBe(false);
  });

  it("sends one request at a time: the second starts only after the first resolved", async () => {
    const events: string[] = [];
    const releases: (() => void)[] = [];
    const fetchMock = mockFetch(async () => {
      const index = fetchMock.mock.calls.length;
      events.push(`start ${index}`);
      await new Promise<void>((resolve) => releases.push(resolve));
      events.push(`end ${index}`);
      return audioReply();
    });
    const provider = pocketWith(fetchMock);

    const first = provider.synthesize(say("Un."));
    const second = provider.synthesize(say("Deux."));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["start 1"]);

    releases[0]!();
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(events).toEqual(["start 1", "end 1", "start 2"]);

    releases[1]!();
    await second;
    expect(events).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    expect(bodyOf(fetchMock, 1)).toMatchObject({ input: "Deux." });
  });
});
