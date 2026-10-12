const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = {
  mpeg1: [44_100, 48_000, 32_000],
  mpeg2: [22_050, 24_000, 16_000],
  mpeg25: [11_025, 12_000, 8_000],
} as const;

interface FrameHeader {
  length: number;
  samples: number;
  sampleRate: number;
  tagOffset: number;
}

function id3v2Length(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const sizeBytes = [bytes[6]!, bytes[7]!, bytes[8]!, bytes[9]!];
  if (sizeBytes.some((value) => value & 0x80)) return 0;
  const size = sizeBytes.reduce((total, value) => (total << 7) | value, 0);
  const footer = bytes[5]! & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

function parseHeader(bytes: Uint8Array, at: number): FrameHeader | null {
  if (at + 4 > bytes.length) return null;
  const b1 = bytes[at + 1]!;
  const b2 = bytes[at + 2]!;
  if (bytes[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (versionBits === 1 || layerBits !== 1) return null;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;

  const mpeg1 = versionBits === 3;
  const rates = mpeg1
    ? SAMPLE_RATES.mpeg1
    : versionBits === 2
      ? SAMPLE_RATES.mpeg2
      : SAMPLE_RATES.mpeg25;
  const sampleRate = rates[rateIndex]!;
  const bitrate = (mpeg1 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES)[bitrateIndex]! * 1000;
  const samples = mpeg1 ? 1152 : 576;
  const padding = (b2 >> 1) & 1;
  const mono = bytes[at + 3]! >> 6 === 3;
  const sideInfo = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  return {
    length: Math.floor(((samples / 8) * bitrate) / sampleRate) + padding,
    samples,
    sampleRate,
    tagOffset: 4 + sideInfo,
  };
}

function isInfoFrame(bytes: Uint8Array, at: number, header: FrameHeader): boolean {
  const start = at + header.tagOffset;
  if (start + 4 > bytes.length) return false;
  const tag = String.fromCharCode(
    bytes[start]!,
    bytes[start + 1]!,
    bytes[start + 2]!,
    bytes[start + 3]!,
  );
  return tag === "Xing" || tag === "Info";
}

// Walks the frame headers, so the result is exact for constant and variable bitrates.
export function mp3DurationMs(bytes: Uint8Array): number {
  let position = id3v2Length(bytes);
  let seconds = 0;
  let locked = false;
  let first = true;

  while (position < bytes.length) {
    const header = parseHeader(bytes, position);
    const end = header ? position + header.length : 0;
    // Outside a run of frames, a header only counts if another one (or the end) follows it.
    const accepted =
      header !== null &&
      end <= bytes.length &&
      (locked || end === bytes.length || parseHeader(bytes, end) !== null);
    if (!header || !accepted) {
      locked = false;
      position += 1;
      continue;
    }
    if (!(first && isInfoFrame(bytes, position, header))) {
      seconds += header.samples / header.sampleRate;
    }
    first = false;
    locked = true;
    position = end;
  }
  return Math.round(seconds * 1000);
}
