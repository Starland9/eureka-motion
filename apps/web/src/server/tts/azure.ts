import type { Language } from "scene";
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

export interface AzureConfig {
  key: string;
  region: string;
  voices: Voices;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function localeOf(voice: string, language: Language): string {
  return /^([a-z]{2,3}-[A-Za-z0-9]{2,4})-/.exec(voice)?.[1] ?? language;
}

export function buildSsml(text: string, voice: string, language: Language): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xml:lang="${localeOf(voice, language)}"><voice name="${escapeXml(voice)}">` +
    `${escapeXml(text)}</voice></speak>`
  );
}

export function createAzureProvider(config: AzureConfig): VoiceProvider {
  const send = config.fetch ?? fetch;
  const host = `https://${config.region}.tts.speech.microsoft.com`;
  const timeoutMs = config.timeoutMs ?? TTS_TIMEOUT_MS;

  return {
    name: "azure",
    voiceFor: (language) => config.voices[language],
    async synthesize({ text, language, signal }: SynthesizeRequest): Promise<SynthesizedAudio> {
      assertSpeakable("azure", text);
      const voice = config.voices[language];
      const { audio, durationMs } = await fetchMp3({
        provider: "azure",
        send,
        url: `${host}/cognitiveservices/v1`,
        init: {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": config.key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
            "User-Agent": "eureka-motion",
          },
          body: buildSsml(text, voice, language),
        },
        timeoutMs,
        signal,
      });
      return { audio, durationMs, provider: "azure", voice };
    },
    async health(): Promise<boolean> {
      try {
        const response = await send(`${host}/cognitiveservices/voices/list`, {
          headers: { "Ocp-Apim-Subscription-Key": config.key },
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
