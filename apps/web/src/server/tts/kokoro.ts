import { createSpeechProvider, type SpeechConfig } from "./speech";
import type { VoiceProvider } from "./types";

export type KokoroConfig = Omit<SpeechConfig, "name" | "model">;

export function createKokoroProvider(config: KokoroConfig): VoiceProvider {
  return createSpeechProvider({ ...config, name: "kokoro", model: "kokoro" });
}
