import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isVoiceAvailable,
  resetVoiceAvailability,
  voiceStates,
} from "../../src/server/health/voice";

const chain = vi.hoisted(() => ({
  healthByProvider: vi.fn<() => Promise<Record<string, boolean>>>(),
}));

vi.mock("../../src/server/tts", () => ({ getVoice: () => chain }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  chain.healthByProvider.mockReset();
  resetVoiceAvailability();
});

afterEach(() => {
  vi.useRealTimers();
  resetVoiceAvailability();
});

describe("voiceStates", () => {
  it("returns the state of each voice", async () => {
    chain.healthByProvider.mockResolvedValue({ pocket: false, kokoro: true });
    expect(await voiceStates()).toEqual({ pocket: false, kokoro: true });
  });

  it("returns an empty record when the chain cannot answer", async () => {
    chain.healthByProvider.mockRejectedValue(new Error("no chain"));
    expect(await voiceStates()).toEqual({});
  });

  it("asks the chain once within 30 seconds and again after", async () => {
    chain.healthByProvider.mockResolvedValue({ kokoro: true });
    await voiceStates();
    vi.setSystemTime(Date.now() + 29_999);
    await voiceStates();
    expect(chain.healthByProvider).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1);
    await voiceStates();
    expect(chain.healthByProvider).toHaveBeenCalledTimes(2);
  });

  it("is cleared by resetVoiceAvailability", async () => {
    chain.healthByProvider.mockResolvedValue({ kokoro: true });
    await voiceStates();
    resetVoiceAvailability();
    await voiceStates();
    expect(chain.healthByProvider).toHaveBeenCalledTimes(2);
  });
});

describe("isVoiceAvailable", () => {
  it("is true when at least one voice answers", async () => {
    chain.healthByProvider.mockResolvedValue({ pocket: false, kokoro: true });
    expect(await isVoiceAvailable()).toBe(true);
  });

  it("is false when every voice is stopped, when none is configured, or on error", async () => {
    chain.healthByProvider.mockResolvedValue({ pocket: false, kokoro: false });
    expect(await isVoiceAvailable()).toBe(false);
    resetVoiceAvailability();
    chain.healthByProvider.mockResolvedValue({});
    expect(await isVoiceAvailable()).toBe(false);
    resetVoiceAvailability();
    chain.healthByProvider.mockRejectedValue(new Error("boom"));
    expect(await isVoiceAvailable()).toBe(false);
  });

  it("shares one probe with voiceStates", async () => {
    chain.healthByProvider.mockResolvedValue({ pocket: true });
    await voiceStates();
    await isVoiceAvailable();
    await voiceStates();
    expect(chain.healthByProvider).toHaveBeenCalledTimes(1);
  });
});
