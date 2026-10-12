import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mp3DurationMs } from "@/server/tts/mp3";

const AUDIO = path.join(__dirname, "..", "fixtures", "audio");
const FIXTURES = ["kokoro-fr.mp3", "kokoro-en.mp3"];

function ffprobeDurationMs(file: string): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8" },
    );
    return Math.round(Number(out.trim()) * 1000);
  } catch {
    return null;
  }
}

const hasFfprobe = ffprobeDurationMs(path.join(AUDIO, FIXTURES[0]!)) !== null;

type Version = "mpeg1" | "mpeg2" | "mpeg25";

const VERSION_BITS: Record<Version, number> = { mpeg1: 3, mpeg2: 2, mpeg25: 0 };
const SAMPLES: Record<Version, number> = { mpeg1: 1152, mpeg2: 576, mpeg25: 576 };
const RATES: Record<Version, number[]> = {
  mpeg1: [44_100, 48_000, 32_000],
  mpeg2: [22_050, 24_000, 16_000],
  mpeg25: [11_025, 12_000, 8_000],
};
const KBPS_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const KBPS_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

interface FrameSpec {
  version: Version;
  rate: number;
  bitrateIndex: number;
  padding?: 0 | 1;
  mono?: boolean;
  layer?: number;
  tag?: string;
}

// An empty frame: a valid header followed by zeros, which is all a duration walk looks at.
function frame(spec: FrameSpec): Uint8Array {
  const { version, rate, bitrateIndex, padding = 0, mono = true, layer = 1, tag } = spec;
  const kbps = (version === "mpeg1" ? KBPS_MPEG1 : KBPS_MPEG2)[bitrateIndex]!;
  const sampleRate = RATES[version][rate]!;
  const length = Math.floor(((SAMPLES[version] / 8) * kbps * 1000) / sampleRate) + padding;
  const bytes = new Uint8Array(length);
  bytes[0] = 0xff;
  bytes[1] = 0xe0 | (VERSION_BITS[version] << 3) | (layer << 1) | 1;
  bytes[2] = (bitrateIndex << 4) | (rate << 2) | (padding << 1);
  bytes[3] = mono ? 0xc0 : 0x00;
  if (tag) {
    const sideInfo = version === "mpeg1" ? (mono ? 17 : 32) : mono ? 9 : 17;
    bytes.set(new TextEncoder().encode(tag), 4 + sideInfo);
  }
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const repeat = (bytes: Uint8Array, times: number): Uint8Array =>
  concat(...Array.from({ length: times }, () => bytes));

function id3v2(payload: Uint8Array, footer = false): Uint8Array {
  const size = payload.length;
  const header = new Uint8Array([
    0x49,
    0x44,
    0x33,
    0x04,
    0x00,
    footer ? 0x10 : 0x00,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
  return concat(header, payload, footer ? new Uint8Array(10) : new Uint8Array(0));
}

describe("mp3DurationMs on real files", () => {
  it.skipIf(!hasFfprobe)("agrees with ffprobe within 30 ms", () => {
    for (const name of FIXTURES) {
      const file = path.join(AUDIO, name);
      const expected = ffprobeDurationMs(file)!;
      const measured = mp3DurationMs(new Uint8Array(readFileSync(file)));
      expect(Math.abs(measured - expected), name).toBeLessThanOrEqual(30);
    }
  });

  it("reads Kokoro output as a whole number of 24 ms frames", () => {
    for (const name of FIXTURES) {
      const measured = mp3DurationMs(new Uint8Array(readFileSync(path.join(AUDIO, name))));
      expect(measured % 24).toBe(0);
      expect(measured).toBeGreaterThan(1_000);
    }
  });
});

describe("mp3DurationMs on built streams", () => {
  it("counts MPEG 1 frames of 1152 samples, with and without padding", () => {
    const plain = frame({ version: "mpeg1", rate: 0, bitrateIndex: 9 });
    const padded = frame({ version: "mpeg1", rate: 0, bitrateIndex: 9, padding: 1 });
    expect(plain.length).toBe(417);
    expect(padded.length).toBe(418);
    const stream = concat(repeat(concat(plain, padded), 50), plain);
    expect(mp3DurationMs(stream)).toBe(Math.round((101 * 1152 * 1000) / 44_100));
  });

  it("counts MPEG 2 frames of 576 samples", () => {
    const stream = repeat(frame({ version: "mpeg2", rate: 1, bitrateIndex: 12 }), 125);
    expect(mp3DurationMs(stream)).toBe(3_000);
  });

  it("counts MPEG 2.5 frames of 576 samples", () => {
    const stream = repeat(frame({ version: "mpeg25", rate: 2, bitrateIndex: 4 }), 100);
    expect(mp3DurationMs(stream)).toBe(7_200);
  });

  it("is exact for a variable bitrate", () => {
    const stream = concat(
      ...[2, 14, 9, 5, 11, 3, 13, 7].map((bitrateIndex) =>
        repeat(frame({ version: "mpeg1", rate: 1, bitrateIndex, mono: false }), 10),
      ),
    );
    expect(mp3DurationMs(stream)).toBe(Math.round((80 * 1152 * 1000) / 48_000));
  });

  it("skips an ID3v2 tag, with or without a footer, even if it looks like frames", () => {
    const body = repeat(frame({ version: "mpeg2", rate: 1, bitrateIndex: 12 }), 50);
    const lookalike = repeat(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), 300);
    expect(mp3DurationMs(concat(id3v2(lookalike), body))).toBe(1_200);
    expect(mp3DurationMs(concat(id3v2(lookalike, true), body))).toBe(1_200);
  });

  it("does not count the Xing or Info frame that precedes the audio", () => {
    const audio = repeat(frame({ version: "mpeg1", rate: 0, bitrateIndex: 9, mono: false }), 40);
    const expected = Math.round((40 * 1152 * 1000) / 44_100);
    for (const tag of ["Xing", "Info"]) {
      const info = frame({ version: "mpeg1", rate: 0, bitrateIndex: 9, mono: false, tag });
      expect(mp3DurationMs(concat(info, audio))).toBe(expected);
    }
  });

  it("ignores a trailing ID3v1 tag and bytes before the first frame", () => {
    const body = repeat(frame({ version: "mpeg2", rate: 1, bitrateIndex: 12 }), 50);
    const id3v1 = new Uint8Array(128);
    id3v1.set(new TextEncoder().encode("TAG"));
    const junk = new Uint8Array([0x00, 0x12, 0xff, 0x00, 0x34]);
    expect(mp3DurationMs(concat(junk, body, id3v1))).toBe(1_200);
  });

  it("does not count a frame cut short", () => {
    const one = frame({ version: "mpeg2", rate: 1, bitrateIndex: 12 });
    const stream = concat(repeat(one, 10), one.subarray(0, 100));
    expect(mp3DurationMs(stream)).toBe(240);
  });

  it("ignores Layer II frames and returns 0 for data that is not MP3", () => {
    const layer2 = repeat(frame({ version: "mpeg1", rate: 0, bitrateIndex: 9, layer: 2 }), 20);
    expect(mp3DurationMs(layer2)).toBe(0);
    expect(mp3DurationMs(new Uint8Array(0))).toBe(0);
    expect(mp3DurationMs(new TextEncoder().encode("<html>not audio</html>"))).toBe(0);
  });
});
