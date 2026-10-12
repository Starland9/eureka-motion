import {
  assertSpeakable,
  TtsError,
  type SynthesizeRequest,
  type SynthesizedAudio,
  type VoiceProvider,
} from "./types";

export interface Synthesiser {
  // The provider the next call tries first, or null when no voice is configured.
  readonly provider: string | null;
  synthesize(request: SynthesizeRequest): Promise<SynthesizedAudio>;
}

export interface VoiceChain {
  readonly providers: readonly string[];
  forExplanation(explanationId: string): Synthesiser;
  health(): Promise<boolean>;
}

const MAX_TRACKED_EXPLANATIONS = 500;

export function createChain(providers: readonly VoiceProvider[]): VoiceChain {
  const position = new Map<string, number>();

  function advance(explanationId: string, index: number): void {
    const current = position.get(explanationId) ?? 0;
    position.delete(explanationId);
    position.set(explanationId, Math.max(current, index));
    if (position.size > MAX_TRACKED_EXPLANATIONS) {
      position.delete(position.keys().next().value!);
    }
  }

  return {
    providers: providers.map((provider) => provider.name),
    forExplanation(explanationId) {
      return {
        get provider() {
          return providers[position.get(explanationId) ?? 0]?.name ?? null;
        },
        async synthesize(request) {
          assertSpeakable("chain", request.text);
          for (let index = position.get(explanationId) ?? 0; index < providers.length; index++) {
            if (request.signal?.aborted) break;
            try {
              const result = await providers[index]!.synthesize(request);
              advance(explanationId, index);
              return result;
            } catch (error) {
              if (error instanceof TtsError && error.code === "invalid_input") throw error;
              // Another call may already have moved past this provider.
              index = Math.max(index, (position.get(explanationId) ?? 0) - 1);
            }
          }
          throw new TtsError("unavailable", "chain", "No voice could speak this text.");
        },
      };
    },
    async health() {
      const states = await Promise.all(
        providers.map((provider) => provider.health().catch(() => false)),
      );
      return states.some(Boolean);
    },
  };
}
