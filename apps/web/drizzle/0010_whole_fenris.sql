CREATE TYPE "public"."feed_type" AS ENUM('all', 'releases', 'events', 'following');--> statement-breakpoint
CREATE TYPE "public"."follow_target" AS ENUM('game', 'event', 'platform', 'franchise', 'company');--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_ciphertext" text,
	"name" varchar(100) DEFAULT 'My Game Calendar' NOT NULL,
	"locale" varchar(16) DEFAULT 'zh-Hant' NOT NULL,
	"settings_version" integer DEFAULT 0 NOT NULL,
	"feed_type" "feed_type" DEFAULT 'all' NOT NULL,
	"filter_platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filter_regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filter_genres" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filter_stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"include_releases" boolean DEFAULT true NOT NULL,
	"include_events" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"user_id" integer NOT NULL,
	"target_type" "follow_target" NOT NULL,
	"target_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_user_id_target_type_target_id_pk" PRIMARY KEY("user_id","target_type","target_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_following_active_uq" ON "calendar_feeds" USING btree ("user_id") WHERE "calendar_feeds"."feed_type" = 'following' AND "calendar_feeds"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "calendar_feeds_user_created_idx" ON "calendar_feeds" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "follows_by_target_idx" ON "follows" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "follows_user_created_idx" ON "follows" USING btree ("user_id","created_at");