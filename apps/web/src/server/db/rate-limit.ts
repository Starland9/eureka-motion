import { createHash } from "node:crypto";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import type { Database } from "./client";
import { rateLimits } from "./schema";

export type RateLimitKind = "generation" | "export";
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  check(address: string, kind: RateLimitKind): Promise<RateLimitResult>;
}

type Env = Readonly<Record<string, string | undefined>>;

export interface RateLimiterOptions {
  now?: () => Date;
  env?: Env;
}

const WINDOW_MS = 60 * 60 * 1000;

const LIMITS: Record<RateLimitKind, { variable: string; fallback: number }> = {
  generation: { variable: "RATE_LIMIT_PER_HOUR", fallback: 10 },
  export: { variable: "RATE_LIMIT_EXPORT_PER_HOUR", fallback: 5 },
};

export function rateLimitKey(address: string, kind: RateLimitKind, at: Date, salt: string): string {
  const day = at.toISOString().slice(0, 10);
  return createHash("sha256")
    .update(JSON.stringify([address, kind, day, salt]))
    .digest("hex");
}

function limitFor(kind: RateLimitKind, env: Env): number {
  const { variable, fallback } = LIMITS[kind];
  const value = Number.parseInt(env[variable] ?? "", 10);
  return value > 0 ? value : fallback;
}

export function createRateLimiter(db: Database, options: RateLimiterOptions = {}): RateLimiter {
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;
  const salt = env.RATE_LIMIT_SALT ?? "";

  return {
    async check(address, kind) {
      const at = now();
      const key = rateLimitKey(address, kind, at, salt);
      const limit = limitFor(kind, env);
      const since = new Date(at.getTime() - WINDOW_MS);

      return db.transaction(async (tx) => {
        // Serialises the calls of one key so that counting then inserting cannot interleave.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);

        const hits = await tx
          .select({ at: rateLimits.window_start, count: rateLimits.count })
          .from(rateLimits)
          .where(and(eq(rateLimits.key, key), gt(rateLimits.window_start, since)))
          .orderBy(asc(rateLimits.window_start));
        const used = hits.reduce((total, hit) => total + hit.count, 0);

        let result: RateLimitResult;
        if (used >= limit) {
          // The hits that must leave the window before one slot is free, oldest first.
          let toExpire = used - limit + 1;
          let freeAt = at.getTime();
          for (const hit of hits) {
            freeAt = hit.at.getTime() + WINDOW_MS;
            toExpire -= hit.count;
            if (toExpire <= 0) break;
          }
          result = {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((freeAt - at.getTime()) / 1000)),
          };
        } else {
          await tx
            .insert(rateLimits)
            .values({ key, window_start: at, count: 1 })
            .onConflictDoUpdate({
              target: [rateLimits.key, rateLimits.window_start],
              set: { count: sql`${rateLimits.count} + 1` },
            });
          result = { allowed: true };
        }

        await tx.delete(rateLimits).where(lte(rateLimits.window_start, since));
        return result;
      });
    },
  };
}
