import { getVoice } from "../tts";

const TTL_MS = 30_000;

type VoiceStates = Record<string, boolean>;

let probe: { at: number; states: Promise<VoiceStates> } | undefined;

async function askChain(): Promise<VoiceStates> {
  try {
    return await getVoice().healthByProvider();
  } catch {
    return {};
  }
}

// One probe feeds both the aggregate and the per-voice answer: each provider is asked once per window.
export function voiceStates(): Promise<VoiceStates> {
  const now = Date.now();
  if (!probe || now - probe.at >= TTL_MS) probe = { at: now, states: askChain() };
  return probe.states;
}

export async function isVoiceAvailable(): Promise<boolean> {
  return Object.values(await voiceStates()).some(Boolean);
}

export function resetVoiceAvailability(): void {
  probe = undefined;
}
