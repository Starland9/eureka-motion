import { describe, expect, it } from "vitest";
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

function fake(name: string, fail = false): FakeProvider {
  const calls: string[] = [];
  return {
    name,
    calls,
    voiceFor: (language) => `${name}-${language}`,
    health: async () => true,
    async synthesize(request): Promise<SynthesizedAudio> {
      calls.push(request.text);
      if (fail) throw new TtsError("unavailable", name, "down");
      return { audio: new Uint8Array([1]), durationMs: 1000, provider: name, voice: name };
    },
  };
}

const say = (text: string): SynthesizeRequest => ({ text, language: "fr" });

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

  it("counts an explanation for the voice it fell back to", async () => {
    const time = clock();
    const chain = createChain([fake("deepgram", true), fake("assemblyai"), fake("pocket")], {
      maxActive: { deepgram: 5, assemblyai: 1 },
      now: time.now,
    });
    expect((await chain.forExplanation("e1").synthesize(say("un"))).provider).toBe("assemblyai");
    expect((await chain.forExplanation("e2").synthesize(say("deux"))).provider).toBe("pocket");
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
