ALTER TABLE "take" DROP CONSTRAINT "take_container_check";--> statement-breakpoint
ALTER TABLE "take" ADD COLUMN "source" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "take" ADD COLUMN "script" text;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_source_check" CHECK ("take"."source" IN ('file', 'recording')) NOT VALID;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_script_length_check" CHECK ("take"."script" IS NULL OR char_length("take"."script") <= 20000) NOT VALID;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_container_check" CHECK ("take"."container" IN ('mp4', 'mov', 'webm')) NOT VALID;