CREATE TABLE "oauth_rate_window" (
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "oauth_rate_window_client_id_user_id_window_start_pk" PRIMARY KEY("client_id","user_id","window_start")
);
--> statement-breakpoint
ALTER TABLE "oauth_rate_window" ADD CONSTRAINT "oauth_rate_window_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_rate_window" ADD CONSTRAINT "oauth_rate_window_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;