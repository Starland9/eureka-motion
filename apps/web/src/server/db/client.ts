import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface Connection {
  client: postgres.Sql;
  db: Database;
}

const POOL_SIZE = 5;

export function createConnection(url: string, options: { max?: number } = {}): Connection {
  const client = postgres(url, {
    max: options.max ?? POOL_SIZE,
    idle_timeout: 20,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  return { client, db: drizzle({ client, schema }) };
}

// A global survives the module reloads of `next dev`, which would otherwise leak one pool per edit.
const shared = globalThis as typeof globalThis & { __eurekaDb?: Connection };

export function getDb(): Database {
  if (!shared.__eurekaDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    shared.__eurekaDb = createConnection(url);
  }
  return shared.__eurekaDb.db;
}

export async function closeDb(): Promise<void> {
  const connection = shared.__eurekaDb;
  shared.__eurekaDb = undefined;
  await connection?.client.end({ timeout: 5 });
}

export async function pingDb(): Promise<boolean> {
  try {
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
