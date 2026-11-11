ALTER TABLE "user" ADD COLUMN "take_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_job" ADD COLUMN "notified_at" timestamp with time zone;