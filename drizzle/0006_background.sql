CREATE TABLE "background" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" text,
	"name" text NOT NULL,
	"source_key" text,
	"image_key" text,
	"thumb_key" text,
	"width" integer,
	"height" integer,
	"bytes" bigint,
	"status" text NOT NULL,
	"failure_code" text,
	"alt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_status_check" CHECK ("background"."status" IN ('uploading', 'processing', 'ready', 'failed')),
	CONSTRAINT "background_name_length_check" CHECK (char_length("background"."name") BETWEEN 1 AND 80),
	CONSTRAINT "background_ready_complete_check" CHECK ("background"."status" <> 'ready' OR ("background"."image_key" IS NOT NULL AND "background"."thumb_key" IS NOT NULL AND "background"."width" IS NOT NULL AND "background"."height" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "background_preview" (
	"id" uuid PRIMARY KEY NOT NULL,
	"take_id" uuid NOT NULL,
	"background_id" uuid NOT NULL,
	"cut_version" text NOT NULL,
	"status" text NOT NULL,
	"object_key" text,
	"no_green_screen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_preview_take_background_cut_unique" UNIQUE("take_id","background_id","cut_version"),
	CONSTRAINT "background_preview_status_check" CHECK ("background_preview"."status" IN ('making', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "default_background_id" uuid;--> statement-breakpoint
ALTER TABLE "take" ADD COLUMN "background_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_job" ADD COLUMN "target_background_id" uuid;--> statement-breakpoint
ALTER TABLE "render" ADD COLUMN "background_id" uuid;--> statement-breakpoint
ALTER TABLE "render" ADD COLUMN "background_name" text;--> statement-breakpoint
ALTER TABLE "render" ADD COLUMN "keyed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "render" ADD COLUMN "key_color" text;--> statement-breakpoint
ALTER TABLE "background" ADD CONSTRAINT "background_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_preview" ADD CONSTRAINT "background_preview_take_id_take_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."take"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_preview" ADD CONSTRAINT "background_preview_background_id_background_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."background"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_creator_created_idx" ON "background" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "background_status_created_idx" ON "background" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "background_preview_background_idx" ON "background_preview" USING btree ("background_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_default_background_id_background_id_fk" FOREIGN KEY ("default_background_id") REFERENCES "public"."background"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "take" ADD CONSTRAINT "take_background_id_background_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."background"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_job" ADD CONSTRAINT "processing_job_target_background_id_background_id_fk" FOREIGN KEY ("target_background_id") REFERENCES "public"."background"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render" ADD CONSTRAINT "render_background_id_background_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."background"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "take_background_idx" ON "take" USING btree ("background_id");--> statement-breakpoint
CREATE INDEX "processing_job_target_background_idx" ON "processing_job" USING btree ("target_background_id");