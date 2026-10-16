CREATE TYPE "public"."play_status" AS ENUM('want_to_play', 'playing', 'finished', 'completed', 'paused', 'abandoned');--> statement-breakpoint
CREATE TABLE "game_player_ratings" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"avg_half_steps" numeric(4, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"avg_play_minutes" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"platform_id" integer,
	"status" "play_status" NOT NULL,
	"started_on" date,
	"finished_on" date,
	"play_minutes" integer,
	"rating_half_steps" smallint,
	"review" text,
	"review_has_spoilers" boolean DEFAULT false NOT NULL,
	"review_visibility" "review_visibility" DEFAULT 'public' NOT NULL,
	"private_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_list_games" (
	"list_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_list_games_list_id_game_id_pk" PRIMARY KEY("list_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "user_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"visibility" "list_visibility" DEFAULT 'private' NOT NULL,
	"share_token" varchar(32),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_lists_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
ALTER TABLE "owned_games" ADD COLUMN "match_method" varchar(8) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "play_records" ADD CONSTRAINT "play_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_list_games" ADD CONSTRAINT "user_list_games_list_id_user_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."user_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lists" ADD CONSTRAINT "user_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_records_user_game_idx" ON "play_records" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "play_records_game_rated_idx" ON "play_records" USING btree ("game_id") WHERE "play_records"."rating_half_steps" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "play_records_user_updated_idx" ON "play_records" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "user_list_games_game_idx" ON "user_list_games" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "user_list_games_list_position_idx" ON "user_list_games" USING btree ("list_id","position");--> statement-breakpoint
CREATE INDEX "user_lists_user_sort_idx" ON "user_lists" USING btree ("user_id","sort_order","id");--> statement-breakpoint
-- 手寫：跨模組外鍵（accounts → catalog）。accounts/schema.ts 不能 import catalog 的 schema（lint:arch），所以 drizzle 看不到這幾條；
-- 之後 db:generate 不會嘗試移除它們。遊戲被刪時：清單項目、遊玩紀錄、玩家平均跟著刪；平台被刪時只清掉遊玩紀錄的平台欄位。
ALTER TABLE "user_list_games" ADD CONSTRAINT "user_list_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_records" ADD CONSTRAINT "play_records_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_records" ADD CONSTRAINT "play_records_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_player_ratings" ADD CONSTRAINT "game_player_ratings_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 手寫：資料完整性（應用層已驗證，這裡是最後一道）
ALTER TABLE "play_records" ADD CONSTRAINT "play_records_rating_range_ck" CHECK ("rating_half_steps" IS NULL OR ("rating_half_steps" BETWEEN 1 AND 20));--> statement-breakpoint
ALTER TABLE "play_records" ADD CONSTRAINT "play_records_play_minutes_ck" CHECK ("play_minutes" IS NULL OR "play_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "play_records" ADD CONSTRAINT "play_records_dates_ck" CHECK ("started_on" IS NULL OR "finished_on" IS NULL OR "finished_on" >= "started_on");--> statement-breakpoint
ALTER TABLE "owned_games" ADD CONSTRAINT "owned_games_match_method_ck" CHECK ("match_method" IN ('auto', 'manual'));
