CREATE TYPE "public"."date_precision" AS ENUM('day', 'month', 'quarter', 'year', 'tbd');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('showcase', 'expo', 'awards', 'other');--> statement-breakpoint
CREATE TYPE "public"."franchise_kind" AS ENUM('franchise', 'collection');--> statement-breakpoint
CREATE TYPE "public"."game_company_role" AS ENUM('developer', 'publisher', 'porting', 'supporting');--> statement-breakpoint
CREATE TYPE "public"."game_link_type" AS ENUM('store', 'official', 'social', 'media');--> statement-breakpoint
CREATE TYPE "public"."language_support_type" AS ENUM('interface', 'subtitles', 'audio');--> statement-breakpoint
CREATE TYPE "public"."platform_kind" AS ENUM('console', 'handheld', 'hybrid', 'pc', 'arcade', 'mobile', 'other');--> statement-breakpoint
CREATE TYPE "public"."platform_status" AS ENUM('announced', 'active', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."release_stage" AS ENUM('unspecified', 'full', 'early_access', 'beta', 'alpha', 'demo', 'other');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('scheduled', 'delayed', 'released', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."score_provider" AS ENUM('igdb', 'opencritic', 'metacritic_scrape');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TABLE "consumer_cursors" (
	"consumer_name" varchar(64) PRIMARY KEY NOT NULL,
	"last_change_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"job_name" varchar(64) PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"cursor" text,
	"meta" jsonb,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "change_feed" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" varchar(24) NOT NULL,
	"entity_id" integer NOT NULL,
	"change_type" varchar(24) NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"logo_url" text,
	"website_url" text,
	CONSTRAINT "companies_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event_games" (
	"event_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	CONSTRAINT "event_games_event_id_game_id_pk" PRIMARY KEY("event_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "event_series" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"kind" "event_kind" DEFAULT 'other' NOT NULL,
	CONSTRAINT "event_series_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_event_id" integer,
	"name" text NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"kind" "event_kind" DEFAULT 'other' NOT NULL,
	"series_id" integer,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"timezone" varchar(64),
	"logo_url" text,
	"stream_url" text,
	"url" text,
	"organizer" varchar(255),
	"source" varchar(16) DEFAULT 'igdb' NOT NULL,
	"game_igdb_ids" jsonb DEFAULT '[]'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "events_igdb_event_id_unique" UNIQUE("igdb_event_id"),
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "external_id_rejections" (
	"game_id" integer NOT NULL,
	"source" varchar(32) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"rejected_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "external_id_rejections_game_id_source_external_id_pk" PRIMARY KEY("game_id","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "external_ids" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"source" varchar(32) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"external_url" text,
	"confidence_pct" integer,
	"needs_review" boolean DEFAULT false NOT NULL,
	"match_method" varchar(8) DEFAULT 'auto' NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "external_match_attempts" (
	"game_id" integer NOT NULL,
	"source" varchar(32) NOT NULL,
	"last_attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_result" varchar(16) NOT NULL,
	CONSTRAINT "external_match_attempts_game_id_source_pk" PRIMARY KEY("game_id","source")
);
--> statement-breakpoint
CREATE TABLE "franchises" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"kind" "franchise_kind" NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_companies" (
	"game_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"role" "game_company_role" NOT NULL,
	CONSTRAINT "game_companies_game_id_company_id_role_pk" PRIMARY KEY("game_id","company_id","role")
);
--> statement-breakpoint
CREATE TABLE "game_external_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"link_type" "game_link_type" NOT NULL,
	"igdb_category" integer,
	"igdb_origin" varchar(16),
	"category_label" varchar(64) NOT NULL,
	"url" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"is_broken" boolean DEFAULT false NOT NULL,
	"source" varchar(32) DEFAULT 'igdb' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "game_franchises" (
	"game_id" integer NOT NULL,
	"franchise_id" integer NOT NULL,
	CONSTRAINT "game_franchises_game_id_franchise_id_pk" PRIMARY KEY("game_id","franchise_id")
);
--> statement-breakpoint
CREATE TABLE "game_genres" (
	"game_id" integer NOT NULL,
	"genre_id" integer NOT NULL,
	CONSTRAINT "game_genres_game_id_genre_id_pk" PRIMARY KEY("game_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "game_language_supports" (
	"game_id" integer NOT NULL,
	"language_id" integer NOT NULL,
	"support_type" "language_support_type" NOT NULL,
	"source" varchar(16) DEFAULT 'igdb' NOT NULL,
	CONSTRAINT "game_language_supports_game_id_language_id_support_type_pk" PRIMARY KEY("game_id","language_id","support_type")
);
--> statement-breakpoint
CREATE TABLE "game_localizations" (
	"game_id" integer NOT NULL,
	"locale_code" varchar(16) NOT NULL,
	"name" text NOT NULL,
	"cover_url" text,
	"source" varchar(16) DEFAULT 'igdb' NOT NULL,
	CONSTRAINT "game_localizations_game_id_locale_code_pk" PRIMARY KEY("game_id","locale_code")
);
--> statement-breakpoint
CREATE TABLE "game_platforms" (
	"game_id" integer NOT NULL,
	"platform_id" integer NOT NULL,
	CONSTRAINT "game_platforms_game_id_platform_id_pk" PRIMARY KEY("game_id","platform_id")
);
--> statement-breakpoint
CREATE TABLE "game_popularity_signals" (
	"game_id" integer NOT NULL,
	"signal_name" varchar(32) NOT NULL,
	"value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "game_popularity_signals_game_id_signal_name_pk" PRIMARY KEY("game_id","signal_name")
);
--> statement-breakpoint
CREATE TABLE "game_similar_games" (
	"game_id" integer NOT NULL,
	"similar_game_id" integer NOT NULL,
	CONSTRAINT "game_similar_games_game_id_similar_game_id_pk" PRIMARY KEY("game_id","similar_game_id")
);
--> statement-breakpoint
CREATE TABLE "game_themes" (
	"game_id" integer NOT NULL,
	"theme_id" integer NOT NULL,
	CONSTRAINT "game_themes_game_id_theme_id_pk" PRIMARY KEY("game_id","theme_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"slug" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"cover_url" text,
	"first_release_date" date,
	"first_release_precision" date_precision,
	"game_type" varchar(32) DEFAULT 'main_game',
	"parent_game_id" integer,
	"game_status" varchar(16),
	"popularity_score" integer DEFAULT 0 NOT NULL,
	"heat_level" integer DEFAULT 0 NOT NULL,
	"display_names" jsonb DEFAULT '{}'::jsonb,
	"search_text" text,
	"similar_igdb_ids" jsonb DEFAULT '[]'::jsonb,
	"alternative_names" jsonb DEFAULT '[]'::jsonb,
	"screenshot_urls" jsonb DEFAULT '[]'::jsonb,
	"trailer_url" text,
	"age_rating_label" varchar(32),
	"last_full_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "games_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "games_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	CONSTRAINT "genres_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "genres_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer,
	"code" varchar(32) NOT NULL,
	"name" varchar(100) NOT NULL,
	"native_name" varchar(100),
	CONSTRAINT "languages_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "languages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "platform_families" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	CONSTRAINT "platform_families_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "platform_families_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_release_dates" (
	"platform_id" integer NOT NULL,
	"region_id" integer NOT NULL,
	"release_date" date,
	"precision" date_precision DEFAULT 'day' NOT NULL,
	"source" varchar(16) DEFAULT 'igdb' NOT NULL,
	CONSTRAINT "platform_release_dates_platform_id_region_id_pk" PRIMARY KEY("platform_id","region_id")
);
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"abbreviation" varchar(32),
	"alternative_name" varchar(100),
	"kind" "platform_kind" DEFAULT 'other' NOT NULL,
	"generation" integer,
	"family_id" integer,
	"logo_url" text,
	"summary" text,
	"status" "platform_status" DEFAULT 'active' NOT NULL,
	"discontinued_on" date,
	"source" varchar(16) DEFAULT 'igdb' NOT NULL,
	CONSTRAINT "platforms_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "platforms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"platform_id" integer,
	"score_origin" varchar(32) NOT NULL,
	"score_provider" "score_provider" NOT NULL,
	"score_type" varchar(32) DEFAULT 'critic_aggregate' NOT NULL,
	"score" integer,
	"score_max" integer DEFAULT 100,
	"review_count" integer,
	"source_url" text,
	"fetched_at" timestamp with time zone DEFAULT now(),
	"next_refresh_at" timestamp with time zone,
	CONSTRAINT "ratings_game_platform_provider_type_uq" UNIQUE NULLS NOT DISTINCT("game_id","platform_id","score_provider","score_type")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(8) NOT NULL,
	"name" varchar(64) NOT NULL,
	CONSTRAINT "regions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "release_date_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"release_event_id" integer NOT NULL,
	"old_date" date,
	"old_precision" date_precision,
	"new_date" date,
	"new_precision" date_precision,
	"changed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "release_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"platform_id" integer NOT NULL,
	"region_id" integer NOT NULL,
	"release_date" date,
	"period_start" date,
	"precision" date_precision DEFAULT 'day' NOT NULL,
	"status" "release_status" DEFAULT 'scheduled' NOT NULL,
	"release_stage" "release_stage" DEFAULT 'unspecified' NOT NULL,
	"source_status" "source_status" DEFAULT 'active' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"source" varchar(32) DEFAULT 'igdb',
	"source_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "score_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"rating_id" integer NOT NULL,
	"score" integer,
	"review_count" integer,
	"recorded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" serial PRIMARY KEY NOT NULL,
	"igdb_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	CONSTRAINT "themes_igdb_id_unique" UNIQUE("igdb_id"),
	CONSTRAINT "themes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "event_games" ADD CONSTRAINT "event_games_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_games" ADD CONSTRAINT "event_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."event_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_id_rejections" ADD CONSTRAINT "external_id_rejections_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ids" ADD CONSTRAINT "external_ids_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_match_attempts" ADD CONSTRAINT "external_match_attempts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_companies" ADD CONSTRAINT "game_companies_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_companies" ADD CONSTRAINT "game_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_external_links" ADD CONSTRAINT "game_external_links_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_franchises" ADD CONSTRAINT "game_franchises_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_franchises" ADD CONSTRAINT "game_franchises_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_genres" ADD CONSTRAINT "game_genres_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_genres" ADD CONSTRAINT "game_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_language_supports" ADD CONSTRAINT "game_language_supports_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_language_supports" ADD CONSTRAINT "game_language_supports_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_localizations" ADD CONSTRAINT "game_localizations_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_platforms" ADD CONSTRAINT "game_platforms_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_platforms" ADD CONSTRAINT "game_platforms_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_popularity_signals" ADD CONSTRAINT "game_popularity_signals_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_similar_games" ADD CONSTRAINT "game_similar_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_similar_games" ADD CONSTRAINT "game_similar_games_similar_game_id_games_id_fk" FOREIGN KEY ("similar_game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_themes" ADD CONSTRAINT "game_themes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_themes" ADD CONSTRAINT "game_themes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_release_dates" ADD CONSTRAINT "platform_release_dates_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_release_dates" ADD CONSTRAINT "platform_release_dates_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platforms" ADD CONSTRAINT "platforms_family_id_platform_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."platform_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_date_history" ADD CONSTRAINT "release_date_history_release_event_id_release_events_id_fk" FOREIGN KEY ("release_event_id") REFERENCES "public"."release_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_events" ADD CONSTRAINT "release_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_events" ADD CONSTRAINT "release_events_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_events" ADD CONSTRAINT "release_events_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_feed_entity_idx" ON "change_feed" USING btree ("entity_type","entity_id","id");--> statement-breakpoint
CREATE INDEX "event_games_game_event_idx" ON "event_games" USING btree ("game_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_ids_game_source_uq" ON "external_ids" USING btree ("game_id","source");--> statement-breakpoint
CREATE INDEX "external_ids_source_external_idx" ON "external_ids" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "franchises_igdb_kind_uq" ON "franchises" USING btree ("igdb_id","kind");--> statement-breakpoint
CREATE INDEX "game_companies_company_game_idx" ON "game_companies" USING btree ("company_id","game_id");--> statement-breakpoint
CREATE INDEX "game_external_links_game_idx" ON "game_external_links" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_franchises_franchise_game_idx" ON "game_franchises" USING btree ("franchise_id","game_id");--> statement-breakpoint
CREATE INDEX "game_genres_genre_game_idx" ON "game_genres" USING btree ("genre_id","game_id");--> statement-breakpoint
CREATE INDEX "game_platforms_platform_game_idx" ON "game_platforms" USING btree ("platform_id","game_id");--> statement-breakpoint
CREATE INDEX "game_themes_theme_game_idx" ON "game_themes" USING btree ("theme_id","game_id");--> statement-breakpoint
CREATE INDEX "games_name_idx" ON "games" USING btree ("name");--> statement-breakpoint
CREATE INDEX "games_parent_game_idx" ON "games" USING btree ("parent_game_id");--> statement-breakpoint
CREATE INDEX "games_type_popularity_idx" ON "games" USING btree ("game_type","popularity_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "games_first_release_date_idx" ON "games" USING btree ("first_release_date");--> statement-breakpoint
CREATE INDEX "games_search_text_trgm_idx" ON "games" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ratings_next_refresh_idx" ON "ratings" USING btree ("next_refresh_at");--> statement-breakpoint
CREATE INDEX "release_events_date_platform_idx" ON "release_events" USING btree ("release_date","platform_id");--> statement-breakpoint
CREATE INDEX "release_events_region_date_idx" ON "release_events" USING btree ("region_id","release_date");--> statement-breakpoint
CREATE INDEX "release_events_period_start_idx" ON "release_events" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "release_events_diff_key_idx" ON "release_events" USING btree ("game_id","platform_id","region_id","release_stage");