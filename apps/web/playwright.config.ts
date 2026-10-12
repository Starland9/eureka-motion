import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

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
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // Pixel 5 gives a mobile Chromium profile (user agent, touch, mobile viewport
      // handling); only the viewport is overridden.
      name: "phone",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 }, hasTouch: true },
    },
  ],
  webServer: {
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
