import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createExplanationCache } from "@/server/db/cache";
import { closeDb, getDb, pingDb, type Database } from "@/server/db/client";
import { questionHash } from "@/server/db/normalize";
import { createRateLimiter, rateLimitKey } from "@/server/db/rate-limit";
import { conceptCache, explanations, jobs, questionCache, rateLimits } from "@/server/db/schema";
import { createExplanationStore } from "@/server/db/store";
import type {
  ExplanationCache,
  ExplanationRecord,
  ExplanationStore,
} from "@/server/pipeline/ports";
import { describeTarget, openTestDatabase, testDatabaseUrl } from "../helpers/db";

const database = await openTestDatabase();
const target = describeTarget(testDatabaseUrl());
if (!database) console.warn(`PostgreSQL is unreachable at ${target}: integration tests skipped`);

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const BAD_ENUM = "22P02";

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-03-04T10:00:00.000Z");
const DAY = 24 * HOUR;

interface PgError {
  code: string;
  constraint_name?: string;
}

function isPgError(value: unknown): value is PgError {
  return (
    typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
  );
}

async function rejection(statement: PromiseLike<unknown>): Promise<PgError> {
  try {
    await statement;
  } catch (error) {
    for (let cause: unknown = error; cause; cause = (cause as Error).cause) {
      if (isPgError(cause)) return cause;
    }
    throw error;
  }
  throw new Error("The database accepted a statement it should have rejected");
}

let counter = 0;

function newId(): string {
  counter += 1;
  return `exp${String(counter).padStart(9, "0")}`;
}

function record(overrides: Partial<ExplanationRecord> = {}): ExplanationRecord {
  const id = overrides.id ?? newId();
  return {
    id,
    kind: "initial",
    parent_id: null,
    root_id: id,
    focus_scene_id: null,
    question: "Je n'ai pas compris la loi de la gravité !",
    language: "fr",
    level: "lycee",
    concept_slug: "physics/universal-gravitation",
    subject: "physics",
    title: "La gravitation universelle",
    status: "ready",
    payload: {
      version: 1,
      plan: {
        objective: "Comprendre pourquoi deux masses s'attirent.",
        prerequisites: ["Force", "Masse"],
        analogy: { name: "Trampoline", mapping: "Une masse creuse la toile." },
        key_rule: { statement: "La force décroît avec le carré de la distance." },
        steps: [{ role: "hook", intent: "Poser la question", visual: "Une pomme qui tombe" }],
      },
      params: [
        {
          id: "m1",
          symbol: "m₁",
          label: "Masse",
          unit: "kg",
          min: 1,
          max: 100,
          step: 1,
          default: 10,
          role: "quantity",
        },
      ],
      model: {
        constants: [{ id: "G", value: 6.674e-11, unit: "N m2 kg-2", label: "Constante" }],
        derived: [{ id: "F", expr: "G * m1 / 4", unit: "N", label: "Force", format: "sci:2" }],
      },
      scenes: [],
      quiz: {
        questions: [
          {
            prompt: "Que devient la force si la distance double ?",
            choices: [
              { id: "a", text: "Elle double" },
              { id: "b", text: "Elle est divisée par quatre" },
              { id: "c", text: "Elle ne change pas" },
            ],
            answer_id: "b",
            explanation: "La force varie comme l'inverse du carré de la distance.",
            scene_id: "s1",
          },
          {
            prompt: "Quelle grandeur mesure la quantité de matière ?",
            choices: [
              { id: "a", text: "La masse" },
              { id: "b", text: "La vitesse" },
              { id: "c", text: "La couleur" },
            ],
            answer_id: "a",
            explanation: "La masse mesure la quantité de matière.",
            scene_id: "s1",
          },
        ],
      },
    },
    verdicts: [
      {
        target: "plan",
        status: "validated",
        attempts: 1,
        reason: "Plan cohérent.",
        checks: ["schema", "model"],
      },
    ],
    scene_count_planned: 5,
    provider: "fixture",
    model: "fixture-1",
    timings: { triage: 812, total: 41_250 },
    created_at: T0,
    completed_at: new Date(T0.getTime() + 41_250),
    expires_at: new Date(Date.now() + 90 * DAY),
    ...overrides,
  };
}

function ofKind(
  kind: ExplanationRecord["kind"],
  parent: ExplanationRecord,
  overrides: Partial<ExplanationRecord> = {},
): ExplanationRecord {
  return kind === "initial" || kind === "reference"
    ? record({ kind, ...overrides })
    : child(parent, kind, overrides);
}

function child(
  parent: ExplanationRecord,
  kind: ExplanationRecord["kind"],
  overrides: Partial<ExplanationRecord> = {},
): ExplanationRecord {
  return record({
    kind,
    parent_id: parent.id,
    root_id: parent.root_id,
    scene_count_planned: 5,
    ...overrides,
  });
}

describe.skipIf(!database)(
  database ? `database ${target}` : `database (skipped: PostgreSQL unreachable at ${target})`,
  () => {
    let db: Database;
    let store: ExplanationStore;
    let cache: ExplanationCache;

    async function insert(row: ExplanationRecord): Promise<ExplanationRecord> {
      await db.insert(explanations).values(row);
      return row;
    }

    async function insertJob(
      explanationId: string,
      overrides: Partial<typeof jobs.$inferInsert> = {},
    ): Promise<typeof jobs.$inferSelect> {
      const [row] = await db
        .insert(jobs)
        .values({ type: "export", explanation_id: explanationId, ...overrides })
        .returning();
      if (!row) throw new Error("no job returned");
      return row;
    }

    beforeAll(() => {
      if (!database) return;
      db = database.db;
      store = createExplanationStore(db);
      cache = createExplanationCache(db);
    });

    beforeEach(async () => {
      await database?.reset();
    });

    afterAll(async () => {
      await database?.close();
    });

    describe("explanations constraints", () => {
      it.each(["kind", "language", "level", "subject", "status"])(
        "rejects a %s outside its enumeration",
        async (column) => {
          const bad = { ...record(), [column]: "bogus" } as never;
          expect((await rejection(db.insert(explanations).values(bad))).code).toBe(BAD_ENUM);
        },
      );

      it.each([
        ["too short", "exp00000001"],
        ["too long", "exp0000000001"],
        ["with a character unsafe in an address", "exp/0000001a"],
        ["with a space", "exp 0000001a"],
      ])("rejects an id %s", async (_label, id) => {
        const error = await rejection(db.insert(explanations).values(record({ id })));
        expect(error).toMatchObject({ code: CHECK, constraint_name: "explanations_id_format" });
      });

      it("accepts a 12-character id with letters, digits, hyphen and underscore", async () => {
        await insert(record({ id: "Ab3-_xYz9012" }));
      });

      it.each([
        ["empty", ""],
        ["501 characters", "x".repeat(501)],
      ])("rejects a question that is %s", async (_label, question) => {
        const error = await rejection(db.insert(explanations).values(record({ question })));
        expect(error).toMatchObject({
          code: CHECK,
          constraint_name: "explanations_question_length",
        });
      });

      it("accepts questions of 1 and 500 characters, counted in characters", async () => {
        await insert(record({ question: "x" }));
        await insert(record({ question: "é".repeat(500) }));
      });

      it.each([
        ["initial", 3],
        ["initial", 8],
        ["initial", 0],
        ["followup", 4],
        ["followup", 0],
        ["zoom", 4],
      ] as const)("rejects scene_count_planned for %s = %i", async (kind, count) => {
        const parent = await insert(record());
        const error = await rejection(
          db.insert(explanations).values(ofKind(kind, parent, { scene_count_planned: count })),
        );
        expect(error).toMatchObject({ code: CHECK, constraint_name: "explanations_scene_count" });
      });

      it.each([
        ["initial", 4],
        ["initial", 7],
        ["simpler", 5],
        ["followup", 1],
        ["followup", 3],
        ["zoom", 2],
      ] as const)("accepts scene_count_planned for %s = %i", async (kind, count) => {
        const parent = await insert(record());
        await insert(ofKind(kind, parent, { scene_count_planned: count }));
      });

      it("accepts an explanation whose scene count is not planned yet", async () => {
        await insert(record({ status: "triaging", scene_count_planned: null }));
      });

      it("rejects an expiry date on a reference explanation", async () => {
        const error = await rejection(
          db.insert(explanations).values(record({ kind: "reference", expires_at: T0 })),
        );
        expect(error).toMatchObject({
          code: CHECK,
          constraint_name: "explanations_reference_no_expiry",
        });
        await insert(record({ kind: "reference", expires_at: null }));
      });

      it("rejects a non-start explanation without parent", async () => {
        const error = await rejection(
          db.insert(explanations).values(record({ kind: "followup", scene_count_planned: 2 })),
        );
        expect(error).toMatchObject({
          code: CHECK,
          constraint_name: "explanations_parent_required",
        });
      });

      it("rejects a starting explanation whose root is another one", async () => {
        const other = await insert(record());
        const error = await rejection(
          db.insert(explanations).values(record({ root_id: other.id })),
        );
        expect(error).toMatchObject({
          code: CHECK,
          constraint_name: "explanations_start_is_root",
        });
      });

      it("rejects a focus scene on anything but a zoom", async () => {
        const parent = await insert(record());
        const error = await rejection(
          db.insert(explanations).values(child(parent, "simpler", { focus_scene_id: "s2" })),
        );
        expect(error).toMatchObject({
          code: CHECK,
          constraint_name: "explanations_focus_only_for_zoom",
        });
        await insert(child(parent, "zoom", { focus_scene_id: "s2", scene_count_planned: 2 }));
      });

      it("rejects a parent that does not exist", async () => {
        const parent = await insert(record());
        const error = await rejection(
          db.insert(explanations).values(child(parent, "simpler", { parent_id: "missing00000" })),
        );
        expect(error).toMatchObject({
          code: FOREIGN_KEY,
          constraint_name: "explanations_parent_id_explanations_id_fk",
        });
      });

      it("rejects a root that does not exist", async () => {
        const parent = await insert(record());
        const error = await rejection(
          db.insert(explanations).values(child(parent, "simpler", { root_id: "missing00000" })),
        );
        expect(error).toMatchObject({
          code: FOREIGN_KEY,
          constraint_name: "explanations_root_id_explanations_id_fk",
        });
      });

      it("rejects a null payload and a missing language", async () => {
        const noPayload = { ...record(), payload: null } as never;
        const noLanguage = { ...record(), language: null } as never;
        expect((await rejection(db.insert(explanations).values(noPayload))).code).toBe("23502");
        expect((await rejection(db.insert(explanations).values(noLanguage))).code).toBe("23502");
      });

      it("deletes the descendants, the jobs and the cache entries with an explanation", async () => {
        const root = await insert(record());
        const reply = await insert(child(root, "followup", { scene_count_planned: 2 }));
        await insertJob(reply.id);
        await cache.remember(root.id, {
          question: root.question,
          slug: "physics/universal-gravitation",
          language: "fr",
          level: "lycee",
        });
        await store.remove(root.id);

        for (const table of [explanations, jobs, questionCache, conceptCache]) {
          expect(await db.select().from(table)).toEqual([]);
        }
      });
    });

    describe("jobs constraints", () => {
      it.each(["type", "status"])("rejects a job %s outside its enumeration", async (column) => {
        const parent = await insert(record());
        const bad = { type: "export", explanation_id: parent.id, [column]: "bogus" } as never;
        expect((await rejection(db.insert(jobs).values(bad))).code).toBe(BAD_ENUM);
      });

      it.each([-1, 101])("rejects a progress of %i", async (progress) => {
        const parent = await insert(record());
        const error = await rejection(insertJob(parent.id, { progress }));
        expect(error).toMatchObject({ code: CHECK, constraint_name: "jobs_progress_range" });
      });

      it("accepts progress from 0 to 100", async () => {
        const parent = await insert(record());
        await insertJob(parent.id, { progress: 0, status: "succeeded" });
        await insertJob(parent.id, { progress: 100 });
      });

      it.each([
        ["deep", 4],
        ["export", 3],
        ["export", -1],
      ] as const)("rejects %s attempts = %i", async (type, attempts) => {
        const parent = await insert(record());
        const error = await rejection(insertJob(parent.id, { type, attempts }));
        expect(error).toMatchObject({ code: CHECK, constraint_name: "jobs_attempts_limit" });
      });

      it("accepts up to 3 attempts for deep and 2 for export", async () => {
        const parent = await insert(record());
        await insertJob(parent.id, { type: "deep", attempts: 3 });
        await insertJob(parent.id, { type: "export", attempts: 2 });
      });

      it("rejects a job for an explanation that does not exist", async () => {
        const error = await rejection(insertJob("missing00000"));
        expect(error).toMatchObject({
          code: FOREIGN_KEY,
          constraint_name: "jobs_explanation_id_explanations_id_fk",
        });
      });

      it("defaults to a queued job at 0 percent", async () => {
        const parent = await insert(record());
        const job = await insertJob(parent.id);
        expect(job).toMatchObject({ status: "queued", progress: 0, attempts: 0 });
      });

      it.each(["queued", "running"] as const)(
        "allows only one job per explanation and type while one is %s",
        async (status) => {
          const parent = await insert(record());
          await insertJob(parent.id, { status });
          for (const second of ["queued", "running"] as const) {
            const error = await rejection(insertJob(parent.id, { status: second }));
            expect(error).toMatchObject({
              code: UNIQUE,
              constraint_name: "jobs_one_active_per_type_idx",
            });
          }
        },
      );

      it("allows an active job of each type, and for each explanation", async () => {
        const first = await insert(record());
        const second = await insert(record());
        await insertJob(first.id, { type: "export" });
        await insertJob(first.id, { type: "deep" });
        await insertJob(second.id, { type: "export" });
      });

      it.each(["succeeded", "failed", "abandoned"] as const)(
        "allows a new job once the first one is %s",
        async (status) => {
          const parent = await insert(record());
          const first = await insertJob(parent.id, { status: "running" });
          await db.update(jobs).set({ status }).where(eq(jobs.id, first.id));
          await insertJob(parent.id);
          await insertJob(parent.id, { status: "failed" });
          await insertJob(parent.id, { status: "succeeded" });
        },
      );

      it("refuses to queue a finished job again while another one is active", async () => {
        const parent = await insert(record());
        const finished = await insertJob(parent.id, { status: "failed" });
        await insertJob(parent.id);
        const error = await rejection(
          db.update(jobs).set({ status: "queued" }).where(eq(jobs.id, finished.id)),
        );
        expect(error.code).toBe(UNIQUE);
      });
    });

    describe("cache and rate limit constraints", () => {
      const key = { language: "fr", level: "lycee" } as const;

      it("uses (hash, language, level) as the key of question_cache", async () => {
        const first = await insert(record());
        const second = await insert(record());
        const row = { question_hash: "h".repeat(64), ...key, explanation_id: first.id };
        await db.insert(questionCache).values(row);

        const duplicate = await rejection(
          db.insert(questionCache).values({ ...row, explanation_id: second.id }),
        );
        expect(duplicate).toMatchObject({
          code: UNIQUE,
          constraint_name: "question_cache_question_hash_language_level_pk",
        });

        await db.insert(questionCache).values({ ...row, language: "en" });
        await db.insert(questionCache).values({ ...row, level: "college" });
      });

      it("uses (slug, language, level) as the key of concept_cache", async () => {
        const first = await insert(record());
        const second = await insert(record());
        const row = { concept_slug: "physics/gravity", ...key, explanation_id: first.id };
        await db.insert(conceptCache).values(row);

        const duplicate = await rejection(
          db.insert(conceptCache).values({ ...row, explanation_id: second.id }),
        );
        expect(duplicate).toMatchObject({
          code: UNIQUE,
          constraint_name: "concept_cache_concept_slug_language_level_pk",
        });

        await db.insert(conceptCache).values({ ...row, language: "en" });
        await db.insert(conceptCache).values({ ...row, level: "superieur" });
      });

      it("rejects a cache entry for an explanation that does not exist", async () => {
        const question = await rejection(
          db
            .insert(questionCache)
            .values({ question_hash: "a", ...key, explanation_id: "missing00000" }),
        );
        const concept = await rejection(
          db
            .insert(conceptCache)
            .values({ concept_slug: "a/b", ...key, explanation_id: "missing00000" }),
        );
        expect(question.code).toBe(FOREIGN_KEY);
        expect(concept.code).toBe(FOREIGN_KEY);
      });

      it("rejects a language or a level outside the enumeration in a cache", async () => {
        const parent = await insert(record());
        const bad = {
          question_hash: "a",
          language: "de",
          level: "lycee",
          explanation_id: parent.id,
        };
        expect((await rejection(db.insert(questionCache).values(bad as never))).code).toBe(
          BAD_ENUM,
        );
        const worse = {
          concept_slug: "a/b",
          language: "fr",
          level: "phd",
          explanation_id: parent.id,
        };
        expect((await rejection(db.insert(conceptCache).values(worse as never))).code).toBe(
          BAD_ENUM,
        );
      });

      it("rejects a hit count that is not positive and a duplicate hit instant", async () => {
        const error = await rejection(
          db.insert(rateLimits).values({ key: "k", window_start: T0, count: 0 }),
        );
        expect(error).toMatchObject({ code: CHECK, constraint_name: "rate_limits_count_positive" });

        await db.insert(rateLimits).values({ key: "k", window_start: T0, count: 1 });
        const duplicate = await rejection(
          db.insert(rateLimits).values({ key: "k", window_start: T0, count: 1 }),
        );
        expect(duplicate.code).toBe(UNIQUE);
      });
    });

    describe("explanation store", () => {
      it("returns what was stored, JSON documents and dates included", async () => {
        const original = record();
        await store.create(original);
        expect(await store.get(original.id)).toEqual(original);
      });

      it("stores the documents as JSON objects and arrays, not as encoded strings", async () => {
        await store.create(record());
        const [row] = await db.execute<{ payload: string; verdicts: string; timings: string }>(
          sql`select jsonb_typeof(payload) as payload, jsonb_typeof(verdicts) as verdicts, jsonb_typeof(timings) as timings from explanations`,
        );
        expect(row).toEqual({ payload: "object", verdicts: "array", timings: "object" });
      });

      it("stores an explanation that is still being triaged", async () => {
        const original = record({
          status: "triaging",
          concept_slug: null,
          subject: null,
          title: null,
          scene_count_planned: null,
          completed_at: null,
          expires_at: null,
          verdicts: [],
          timings: {},
        });
        await store.create(original);
        expect(await store.get(original.id)).toEqual(original);
      });

      it("returns null for an unknown id", async () => {
        expect(await store.get("missing00000")).toBeNull();
      });

      it("applies a partial update and leaves the other fields alone", async () => {
        const original = record({ status: "streaming", completed_at: null });
        await store.create(original);
        const done = new Date(T0.getTime() + 60_000);
        await store.update(original.id, {
          status: "ready",
          completed_at: done,
          timings: { total: 60_000 },
        });
        expect(await store.get(original.id)).toEqual({
          ...original,
          status: "ready",
          completed_at: done,
          timings: { total: 60_000 },
        });
      });

      it("sets a field to null when the patch says null, and ignores undefined", async () => {
        const original = record();
        await store.create(original);
        await store.update(original.id, { title: null, concept_slug: undefined });
        expect(await store.get(original.id)).toEqual({ ...original, title: null });
      });

      it("accepts an empty patch and an unknown id", async () => {
        const original = record();
        await store.create(original);
        await store.update(original.id, {});
        await store.update(original.id, { title: undefined });
        await store.update("missing00000", { status: "failed" });
        expect(await store.get(original.id)).toEqual(original);
        expect(await store.get("missing00000")).toBeNull();
      });

      it("still enforces the constraints on an update", async () => {
        const original = record();
        await store.create(original);
        const error = await rejection(store.update(original.id, { question: "" }));
        expect(error.code).toBe(CHECK);
      });

      it("removes an explanation, and only that one", async () => {
        const kept = record();
        const removed = record();
        await store.create(kept);
        await store.create(removed);
        await store.remove(removed.id);
        await store.remove("missing00000");
        expect(await store.get(removed.id)).toBeNull();
        expect(await store.get(kept.id)).toEqual(kept);
      });

      it("hides an explanation whose expiry is past, but keeps the row", async () => {
        const original = record({ expires_at: new Date(T0.getTime() - 1) });
        await store.create(original);
        expect(await store.get(original.id)).toBeNull();
        expect(await db.select().from(explanations)).toHaveLength(1);
      });

      it("compares the expiry with the clock it is given", async () => {
        const original = record({ expires_at: T0 });
        await store.create(original);
        const at = (offset: number) =>
          createExplanationStore(db, { now: () => new Date(T0.getTime() + offset) });
        expect(await at(-1).get(original.id)).toEqual(original);
        expect(await at(0).get(original.id)).toBeNull();
        expect(await at(1).get(original.id)).toBeNull();
      });

      it("never expires a reference explanation", async () => {
        const original = record({ kind: "reference", expires_at: null });
        await store.create(original);
        const later = createExplanationStore(db, { now: () => new Date(T0.getTime() + 900 * DAY) });
        expect(await later.get(original.id)).toEqual(original);
      });

      it("lists the explanations of one session, oldest first, and no other session", async () => {
        const root = record({ created_at: T0 });
        const other = record({ created_at: T0 });
        const second = child(root, "simpler", { created_at: new Date(T0.getTime() + 2_000) });
        const first = child(root, "another_analogy", {
          created_at: new Date(T0.getTime() + 1_000),
        });
        const stranger = child(other, "simpler", { created_at: new Date(T0.getTime() + 500) });
        for (const item of [root, other, second, first, stranger]) await store.create(item);

        const listed = await store.listByRoot(root.id);
        expect(listed.map((item) => item.id)).toEqual([root.id, first.id, second.id]);
        expect((await store.listByRoot(other.id)).map((item) => item.id)).toEqual([
          other.id,
          stranger.id,
        ]);
        expect(await store.listByRoot("unknownroot")).toEqual([]);
      });

      it("leaves the expired explanations out of the list of a session", async () => {
        const root = record({ created_at: T0, expires_at: null });
        const alive = child(root, "simpler", { created_at: new Date(T0.getTime() + 1_000) });
        const expired = child(root, "zoom", {
          focus_scene_id: "s1",
          scene_count_planned: 2,
          created_at: new Date(T0.getTime() + 2_000),
          expires_at: new Date(Date.now() - DAY),
        });
        for (const item of [root, alive, expired]) await store.create(item);
        expect((await store.listByRoot(root.id)).map((item) => item.id)).toEqual([
          root.id,
          alive.id,
        ]);
      });
    });

    describe("explanation cache", () => {
      const key = { language: "fr", level: "lycee" } as const;
      const entry = (question: string, slug = "physics/universal-gravitation") => ({
        question,
        slug,
        ...key,
      });

      it("finds an explanation by question, whatever the request phrasing", async () => {
        const original = await insert(record());
        await cache.remember(original.id, entry("Je n'ai pas compris la loi de la gravité !"));
        expect(await cache.findByQuestion("la loi de la gravité", key)).toBe(original.id);
        expect(await cache.findByQuestion("Explique-moi la loi de la gravité, stp", key)).toBe(
          original.id,
        );
        expect(await cache.findByQuestion("la loi de la gravitation", key)).toBeNull();
      });

      it("finds an explanation by concept", async () => {
        const original = await insert(record());
        await cache.remember(original.id, entry("la gravité"));
        expect(await cache.findByConcept("physics/universal-gravitation", key)).toBe(original.id);
        expect(await cache.findByConcept("physics/electromagnetism", key)).toBeNull();
      });

      it("keeps languages and levels apart", async () => {
        const original = await insert(record());
        await cache.remember(original.id, entry("la gravité"));
        for (const other of [
          { language: "en", level: "lycee" },
          { language: "fr", level: "college" },
          { language: "fr", level: "superieur" },
        ] as const) {
          expect(await cache.findByQuestion("la gravité", other)).toBeNull();
          expect(await cache.findByConcept("physics/universal-gravitation", other)).toBeNull();
        }
      });

      it("stores a hash of the normalised question, not the question", async () => {
        const original = await insert(record());
        await cache.remember(original.id, entry("Explique-moi la gravité !"));
        const rows = await db.select().from(questionCache);
        expect(rows).toEqual([
          { question_hash: questionHash("la gravité", "fr"), ...key, explanation_id: original.id },
        ]);
      });

      it("ignores an explanation that is no longer ready", async () => {
        const original = await insert(record());
        await cache.remember(original.id, entry("la gravité"));
        await store.update(original.id, { status: "partial" });
        expect(await cache.findByQuestion("la gravité", key)).toBeNull();
        expect(await cache.findByConcept("physics/universal-gravitation", key)).toBeNull();

        await store.update(original.id, { status: "ready" });
        expect(await cache.findByQuestion("la gravité", key)).toBe(original.id);
      });

      it("ignores an expired explanation", async () => {
        const original = await insert(record());
        await cache.remember(original.id, entry("la gravité"));
        await store.update(original.id, { expires_at: new Date(Date.now() - 1000) });
        expect(await cache.findByQuestion("la gravité", key)).toBeNull();
        expect(await cache.findByConcept("physics/universal-gravitation", key)).toBeNull();
      });

      it("compares the expiry with the clock it is given", async () => {
        const original = await insert(record({ expires_at: T0 }));
        await cache.remember(original.id, entry("la gravité"));
        const before = createExplanationCache(db, { now: () => new Date(T0.getTime() - 1) });
        const after = createExplanationCache(db, { now: () => T0 });
        expect(await before.findByQuestion("la gravité", key)).toBe(original.id);
        expect(await after.findByQuestion("la gravité", key)).toBeNull();
      });

      it.each([
        "triaging",
        "planning",
        "streaming",
        "partial",
        "failed",
        "needs_clarification",
        "refused",
      ] as const)("refuses to remember an explanation that is %s", async (status) => {
        const original = await insert(record({ status }));
        await cache.remember(original.id, entry("la gravité"));
        expect(await db.select().from(questionCache)).toEqual([]);
        expect(await db.select().from(conceptCache)).toEqual([]);
      });

      it.each(["another_analogy", "simpler", "zoom", "followup"] as const)(
        "refuses to remember a %s explanation",
        async (kind) => {
          const parent = await insert(record());
          const short = kind === "zoom" || kind === "followup";
          const original = await insert(
            child(parent, kind, {
              scene_count_planned: short ? 2 : 5,
              focus_scene_id: kind === "zoom" ? "s1" : null,
            }),
          );
          await cache.remember(original.id, entry("la gravité"));
          expect(await db.select().from(questionCache)).toEqual([]);
          expect(await db.select().from(conceptCache)).toEqual([]);
        },
      );

      it("remembers a reference explanation", async () => {
        const original = await insert(record({ kind: "reference", expires_at: null }));
        await cache.remember(original.id, entry("la gravité"));
        expect(await cache.findByConcept("physics/universal-gravitation", key)).toBe(original.id);
      });

      it("ignores an unknown explanation", async () => {
        await cache.remember("missing00000", entry("la gravité"));
        expect(await db.select().from(questionCache)).toEqual([]);
        expect(await db.select().from(conceptCache)).toEqual([]);
      });

      it("replaces an older entry for the same keys", async () => {
        const older = await insert(record());
        const newer = await insert(record());
        await cache.remember(older.id, entry("la gravité"));
        await cache.remember(newer.id, entry("Explique la gravité"));
        expect(await cache.findByQuestion("la gravité", key)).toBe(newer.id);
        expect(await cache.findByConcept("physics/universal-gravitation", key)).toBe(newer.id);
        expect(await db.select().from(questionCache)).toHaveLength(1);
        expect(await db.select().from(conceptCache)).toHaveLength(1);
      });

      it("keeps the older entry when the newer explanation is refused", async () => {
        const older = await insert(record());
        const newer = await insert(record({ status: "partial" }));
        await cache.remember(older.id, entry("la gravité"));
        await cache.remember(newer.id, entry("la gravité"));
        expect(await cache.findByQuestion("la gravité", key)).toBe(older.id);
      });

      it("forgets an explanation that was removed", async () => {
        const original = await insert(record());
        await cache.remember(original.id, entry("la gravité"));
        await store.remove(original.id);
        expect(await cache.findByQuestion("la gravité", key)).toBeNull();
        expect(await db.select().from(questionCache)).toEqual([]);
      });
    });

    describe("client", () => {
      const original = process.env.DATABASE_URL;

      afterEach(async () => {
        await closeDb();
        if (original === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = original;
      });

      it("reuses one instance until it is closed", async () => {
        process.env.DATABASE_URL = testDatabaseUrl().href;
        const first = getDb();
        expect(getDb()).toBe(first);
        expect(await pingDb()).toBe(true);
        await closeDb();
        expect(getDb()).not.toBe(first);
        expect(await pingDb()).toBe(true);
      });

      it("reports false when the database cannot be reached or is not configured", async () => {
        process.env.DATABASE_URL = "postgresql://eureka:eureka@127.0.0.1:1/eureka_test";
        expect(await pingDb()).toBe(false);
        await closeDb();
        delete process.env.DATABASE_URL;
        expect(await pingDb()).toBe(false);
      });
    });

    describe("rate limiter", () => {
      const ADDRESS = "203.0.113.42";
      const MINUTE = 60 * 1000;

      function clock(start: Date = T0) {
        let current = start.getTime();
        return {
          now: () => new Date(current),
          advance: (ms: number) => {
            current += ms;
          },
          set: (ms: number) => {
            current = ms;
          },
        };
      }

      const hitCount = async () =>
        Number(
          (
            await db
              .select({ total: sql<string>`coalesce(sum(${rateLimits.count}), 0)` })
              .from(rateLimits)
          )[0]?.total,
        );

      it("lets ten generations through and refuses the eleventh with a waiting time", async () => {
        const time = clock();
        const limiter = createRateLimiter(db, { now: time.now, env: {} });
        for (let hit = 0; hit < 10; hit += 1) {
          expect(await limiter.check(ADDRESS, "generation")).toEqual({ allowed: true });
          time.advance(MINUTE);
        }
        expect(await limiter.check(ADDRESS, "generation")).toEqual({
          allowed: false,
          retryAfterSeconds: 3000,
        });
        expect(await hitCount()).toBe(10);
      });

      it("slides: a slot frees up when the oldest hit leaves the window", async () => {
        const time = clock();
        const limiter = createRateLimiter(db, { now: time.now, env: {} });
        for (let hit = 0; hit < 10; hit += 1) {
          await limiter.check(ADDRESS, "generation");
          time.advance(MINUTE);
        }
        time.set(T0.getTime() + HOUR - 1);
        expect(await limiter.check(ADDRESS, "generation")).toEqual({
          allowed: false,
          retryAfterSeconds: 1,
        });
        time.set(T0.getTime() + HOUR);
        expect(await limiter.check(ADDRESS, "generation")).toEqual({ allowed: true });
        expect(await limiter.check(ADDRESS, "generation")).toEqual({
          allowed: false,
          retryAfterSeconds: 60,
        });
        time.set(T0.getTime() + HOUR + 3 * MINUTE);
        expect(await limiter.check(ADDRESS, "generation")).toEqual({ allowed: true });
      });

      it("rounds the waiting time up to the next second", async () => {
        const time = clock();
        const limiter = createRateLimiter(db, { now: time.now, env: { RATE_LIMIT_PER_HOUR: "1" } });
        await limiter.check(ADDRESS, "generation");
        time.advance(1500);
        expect(await limiter.check(ADDRESS, "generation")).toEqual({
          allowed: false,
          retryAfterSeconds: 3599,
        });
      });

      it("waits for several hits to leave when the same instant holds several", async () => {
        const time = clock();
        const limiter = createRateLimiter(db, { now: time.now, env: { RATE_LIMIT_PER_HOUR: "3" } });
        await limiter.check(ADDRESS, "generation");
        await limiter.check(ADDRESS, "generation");
        time.advance(10 * MINUTE);
        await limiter.check(ADDRESS, "generation");
        time.advance(10 * MINUTE);
        expect(await limiter.check(ADDRESS, "generation")).toEqual({
          allowed: false,
          retryAfterSeconds: 2400,
        });
      });

      it("counts exports separately, with their own limit of five", async () => {
        const limiter = createRateLimiter(db, { now: clock().now, env: {} });
        for (let hit = 0; hit < 10; hit += 1) await limiter.check(ADDRESS, "generation");
        for (let hit = 0; hit < 5; hit += 1) {
          expect(await limiter.check(ADDRESS, "export")).toEqual({ allowed: true });
        }
        expect(await limiter.check(ADDRESS, "export")).toMatchObject({ allowed: false });
        expect(await limiter.check(ADDRESS, "generation")).toMatchObject({ allowed: false });
      });

      it("reads the limits from RATE_LIMIT_PER_HOUR and RATE_LIMIT_EXPORT_PER_HOUR", async () => {
        const limiter = createRateLimiter(db, {
          now: clock().now,
          env: { RATE_LIMIT_PER_HOUR: "2", RATE_LIMIT_EXPORT_PER_HOUR: "1" },
        });
        expect(await limiter.check(ADDRESS, "generation")).toEqual({ allowed: true });
        expect(await limiter.check(ADDRESS, "generation")).toEqual({ allowed: true });
        expect(await limiter.check(ADDRESS, "generation")).toMatchObject({ allowed: false });
        expect(await limiter.check(ADDRESS, "export")).toEqual({ allowed: true });
        expect(await limiter.check(ADDRESS, "export")).toMatchObject({ allowed: false });
      });

      it.each(["", "abc", "0", "-3"])("falls back to the defaults for %j", async (value) => {
        const limiter = createRateLimiter(db, {
          now: clock().now,
          env: { RATE_LIMIT_PER_HOUR: value },
        });
        for (let hit = 0; hit < 10; hit += 1) await limiter.check(ADDRESS, "generation");
        expect(await limiter.check(ADDRESS, "generation")).toMatchObject({ allowed: false });
      });

      it("counts each address on its own", async () => {
        const limiter = createRateLimiter(db, { now: clock().now, env: {} });
        for (let hit = 0; hit < 10; hit += 1) await limiter.check(ADDRESS, "generation");
        expect(await limiter.check("203.0.113.43", "generation")).toEqual({ allowed: true });
      });

      it("starts a new count when the UTC day changes, because the key is renewed", async () => {
        const time = clock(new Date("2026-03-04T23:50:00.000Z"));
        const limiter = createRateLimiter(db, { now: time.now, env: {} });
        for (let hit = 0; hit < 10; hit += 1) await limiter.check(ADDRESS, "generation");
        expect(await limiter.check(ADDRESS, "generation")).toMatchObject({ allowed: false });
        time.advance(15 * MINUTE);
        expect(await limiter.check(ADDRESS, "generation")).toEqual({ allowed: true });
      });

      it("does not share a count between two salts", async () => {
        const time = clock();
        const one = createRateLimiter(db, { now: time.now, env: { RATE_LIMIT_SALT: "one" } });
        const two = createRateLimiter(db, { now: time.now, env: { RATE_LIMIT_SALT: "two" } });
        for (let hit = 0; hit < 10; hit += 1) await one.check(ADDRESS, "generation");
        expect(await one.check(ADDRESS, "generation")).toMatchObject({ allowed: false });
        expect(await two.check(ADDRESS, "generation")).toEqual({ allowed: true });
      });

      it("lets exactly ten of twenty concurrent checks through", async () => {
        const limiter = createRateLimiter(db, { now: clock().now, env: {} });
        const results = await Promise.all(
          Array.from({ length: 20 }, () => limiter.check(ADDRESS, "generation")),
        );
        expect(results.filter((result) => result.allowed)).toHaveLength(10);
        expect(results.filter((result) => !result.allowed)).toHaveLength(10);
        expect(await hitCount()).toBe(10);
      });

      it("lets exactly ten of twenty concurrent checks through with the real clock", async () => {
        const limiter = createRateLimiter(db, { env: {} });
        const results = await Promise.all(
          Array.from({ length: 20 }, () => limiter.check(ADDRESS, "generation")),
        );
        expect(results.filter((result) => result.allowed)).toHaveLength(10);
        expect(await hitCount()).toBe(10);
      });

      it("stores only a hash: no row contains an address", async () => {
        const time = clock();
        const limiter = createRateLimiter(db, {
          now: time.now,
          env: { RATE_LIMIT_SALT: "pepper" },
        });
        const addresses = [ADDRESS, "198.51.100.7", "2001:db8::1"];
        for (const address of addresses) {
          await limiter.check(address, "generation");
          await limiter.check(address, "export");
        }
        const rows = await db.select().from(rateLimits);
        expect(rows).toHaveLength(addresses.length * 2);
        const dump = JSON.stringify(rows);
        for (const address of addresses) expect(dump).not.toContain(address);
        expect(rows.map((row) => row.key)).toContain(
          rateLimitKey(ADDRESS, "generation", T0, "pepper"),
        );
      });

      it("deletes the rows that left the window, whoever they belong to", async () => {
        const time = clock();
        const limiter = createRateLimiter(db, { now: time.now, env: {} });
        await db.insert(rateLimits).values([
          { key: "old", window_start: new Date(T0.getTime() - HOUR), count: 3 },
          { key: "older", window_start: new Date(T0.getTime() - 2 * DAY), count: 1 },
          { key: "recent", window_start: new Date(T0.getTime() - HOUR + 1), count: 2 },
        ]);
        await limiter.check(ADDRESS, "generation");
        const keys = (await db.select().from(rateLimits)).map((row) => row.key);
        expect(keys).toContain("recent");
        expect(keys).not.toContain("old");
        expect(keys).not.toContain("older");
        expect(keys).toHaveLength(2);
      });
    });
  },
);
