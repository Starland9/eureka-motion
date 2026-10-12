import { and, eq } from "drizzle-orm";
import type { ExplanationCache, ExplanationKind } from "../pipeline/ports";
import type { Database } from "./client";
import { questionHash } from "./normalize";
import { conceptCache, explanations, questionCache } from "./schema";
import { notExpired, type Clock } from "./store";

const CACHEABLE_KINDS: ReadonlySet<ExplanationKind> = new Set(["initial", "reference"]);

export function createExplanationCache(db: Database, clock: Clock = {}): ExplanationCache {
  const now = clock.now ?? (() => new Date());
  return {
    async findByQuestion(question, { language, level }) {
      const [row] = await db
        .select({ id: explanations.id })
        .from(questionCache)
        .innerJoin(explanations, eq(explanations.id, questionCache.explanation_id))
        .where(
          and(
            eq(questionCache.question_hash, questionHash(question, language)),
            eq(questionCache.language, language),
            eq(questionCache.level, level),
            eq(explanations.status, "ready"),
            notExpired(now()),
          ),
        )
        .limit(1);
      return row?.id ?? null;
    },

    async findByConcept(slug, { language, level }) {
      const [row] = await db
        .select({ id: explanations.id })
        .from(conceptCache)
        .innerJoin(explanations, eq(explanations.id, conceptCache.explanation_id))
        .where(
          and(
            eq(conceptCache.concept_slug, slug),
            eq(conceptCache.language, language),
            eq(conceptCache.level, level),
            eq(explanations.status, "ready"),
            notExpired(now()),
          ),
        )
        .limit(1);
      return row?.id ?? null;
    },

    async remember(id, { question, slug, language, level }) {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ kind: explanations.kind, status: explanations.status })
          .from(explanations)
          .where(eq(explanations.id, id))
          .limit(1);
        if (!row || row.status !== "ready" || !CACHEABLE_KINDS.has(row.kind)) return;

        await tx
          .insert(questionCache)
          .values({
            question_hash: questionHash(question, language),
            language,
            level,
            explanation_id: id,
          })
          .onConflictDoUpdate({
            target: [questionCache.question_hash, questionCache.language, questionCache.level],
            set: { explanation_id: id },
          });
        await tx
          .insert(conceptCache)
          .values({ concept_slug: slug, language, level, explanation_id: id })
          .onConflictDoUpdate({
            target: [conceptCache.concept_slug, conceptCache.language, conceptCache.level],
            set: { explanation_id: id },
          });
      });
    },
  };
}
