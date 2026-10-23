import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/health/route";
import { closeDb } from "../../src/server/db/client";
import { resetVoiceAvailability } from "../../src/server/health/voice";
import { readWorkerHealth } from "../../src/server/health/workers";
import { resetGenerationAvailability } from "../../src/server/http/availability";
import { resetLlm } from "../../src/server/llm";
import { resetVoice } from "../../src/server/tts";

const database = vi.hoisted(() => ({ ping: vi.fn<() => Promise<boolean>>() }));

vi.mock("../../src/server/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/db/client")>();
  database.ping.mockImplementation(actual.pingDb);
  return { ...actual, pingDb: database.ping };
});

const UNREACHABLE = "postgresql://eureka:eureka@127.0.0.1:1/eureka";
const STOPPED = {
  database: false,
  generation: false,
  voice: false,
  render_worker: false,
  deep_worker: false,
};

let root: string;
let mediaDir: string;
let scenarioDir: string;

function ago(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

async function writeBeat(beat: unknown): Promise<void> {
  await mkdir(path.join(mediaDir, ".health"), { recursive: true });
  await writeFile(
    path.join(mediaDir, ".health", "worker.json"),
    typeof beat === "string" ? beat : JSON.stringify(beat),
  );
}

async function health(): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await GET();
  return { response, body: (await response.json()) as Record<string, unknown> };
}

function resetProbes(): void {
  resetLlm();
  resetVoice();
  resetGenerationAvailability();
  resetVoiceAvailability();
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "health-route-"));
  scenarioDir = path.join(root, "scenarios");
  await mkdir(scenarioDir);
});

afterAll(async () => {
  await closeDb();
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  mediaDir = await mkdtemp(path.join(root, "media-"));
  vi.stubEnv("DATABASE_URL", UNREACHABLE);
  vi.stubEnv("MEDIA_DIR", mediaDir);
  vi.stubEnv("LLM_PROVIDER", "fixture");
  vi.stubEnv("LLM_FIXTURE_DIR", scenarioDir);
  vi.stubEnv("TTS_PROVIDERS", "none");
  resetProbes();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetProbes();
  await closeDb();
  await rm(path.join(scenarioDir, "recorded.json"), { force: true });
});

describe("GET /api/health with every dependency stopped", () => {
  it("answers 200 degraded: no database, no scenario, no voice, no worker file", async () => {
    const { response, body } = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ status: "degraded", checks: STOPPED });
  });

  it("lists the five checks of the contract", async () => {
    const { body } = await health();
    expect(Object.keys(body.checks as object)).toEqual([
      "database",
      "generation",
      "voice",
      "render_worker",
      "deep_worker",
    ]);
  });

  it("answers 200 even when the database URL is not set", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await closeDb();
    const { response, body } = await health();
    expect(response.status).toBe(200);
    expect((body.checks as Record<string, boolean>).database).toBe(false);
  });
});

describe("GET /api/health: database", () => {
  it("is available when the database answers", async () => {
    database.ping.mockResolvedValueOnce(true);
    const { body } = await health();
    expect((body.checks as Record<string, boolean>).database).toBe(true);
  });

  it("answers 200 without waiting for a database that never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    database.ping.mockReturnValueOnce(new Promise<boolean>(() => undefined));
    const pending = health();
    await vi.advanceTimersByTimeAsync(3_000);
    const { response, body } = await pending;
    expect(response.status).toBe(200);
    expect((body.checks as Record<string, boolean>).database).toBe(false);
  });

  it("does not throw when the ping itself fails", async () => {
    database.ping.mockRejectedValueOnce(new Error("boom"));
    const { response, body } = await health();
    expect(response.status).toBe(200);
    expect((body.checks as Record<string, boolean>).database).toBe(false);
  });
});

describe("GET /api/health: generation", () => {
  it("is available when the simulated provider has a scenario", async () => {
    await writeFile(
      path.join(scenarioDir, "recorded.json"),
      JSON.stringify({ name: "recorded", question: "gravité", steps: [] }),
    );
    const { body } = await health();
    expect((body.checks as Record<string, boolean>).generation).toBe(true);
  });

  it("is unavailable for a remote provider without a key, without any request", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("LLM_API_KEY", "");
    const { body } = await health();
    expect((body.checks as Record<string, boolean>).generation).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("asks a remote provider with a key only for its model list, never for a completion", async () => {
    const send = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("LLM_API_KEY", "sk-test");
    const { body } = await health();
    expect((body.checks as Record<string, boolean>).generation).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/models$/);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("is unavailable when the remote provider cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("LLM_API_KEY", "sk-test");
    const { response, body } = await health();
    expect(response.status).toBe(200);
    expect((body.checks as Record<string, boolean>).generation).toBe(false);
  });

  it("asks the provider once in 30 seconds across health checks", async () => {
    const send = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
    vi.stubEnv("LLM_PROVIDER", "deepseek");
    vi.stubEnv("LLM_API_KEY", "sk-test");
    await health();
    await health();
    await health();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/health: voice", () => {
  it("is available when one provider of the chain answers", async () => {
    const send = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", send);
    vi.stubEnv("TTS_PROVIDERS", "kokoro");
    vi.stubEnv("KOKORO_BASE_URL", "http://kokoro.test");
    const { body } = await health();
    expect((body.checks as Record<string, boolean>).voice).toBe(true);
    expect(send.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "http://kokoro.test/health",
    ]);
  });

  it("is unavailable when the chain is empty", async () => {
    const { body } = await health();
    expect((body.checks as Record<string, boolean>).voice).toBe(false);
  });

  it("is unavailable, without an error, when the chain cannot even be built", async () => {
    vi.stubEnv("TTS_PROVIDERS", "nonexistent");
    const { response, body } = await health();
    expect(response.status).toBe(200);
    expect((body.checks as Record<string, boolean>).voice).toBe(false);
  });

  it("asks the voice providers once in 30 seconds", async () => {
    const send = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", send);
    vi.stubEnv("TTS_PROVIDERS", "kokoro");
    vi.stubEnv("KOKORO_BASE_URL", "http://kokoro.test");
    await health();
    await health();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/health: workers", () => {
  const checks = async () => (await health()).body.checks as Record<string, boolean>;

  it("reads both workers as unavailable when the heartbeat file is missing", async () => {
    const result = await checks();
    expect(result.render_worker).toBe(false);
    expect(result.deep_worker).toBe(false);
  });

  it("reads both as available when the heartbeats are recent", async () => {
    await writeBeat({ render_at: ago(3), deep_at: ago(10) });
    const result = await checks();
    expect(result.render_worker).toBe(true);
    expect(result.deep_worker).toBe(true);
  });

  it("reads a heartbeat 61 seconds old as unavailable", async () => {
    await writeBeat({ render_at: ago(61), deep_at: ago(61) });
    const result = await checks();
    expect(result.render_worker).toBe(false);
    expect(result.deep_worker).toBe(false);
  });

  it("reads a heartbeat 59 seconds old as available", async () => {
    await writeBeat({ render_at: ago(59), deep_at: ago(59) });
    const result = await checks();
    expect(result.render_worker).toBe(true);
    expect(result.deep_worker).toBe(true);
  });

  it("judges the two heartbeats separately", async () => {
    await writeBeat({ render_at: ago(2), deep_at: ago(120) });
    expect(await checks()).toMatchObject({ render_worker: true, deep_worker: false });
    await writeBeat({ render_at: ago(120), deep_at: ago(2) });
    expect(await checks()).toMatchObject({ render_worker: false, deep_worker: true });
  });

  it("accepts epoch seconds and epoch milliseconds", async () => {
    await writeBeat({ render_at: Math.floor(Date.now() / 1000) - 5, deep_at: Date.now() - 5000 });
    expect(await checks()).toMatchObject({ render_worker: true, deep_worker: true });
    await writeBeat({
      render_at: Math.floor(Date.now() / 1000) - 90,
      deep_at: Date.now() - 90_000,
    });
    expect(await checks()).toMatchObject({ render_worker: false, deep_worker: false });
  });

  it("reads a missing or unreadable field as unavailable", async () => {
    await writeBeat({ render_at: ago(2) });
    expect(await checks()).toMatchObject({ render_worker: true, deep_worker: false });
    await writeBeat({ render_at: "yesterday", deep_at: null });
    expect(await checks()).toMatchObject({ render_worker: false, deep_worker: false });
  });

  it.each([["{ not json"], ["[]"], ["null"], ["42"], [""]])(
    "never throws on the content %j",
    async (content) => {
      await writeBeat(content);
      const { response, body } = await health();
      expect(response.status).toBe(200);
      expect(body.checks).toMatchObject({ render_worker: false, deep_worker: false });
    },
  );

  it("never throws when the heartbeat path is a directory", async () => {
    await mkdir(path.join(mediaDir, ".health", "worker.json"), { recursive: true });
    expect(await readWorkerHealth(mediaDir)).toEqual({ render_worker: false, deep_worker: false });
  });

  it("measures the age against the time it is given", async () => {
    const now = Date.parse("2026-10-23T10:00:00.000Z");
    await writeBeat({ render_at: "2026-10-23T09:59:00.000Z", deep_at: "2026-10-23T09:58:59.000Z" });
    expect(await readWorkerHealth(mediaDir, now)).toEqual({
      render_worker: true,
      deep_worker: false,
    });
  });
});

describe("GET /api/health when everything is available", () => {
  it("answers 200 ok", async () => {
    await writeFile(
      path.join(scenarioDir, "recorded.json"),
      JSON.stringify({ name: "recorded", question: "gravité", steps: [] }),
    );
    await writeBeat({ render_at: ago(1), deep_at: ago(1) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    vi.stubEnv("TTS_PROVIDERS", "kokoro");
    vi.stubEnv("KOKORO_BASE_URL", "http://kokoro.test");
    database.ping.mockResolvedValueOnce(true);
    const { response, body } = await health();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      checks: {
        database: true,
        generation: true,
        voice: true,
        render_worker: true,
        deep_worker: true,
      },
    });
  });
});
