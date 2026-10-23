import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const REFERENCE_PORT = 3100;
const REFERENCE_URL = `http://localhost:${REFERENCE_PORT}`;
const REFERENCE_SPEC = "reference.spec.ts";

// next dev locks .next/dev: the two servers cannot run together, a run starts only one.
// Workers load this file without the command line, so the choice travels in the environment.
const referenceRun =
  process.env.E2E_REFERENCE === "1" ||
  process.argv.slice(2).some((argument) => argument.includes("reference"));
process.env.E2E_REFERENCE = referenceRun ? "1" : "0";

const appProjects: NonNullable<PlaywrightTestConfig["projects"]> = [
  {
    name: "desktop",
    testIgnore: REFERENCE_SPEC,
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  },
  {
    // Pixel 5 gives a mobile Chromium profile (user agent, touch, mobile viewport
    // handling); only the viewport is overridden.
    name: "phone",
    testIgnore: REFERENCE_SPEC,
    use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 }, hasTouch: true },
  },
];

const referenceProjects = appProjects.map(({ name, use }) => ({
  name: `reference-${name}`,
  testMatch: REFERENCE_SPEC,
  use: { ...use, baseURL: REFERENCE_URL },
}));

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: referenceRun ? referenceProjects : appProjects,
  webServer: referenceRun
    ? {
        command: `pnpm dev --port ${REFERENCE_PORT}`,
        url: REFERENCE_URL,
        env: {
          LLM_PROVIDER: "fixture",
          TTS_PROVIDERS: "none",
          DATABASE_URL: "postgresql://eureka:eureka@127.0.0.1:1/eureka",
        },
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : {
        command: `pnpm dev --port ${PORT}`,
        url: BASE_URL,
        env: {
          LLM_PROVIDER: "fixture",
          TTS_PROVIDERS: "none",
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
