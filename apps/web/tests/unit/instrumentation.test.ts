import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const migrate = vi.hoisted(() => ({ runMigrations: vi.fn<() => Promise<void>>() }));

vi.mock("@/server/db/migrate", () => migrate);

const STARTUP_WAIT_MS = 10_000;

async function load() {
  return import("@/instrumentation");
}

describe("the startup hook", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RUN_MIGRATIONS", "");
    migrate.runMigrations.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs the migrations once and waits for them", async () => {
    let done = false;
    migrate.runMigrations.mockImplementation(async () => {
      await Promise.resolve();
      done = true;
    });
    await (await load()).register();
    expect(migrate.runMigrations).toHaveBeenCalledTimes(1);
    expect(done).toBe(true);
  });

  it("starts anyway when the migrations fail, and says so", async () => {
    migrate.runMigrations.mockRejectedValue(new Error("database does not exist"));
    await expect((await load()).register()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("stops waiting after the budget when the database does not answer", async () => {
    vi.useFakeTimers();
    migrate.runMigrations.mockReturnValue(new Promise<void>(() => undefined));
    const instrumentation = await load();
    let started = false;
    const registered = instrumentation.register().then(() => {
      started = true;
    });
    await vi.advanceTimersByTimeAsync(STARTUP_WAIT_MS - 1);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await registered;
    expect(started).toBe(true);
  });

  it.each([
    ["outside production", { NODE_ENV: "development" }],
    ["when switched off", { RUN_MIGRATIONS: "off" }],
    ["outside the Node.js runtime", { NEXT_RUNTIME: "edge" }],
  ])("does nothing %s", async (_name, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    await (await load()).register();
    expect(migrate.runMigrations).not.toHaveBeenCalled();
  });
});
