import {
  assertSpeakable,
  fetchMp3,
  TtsError,
  TTS_HEALTH_TIMEOUT_MS,
  TTS_TIMEOUT_MS,
  type SynthesizeRequest,
  type SynthesizedAudio,
  type VoiceProvider,
  type Voices,
} from "./types";

export interface AssemblyAiConfig {
  apiKey: string;
  voices: Voices;
  host?: string;
  perMinute?: number;
  maxWaitMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_HOST = "https://tts.eu.assemblyai.com";
const HEALTH_URL = "https://api.assemblyai.com/v2/transcript?limit=1";
const DEFAULT_PER_MINUTE = 45;
const DEFAULT_MAX_WAIT_MS = 10_000;
const WINDOW_MS = 60_000;
const LANGUAGES = { fr: "french", en: "english" } as const;

const cancelled = () => new TtsError("unavailable", "assemblyai", "The request was cancelled.");
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A 429 would move the whole explanation to the next voice, so calls wait here for a free place.
function createLimiter(
  perMinute: number,
  maxWaitMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
) {
  const starts: number[] = [];
  const waiting: (() => void)[] = [];
  let pumping = false;

  function forget(time: number): void {
    while (starts.length > 0 && starts[0]! <= time - WINDOW_MS) starts.shift();
  }

  // Replays the queue in order to find when a call arriving now would start.
  function waitForPlace(time: number): number {
    forget(time);
    const planned = [...starts];
    let at = time;
    for (let ahead = 0; ahead <= waiting.length; ahead++) {
      if (planned.length >= perMinute) {
        at = Math.max(at, planned[planned.length - perMinute]! + WINDOW_MS);
      }
      planned.push(at);
    }
    return at - time;
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (waiting.length > 0) {
        const time = now();
        forget(time);
        if (starts.length < perMinute) {
          starts.push(time);
          waiting.shift()!();
        } else {
          await sleep(starts[0]! + WINDOW_MS - time);
        }
      }
    } finally {
      pumping = false;
    }
  }

  return async function acquire(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) throw cancelled();
    if (waitForPlace(now()) > maxWaitMs) {
      throw new TtsError(
        "rate_limited",
        "assemblyai",
        `The assemblyai voice would make this call wait over ${maxWaitMs} ms.`,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const turn = () => {
        signal?.removeEventListener("abort", leave);
        resolve();
      };
      const leave = () => {
        const position = waiting.indexOf(turn);
        if (position >= 0) waiting.splice(position, 1);
        reject(cancelled());
      };
      waiting.push(turn);
      signal?.addEventListener("abort", leave, { once: true });
      void pump();
    });
  };
}

export function createAssemblyAiProvider(config: AssemblyAiConfig): VoiceProvider {
  const send = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? TTS_TIMEOUT_MS;
  const url = `${(config.host ?? DEFAULT_HOST).replace(/\/+$/, "")}/v1/speech`;
  const acquire = createLimiter(
    config.perMinute ?? DEFAULT_PER_MINUTE,
    config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
    config.now ?? Date.now,
    config.sleep ?? realSleep,
  );

  return {
    name: "assemblyai",
    voiceFor: (language) => config.voices[language],
    async synthesize({ text, language, signal }: SynthesizeRequest): Promise<SynthesizedAudio> {
      assertSpeakable("assemblyai", text);
      const voice = config.voices[language];
      await acquire(signal);
      const { audio, durationMs } = await fetchMp3({
        provider: "assemblyai",
        send,
        url,
        init: {
          method: "POST",
          headers: { Authorization: config.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice_id: voice,
            language: LANGUAGES[language],
            encoding: "mp3",
            stream: false,
          }),
        },
        timeoutMs,
        signal,
      });
      return { audio, durationMs, provider: "assemblyai", voice };
    },
    // Listing one transcript checks the key without using the TTS quota.
    async health(): Promise<boolean> {
      try {
        const response = await send(HEALTH_URL, {
          headers: { Authorization: config.apiKey },
          signal: AbortSignal.timeout(TTS_HEALTH_TIMEOUT_MS),
        });
        await response.body?.cancel();
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
