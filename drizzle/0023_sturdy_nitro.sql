ALTER TABLE "processing_job" DROP CONSTRAINT "processing_job_kind_check";--> statement-breakpoint
ALTER TABLE "take" ADD COLUMN "credit_choice" text;--> statement-breakpoint
ALTER TABLE "render" ADD COLUMN "credit_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_credit_choice_check" CHECK ("take"."credit_choice" IS NULL OR "take"."credit_choice" IN ('on', 'off'));--> statement-breakpoint
ALTER TABLE "processing_job" ADD CONSTRAINT "processing_job_kind_check" CHECK ("processing_job"."kind" IN ('initial', 'rerender', 'background', 'credit', 'transcribe', 'reanalyse'));--> statement-breakpoint
-- Spec 0026 AC-4: the credit is off, and has no start, until go live sets both.
INSERT INTO "app_setting" ("key", "value") VALUES
	('credit_enabled', 'false'::jsonb),
	('credit_starts_at', 'null'::jsonb)
ON CONFLICT ("key") DO NOTHING;
