import { rm } from "node:fs/promises";
import path from "node:path";
import { createConnection } from "../../../apps/web/src/server/db/client";
import { createJobs } from "../../../apps/web/src/server/db/jobs";
import { createProvider } from "../../../apps/web/src/server/llm";
import { isCleanupEnabled, startCleanup } from "./cleanup";
import { isDeepEnabled, startDeepLoop } from "./deep/loop";
import { createDeepRenderer } from "./deep/orchestrate";
import { createSandbox } from "./deep/sandbox";
import { startHealth } from "./health";
import { startLoop } from "./loop";
import { bundleComposition, createRenderer } from "./render";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = required("DATABASE_URL");
  const mediaDir = path.resolve(process.env.MEDIA_DIR || "./media");
  const sandboxDir = path.resolve(process.env.SANDBOX_DIR || "./sandbox");
  const referenceDir = path.resolve(process.env.REFERENCE_DIR || "../../content/reference");
  const browserExecutable = process.env.BROWSER_EXECUTABLE || undefined;

  const connection = createConnection(databaseUrl, { max: 3 });
  const jobs = createJobs(connection.db);

  const serveUrl = await bundleComposition();
  console.info("The composition is bundled.");

  const health = await startHealth({ mediaDir, sandboxDir });
  const loop = startLoop({
    db: connection.db,
    jobs,
    mediaDir,
    render: createRenderer({ serveUrl, mediaDir, referenceDir, browserExecutable }),
  });
  const deep = isDeepEnabled()
    ? startDeepLoop({
        db: connection.db,
        jobs,
        mediaDir,
        render: createDeepRenderer({
          llm: createProvider(),
          sandbox: createSandbox({ dir: sandboxDir }),
          mediaDir,
        }),
      })
    : null;
  const cleanup = isCleanupEnabled() ? startCleanup({ db: connection.db, mediaDir }) : null;
  if (!cleanup) console.info("The periodic cleanup is switched off (CLEANUP=off).");
  console.info(
    deep
      ? `Waiting for deep version jobs. Sandbox directory: ${sandboxDir}`
      : "The deep version is switched off (DEEP=off).",
  );
  console.info(`Waiting for export jobs. Media directory: ${mediaDir}`);

  let signals = 0;
  const shutdown = async (signal: NodeJS.Signals) => {
    signals += 1;
    if (signals > 1) {
      console.error(`${signal} received again: leaving without waiting for the render.`);
      process.exit(1);
    }
    console.info(`${signal} received: finishing the current render, then leaving.`);
    health.stop();
    try {
      await Promise.all([loop.stop(), deep?.stop(), cleanup?.stop()]);
      await connection.client.end({ timeout: 5 });
      await rm(serveUrl, { recursive: true, force: true });
      process.exit(0);
    } catch (error) {
      console.error("The render worker could not leave cleanly.", error);
      process.exit(1);
    }
  };
  process.on("SIGTERM", (signal) => void shutdown(signal));
  process.on("SIGINT", (signal) => void shutdown(signal));
}

main().catch((error: unknown) => {
  console.error("The render worker could not start.", error);
  process.exit(1);
});
