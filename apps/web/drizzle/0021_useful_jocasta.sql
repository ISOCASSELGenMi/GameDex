CREATE TABLE "igdb_feedback_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"igdb_game_id" integer NOT NULL,
	"game_slug" varchar(255) NOT NULL,
	"field" varchar(32) NOT NULL,
	"platform_id" integer,
	"region_code" varchar(16),
	"stage" "release_stage",
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"source_url" text,
	"reporter_note" text,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"handler_note" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"status_changed_at" timestamp with time zone DEFAULT now(),
	"adopted_at" timestamp with time zone,
	CONSTRAINT "igdb_feedback_items_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
ALTER TABLE "igdb_feedback_items" ADD CONSTRAINT "igdb_feedback_items_report_id_data_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."data_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "igdb_feedback_items" ADD CONSTRAINT "igdb_feedback_items_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "igdb_feedback_items_game_status_idx" ON "igdb_feedback_items" USING btree ("game_id","status");--> statement-breakpoint
CREATE INDEX "igdb_feedback_items_status_created_idx" ON "igdb_feedback_items" USING btree ("status","created_at");