import path from "node:path";
import { getMediaDir } from "../media";
import { createAzureProvider } from "./azure";
import { TTS_CACHE_DIRNAME, withDiskCache } from "./cache";
import { createChain, type VoiceChain } from "./chain";
import { createKokoroProvider } from "./kokoro";
import { createPocketProvider } from "./pocket";
import type { VoiceProvider } from "./types";

export * from "./types";
export { createChain, type Synthesiser, type VoiceChain } from "./chain";
export { createAzureProvider } from "./azure";
export { createKokoroProvider } from "./kokoro";
export { createPocketProvider } from "./pocket";
export { createSpeechProvider } from "./speech";
export { withDiskCache } from "./cache";
export { mp3DurationMs } from "./mp3";

type Env = Readonly<Record<string, string | undefined>>;

export interface VoiceOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_PROVIDERS = "azure,kokoro";
const KNOWN_PROVIDERS: readonly string[] = ["azure", "kokoro", "pocket"];

function providerNames(env: Env): string[] {
  const names = (env.TTS_PROVIDERS || DEFAULT_PROVIDERS)
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes("none")) return [];
  for (const name of names) {
    if (!KNOWN_PROVIDERS.includes(name)) {
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
  if (name === "pocket") {
    return createPocketProvider({
      ...options,
      baseUrl: env.POCKET_BASE_URL || "http://127.0.0.1:8890",
      voices: { fr: env.POCKET_VOICE_FR || "estelle", en: env.POCKET_VOICE_EN || "alba" },
    });
  }
  return createKokoroProvider({
    ...options,
    baseUrl: env.KOKORO_BASE_URL || "http://127.0.0.1:8880",
    apiKey: env.KOKORO_API_KEY || undefined,
    voices: { fr: env.KOKORO_VOICE_FR || "ff_siwis", en: env.KOKORO_VOICE_EN || "af_heart" },
  });
}

export function createVoiceProvider(
  name: string,
  env: Env = process.env,
  options: VoiceOptions = {},
): VoiceProvider | null {
  if (!KNOWN_PROVIDERS.includes(name)) throw new Error(`Unknown voice provider "${name}".`);
  return buildProvider(name, env, options);
}

export function isPocketConfigured(env: Env = process.env): boolean {
  return providerNames(env).includes("pocket");
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
