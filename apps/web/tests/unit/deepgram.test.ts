import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createDeepgramProvider,
  mp3DurationMs,
  TtsError,
  type SynthesizeRequest,
} from "@/server/tts";

const SECRET = "deepgram-secret-key-0123456789";
const FRENCH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-fr.mp3"));
const ENGLISH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-en.mp3"));

type FetchMock = Mock<typeof fetch>;

const mockFetch = (implementation?: typeof fetch): FetchMock => vi.fn<typeof fetch>(implementation);
const audioReply = (bytes: Uint8Array = FRENCH, status = 200): Response =>
  new Response(new Uint8Array(bytes), { status, headers: { "content-type": "audio/mpeg" } });
const initOf = (mock: FetchMock, call = 0): RequestInit => mock.mock.calls[call]![1]!;
const urlOf = (mock: FetchMock, call = 0): string => String(mock.mock.calls[call]![0]);
const bodyOf = (mock: FetchMock, call = 0): { text: string } =>
  JSON.parse(initOf(mock, call).body as string) as { text: string };

const voices = { fr: "aura-2-agathe-fr", en: "aura-2-thalia-en" };

function deepgramWith(
  fetchMock: FetchMock,
  extra: { timeoutMs?: number; concurrency?: number; voices?: typeof voices } = {},
) {
  return createDeepgramProvider({ apiKey: SECRET, voices, fetch: fetchMock, ...extra });
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await sleep(1);
  expect(condition()).toBe(true);
}

function abortable(init: RequestInit | undefined, reply: () => Response, delayMs: number) {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(reply()), delayMs);
    init!.signal!.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(init!.signal!.reason);
    });
  });
}

function held() {
  const releases: (() => void)[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchMock = mockFetch(
    () =>
      new Promise<Response>((resolve) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        releases.push(() => {
          inFlight--;
          resolve(audioReply());
        });
      }),
  );
  return {
    fetchMock,
    releases,
    inFlight: () => inFlight,
    peak: () => peak,
    release: (index: number) => releases[index]!(),
  };
}

describe("Deepgram provider", () => {
  it("posts the text to the speak endpoint with the token and the model in the query", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const result = await deepgramWith(fetchMock).synthesize(say("Une pomme tombe."));

    expect(urlOf(fetchMock)).toBe(
      "https://api.deepgram.com/v1/speak?model=aura-2-agathe-fr&encoding=mp3",
    );
    const init = initOf(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Token ${SECRET}`,
      "Content-Type": "application/json",
    });
    expect(init.body).toBe(JSON.stringify({ text: "Une pomme tombe." }));
    expect(result).toMatchObject({ provider: "deepgram", voice: "aura-2-agathe-fr" });
    expect(result.audio).toEqual(new Uint8Array(FRENCH));
    expect(result.durationMs).toBe(mp3DurationMs(FRENCH));
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("is named deepgram and gives the voice of each language", () => {
    const provider = deepgramWith(mockFetch());
    expect(provider.name).toBe("deepgram");
    expect(provider.voiceFor("fr")).toBe("aura-2-agathe-fr");
    expect(provider.voiceFor("en")).toBe("aura-2-thalia-en");
  });

  it("uses the English voice for English text", async () => {
    const fetchMock = mockFetch(async () => audioReply(ENGLISH));
    const result = await deepgramWith(fetchMock).synthesize(say("The apple falls.", "en"));
    expect(urlOf(fetchMock)).toBe(
      "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3",
    );
    expect(bodyOf(fetchMock)).toEqual({ text: "The apple falls." });
    expect(result.voice).toBe("aura-2-thalia-en");
  });

  it("encodes the voice name in the query", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    await deepgramWith(fetchMock, { voices: { fr: "a b&c=d", en: "x" } }).synthesize(say("Un."));
    expect(urlOf(fetchMock)).toBe(
      "https://api.deepgram.com/v1/speak?model=a%20b%26c%3Dd&encoding=mp3",
    );
  });

  it.each([
    [401, "unavailable"],
    [402, "unavailable"],
    [429, "rate_limited"],
    [500, "unavailable"],
  ] as const)("maps status %i to %s", async (status, code) => {
    const fetchMock = mockFetch(async () => new Response(`bad ${SECRET}`, { status }));
    const error = await failure(deepgramWith(fetchMock).synthesize(say("Bonjour.")));
    expect(error.code).toBe(code);
    expect(error.provider).toBe("deepgram");
  });

  it("rejects empty text and text over 200 characters without any network call", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const provider = deepgramWith(fetchMock);
    expect((await failure(provider.synthesize(say("   ")))).code).toBe("invalid_input");
    expect((await failure(provider.synthesize(say("")))).code).toBe("invalid_input");
    expect((await failure(provider.synthesize(say("x".repeat(201))))).code).toBe("invalid_input");
    expect(fetchMock).not.toHaveBeenCalled();
    await provider.synthesize(say("x".repeat(200)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a network failure and an unreadable answer to unavailable", async () => {
    const down = mockFetch(async () => Promise.reject(new TypeError(`fetch failed ${SECRET}`)));
    expect((await failure(deepgramWith(down).synthesize(say("Bonjour.")))).code).toBe(
      "unavailable",
    );
    const html = mockFetch(async () => new Response("<html>login</html>", { status: 200 }));
    expect((await failure(deepgramWith(html).synthesize(say("Bonjour.")))).code).toBe(
      "unavailable",
    );
  });

  it("never puts the key in an error", async () => {
    const attempts: [string, FetchMock][] = [
      ["rejected", mockFetch(async () => Promise.reject(new Error(`boom ${SECRET}`)))],
      ["401", mockFetch(async () => new Response(`key ${SECRET} rejected`, { status: 401 }))],
      ["429", mockFetch(async () => new Response(SECRET, { status: 429 }))],
      ["garbage", mockFetch(async () => new Response(SECRET, { status: 200 }))],
    ];
    for (const [label, fetchMock] of attempts) {
      const error = await failure(deepgramWith(fetchMock).synthesize(say("Bonjour.")));
      const printed = [error.message, error.stack, String(error), JSON.stringify(error)].join("|");
      expect(printed, label).not.toContain(SECRET);
      expect(error.cause, label).toBeUndefined();
    }

    const slow = mockFetch((_url, init) => abortable(init, () => audioReply(), 1_000));
    const timeout = await failure(deepgramWith(slow, { timeoutMs: 10 }).synthesize(say("Un.")));
    expect(timeout.code).toBe("timeout");
    expect([timeout.message, timeout.stack, String(timeout)].join("|")).not.toContain(SECRET);

    const gate = held();
    const provider = deepgramWith(gate.fetchMock, { concurrency: 1 });
    const first = provider.synthesize(say("Un."));
    await until(() => gate.releases.length === 1);
    const controller = new AbortController();
    const waiting = failure(provider.synthesize({ ...say("Deux."), signal: controller.signal }));
    controller.abort();
    const cancelled = await waiting;
    expect([cancelled.message, cancelled.stack, String(cancelled)].join("|")).not.toContain(SECRET);
    gate.release(0);
    await first;
  });

  describe("concurrency", () => {
    it("never has more than the allowed calls in flight and serves the others in arrival order", async () => {
      const gate = held();
      const provider = deepgramWith(gate.fetchMock, { concurrency: 2 });
      const calls = [1, 2, 3, 4, 5].map((n) => provider.synthesize(say(`Phrase ${n}.`)));
      const settled: number[] = [];
      calls.forEach((call, index) => void call.then(() => settled.push(index + 1)));

      await until(() => gate.fetchMock.mock.calls.length === 2);
      await sleep(10);
      expect(gate.fetchMock).toHaveBeenCalledTimes(2);
      expect(gate.inFlight()).toBe(2);

      gate.release(0);
      await until(() => gate.fetchMock.mock.calls.length === 3);
      expect(gate.inFlight()).toBe(2);

      gate.release(1);
      await until(() => gate.fetchMock.mock.calls.length === 4);
      gate.release(2);
      await until(() => gate.fetchMock.mock.calls.length === 5);
      gate.release(3);
      gate.release(4);

      const results = await Promise.all(calls);
      expect(results).toHaveLength(5);
      expect(results.every((result) => result.provider === "deepgram")).toBe(true);
      expect(gate.peak()).toBe(2);
      expect(
        gate.fetchMock.mock.calls.map((_call, index) => bodyOf(gate.fetchMock, index).text),
      ).toEqual(["Phrase 1.", "Phrase 2.", "Phrase 3.", "Phrase 4.", "Phrase 5."]);
      expect(settled).toEqual([1, 2, 3, 4, 5]);
    });

    it("allows ten calls at once by default", async () => {
      const gate = held();
      const provider = deepgramWith(gate.fetchMock);
      const calls = Array.from({ length: 12 }, (_, n) => provider.synthesize(say(`Phrase ${n}.`)));
      await until(() => gate.fetchMock.mock.calls.length === 10);
      await sleep(10);
      expect(gate.fetchMock).toHaveBeenCalledTimes(10);
      gate.release(0);
      await until(() => gate.fetchMock.mock.calls.length === 11);
      gate.releases.forEach((release) => release());
      await until(() => gate.fetchMock.mock.calls.length === 12);
      gate.releases.forEach((release) => release());
      await Promise.all(calls);
      expect(gate.peak()).toBe(10);
    });

    it("does not count the wait in the queue against the timeout", async () => {
      const fetchMock = mockFetch((_url, init) => abortable(init, () => audioReply(), 100));
      const provider = deepgramWith(fetchMock, { concurrency: 1, timeoutMs: 150 });
      const started = Date.now();
      const results = await Promise.all([
        provider.synthesize(say("Un.")),
        provider.synthesize(say("Deux.")),
      ]);
      expect(Date.now() - started).toBeGreaterThan(150);
      expect(results).toHaveLength(2);
      expect(initOf(fetchMock, 1).signal!.aborted).toBe(false);
    });

    it("still times out a request that has started", async () => {
      const fetchMock = mockFetch((_url, init) => abortable(init, () => audioReply(), 1_000));
      const error = await failure(
        deepgramWith(fetchMock, { concurrency: 1, timeoutMs: 20 }).synthesize(say("Un.")),
      );
      expect(error.code).toBe("timeout");
    });

    it("leaves the queue when cancelled while waiting and never takes a slot", async () => {
      const gate = held();
      const provider = deepgramWith(gate.fetchMock, { concurrency: 1 });
      const first = provider.synthesize(say("Un."));
      await until(() => gate.fetchMock.mock.calls.length === 1);

      const controller = new AbortController();
      const waiting = failure(provider.synthesize({ ...say("Deux."), signal: controller.signal }));
      const third = provider.synthesize(say("Trois."));
      controller.abort();

      const error = await waiting;
      expect(error.code).toBe("unavailable");
      expect(error.provider).toBe("deepgram");
      expect(error.message).toBe("The request was cancelled.");
      expect(gate.fetchMock).toHaveBeenCalledTimes(1);

      gate.release(0);
      await until(() => gate.fetchMock.mock.calls.length === 2);
      expect(bodyOf(gate.fetchMock, 1).text).toBe("Trois.");
      expect(gate.inFlight()).toBe(1);
      gate.release(1);
      await Promise.all([first, third]);

      const next = provider.synthesize(say("Quatre."));
      await until(() => gate.fetchMock.mock.calls.length === 3);
      gate.release(2);
      await next;
      expect(gate.peak()).toBe(1);
    });

    it("makes no call for a signal that is already cancelled", async () => {
      const fetchMock = mockFetch(async () => audioReply());
      const provider = deepgramWith(fetchMock, { concurrency: 1 });
      const error = await failure(
        provider.synthesize({ ...say("Un."), signal: AbortSignal.abort() }),
      );
      expect(error.code).toBe("unavailable");
      expect(error.message).toBe("The request was cancelled.");
      expect(fetchMock).not.toHaveBeenCalled();
      await provider.synthesize(say("Deux."));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("cancels a request that has started, as the other voices do", async () => {
      const fetchMock = mockFetch((_url, init) => abortable(init, () => audioReply(), 1_000));
      const controller = new AbortController();
      const call = failure(
        deepgramWith(fetchMock, { concurrency: 1 }).synthesize({
          ...say("Un."),
          signal: controller.signal,
        }),
      );
      await until(() => fetchMock.mock.calls.length === 1);
      controller.abort();
      const error = await call;
      expect(error.code).toBe("unavailable");
      expect(error.message).toBe("The request was cancelled.");
    });

    it("frees the slot after a failure", async () => {
      const replies = [new Response("", { status: 429 }), audioReply()];
      const fetchMock = mockFetch(async () => replies.shift()!);
      const provider = deepgramWith(fetchMock, { concurrency: 1 });
      const [first, second] = await Promise.allSettled([
        provider.synthesize(say("Un.")),
        provider.synthesize(say("Deux.")),
      ]);
      expect(first.status).toBe("rejected");
      expect(second.status).toBe("fulfilled");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the limit per provider instance", async () => {
      const gate = held();
      const one = deepgramWith(gate.fetchMock, { concurrency: 1 });
      const other = deepgramWith(gate.fetchMock, { concurrency: 1 });
      const calls = [one.synthesize(say("Un.")), other.synthesize(say("Deux."))];
      await until(() => gate.fetchMock.mock.calls.length === 2);
      gate.releases.forEach((release) => release());
      await Promise.all(calls);
      expect(gate.peak()).toBe(2);
    });
  });

  describe("health", () => {
    it("asks for the projects with the token and a short deadline", async () => {
      const fetchMock = mockFetch(async () => new Response("{}", { status: 200 }));
      expect(await deepgramWith(fetchMock).health()).toBe(true);
      expect(urlOf(fetchMock)).toBe("https://api.deepgram.com/v1/projects");
      const init = initOf(fetchMock);
      expect(init.headers).toEqual({ Authorization: `Token ${SECRET}` });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("is false when the key is refused or the service is down, and never throws", async () => {
      const denied = mockFetch(async () => new Response("", { status: 401 }));
      expect(await deepgramWith(denied).health()).toBe(false);
      const down = mockFetch(async () => Promise.reject(new Error("offline")));
      expect(await deepgramWith(down).health()).toBe(false);
    });
  });
});
