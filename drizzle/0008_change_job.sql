ALTER TABLE "take" ADD COLUMN "waveform" jsonb;--> statement-breakpoint
ALTER TABLE "processing_job" ADD COLUMN "cut_plan" jsonb;