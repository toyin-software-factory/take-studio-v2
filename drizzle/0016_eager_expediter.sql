CREATE TABLE "realtime_token_mint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"minted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "realtime_token_mint" ADD CONSTRAINT "realtime_token_mint_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_token_mint_creator_minted_idx" ON "realtime_token_mint" USING btree ("creator_id","minted_at");