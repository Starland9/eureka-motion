import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChain,
  TtsError,
  type SynthesizeRequest,
  type SynthesizedAudio,
  type VoiceProvider,
} from "@/server/tts";

interface FakeProvider extends VoiceProvider {
  calls: string[];
}

function fake(name: string, fail: boolean | (() => boolean) = false): FakeProvider {
  const calls: string[] = [];
  return {
    name,
    calls,
    voiceFor: (language) => `${name}-${language}`,
    health: async () => true,
    async synthesize(request): Promise<SynthesizedAudio> {
      calls.push(request.text);
      if (typeof fail === "function" ? fail() : fail) {
        throw new TtsError("unavailable", name, "down");
      }
      return { audio: new Uint8Array([1]), durationMs: 1000, provider: name, voice: name };
    },
  };
}

const say = (text: string): SynthesizeRequest => ({ text, language: "fr" });

const pause = (ms: number) => new Promise<"waited">((resolve) => setTimeout(resolve, ms, "waited"));

interface QueueingProvider extends VoiceProvider {
  signals: AbortSignal[];
}

// Holds every call until its signal is aborted, except "fail", which fails at once.
function queueing(name: string): QueueingProvider {
  const signals: AbortSignal[] = [];
  return {
    name,
    signals,
    voiceFor: (language) => `${name}-${language}`,
    health: async () => true,
    synthesize(request): Promise<SynthesizedAudio> {
      if (request.signal) signals.push(request.signal);
      if (request.text === "fail") return Promise.reject(new TtsError("unavailable", name, "down"));
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener(
          "abort",
          () => reject(new TtsError("unavailable", name, "The request was cancelled.")),
          { once: true },
        );
      });
    },
  };
}

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("voice router", () => {
  it("gives each explanation the first voice that still has room, and keeps it", async () => {
    const time = clock();
    const deepgram = fake("deepgram");
    const assembly = fake("assemblyai");
    const pocket = fake("pocket");
    const chain = createChain([deepgram, assembly, pocket], {
      maxActive: { deepgram: 2, assemblyai: 1 },
      now: time.now,
    });

    const providers = [];
    for (const id of ["e1", "e2", "e3", "e4", "e5"]) {
      providers.push((await chain.forExplanation(id).synthesize(say(id))).provider);
    }
    expect(providers).toEqual(["deepgram", "deepgram", "assemblyai", "pocket", "pocket"]);

    expect((await chain.forExplanation("e1").synthesize(say("suite"))).provider).toBe("deepgram");
    expect((await chain.forExplanation("e3").synthesize(say("suite"))).provider).toBe("assemblyai");
  });

  it("assigns one voice to all the parallel calls of a new explanation", async () => {
    const chain = createChain([fake("deepgram"), fake("pocket")], {
      maxActive: { deepgram: 1 },
      now: clock().now,
    });
    const voice = chain.forExplanation("e1");
    const results = await Promise.all(
      ["a", "b", "c", "d"].map((text) => voice.synthesize(say(text))),
    );
    expect(results.map((result) => result.provider)).toEqual([
      "deepgram",
      "deepgram",
      "deepgram",
      "deepgram",
    ]);
    expect((await chain.forExplanation("e2").synthesize(say("x"))).provider).toBe("pocket");
  });

  it("frees a place once an explanation has been silent for 45 seconds", async () => {
    const time = clock();
    const chain = createChain([fake("assemblyai"), fake("pocket")], {
      maxActive: { assemblyai: 1 },
      now: time.now,
    });
    await chain.forExplanation("e1").synthesize(say("un"));
    time.advance(44_999);
    expect((await chain.forExplanation("e2").synthesize(say("deux"))).provider).toBe("pocket");
    time.advance(45_000);
    expect((await chain.forExplanation("e3").synthesize(say("trois"))).provider).toBe("assemblyai");
  });

  it("keeps an explanation busy while it speaks, however long it lasts", async () => {
    const time = clock();
    const chain = createChain([fake("assemblyai"), fake("pocket")], {
      maxActive: { assemblyai: 1 },
      now: time.now,
    });
    const one = chain.forExplanation("e1");
    for (let step = 0; step < 4; step += 1) {
      await one.synthesize(say(`phrase ${step}`));
      time.advance(30_000);
    }
    expect((await chain.forExplanation("e2").synthesize(say("x"))).provider).toBe("pocket");
  });

  it("keeps an explanation busy while one of its calls is still running, however long it takes", async () => {
    const time = clock();
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const base = fake("assemblyai");
    const slow: VoiceProvider = {
      ...base,
      async synthesize(request) {
        if (request.text === "longue") await hold;
        return base.synthesize(request);
      },
    };
    const chain = createChain([slow, fake("pocket")], {
      maxActive: { assemblyai: 1 },
      now: time.now,
    });

    const long = chain.forExplanation("e1").synthesize(say("longue"));
    time.advance(60_000);
    expect((await chain.forExplanation("e2").synthesize(say("x"))).provider).toBe("pocket");

    release();
    await long;
    time.advance(45_000);
    expect((await chain.forExplanation("e3").synthesize(say("y"))).provider).toBe("assemblyai");
  });

  it("stops counting a call that was cancelled", async () => {
    const time = clock();
    const base = fake("assemblyai");
    const holding: VoiceProvider = {
      ...base,
      synthesize(request) {
        if (request.text !== "attend") return base.synthesize(request);
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener(
            "abort",
            () => reject(new TtsError("unavailable", "assemblyai", "The request was cancelled.")),
            { once: true },
          );
        });
      },
    };
    const chain = createChain([holding, fake("pocket")], {
      maxActive: { assemblyai: 1 },
      now: time.now,
    });
    const controller = new AbortController();
    const cancelled = chain
      .forExplanation("e1")
      .synthesize({ ...say("attend"), signal: controller.signal })
      .catch((error: unknown) => error);
    time.advance(60_000);
    expect((await chain.forExplanation("e2").synthesize(say("ok"))).provider).toBe("pocket");

    controller.abort();
    await cancelled;
    time.advance(45_001);
    expect((await chain.forExplanation("e3").synthesize(say("ok"))).provider).toBe("assemblyai");
  });

  it("counts an explanation for the voice it fell back to", async () => {
    const time = clock();
    const chain = createChain([fake("deepgram", true), fake("assemblyai"), fake("pocket")], {
      maxActive: { deepgram: 5, assemblyai: 1 },
      now: time.now,
    });
    expect((await chain.forExplanation("e1").synthesize(say("un"))).provider).toBe("assemblyai");
    expect((await chain.forExplanation("e2").synthesize(say("deux"))).provider).toBe("pocket");
  });

  it("holds the place on the next voice before falling back, so a failing voice does not flood it", async () => {
    let deepgramUp = true;
    const chain = createChain(
      [fake("deepgram", () => !deepgramUp), fake("assemblyai"), fake("pocket")],
      { maxActive: { deepgram: 6, assemblyai: 2 }, now: clock().now },
    );
    const ids = ["e1", "e2", "e3", "e4", "e5", "e6"];
    for (const id of ids) {
      expect((await chain.forExplanation(id).synthesize(say(id))).provider).toBe("deepgram");
    }
    deepgramUp = false;

    const results = await Promise.all(
      ids.map((id) => chain.forExplanation(id).synthesize(say(`${id} suite`))),
    );
    const by = (name: string) => results.filter((result) => result.provider === name).length;
    expect(by("assemblyai")).toBe(2);
    expect(by("pocket")).toBe(4);
    expect(by("deepgram")).toBe(0);
  });

  it("keeps a call on the voice its explanation already holds, even when that voice looks full", async () => {
    const time = clock();
    let slowRelease: () => void = () => {};
    const slowHold = new Promise<void>((resolve) => (slowRelease = resolve));
    const first = fake("first", () => true);
    const slowFirst: VoiceProvider = {
      ...first,
      async synthesize(request) {
        if (request.text === "lente") await slowHold;
        return first.synthesize(request);
      },
    };
    const second = fake("second");
    const chain = createChain([slowFirst, second, fake("third")], {
      maxActive: { second: 1 },
      now: time.now,
    });

    await chain.forExplanation("e2").synthesize(say("un"));
    time.advance(50_000);

    const one = chain.forExplanation("e1");
    const slow = one.synthesize(say("lente"));
    expect((await one.synthesize(say("vite"))).provider).toBe("second");
    expect((await chain.forExplanation("e2").synthesize(say("deux"))).provider).toBe("second");
    slowRelease();
    expect((await slow).provider).toBe("second");
  });

  it("cancels the calls still waiting on a voice once their explanation has moved past it", async () => {
    const queue = queueing("queue");
    const chain = createChain([queue, fake("next")], { now: clock().now });
    const voice = chain.forExplanation("e1");

    const calls = ["a", "b", "fail"].map((text) => voice.synthesize(say(text)));
    const outcome = await Promise.race([Promise.all(calls), pause(200)]);

    expect(outcome).not.toBe("waited");
    expect((outcome as SynthesizedAudio[]).map((result) => result.provider)).toEqual([
      "next",
      "next",
      "next",
    ]);
  });

  it("cancels the waiting calls of the explanation that moved on and no other", async () => {
    const queue = queueing("queue");
    const chain = createChain([queue, fake("next")], { now: clock().now });
    const bystander = chain.forExplanation("e2").synthesize(say("attend"));
    const mover = chain.forExplanation("e1");

    const moved = await Promise.race([
      Promise.all([mover.synthesize(say("a")), mover.synthesize(say("fail"))]),
      pause(200),
    ]);

    expect(moved).not.toBe("waited");
    expect(queue.signals.map((signal) => signal.aborted)).toEqual([false, true, true]);
    expect(await Promise.race([bystander, pause(20)])).toBe("waited");
  });

  it("still passes the caller's cancellation to the voice", async () => {
    const queue = queueing("queue");
    const chain = createChain([queue, fake("next")], { now: clock().now });
    const controller = new AbortController();
    const call = chain
      .forExplanation("e1")
      .synthesize({ ...say("a"), signal: controller.signal })
      .catch((error: unknown) => error);

    controller.abort();

    expect(await call).toBeInstanceOf(TtsError);
    expect(queue.signals[0]!.aborted).toBe(true);
  });

  describe("with its own clock", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("ignores changes of the wall clock when it measures the silence", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const chain = createChain([fake("assemblyai"), fake("pocket")], {
        maxActive: { assemblyai: 1 },
      });
      await chain.forExplanation("e1").synthesize(say("un"));

      vi.setSystemTime(Date.now() + 3_600_000);

      expect((await chain.forExplanation("e2").synthesize(say("deux"))).provider).toBe("pocket");
    });
  });

  it("sends the overflow to the last voice when every limited voice is full", async () => {
    const chain = createChain([fake("deepgram"), fake("assemblyai")], {
      maxActive: { deepgram: 1, assemblyai: 1 },
      now: clock().now,
    });
    await chain.forExplanation("e1").synthesize(say("un"));
    await chain.forExplanation("e2").synthesize(say("deux"));
    expect((await chain.forExplanation("e3").synthesize(say("trois"))).provider).toBe("assemblyai");
  });

  it("names the voice a new explanation would get before it speaks", async () => {
    const chain = createChain([fake("assemblyai"), fake("pocket")], {
      maxActive: { assemblyai: 1 },
      now: clock().now,
    });
    expect(chain.forExplanation("e1").provider).toBe("assemblyai");
    await chain.forExplanation("e1").synthesize(say("un"));
    expect(chain.forExplanation("e2").provider).toBe("pocket");
  });

  it("treats a voice with no limit, or a limit of zero, as always free", async () => {
    const chain = createChain([fake("deepgram"), fake("pocket")], {
      maxActive: { deepgram: 0 },
      now: clock().now,
    });
    for (const id of ["e1", "e2", "e3"]) {
      expect((await chain.forExplanation(id).synthesize(say(id))).provider).toBe("deepgram");
    }
  });
});
