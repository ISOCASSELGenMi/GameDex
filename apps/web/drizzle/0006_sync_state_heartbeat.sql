ALTER TABLE "sync_state" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "last_alerted_at" timestamp with time zone;