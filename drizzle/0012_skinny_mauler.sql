CREATE TABLE "analytics_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"creator_id" text NOT NULL,
	"take_id" uuid,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_event_name_check" CHECK ("analytics_event"."name" IN ('signup', 'take_uploaded', 'take_ready', 'ai_edit_used', 'change_requested', 'take_downloaded', 'transcript_downloaded', 'take_failed', 'limit_hit'))
);
--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_event_name_time_idx" ON "analytics_event" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_event_creator_name_idx" ON "analytics_event" USING btree ("creator_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_signup_once_uidx" ON "analytics_event" USING btree ("creator_id") WHERE "analytics_event"."name" = 'signup';--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_once_per_take_uidx" ON "analytics_event" USING btree ("take_id","name") WHERE "analytics_event"."name" IN ('take_uploaded', 'take_ready', 'ai_edit_used') and "analytics_event"."take_id" is not null;