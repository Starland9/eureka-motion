import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure logic by default. A test file opts into the DOM with a
    // `// @vitest-environment jsdom` comment on its first lines.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
