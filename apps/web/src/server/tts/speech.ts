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

export interface SpeechConfig {
  name: string;
  model: string;
  baseUrl: string;
  apiKey?: string | undefined;
  voices: Voices;
  timeoutMs?: number;
  concurrency?: number;
  fetch?: typeof fetch;
}

// These servers run one inference at a time: queued calls would burn their timeout waiting.
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

export function createSpeechProvider(config: SpeechConfig): VoiceProvider {
  const send = config.fetch ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? TTS_TIMEOUT_MS;
  const gate = createGate(config.concurrency ?? 1);
  const authorization: Record<string, string> = config.apiKey
    ? { Authorization: `Bearer ${config.apiKey}` }
    : {};

  return {
    name: config.name,
    voiceFor: (language) => config.voices[language],
    async synthesize({ text, language, signal }: SynthesizeRequest): Promise<SynthesizedAudio> {
      assertSpeakable(config.name, text);
      const voice = config.voices[language];
      const { audio, durationMs } = await gate(() =>
        fetchMp3({
          provider: config.name,
          send,
          url: `${base}/v1/audio/speech`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authorization },
            body: JSON.stringify({
              model: config.model,
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
      return { audio, durationMs, provider: config.name, voice };
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
