import { getLlm } from "../llm";

const TTL_MS = 30_000;

let probe: { at: number; ok: Promise<boolean> } | undefined;

async function askProvider(): Promise<boolean> {
  try {
    return (await getLlm().health()).ok;
  } catch {
    return false;
  }
}

export function isGenerationAvailable(): Promise<boolean> {
  const now = Date.now();
  if (!probe || now - probe.at >= TTL_MS) probe = { at: now, ok: askProvider() };
  return probe.ok;
}

export function resetGenerationAvailability(): void {
  probe = undefined;
}
