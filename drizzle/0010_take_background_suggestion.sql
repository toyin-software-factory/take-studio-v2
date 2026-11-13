ALTER TABLE "take" ADD COLUMN "suggested_background_id" uuid;--> statement-breakpoint
ALTER TABLE "take" ADD COLUMN "suggestion_reason" text;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_suggested_background_id_background_id_fk" FOREIGN KEY ("suggested_background_id") REFERENCES "public"."background"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_suggestion_reason_length_check" CHECK ("take"."suggestion_reason" IS NULL OR char_length("take"."suggestion_reason") <= 280);