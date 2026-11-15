CREATE TABLE "bearer_fail_window" (
	"ip_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bearer_fail_window_ip_hash_window_start_pk" PRIMARY KEY("ip_hash","window_start")
);
--> statement-breakpoint
CREATE INDEX "bearer_fail_window_start_idx" ON "bearer_fail_window" USING btree ("window_start");