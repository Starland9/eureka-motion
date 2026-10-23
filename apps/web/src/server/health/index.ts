import { pingDb } from "../db/client";
import { isGenerationAvailable } from "../http/availability";
import { within } from "./timeout";
import { isVoiceAvailable } from "./voice";
import { readWorkerHealth, type WorkerHealth } from "./workers";

export interface HealthChecks extends WorkerHealth {
  database: boolean;
  generation: boolean;
  voice: boolean;
}

export interface Health {
  status: "ok" | "degraded";
  checks: HealthChecks;
}

async function attempt(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await within(check());
  } catch {
    return false;
  }
}

export async function checkHealth(): Promise<Health> {
  const [database, generation, voice, workers] = await Promise.all([
    attempt(pingDb),
    attempt(isGenerationAvailable),
    attempt(isVoiceAvailable),
    readWorkerHealth(),
  ]);
  const checks: HealthChecks = { database, generation, voice, ...workers };
  return { status: Object.values(checks).every(Boolean) ? "ok" : "degraded", checks };
}
