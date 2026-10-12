import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { ExplanationStore } from "../pipeline/ports";
import type { Database } from "./client";
import { explanations } from "./schema";

export interface Clock {
  now?: () => Date;
}

export function notExpired(at: Date) {
  return or(isNull(explanations.expires_at), gt(explanations.expires_at, at));
}

export function createExplanationStore(db: Database, clock: Clock = {}): ExplanationStore {
  const now = clock.now ?? (() => new Date());
  return {
    async create(record) {
      await db.insert(explanations).values(record);
    },

    async update(id, patch) {
      if (Object.values(patch).every((value) => value === undefined)) return;
      await db.update(explanations).set(patch).where(eq(explanations.id, id));
    },

    async get(id) {
      const [row] = await db
        .select()
        .from(explanations)
        .where(and(eq(explanations.id, id), notExpired(now())))
        .limit(1);
      return row ?? null;
    },

    async isExpired(id) {
      const [row] = await db
        .select({ id: explanations.id })
        .from(explanations)
        .where(and(eq(explanations.id, id), lte(explanations.expires_at, now())))
        .limit(1);
      return row !== undefined;
    },

    async remove(id) {
      await db.delete(explanations).where(eq(explanations.id, id));
    },
  };
}
