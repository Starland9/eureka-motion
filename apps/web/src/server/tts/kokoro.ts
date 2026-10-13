import {
  assertSpeakable,
  fetchMp3,
  TTS_HEALTH_TIMEOUT_MS,
  TTS_TIMEOUT_MS,
  type SynthesizeRequest,
  type SynthesizedAudio,
  type VoiceProvider,
  type Voices,
} from "./types";

export interface KokoroConfig {
  baseUrl: string;
  apiKey?: string | undefined;
  voices: Voices;
  timeoutMs?: number;
  concurrency?: number;
  fetch?: typeof fetch;
}

// Kokoro-FastAPI runs one inference at a time: queued calls would burn their timeout waiting.
function createGate(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export function createKokoroProvider(config: KokoroConfig): VoiceProvider {
  const send = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? TTS_TIMEOUT_MS;
  const gate = createGate(config.concurrency ?? 1);
  const authorization: Record<string, string> = config.apiKey
    ? { Authorization: `Bearer ${config.apiKey}` }
    : {};

  return {
    name: "kokoro",
    voiceFor: (language) => config.voices[language],
    async synthesize({ text, language, signal }: SynthesizeRequest): Promise<SynthesizedAudio> {
      assertSpeakable("kokoro", text);
      const voice = config.voices[language];
      const { audio, durationMs } = await gate(() =>
        fetchMp3({
          provider: "kokoro",
          send,
          url: `${base}/v1/audio/speech`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authorization },
            body: JSON.stringify({
              model: "kokoro",
              input: text,
              voice,
              response_format: "mp3",
              stream: false,
            }),
          },
          timeoutMs,
          signal,
        }),
      );
      return { audio, durationMs, provider: "kokoro", voice };
    },
    async health(): Promise<boolean> {
      try {
        const response = await send(`${base}/health`, {
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
