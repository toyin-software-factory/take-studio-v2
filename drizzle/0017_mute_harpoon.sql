CREATE TABLE "ai_eval_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text NOT NULL,
	"cases" integer NOT NULL,
	"overall_precision" double precision NOT NULL,
	"overall_recall" double precision NOT NULL,
	"main_precision" double precision NOT NULL,
	"main_recall" double precision NOT NULL,
	"holdout_precision" double precision NOT NULL,
	"holdout_recall" double precision NOT NULL,
	"wrong_keeps" integer NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_eval_run_ran_at_idx" ON "ai_eval_run" USING btree ("ran_at");