// Registers the jest-dom matchers (toBeInTheDocument, ...) on Vitest's `expect`.
// Importing them is harmless in the `node` environment: they only touch the DOM when called.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// React Testing Library only cleans up on its own when the test globals are enabled.
// Do it explicitly, and only in tests that opted into jsdom.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
  });
}
