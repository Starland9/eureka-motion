import type { Language } from "scene";
import { mp3DurationMs } from "./mp3";

export type TtsErrorCode = "unavailable" | "timeout" | "rate_limited" | "invalid_input";

export class TtsError extends Error {
  readonly code: TtsErrorCode;
  readonly provider: string;

  constructor(code: TtsErrorCode, provider: string, message: string) {
    super(message);
    this.name = "TtsError";
    this.code = code;
    this.provider = provider;
  }
}

export const MAX_TEXT_LENGTH = 200;
export const TTS_TIMEOUT_MS = 6_000;
export const TTS_HEALTH_TIMEOUT_MS = 4_000;

export interface SynthesizeRequest {
  text: string;
  language: Language;
  signal?: AbortSignal | undefined;
}

export interface SynthesizedAudio {
  audio: Uint8Array;
  durationMs: number;
  provider: string;
  voice: string;
}

export interface VoiceProvider {
  readonly name: string;
  voiceFor(language: Language): string;
  synthesize(request: SynthesizeRequest): Promise<SynthesizedAudio>;
  health(): Promise<boolean>;
}

export type Voices = Readonly<Record<Language, string>>;

export function assertSpeakable(provider: string, text: string): void {
  if (text.trim() === "") {
    throw new TtsError("invalid_input", provider, "The text to speak is empty.");
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new TtsError(
      "invalid_input",
      provider,
      `The text to speak is longer than ${MAX_TEXT_LENGTH} characters.`,
    );
  }
}

export interface AudioCall {
  provider: string;
  send: typeof fetch;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  signal: AbortSignal | undefined;
}

// Messages are fixed strings: neither the key nor anything the service said reaches the caller.
export async function fetchMp3(
  call: AudioCall,
): Promise<{ audio: Uint8Array; durationMs: number }> {
  const timeout = AbortSignal.timeout(call.timeoutMs);
  const signal = call.signal ? AbortSignal.any([call.signal, timeout]) : timeout;
  let response: Response;
  let body: ArrayBuffer;
  try {
    response = await call.send(call.url, { ...call.init, signal });
    body = await response.arrayBuffer();
  } catch {
    if (timeout.aborted) {
      throw new TtsError(
        "timeout",
        call.provider,
        `The ${call.provider} voice did not answer within ${call.timeoutMs} ms.`,
      );
    }
    if (call.signal?.aborted) {
      throw new TtsError("unavailable", call.provider, "The request was cancelled.");
    }
    throw new TtsError(
      "unavailable",
      call.provider,
      `The ${call.provider} voice could not be reached.`,
    );
  }

  if (response.status === 429) {
    throw new TtsError(
      "rate_limited",
      call.provider,
      `The ${call.provider} voice is rate limiting requests.`,
    );
  }
  if (!response.ok) {
    throw new TtsError(
      "unavailable",
      call.provider,
      `The ${call.provider} voice answered with status ${response.status}.`,
    );
  }
  const audio = new Uint8Array(body);
  const durationMs = mp3DurationMs(audio);
  if (durationMs <= 0) {
    throw new TtsError(
      "unavailable",
      call.provider,
      `The ${call.provider} voice sent no readable audio.`,
    );
  }
  return { audio, durationMs };
}
