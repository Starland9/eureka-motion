import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createConnection } from "./client";

const ATTEMPTS = 10;
const RETRY_MS = 3000;

export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const folder =
    process.env.MIGRATIONS_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "drizzle");
  for (let attempt = 1; ; attempt += 1) {
    const connection = createConnection(url, { max: 1 });
    try {
      await migrate(connection.db, { migrationsFolder: folder });
      return;
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    } finally {
      await connection.client.end({ timeout: 5 });
    }
  }
}
