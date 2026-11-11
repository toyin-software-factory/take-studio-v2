CREATE TYPE "public"."processing_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."take_status" AS ENUM('uploading', 'uploaded', 'processing', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "take" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "take_status" NOT NULL,
	"original_key" text NOT NULL,
	"original_bytes" bigint NOT NULL,
	"upload_id" text,
	"container" text NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"video_expires_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "take_title_length_check" CHECK (char_length("take"."title") BETWEEN 1 AND 200),
	CONSTRAINT "take_container_check" CHECK ("take"."container" IN ('mp4', 'mov'))
);
--> statement-breakpoint
CREATE TABLE "job_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" smallint NOT NULL,
	"status" text NOT NULL,
	"progress" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_step_job_name_unique" UNIQUE("job_id","name"),
	CONSTRAINT "job_step_progress_check" CHECK ("job_step"."progress" BETWEEN 0 AND 100),
	CONSTRAINT "job_step_name_check" CHECK ("job_step"."name" IN ('trim', 'transcript', 'background', 'ai_edit', 'render')),
	CONSTRAINT "job_step_status_check" CHECK ("job_step"."status" IN ('pending', 'running', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "processing_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"take_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" "processing_job_status" NOT NULL,
	"trigger_run_id" text,
	"seconds_charged" integer NOT NULL,
	"charged_month" date,
	"charged_account_hash" text,
	"refunded" boolean DEFAULT false NOT NULL,
	"failure_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_job_kind_check" CHECK ("processing_job"."kind" IN ('initial', 'rerender', 'reanalyse')),
	CONSTRAINT "processing_job_seconds_charged_check" CHECK ("processing_job"."seconds_charged" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cut" (
	"id" uuid PRIMARY KEY NOT NULL,
	"take_id" uuid NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"kind" text NOT NULL,
	"proposed_by" text NOT NULL,
	"reason" text,
	"applied" boolean DEFAULT true NOT NULL,
	"creator_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cut_range_check" CHECK ("cut"."start_ms" >= 0 AND "cut"."end_ms" > "cut"."start_ms"),
	CONSTRAINT "cut_kind_check" CHECK ("cut"."kind" IN ('pause', 'false_start', 'filler', 'manual')),
	CONSTRAINT "cut_proposed_by_check" CHECK ("cut"."proposed_by" IN ('rules', 'ai', 'creator')),
	CONSTRAINT "cut_reason_length_check" CHECK (char_length("cut"."reason") <= 280)
);
--> statement-breakpoint
CREATE TABLE "render" (
	"id" uuid PRIMARY KEY NOT NULL,
	"take_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text NOT NULL,
	"video_key" text,
	"duration_ms" integer,
	"removed_ranges" jsonb NOT NULL,
	"is_latest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_status_check" CHECK ("render"."status" IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "storage_deletion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_step" ADD CONSTRAINT "job_step_job_id_processing_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."processing_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_job" ADD CONSTRAINT "processing_job_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut" ADD CONSTRAINT "cut_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render" ADD CONSTRAINT "render_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render" ADD CONSTRAINT "render_job_id_processing_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."processing_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "take_creator_created_idx" ON "take" USING btree ("creator_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "take_status_expires_idx" ON "take" USING btree ("status","video_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_job_one_active_per_take_uidx" ON "processing_job" USING btree ("take_id") WHERE "processing_job"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "processing_job_take_created_idx" ON "processing_job" USING btree ("take_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "processing_job_status_updated_idx" ON "processing_job" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "cut_take_start_idx" ON "cut" USING btree ("take_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "render_one_latest_per_take_uidx" ON "render" USING btree ("take_id") WHERE "render"."is_latest";--> statement-breakpoint
CREATE INDEX "render_take_idx" ON "render" USING btree ("take_id");--> statement-breakpoint
CREATE INDEX "render_job_idx" ON "render" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "storage_deletion_created_idx" ON "storage_deletion" USING btree ("created_at");