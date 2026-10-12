import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { Language, Level } from "scene";
import type { Verdict } from "../pipeline/events";
import {
  EXPLANATION_KINDS,
  EXPLANATION_STATUSES,
  type ExplanationPayload,
} from "../pipeline/ports";
import { SUBJECTS } from "../pipeline/prompts/schemas";

// Type-only imports from "scene" keep drizzle-kit from loading the whole scene package.
export const LANGUAGES = ["fr", "en"] as const satisfies readonly Language[];
export const LEVELS = ["college", "lycee", "superieur"] as const satisfies readonly Level[];
export const JOB_TYPES = ["export", "deep"] as const;
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "abandoned"] as const;

export const explanationKindEnum = pgEnum("explanation_kind", EXPLANATION_KINDS);
export const explanationStatusEnum = pgEnum("explanation_status", EXPLANATION_STATUSES);
export const languageEnum = pgEnum("language", LANGUAGES);
export const levelEnum = pgEnum("level", LEVELS);
export const subjectEnum = pgEnum("subject", SUBJECTS);
export const jobTypeEnum = pgEnum("job_type", JOB_TYPES);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const explanations = pgTable(
  "explanations",
  {
    id: text("id").primaryKey(),
    kind: explanationKindEnum("kind").notNull(),
    parent_id: text("parent_id").references((): AnyPgColumn => explanations.id, {
      onDelete: "cascade",
    }),
    root_id: text("root_id")
      .notNull()
      .references((): AnyPgColumn => explanations.id, { onDelete: "cascade" }),
    focus_scene_id: text("focus_scene_id"),
    question: text("question").notNull(),
    language: languageEnum("language").notNull(),
    level: levelEnum("level").notNull(),
    concept_slug: text("concept_slug"),
    subject: subjectEnum("subject"),
    title: text("title"),
    status: explanationStatusEnum("status").notNull(),
    payload: jsonb("payload").$type<ExplanationPayload>().notNull(),
    verdicts: jsonb("verdicts")
      .$type<Verdict[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    scene_count_planned: integer("scene_count_planned"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    timings: jsonb("timings")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    completed_at: timestamptz("completed_at"),
    expires_at: timestamptz("expires_at"),
  },
  (t) => [
    check("explanations_id_format", sql`${t.id} ~ '^[A-Za-z0-9_-]{12}$'`),
    check("explanations_question_length", sql`char_length(${t.question}) between 1 and 500`),
    check(
      "explanations_parent_required",
      sql`${t.kind} in ('initial', 'reference') or ${t.parent_id} is not null`,
    ),
    check(
      "explanations_start_is_root",
      sql`${t.kind} not in ('initial', 'reference') or ${t.root_id} = ${t.id}`,
    ),
    check(
      "explanations_focus_only_for_zoom",
      sql`${t.focus_scene_id} is null or ${t.kind} = 'zoom'`,
    ),
    check(
      "explanations_scene_count",
      sql`${t.scene_count_planned} is null or (case when ${t.kind} in ('followup', 'zoom') then ${t.scene_count_planned} between 1 and 3 else ${t.scene_count_planned} between 4 and 7 end)`,
    ),
    check(
      "explanations_reference_no_expiry",
      sql`${t.kind} <> 'reference' or ${t.expires_at} is null`,
    ),
    index("explanations_root_id_idx").on(t.root_id),
    index("explanations_parent_id_idx").on(t.parent_id),
    index("explanations_expires_at_idx").on(t.expires_at),
  ],
);

export const questionCache = pgTable(
  "question_cache",
  {
    question_hash: text("question_hash").notNull(),
    language: languageEnum("language").notNull(),
    level: levelEnum("level").notNull(),
    explanation_id: text("explanation_id")
      .notNull()
      .references(() => explanations.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.question_hash, t.language, t.level] }),
    index("question_cache_explanation_id_idx").on(t.explanation_id),
  ],
);

export const conceptCache = pgTable(
  "concept_cache",
  {
    concept_slug: text("concept_slug").notNull(),
    language: languageEnum("language").notNull(),
    level: levelEnum("level").notNull(),
    explanation_id: text("explanation_id")
      .notNull()
      .references(() => explanations.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.concept_slug, t.language, t.level] }),
    index("concept_cache_explanation_id_idx").on(t.explanation_id),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: jobTypeEnum("type").notNull(),
    explanation_id: text("explanation_id")
      .notNull()
      .references(() => explanations.id, { onDelete: "cascade" }),
    status: jobStatusEnum("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    result_url: text("result_url"),
    error: text("error"),
    locked_at: timestamptz("locked_at"),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    finished_at: timestamptz("finished_at"),
  },
  (t) => [
    check("jobs_progress_range", sql`${t.progress} between 0 and 100`),
    check(
      "jobs_attempts_limit",
      sql`${t.attempts} between 0 and (case when ${t.type} = 'deep' then 3 else 2 end)`,
    ),
    uniqueIndex("jobs_one_active_per_type_idx")
      .on(t.explanation_id, t.type)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("jobs_status_created_at_idx").on(t.status, t.created_at),
  ],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    window_start: timestamptz("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.window_start] }),
    check("rate_limits_count_positive", sql`${t.count} > 0`),
    index("rate_limits_window_start_idx").on(t.window_start),
  ],
);
