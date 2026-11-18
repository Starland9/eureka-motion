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

export interface DeepgramConfig {
  apiKey: string;
  voices: Voices;
  host?: string;
  concurrency?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_HOST = "https://api.deepgram.com";
const DEFAULT_CONCURRENCY = 10;

const cancelled = () => new TtsError("unavailable", "deepgram", "The request was cancelled.");

// A 429 would move the whole explanation to the next voice, so calls queue here instead.
function createGate(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  async function acquire(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) throw cancelled();
    if (active < limit) {
      active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const turn = () => {
        signal?.removeEventListener("abort", leave);
        resolve();
      };
      const leave = () => {
        waiting.splice(waiting.indexOf(turn), 1);
        reject(cancelled());
      };
      waiting.push(turn);
      signal?.addEventListener("abort", leave, { once: true });
    });
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }

  return async function run<T>(signal: AbortSignal | undefined, task: () => Promise<T>) {
    await acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  };
}

export function createDeepgramProvider(config: DeepgramConfig): VoiceProvider {
  const send = config.fetch ?? fetch;
  const api = `${(config.host ?? DEFAULT_HOST).replace(/\/+$/, "")}/v1`;
  const timeoutMs = config.timeoutMs ?? TTS_TIMEOUT_MS;
  const gate = createGate(config.concurrency ?? DEFAULT_CONCURRENCY);
  const authorization = { Authorization: `Token ${config.apiKey}` };

  return {
    name: "deepgram",
    voiceFor: (language) => config.voices[language],
    async synthesize({ text, language, signal }: SynthesizeRequest): Promise<SynthesizedAudio> {
      assertSpeakable("deepgram", text);
      const voice = config.voices[language];
      const { audio, durationMs } = await gate(signal, () =>
        fetchMp3({
          provider: "deepgram",
          send,
          url: `${api}/speak?model=${encodeURIComponent(voice)}&encoding=mp3`,
          init: {
            method: "POST",
            headers: { ...authorization, "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          },
          timeoutMs,
          signal,
        }),
      );
      return { audio, durationMs, provider: "deepgram", voice };
    },
    async health(): Promise<boolean> {
      try {
        const response = await send(`${api}/projects`, {
          headers: authorization,
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
