import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const HEARTBEAT_INTERVAL_MS = 15_000;

export interface HealthOptions {
  mediaDir: string;
  sandboxDir: string;
  intervalMs?: number;
  now?: () => Date;
}

export interface Health {
  stop(): void;
}

// The sandbox writes whole seconds since the epoch.
async function sandboxBeat(sandboxDir: string): Promise<string | null> {
  try {
    const value = Number(
      (await readFile(path.join(sandboxDir, "out", ".heartbeat"), "utf8")).trim(),
    );
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value > 1e11 ? value : value * 1000).toISOString();
  } catch {
    return null;
  }
}

export async function writeHeartbeat(options: HealthOptions): Promise<void> {
  const now = options.now ?? (() => new Date());
  const file = path.join(options.mediaDir, ".health", "worker.json");
  const beat = { render_at: now().toISOString(), deep_at: await sandboxBeat(options.sandboxDir) };
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(beat));
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function startHealth(options: HealthOptions): Promise<Health> {
  const beat = () =>
    writeHeartbeat(options).catch((error: unknown) => {
      console.error("The heartbeat could not be written.", error);
    });
  await beat();
  const timer = setInterval(() => void beat(), options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  return {
    stop: () => clearInterval(timer),
  };
}
