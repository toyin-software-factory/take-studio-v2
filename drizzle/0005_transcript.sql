CREATE TABLE "transcript" (
	"id" uuid PRIMARY KEY NOT NULL,
	"take_id" uuid NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"text" text NOT NULL,
	"words" jsonb NOT NULL,
	"source_fps" numeric NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_take_unique" UNIQUE("take_id")
);
--> statement-breakpoint
ALTER TABLE "processing_job" DROP CONSTRAINT "processing_job_kind_check";--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_job" ADD CONSTRAINT "processing_job_kind_check" CHECK ("processing_job"."kind" IN ('initial', 'rerender', 'transcribe', 'reanalyse'));