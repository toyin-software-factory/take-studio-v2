CREATE TABLE "guest_budget_day" (
	"day" date PRIMARY KEY NOT NULL,
	"reserved_minutes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guest_budget_day_minutes_check" CHECK ("guest_budget_day"."reserved_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guest_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"email_hash" text,
	"ip_hash" text NOT NULL,
	"claim_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"email_sends" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guest_claim_guest_user_id_unique" UNIQUE("guest_user_id"),
	CONSTRAINT "guest_claim_email_sends_check" CHECK ("guest_claim"."email_sends" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guest_ip_day" (
	"ip_hash" text NOT NULL,
	"day" date NOT NULL,
	"drops" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guest_ip_day_pk" PRIMARY KEY("ip_hash","day"),
	CONSTRAINT "guest_ip_day_drops_check" CHECK ("guest_ip_day"."drops" >= 0)
);
--> statement-breakpoint
ALTER TABLE "analytics_event" ALTER COLUMN "creator_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "guest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "take" ADD COLUMN "guest_origin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "take" ADD COLUMN "guest_reserved_minutes" integer;--> statement-breakpoint
ALTER TABLE "take" ADD COLUMN "guest_reserved_day" date;--> statement-breakpoint
ALTER TABLE "guest_claim" ADD CONSTRAINT "guest_claim_guest_user_id_user_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_claim_expires_at_idx" ON "guest_claim" USING btree ("expires_at");