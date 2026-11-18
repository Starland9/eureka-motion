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
  healthByProvider(): Promise<Record<string, boolean>>;
}

export interface ChainOptions {
  // Explanations a provider may voice at once; absent or 0 means no limit.
  maxActive?: Readonly<Record<string, number>>;
  now?: () => number;
}

const MAX_TRACKED_EXPLANATIONS = 500;
export const ROUTER_IDLE_MS = 45_000;

interface Assignment {
  index: number;
  lastUsed: number;
}

export function createChain(
  providers: readonly VoiceProvider[],
  options: ChainOptions = {},
): VoiceChain {
  const now = options.now ?? Date.now;
  const assignments = new Map<string, Assignment>();
  const last = providers.length - 1;

  function remember(explanationId: string, assignment: Assignment): void {
    assignments.delete(explanationId);
    assignments.set(explanationId, assignment);
    if (assignments.size > MAX_TRACKED_EXPLANATIONS) {
      assignments.delete(assignments.keys().next().value!);
    }
  }

  function isFull(index: number, explanationId: string): boolean {
    const limit = options.maxActive?.[providers[index]!.name] ?? 0;
    if (limit <= 0 || index === last) return false;
    const since = now() - ROUTER_IDLE_MS;
    let active = 0;
    for (const [id, assignment] of assignments) {
      if (id !== explanationId && assignment.index === index && assignment.lastUsed > since) {
        active += 1;
      }
    }
    return active >= limit;
  }

  function route(explanationId: string): number {
    let index = 0;
    while (index < last && isFull(index, explanationId)) index += 1;
    return index;
  }

  function advance(explanationId: string, index: number): void {
    const current = assignments.get(explanationId)?.index ?? 0;
    remember(explanationId, { index: Math.max(current, index), lastUsed: now() });
  }

  async function states(): Promise<Record<string, boolean>> {
    const results = await Promise.all(
      providers.map((provider) => provider.health().catch(() => false)),
    );
    return Object.fromEntries(providers.map((provider, index) => [provider.name, results[index]!]));
  }

  return {
    providers: providers.map((provider) => provider.name),
    forExplanation(explanationId) {
      return {
        get provider() {
          if (providers.length === 0) return null;
          const index = assignments.get(explanationId)?.index ?? route(explanationId);
          return providers[index]!.name;
        },
        async synthesize(request) {
          assertSpeakable("chain", request.text);
          if (providers.length === 0) {
            throw new TtsError("unavailable", "chain", "No voice could speak this text.");
          }
          // Assigned before any await, so parallel first calls share one voice.
          const assigned = assignments.get(explanationId);
          const start = assigned?.index ?? route(explanationId);
          remember(explanationId, { index: start, lastUsed: now() });

          for (let index = start; index < providers.length; index++) {
            if (request.signal?.aborted) break;
            if (index !== start && isFull(index, explanationId)) continue;
            try {
              const result = await providers[index]!.synthesize(request);
              advance(explanationId, index);
              return result;
            } catch (error) {
              if (error instanceof TtsError && error.code === "invalid_input") throw error;
              // Another call may already have moved past this provider.
              index = Math.max(index, (assignments.get(explanationId)?.index ?? 0) - 1);
            }
          }
          throw new TtsError("unavailable", "chain", "No voice could speak this text.");
        },
      };
    },
    async health() {
      return Object.values(await states()).some(Boolean);
    },
    healthByProvider: states,
  };
}
