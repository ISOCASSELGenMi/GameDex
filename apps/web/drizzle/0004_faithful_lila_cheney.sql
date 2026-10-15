CREATE TABLE "data_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" varchar(24) NOT NULL,
	"target_id" integer,
	"report_type" varchar(24) NOT NULL,
	"proposed" jsonb,
	"source_url" text,
	"note" text,
	"reporter_user_id" integer,
	"reporter_ip_hash" varchar(64),
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "data_reports_status_created_idx" ON "data_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "data_reports_target_idx" ON "data_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "data_reports_ip_created_idx" ON "data_reports" USING btree ("reporter_ip_hash","created_at");