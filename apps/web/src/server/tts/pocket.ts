import { createSpeechProvider, type SpeechConfig } from "./speech";
import type { VoiceProvider } from "./types";

export type PocketConfig = Omit<SpeechConfig, "name" | "model" | "apiKey">;

export function createPocketProvider(config: PocketConfig): VoiceProvider {
  return createSpeechProvider({ ...config, name: "pocket", model: "pocket" });
}
