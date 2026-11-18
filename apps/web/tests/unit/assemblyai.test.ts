import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createAssemblyAiProvider,
  mp3DurationMs,
  TtsError,
  type SynthesizeRequest,
} from "@/server/tts";

const SECRET = "assemblyai-secret-key-0123456789";
const FRENCH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-fr.mp3"));
const ENGLISH = await readFile(path.join(__dirname, "..", "fixtures", "audio", "kokoro-en.mp3"));

type FetchMock = Mock<typeof fetch>;

const mockFetch = (implementation?: typeof fetch): FetchMock => vi.fn<typeof fetch>(implementation);
const audioReply = (bytes: Uint8Array = FRENCH, status = 200): Response =>
  new Response(new Uint8Array(bytes), { status, headers: { "content-type": "audio/mpeg" } });
const initOf = (mock: FetchMock, call = 0): RequestInit => mock.mock.calls[call]![1]!;
const urlOf = (mock: FetchMock, call = 0): string => String(mock.mock.calls[call]![0]);
const bodyOf = (
  mock: FetchMock,
  call = 0,
): { text: string; voice_id: string; language: string; encoding: string; stream: boolean } =>
  JSON.parse(initOf(mock, call).body as string) as ReturnType<typeof bodyOf>;

const voices = { fr: "aai-donatien", en: "aai-kyla" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HOUR_MS = 3_600_000;

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await sleep(1);
  expect(condition()).toBe(true);
}

function fakeClock(origin = 1_000_000) {
  let time = origin;
  const waiting: (() => void)[] = [];
  const slept: number[] = [];
  return {
    now: () => time,
    sleep: (ms: number) => {
      slept.push(ms);
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
    slept,
    elapsed: () => time - origin,
    pendingSleeps: () => waiting.length,
    advance(ms: number) {
      time += ms;
      waiting.splice(0).forEach((wake) => wake());
    },
  };
}

type Clock = ReturnType<typeof fakeClock>;

function assemblyWith(
  fetchMock: FetchMock,
  extra: {
    timeoutMs?: number;
    perMinute?: number;
    maxWaitMs?: number;
    host?: string;
    clock?: Clock;
    voices?: typeof voices;
  } = {},
) {
  const { clock, ...rest } = extra;
  return createAssemblyAiProvider({
    apiKey: SECRET,
    voices,
    fetch: fetchMock,
    ...(clock ? { now: clock.now, sleep: clock.sleep } : {}),
    maxWaitMs: HOUR_MS,
    ...rest,
  });
}

function recording(clock: Clock) {
  const starts: { at: number; text: string }[] = [];
  const fetchMock = mockFetch(async (_url, init) => {
    const { text } = JSON.parse(init!.body as string) as { text: string };
    starts.push({ at: clock.elapsed(), text });
    return audioReply();
  });
  return { fetchMock, starts };
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

function abortable(init: RequestInit | undefined, reply: () => Response, delayMs: number) {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(reply()), delayMs);
    init!.signal!.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(init!.signal!.reason);
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AssemblyAI provider", () => {
  it("posts the text as JSON to the EU speech endpoint with the raw key", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const result = await assemblyWith(fetchMock).synthesize(say("Une pomme tombe."));

    expect(urlOf(fetchMock)).toBe("https://tts.eu.assemblyai.com/v1/speech");
    const init = initOf(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: SECRET,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Une pomme tombe.",
      voice_id: "aai-donatien",
      language: "french",
      encoding: "mp3",
      stream: false,
    });
    expect(result).toMatchObject({ provider: "assemblyai", voice: "aai-donatien" });
    expect(result.audio).toEqual(new Uint8Array(FRENCH));
    expect(result.durationMs).toBe(mp3DurationMs(FRENCH));
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("is named assemblyai and gives the voice of each language", () => {
    const provider = assemblyWith(mockFetch());
    expect(provider.name).toBe("assemblyai");
    expect(provider.voiceFor("fr")).toBe("aai-donatien");
    expect(provider.voiceFor("en")).toBe("aai-kyla");
  });

  it("writes English out in full with the English voice", async () => {
    const fetchMock = mockFetch(async () => audioReply(ENGLISH));
    const result = await assemblyWith(fetchMock).synthesize(say("The apple falls.", "en"));
    expect(bodyOf(fetchMock)).toEqual({
      text: "The apple falls.",
      voice_id: "aai-kyla",
      language: "english",
      encoding: "mp3",
      stream: false,
    });
    expect(result).toMatchObject({ provider: "assemblyai", voice: "aai-kyla" });
  });

  it("uses the host it is given", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    await assemblyWith(fetchMock, { host: "https://tts.us.assemblyai.com" }).synthesize(say("Un."));
    expect(urlOf(fetchMock)).toBe("https://tts.us.assemblyai.com/v1/speech");
  });

  it("ignores a trailing slash on the host", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    await assemblyWith(fetchMock, { host: "https://tts.us.assemblyai.com/" }).synthesize(
      say("Un."),
    );
    expect(urlOf(fetchMock)).toBe("https://tts.us.assemblyai.com/v1/speech");
  });

  it.each([
    [401, "unavailable"],
    [402, "unavailable"],
    [429, "rate_limited"],
    [500, "unavailable"],
  ] as const)("maps status %i to %s", async (status, code) => {
    const fetchMock = mockFetch(
      async () =>
        new Response(JSON.stringify({ error: `bad ${SECRET}` }), {
          status,
          headers: { "content-type": "application/json", "retry-after": "12" },
        }),
    );
    const error = await failure(assemblyWith(fetchMock).synthesize(say("Bonjour.")));
    expect(error.code).toBe(code);
    expect(error.provider).toBe("assemblyai");
  });

  it("rejects empty text and text over 200 characters without any network call", async () => {
    const fetchMock = mockFetch(async () => audioReply());
    const provider = assemblyWith(fetchMock);
    expect((await failure(provider.synthesize(say("   ")))).code).toBe("invalid_input");
    expect((await failure(provider.synthesize(say("")))).code).toBe("invalid_input");
    expect((await failure(provider.synthesize(say("x".repeat(201))))).code).toBe("invalid_input");
    expect(fetchMock).not.toHaveBeenCalled();
    await provider.synthesize(say("x".repeat(200)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("takes no place in the rate limit for rejected text", async () => {
    const clock = fakeClock();
    const { fetchMock } = recording(clock);
    const provider = assemblyWith(fetchMock, { perMinute: 1, clock });
    await failure(provider.synthesize(say("")));
    await provider.synthesize(say("Un."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(clock.slept).toEqual([]);
  });

  it("maps a network failure and an unreadable answer to unavailable", async () => {
    const down = mockFetch(async () => Promise.reject(new TypeError(`fetch failed ${SECRET}`)));
    expect((await failure(assemblyWith(down).synthesize(say("Bonjour.")))).code).toBe(
      "unavailable",
    );
    const json = mockFetch(async () => new Response('{"audio":"none"}', { status: 200 }));
    expect((await failure(assemblyWith(json).synthesize(say("Bonjour.")))).code).toBe(
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
      const error = await failure(assemblyWith(fetchMock).synthesize(say("Bonjour.")));
      const printed = [error.message, error.stack, String(error), JSON.stringify(error)].join("|");
      expect(printed, label).not.toContain(SECRET);
      expect(error.cause, label).toBeUndefined();
    }

    const slow = mockFetch((_url, init) => abortable(init, () => audioReply(), 1_000));
    const timeout = await failure(assemblyWith(slow, { timeoutMs: 10 }).synthesize(say("Un.")));
    expect(timeout.code).toBe("timeout");
    expect([timeout.message, timeout.stack, String(timeout)].join("|")).not.toContain(SECRET);

    const clock = fakeClock();
    const { fetchMock } = recording(clock);
    const provider = assemblyWith(fetchMock, { perMinute: 1, clock });
    await provider.synthesize(say("Un."));
    const controller = new AbortController();
    const waiting = failure(provider.synthesize({ ...say("Deux."), signal: controller.signal }));
    await until(() => clock.pendingSleeps() === 1);
    controller.abort();
    const cancelled = await waiting;
    expect([cancelled.message, cancelled.stack, String(cancelled)].join("|")).not.toContain(SECRET);
  });

  describe("rate limit", () => {
    it("starts perMinute calls at once and holds the next until 60 s after the first start", async () => {
      const clock = fakeClock();
      const { fetchMock, starts } = recording(clock);
      const provider = assemblyWith(fetchMock, { perMinute: 2, clock });
      const calls = ["Un.", "Deux.", "Trois."].map((text) => provider.synthesize(say(text)));

      await until(() => fetchMock.mock.calls.length === 2);
      await until(() => clock.pendingSleeps() === 1);
      await sleep(10);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(clock.slept).toEqual([60_000]);

      clock.advance(59_999);
      await until(() => clock.pendingSleeps() === 1);
      await sleep(10);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(clock.slept).toEqual([60_000, 1]);

      clock.advance(1);
      await until(() => fetchMock.mock.calls.length === 3);
      const results = await Promise.all(calls);
      expect(results.every((result) => result.provider === "assemblyai")).toBe(true);
      expect(starts).toEqual([
        { at: 0, text: "Un." },
        { at: 0, text: "Deux." },
        { at: 60_000, text: "Trois." },
      ]);
    });

    it("serves the calls in arrival order", async () => {
      const clock = fakeClock();
      const { fetchMock, starts } = recording(clock);
      const provider = assemblyWith(fetchMock, { perMinute: 2, clock });
      const settled: number[] = [];
      const calls = [1, 2, 3, 4, 5].map((n) =>
        provider.synthesize(say(`Phrase ${n}.`)).then(() => settled.push(n)),
      );

      await until(() => fetchMock.mock.calls.length === 2);
      clock.advance(60_000);
      await until(() => fetchMock.mock.calls.length === 4);
      await until(() => clock.pendingSleeps() === 1);
      clock.advance(60_000);
      await Promise.all(calls);

      expect(starts.map((start) => start.text)).toEqual([
        "Phrase 1.",
        "Phrase 2.",
        "Phrase 3.",
        "Phrase 4.",
        "Phrase 5.",
      ]);
      expect(starts.map((start) => start.at)).toEqual([0, 0, 60_000, 60_000, 120_000]);
      expect(settled).toEqual([1, 2, 3, 4, 5]);
    });

    it("uses a sliding window, not a fixed minute", async () => {
      const clock = fakeClock();
      const { fetchMock, starts } = recording(clock);
      const provider = assemblyWith(fetchMock, { perMinute: 2, clock });

      await provider.synthesize(say("A."));
      clock.advance(30_000);
      await provider.synthesize(say("B."));
      const later = [provider.synthesize(say("C.")), provider.synthesize(say("D."))];

      await until(() => clock.pendingSleeps() === 1);
      expect(clock.slept).toEqual([30_000]);
      clock.advance(30_000);
      await until(() => fetchMock.mock.calls.length === 3);
      await until(() => clock.pendingSleeps() === 1);
      expect(clock.slept).toEqual([30_000, 30_000]);
      clock.advance(30_000);
      await Promise.all(later);

      expect(starts).toEqual([
        { at: 0, text: "A." },
        { at: 30_000, text: "B." },
        { at: 60_000, text: "C." },
        { at: 90_000, text: "D." },
      ]);
    });

    it("never starts more than perMinute calls in any 60 s window", async () => {
      const clock = fakeClock();
      const { fetchMock, starts } = recording(clock);
      const provider = assemblyWith(fetchMock, { perMinute: 3, clock });
      const calls: Promise<unknown>[] = [];
      for (let n = 0; n < 12; n++) {
        calls.push(provider.synthesize(say(`Phrase ${n}.`)));
        if (n % 4 === 3) {
          await sleep(10);
          clock.advance(17_000);
        }
      }
      while (starts.length < 12) {
        await sleep(5);
        clock.advance(5_000);
      }
      await Promise.all(calls);

      const times = starts.map((start) => start.at);
      for (const [index, at] of times.entries()) {
        const inWindow = times.filter((other) => other > at - 60_000 && other <= at).length;
        expect(inWindow, `start ${index} at ${at}`).toBeLessThanOrEqual(3);
      }
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "refuses a rate of %s a minute when it is built",
      (perMinute) => {
        expect(() => assemblyWith(mockFetch(), { perMinute })).toThrow(
          "AssemblyAI perMinute must be an integer of at least 1.",
        );
      },
    );

    it("allows 45 starts per minute by default", async () => {
      const clock = fakeClock();
      const { fetchMock } = recording(clock);
      const provider = assemblyWith(fetchMock, { clock });
      const calls = Array.from({ length: 46 }, (_, n) => provider.synthesize(say(`Phrase ${n}.`)));

      await until(() => fetchMock.mock.calls.length === 45);
      await until(() => clock.pendingSleeps() === 1);
      await sleep(10);
      expect(fetchMock).toHaveBeenCalledTimes(45);

      clock.advance(60_000);
      await Promise.all(calls);
      expect(fetchMock).toHaveBeenCalledTimes(46);
    });

    describe("bounded wait", () => {
      function full(extra: { maxWaitMs?: number } = {}) {
        const clock = fakeClock();
        const { fetchMock, starts } = recording(clock);
        const provider = createAssemblyAiProvider({
          apiKey: SECRET,
          voices,
          fetch: fetchMock,
          now: clock.now,
          sleep: clock.sleep,
          perMinute: 2,
          ...extra,
        });
        return { clock, fetchMock, starts, provider };
      }

      it("rejects at once with rate_limited when the place frees up in more than 10 s", async () => {
        const { clock, fetchMock, provider } = full();
        await Promise.all([provider.synthesize(say("Un.")), provider.synthesize(say("Deux."))]);

        const error = await failure(provider.synthesize(say("Trois.")));

        expect(error.code).toBe("rate_limited");
        expect(error.provider).toBe("assemblyai");
        expect(error.message).toBe("The assemblyai voice would make this call wait over 10000 ms.");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(clock.slept).toEqual([]);
      });

      it("waits as usual when the place frees up within 10 s, 10 s included", async () => {
        const { clock, starts, provider } = full();
        await Promise.all([provider.synthesize(say("Un.")), provider.synthesize(say("Deux."))]);
        clock.advance(50_000);

        const third = provider.synthesize(say("Trois."));
        await until(() => clock.pendingSleeps() === 1);
        expect(clock.slept).toEqual([10_000]);
        clock.advance(10_000);
        await third;
        expect(starts.at(-1)).toEqual({ at: 60_000, text: "Trois." });
      });

      it("counts the calls already waiting, which take the next places first", async () => {
        const { clock, fetchMock, provider } = full();
        await Promise.all([provider.synthesize(say("Un.")), provider.synthesize(say("Deux."))]);
        clock.advance(55_000);

        const waiting = [provider.synthesize(say("Trois.")), provider.synthesize(say("Quatre."))];
        const error = await failure(provider.synthesize(say("Cinq.")));
        expect(error.code).toBe("rate_limited");

        await until(() => clock.pendingSleeps() === 1);
        clock.advance(5_000);
        await Promise.all(waiting);
        expect(fetchMock).toHaveBeenCalledTimes(4);
      });

      it("takes the longest wait from maxWaitMs", async () => {
        const { clock, provider } = full({ maxWaitMs: 90_000 });
        await Promise.all([provider.synthesize(say("Un.")), provider.synthesize(say("Deux."))]);

        const third = provider.synthesize(say("Trois."));
        await until(() => clock.pendingSleeps() === 1);
        expect(clock.slept).toEqual([60_000]);
        clock.advance(60_000);
        await third;
      });
    });

    it("keeps the limit per provider instance", async () => {
      const clock = fakeClock();
      const { fetchMock } = recording(clock);
      const one = assemblyWith(fetchMock, { perMinute: 1, clock });
      const other = assemblyWith(fetchMock, { perMinute: 1, clock });
      await Promise.all([one.synthesize(say("Un.")), other.synthesize(say("Deux."))]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(clock.slept).toEqual([]);
    });

    it("waits on the real clock by default", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
      const fetchMock = mockFetch(async () => audioReply());
      const provider = createAssemblyAiProvider({
        apiKey: SECRET,
        voices,
        fetch: fetchMock,
        perMinute: 1,
        maxWaitMs: HOUR_MS,
      });
      const first = provider.synthesize(say("Un."));
      const second = provider.synthesize(say("Deux."));

      await vi.advanceTimersByTimeAsync(59_000);
      await first;
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await second;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("ignores changes of the wall clock when it measures the window", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const fetchMock = mockFetch(async () => audioReply());
      const provider = createAssemblyAiProvider({
        apiKey: SECRET,
        voices,
        fetch: fetchMock,
        perMinute: 1,
      });
      await provider.synthesize(say("Un."));

      vi.setSystemTime(Date.now() + 61_000);
      const error = await failure(provider.synthesize(say("Deux.")));

      expect(error.code).toBe("rate_limited");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not count the wait in the queue against the timeout", async () => {
      const clock = fakeClock();
      const fetchMock = mockFetch((_url, init) => abortable(init, () => audioReply(), 10));
      const provider = assemblyWith(fetchMock, { perMinute: 1, timeoutMs: 80, clock });
      const first = provider.synthesize(say("Un."));
      const second = provider.synthesize(say("Deux."));

      await first;
      await until(() => clock.pendingSleeps() === 1);
      await sleep(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      clock.advance(60_000);
      const result = await second;
      expect(result.provider).toBe("assemblyai");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(initOf(fetchMock, 1).signal!.aborted).toBe(false);
    });

    it("still times out a request that has started", async () => {
      const fetchMock = mockFetch((_url, init) => abortable(init, () => audioReply(), 1_000));
      const clock = fakeClock();
      const error = await failure(
        assemblyWith(fetchMock, { perMinute: 1, timeoutMs: 20, clock }).synthesize(say("Un.")),
      );
      expect(error.code).toBe("timeout");
    });

    it("leaves the queue when cancelled while waiting and takes no place", async () => {
      const clock = fakeClock();
      const { fetchMock, starts } = recording(clock);
      const provider = assemblyWith(fetchMock, { perMinute: 1, clock });
      await provider.synthesize(say("Un."));

      const controller = new AbortController();
      const waiting = failure(provider.synthesize({ ...say("Deux."), signal: controller.signal }));
      const third = provider.synthesize(say("Trois."));
      await until(() => clock.pendingSleeps() === 1);
      controller.abort();

      const error = await waiting;
      expect(error.code).toBe("unavailable");
      expect(error.provider).toBe("assemblyai");
      expect(error.message).toBe("The request was cancelled.");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      clock.advance(60_000);
      await third;
      expect(starts).toEqual([
        { at: 0, text: "Un." },
        { at: 60_000, text: "Trois." },
      ]);
    });

    it("lets the next call through at the right time after the only waiter left", async () => {
      const clock = fakeClock();
      const { fetchMock, starts } = recording(clock);
      const provider = assemblyWith(fetchMock, { perMinute: 1, clock });
      await provider.synthesize(say("Un."));

      const controller = new AbortController();
      const waiting = failure(provider.synthesize({ ...say("Deux."), signal: controller.signal }));
      await until(() => clock.pendingSleeps() === 1);
      controller.abort();
      await waiting;

      clock.advance(10_000);
      const next = provider.synthesize(say("Trois."));
      await sleep(10);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      clock.advance(50_000);
      await next;
      expect(starts.map((start) => start.at)).toEqual([0, 60_000]);
    });

    it("does not drop another call when a cancellation arrives after its own turn", async () => {
      const clock = fakeClock();
      const { fetchMock, starts } = recording(clock);
      const provider = assemblyWith(fetchMock, { perMinute: 1, clock });
      await provider.synthesize(say("Un."));

      const controller = new AbortController();
      vi.spyOn(controller.signal, "removeEventListener").mockImplementation(() => {});
      const second = provider.synthesize({ ...say("Deux."), signal: controller.signal }).then(
        () => undefined,
        () => undefined,
      );
      const third = provider.synthesize(say("Trois."));
      await until(() => clock.pendingSleeps() === 1);

      clock.advance(60_000);
      await until(() => fetchMock.mock.calls.length === 2);
      controller.abort();
      await second;
      await until(() => clock.pendingSleeps() === 1);
      clock.advance(60_000);

      await third;
      expect(starts.map((start) => start.text)).toEqual(["Un.", "Deux.", "Trois."]);
    });

    it("makes no call and takes no place for a signal that is already cancelled", async () => {
      const clock = fakeClock();
      const { fetchMock } = recording(clock);
      const provider = assemblyWith(fetchMock, { perMinute: 1, clock });
      const error = await failure(
        provider.synthesize({ ...say("Un."), signal: AbortSignal.abort() }),
      );
      expect(error.code).toBe("unavailable");
      expect(error.message).toBe("The request was cancelled.");
      expect(fetchMock).not.toHaveBeenCalled();

      await provider.synthesize(say("Deux."));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(clock.slept).toEqual([]);
    });

    it("cancels a request that has started, as the other voices do", async () => {
      const fetchMock = mockFetch((_url, init) => abortable(init, () => audioReply(), 1_000));
      const controller = new AbortController();
      const call = failure(
        assemblyWith(fetchMock, { clock: fakeClock() }).synthesize({
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

    it("still counts a start whose request failed", async () => {
      const clock = fakeClock();
      const replies = [new Response("", { status: 429 }), audioReply()];
      const fetchMock = mockFetch(async () => replies.shift()!);
      const provider = assemblyWith(fetchMock, { perMinute: 1, clock });
      const [first, second] = [provider.synthesize(say("Un.")), provider.synthesize(say("Deux."))];
      const firstResult = failure(first);
      await until(() => clock.pendingSleeps() === 1);
      expect((await firstResult).code).toBe("rate_limited");
      clock.advance(60_000);
      await second;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("health", () => {
    it("asks for one transcript with the key and a short deadline", async () => {
      const fetchMock = mockFetch(async () => new Response("{}", { status: 200 }));
      expect(await assemblyWith(fetchMock).health()).toBe(true);
      expect(urlOf(fetchMock)).toBe("https://api.assemblyai.com/v2/transcript?limit=1");
      const init = initOf(fetchMock);
      expect(init.method ?? "GET").toBe("GET");
      expect(init.headers).toEqual({ Authorization: SECRET });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("does not wait in the speech queue", async () => {
      const clock = fakeClock();
      const fetchMock = mockFetch(async (url) =>
        String(url).endsWith("/v1/speech") ? audioReply() : new Response("{}", { status: 200 }),
      );
      const provider = assemblyWith(fetchMock, { perMinute: 1, clock });
      await provider.synthesize(say("Un."));
      const waiting = provider.synthesize(say("Deux."));
      await until(() => clock.pendingSleeps() === 1);

      expect(await provider.health()).toBe(true);
      expect(urlOf(fetchMock, 1)).toBe("https://api.assemblyai.com/v2/transcript?limit=1");

      clock.advance(60_000);
      await waiting;
    });

    it("is false when the key is refused or the service is down, and never throws", async () => {
      const denied = mockFetch(async () => new Response("", { status: 401 }));
      expect(await assemblyWith(denied).health()).toBe(false);
      const down = mockFetch(async () => Promise.reject(new Error("offline")));
      expect(await assemblyWith(down).health()).toBe(false);
    });
  });
});
