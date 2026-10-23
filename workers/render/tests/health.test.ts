import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkerHealth } from "../../../apps/web/src/server/health/workers";
import { HEARTBEAT_INTERVAL_MS, startHealth, writeHeartbeat } from "../src/health";
import { scratchDir, waitFor } from "./helpers/support";

const T0 = new Date("2026-03-04T10:00:00.000Z");

describe("worker heartbeat", () => {
  let mediaDir: string;
  let sandboxDir: string;

  beforeEach(async () => {
    mediaDir = await scratchDir("health-media");
    sandboxDir = await scratchDir("health-sandbox");
    await mkdir(path.join(sandboxDir, "out"), { recursive: true });
  });

  afterEach(async () => {
    await Promise.all([rm(mediaDir, { recursive: true }), rm(sandboxDir, { recursive: true })]);
  });

  async function sandboxWrites(seconds: number) {
    await writeFile(path.join(sandboxDir, "out", ".heartbeat"), String(seconds));
  }

  async function content() {
    return JSON.parse(await readFile(path.join(mediaDir, ".health", "worker.json"), "utf8"));
  }

  it("beats every 15 seconds", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });

  it("writes its own time and the one of the sandbox in the form the web application reads", async () => {
    await sandboxWrites(T0.getTime() / 1000 - 5);

    await writeHeartbeat({ mediaDir, sandboxDir, now: () => T0 });

    expect(await content()).toEqual({
      render_at: "2026-03-04T10:00:00.000Z",
      deep_at: "2026-03-04T09:59:55.000Z",
    });
    expect(await readWorkerHealth(mediaDir, T0.getTime() + 10_000)).toEqual({
      render_worker: true,
      deep_worker: true,
    });
  });

  it("reports null for the sandbox when it never beat, and the web application sees it down", async () => {
    await writeHeartbeat({ mediaDir, sandboxDir, now: () => T0 });

    expect((await content()).deep_at).toBeNull();
    expect(await readWorkerHealth(mediaDir, T0.getTime())).toEqual({
      render_worker: true,
      deep_worker: false,
    });
  });

  it("reports null for an unreadable sandbox heartbeat", async () => {
    await writeFile(path.join(sandboxDir, "out", ".heartbeat"), "not a time");

    await writeHeartbeat({ mediaDir, sandboxDir, now: () => T0 });

    expect((await content()).deep_at).toBeNull();
  });

  it("copies a stale sandbox heartbeat unchanged, so the web application sees it down", async () => {
    await sandboxWrites(T0.getTime() / 1000 - 300);

    await writeHeartbeat({ mediaDir, sandboxDir, now: () => T0 });

    expect(await readWorkerHealth(mediaDir, T0.getTime())).toEqual({
      render_worker: true,
      deep_worker: false,
    });
  });

  it("is seen as down once its own beat is older than a minute", async () => {
    await writeHeartbeat({ mediaDir, sandboxDir, now: () => T0 });

    expect((await readWorkerHealth(mediaDir, T0.getTime() + 61_000)).render_worker).toBe(false);
  });

  it("writes at once, then at every interval, and leaves no temporary file", async () => {
    const health = await startHealth({ mediaDir, sandboxDir, intervalMs: 30 });
    const first = (await content()).render_at;

    const later = await waitFor(async () => {
      const current = (await content()).render_at;
      return current !== first ? current : null;
    });
    health.stop();

    expect(Date.parse(later)).toBeGreaterThan(Date.parse(first));
    expect(await readdir(path.join(mediaDir, ".health"))).toEqual(["worker.json"]);
  });

  it("stops beating when asked", async () => {
    const health = await startHealth({ mediaDir, sandboxDir, intervalMs: 20 });
    health.stop();
    const stamp = (await content()).render_at;

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect((await content()).render_at).toBe(stamp);
  });
});
