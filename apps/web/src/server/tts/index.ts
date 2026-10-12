import path from "node:path";
import { getMediaDir } from "../media";
import { createAzureProvider } from "./azure";
import { TTS_CACHE_DIRNAME, withDiskCache } from "./cache";
import { createChain, type VoiceChain } from "./chain";
import { createKokoroProvider } from "./kokoro";
import type { VoiceProvider } from "./types";

export * from "./types";
export { createChain, type Synthesiser, type VoiceChain } from "./chain";
export { createAzureProvider } from "./azure";
export { createKokoroProvider } from "./kokoro";
export { withDiskCache } from "./cache";
export { mp3DurationMs } from "./mp3";

type Env = Readonly<Record<string, string | undefined>>;

export interface VoiceOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_PROVIDERS = "azure,kokoro";

function providerNames(env: Env): string[] {
  const names = (env.TTS_PROVIDERS || DEFAULT_PROVIDERS)
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes("none")) return [];
  for (const name of names) {
    if (name !== "azure" && name !== "kokoro") {
      throw new Error(`Unknown voice provider "${name}" in TTS_PROVIDERS.`);
    }
  }
  return [...new Set(names)];
}

function buildProvider(name: string, env: Env, options: VoiceOptions): VoiceProvider | null {
  if (name === "azure") {
    const key = env.AZURE_SPEECH_KEY;
    if (!key) return null;
    return createAzureProvider({
      ...options,
      key,
      region: env.AZURE_SPEECH_REGION || "francecentral",
      voices: {
        fr: env.AZURE_VOICE_FR || "fr-FR-DeniseNeural",
        en: env.AZURE_VOICE_EN || "en-US-JennyNeural",
      },
    });
  }
  return createKokoroProvider({
    ...options,
    baseUrl: env.KOKORO_BASE_URL || "http://127.0.0.1:8880",
    voices: { fr: env.KOKORO_VOICE_FR || "ff_siwis", en: env.KOKORO_VOICE_EN || "af_heart" },
  });
}

export function createVoiceChain(env: Env = process.env, options: VoiceOptions = {}): VoiceChain {
  const cacheDirectory = path.join(getMediaDir(env), TTS_CACHE_DIRNAME);
  const providers = providerNames(env)
    .map((name) => buildProvider(name, env, options))
    .filter((provider): provider is VoiceProvider => provider !== null)
    .map((provider) => withDiskCache(provider, cacheDirectory));
  return createChain(providers);
}

let cached: VoiceChain | undefined;

export function getVoice(): VoiceChain {
  cached ??= createVoiceChain();
  return cached;
}

export function resetVoice(): void {
  cached = undefined;
}

export function voiceHealth(): Promise<boolean> {
  return getVoice().health();
}
