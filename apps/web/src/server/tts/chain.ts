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
  slots: Map<number, Slot>;
}

// Calls of one explanation to one voice; stop is aborted when the explanation moves past it.
interface Slot {
  stop: AbortController;
  running: number;
}

export function createChain(
  providers: readonly VoiceProvider[],
  options: ChainOptions = {},
): VoiceChain {
  const now = options.now ?? Date.now;
  const assignments = new Map<string, Assignment>();
  const last = providers.length - 1;

  function entry(explanationId: string, index: number): Assignment {
    const assignment = assignments.get(explanationId) ?? { index, lastUsed: 0, slots: new Map() };
    assignment.lastUsed = now();
    assignments.delete(explanationId);
    assignments.set(explanationId, assignment);
    if (assignments.size > MAX_TRACKED_EXPLANATIONS) {
      assignments.delete(assignments.keys().next().value!);
    }
    return assignment;
  }

  function isFull(index: number, explanationId: string): boolean {
    const limit = options.maxActive?.[providers[index]!.name] ?? 0;
    if (limit <= 0 || index === last) return false;
    const since = now() - ROUTER_IDLE_MS;
    let active = 0;
    for (const [id, assignment] of assignments) {
      if (id === explanationId || assignment.index !== index) continue;
      if (assignment.lastUsed > since || (assignment.slots.get(index)?.running ?? 0) > 0) {
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
    const assignment = entry(explanationId, index);
    if (index <= assignment.index) return;
    assignment.index = index;
    for (const [held, slot] of assignment.slots) {
      if (held < index) slot.stop.abort();
    }
  }

  function slotFor(assignment: Assignment, index: number): Slot {
    let slot = assignment.slots.get(index);
    if (!slot) {
      slot = { stop: new AbortController(), running: 0 };
      assignment.slots.set(index, slot);
    }
    return slot;
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
          const assignment = entry(
            explanationId,
            assignments.get(explanationId)?.index ?? route(explanationId),
          );
          const start = assignment.index;

          for (let index = start; index < providers.length; index++) {
            if (request.signal?.aborted) break;
            if (index !== start) {
              const held = assignments.get(explanationId)?.index ?? 0;
              if (index > held && isFull(index, explanationId)) continue;
              // Reserved before the call, so parallel fallbacks do not all pick the same voice.
              advance(explanationId, index);
            }
            const slot = slotFor(assignment, index);
            slot.running += 1;
            try {
              const { signal } = request;
              const result = await providers[index]!.synthesize({
                ...request,
                signal: signal ? AbortSignal.any([signal, slot.stop.signal]) : slot.stop.signal,
              });
              advance(explanationId, index);
              return result;
            } catch (error) {
              if (error instanceof TtsError && error.code === "invalid_input") throw error;
              // Another call may already have moved past this provider.
              index = Math.max(index, (assignments.get(explanationId)?.index ?? 0) - 1);
            } finally {
              slot.running -= 1;
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
