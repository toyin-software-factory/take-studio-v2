CREATE TABLE "app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_hash" text NOT NULL,
	"month" date NOT NULL,
	"seconds_used" integer DEFAULT 0 NOT NULL,
	"hash_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_month_account_month_unique" UNIQUE("account_hash","month"),
	CONSTRAINT "usage_month_seconds_used_check" CHECK ("usage_month"."seconds_used" >= 0)
);
--> statement-breakpoint
ALTER TABLE "processing_job" ADD COLUMN "usage_counted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_job" ADD COLUMN "usage_returned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Spec 0014 AC-11: carry the charges recorded since slice 1 into usage_month. One statement:
-- the flag flip and the sum see the same rows, and a second run finds nothing to add.
WITH counted AS (
	UPDATE "processing_job"
	SET "usage_counted" = true
	WHERE "seconds_charged" > 0
		AND NOT "refunded"
		AND NOT "usage_counted"
		AND "charged_account_hash" IS NOT NULL
		AND "charged_month" IS NOT NULL
	RETURNING "charged_account_hash", "charged_month", "seconds_charged"
)
INSERT INTO "usage_month" ("account_hash", "month", "seconds_used")
SELECT "charged_account_hash", "charged_month", sum("seconds_charged")::integer
FROM counted
GROUP BY "charged_account_hash", "charged_month"
ON CONFLICT ("account_hash", "month")
DO UPDATE SET "seconds_used" = "usage_month"."seconds_used" + EXCLUDED."seconds_used";--> statement-breakpoint
-- Spec 0014 AC-2, AC-11: the allowance, and the limit OFF until the reconcile has run.
INSERT INTO "app_setting" ("key", "value") VALUES
	('free_monthly_seconds', '3600'::jsonb),
	('usage_limit_enabled', 'false'::jsonb)
ON CONFLICT ("key") DO NOTHING;
