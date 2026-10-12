CREATE TYPE "public"."explanation_kind" AS ENUM('initial', 'another_analogy', 'simpler', 'zoom', 'followup', 'reference');--> statement-breakpoint
CREATE TYPE "public"."explanation_status" AS ENUM('triaging', 'planning', 'streaming', 'ready', 'partial', 'failed', 'needs_clarification', 'refused');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('export', 'deep');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('fr', 'en');--> statement-breakpoint
CREATE TYPE "public"."level" AS ENUM('college', 'lycee', 'superieur');--> statement-breakpoint
CREATE TYPE "public"."subject" AS ENUM('maths', 'physics', 'chemistry', 'biology', 'cs', 'economics', 'other');--> statement-breakpoint
CREATE TABLE "concept_cache" (
	"concept_slug" text NOT NULL,
	"language" "language" NOT NULL,
	"level" "level" NOT NULL,
	"explanation_id" text NOT NULL,
	CONSTRAINT "concept_cache_concept_slug_language_level_pk" PRIMARY KEY("concept_slug","language","level")
);
--> statement-breakpoint
CREATE TABLE "explanations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "explanation_kind" NOT NULL,
	"parent_id" text,
	"root_id" text NOT NULL,
	"focus_scene_id" text,
	"question" text NOT NULL,
	"language" "language" NOT NULL,
	"level" "level" NOT NULL,
	"concept_slug" text,
	"subject" "subject",
	"title" text,
	"status" "explanation_status" NOT NULL,
	"payload" jsonb NOT NULL,
	"verdicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scene_count_planned" integer,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "explanations_id_format" CHECK ("explanations"."id" ~ '^[A-Za-z0-9_-]{12}$'),
	CONSTRAINT "explanations_question_length" CHECK (char_length("explanations"."question") between 1 and 500),
	CONSTRAINT "explanations_parent_required" CHECK ("explanations"."kind" in ('initial', 'reference') or "explanations"."parent_id" is not null),
	CONSTRAINT "explanations_start_is_root" CHECK ("explanations"."kind" not in ('initial', 'reference') or "explanations"."root_id" = "explanations"."id"),
	CONSTRAINT "explanations_focus_only_for_zoom" CHECK ("explanations"."focus_scene_id" is null or "explanations"."kind" = 'zoom'),
	CONSTRAINT "explanations_scene_count" CHECK ("explanations"."scene_count_planned" is null or (case when "explanations"."kind" in ('followup', 'zoom') then "explanations"."scene_count_planned" between 1 and 3 else "explanations"."scene_count_planned" between 4 and 7 end)),
	CONSTRAINT "explanations_reference_no_expiry" CHECK ("explanations"."kind" <> 'reference' or "explanations"."expires_at" is null)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "job_type" NOT NULL,
	"explanation_id" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result_url" text,
	"error" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_progress_range" CHECK ("jobs"."progress" between 0 and 100),
	CONSTRAINT "jobs_attempts_limit" CHECK ("jobs"."attempts" between 0 and (case when "jobs"."type" = 'deep' then 3 else 2 end))
);
--> statement-breakpoint
CREATE TABLE "question_cache" (
	"question_hash" text NOT NULL,
	"language" "language" NOT NULL,
	"level" "level" NOT NULL,
	"explanation_id" text NOT NULL,
	CONSTRAINT "question_cache_question_hash_language_level_pk" PRIMARY KEY("question_hash","language","level")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start"),
	CONSTRAINT "rate_limits_count_positive" CHECK ("rate_limits"."count" > 0)
);
--> statement-breakpoint
ALTER TABLE "concept_cache" ADD CONSTRAINT "concept_cache_explanation_id_explanations_id_fk" FOREIGN KEY ("explanation_id") REFERENCES "public"."explanations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanations" ADD CONSTRAINT "explanations_parent_id_explanations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."explanations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanations" ADD CONSTRAINT "explanations_root_id_explanations_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."explanations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_explanation_id_explanations_id_fk" FOREIGN KEY ("explanation_id") REFERENCES "public"."explanations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_cache" ADD CONSTRAINT "question_cache_explanation_id_explanations_id_fk" FOREIGN KEY ("explanation_id") REFERENCES "public"."explanations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concept_cache_explanation_id_idx" ON "concept_cache" USING btree ("explanation_id");--> statement-breakpoint
CREATE INDEX "explanations_root_id_idx" ON "explanations" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "explanations_parent_id_idx" ON "explanations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "explanations_expires_at_idx" ON "explanations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_active_per_type_idx" ON "jobs" USING btree ("explanation_id","type") WHERE "jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "jobs_status_created_at_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "question_cache_explanation_id_idx" ON "question_cache" USING btree ("explanation_id");--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");