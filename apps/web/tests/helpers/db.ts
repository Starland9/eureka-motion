import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createConnection, type Connection, type Database } from "@/server/db/client";

const DEFAULT_URL = "postgresql://eureka:eureka@127.0.0.1:54329/eureka_test";
const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));
const TABLES = ["explanations", "question_cache", "concept_cache", "jobs", "rate_limits"];

export interface TestDatabase {
  db: Database;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export function testDatabaseUrl(name?: string): URL {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_URL);
  if (name !== undefined) url.pathname = `/${name}`;
  if (!/^[a-z0-9_]+_test$/.test(url.pathname.slice(1))) {
    throw new Error("The test database name must end with _test: refusing to wipe it");
  }
  return url;
}

export function describeTarget(url: URL): string {
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

async function ensureDatabase(url: URL): Promise<boolean> {
  const name = url.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.href, {
    max: 1,
    connect_timeout: 3,
    onnotice: () => undefined,
  });
  try {
    const found = await admin`select 1 from pg_database where datname = ${name}`;
    if (found.length === 0) await admin.unsafe(`create database "${name}"`);
    // Test data needs no durability, and waiting for the disk makes tests time out.
    await admin.unsafe(`alter database "${name}" set synchronous_commit = off`);
    return true;
  } catch {
    return false;
  } finally {
    await admin.end({ timeout: 1 });
  }
}

// Resolves to null when PostgreSQL cannot be reached, so that the suite can skip itself.
// Test files run in parallel: each one that resets the schema needs a database of its own.
export async function openTestDatabase(name?: string): Promise<TestDatabase | null> {
  const url = testDatabaseUrl(name);
  if (!(await ensureDatabase(url))) return null;

  const connection: Connection = createConnection(url.href, { max: 10 });
  const { client, db } = connection;
  await client.unsafe(
    "set client_min_messages = warning; drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public",
  );
  await migrate(db, { migrationsFolder: MIGRATIONS });

  return {
    db,
    reset: async () => {
      await db.execute(sql.raw(`truncate ${TABLES.join(", ")} restart identity cascade`));
    },
    close: () => client.end({ timeout: 5 }),
  };
}
