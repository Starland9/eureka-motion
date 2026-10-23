import { voiceHealth } from "../tts";

const TTL_MS = 30_000;

let probe: { at: number; ok: Promise<boolean> } | undefined;

async function askChain(): Promise<boolean> {
  try {
    return await voiceHealth();
  } catch {
    return false;
  }
}

export function isVoiceAvailable(): Promise<boolean> {
  const now = Date.now();
  if (!probe || now - probe.at >= TTL_MS) probe = { at: now, ok: askChain() };
  return probe.ok;
}

export function resetVoiceAvailability(): void {
  probe = undefined;
}
