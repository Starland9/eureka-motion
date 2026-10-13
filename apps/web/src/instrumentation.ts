export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.RUN_MIGRATIONS === "off") return;
  const { runMigrations } = await import("./server/db/migrate");
  await runMigrations();
}
