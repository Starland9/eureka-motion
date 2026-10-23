import { pingDb } from "../db/client";
import { isGenerationAvailable } from "../http/availability";
import { within } from "./timeout";
import { isVoiceAvailable, voiceStates } from "./voice";
import { readWorkerHealth, type WorkerHealth } from "./workers";

export interface HealthChecks extends WorkerHealth {
  database: boolean;
  generation: boolean;
  voice: boolean;
}

export interface Health {
  status: "ok" | "degraded";
  checks: HealthChecks;
  voices: Record<string, boolean>;
}

async function attempt(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await within(check());
  } catch {
    return false;
  }
}

async function perVoice(): Promise<Record<string, boolean>> {
  try {
    return await within(voiceStates());
  } catch {
    return {};
  }
}

export async function checkHealth(): Promise<Health> {
  const [database, generation, voice, workers, voices] = await Promise.all([
    attempt(pingDb),
    attempt(isGenerationAvailable),
    attempt(isVoiceAvailable),
    readWorkerHealth(),
    perVoice(),
  ]);
  const checks: HealthChecks = { database, generation, voice, ...workers };
  return { status: Object.values(checks).every(Boolean) ? "ok" : "degraded", checks, voices };
}
