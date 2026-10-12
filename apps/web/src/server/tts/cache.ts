import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../media";
import { mp3DurationMs } from "./mp3";
import type { SynthesizeRequest, SynthesizedAudio, VoiceProvider } from "./types";

export const TTS_CACHE_DIRNAME = ".tts-cache";

export function cacheKey(provider: string, voice: string, language: string, text: string): string {
  return createHash("sha256").update([provider, voice, language, text].join("\0")).digest("hex");
}

export function withDiskCache(provider: VoiceProvider, directory: string): VoiceProvider {
  return {
    name: provider.name,
    voiceFor: (language) => provider.voiceFor(language),
    health: () => provider.health(),
    async synthesize(request: SynthesizeRequest): Promise<SynthesizedAudio> {
      const voice = provider.voiceFor(request.language);
      const file = path.join(
        directory,
        `${cacheKey(provider.name, voice, request.language, request.text)}.mp3`,
      );
      const stored = await readFile(file).catch(() => null);
      if (stored) {
        const audio = new Uint8Array(stored);
        const durationMs = mp3DurationMs(audio);
        if (durationMs > 0) return { audio, durationMs, provider: provider.name, voice };
      }
      const fresh = await provider.synthesize(request);
      // The cache is an optimisation: a read-only or full disk must not fail the narration.
      await writeFileAtomic(file, fresh.audio).catch(() => undefined);
      return fresh;
    },
  };
}
