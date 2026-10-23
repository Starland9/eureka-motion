// The reference explanations must be served even when the database cannot be reached.
const STARTUP_WAIT_MS = 10_000;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.RUN_MIGRATIONS === "off") return;
  const { runMigrations } = await import("./server/db/migrate");
  const migrations = runMigrations().catch((error: unknown) => {
    console.error("The migrations failed: the application starts without its database.", error);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, STARTUP_WAIT_MS);
  });
  try {
    await Promise.race([migrations, budget]);
  } finally {
    clearTimeout(timer);
  }
}
