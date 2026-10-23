-- Z6 效能：/games 分組檢視與平台頁「全部遊戲」的預先計算與 index。
-- 套用後必須執行一次：npm run job -- backfill_game_groups（補 games.release_group／publisher_group 與 release_picks，可續跑；完成後自動 VACUUM ANALYZE）。
-- 回填前 release_group 全是 'tbd'、publisher_group 全是 -1，/games?by=date|publisher 會把所有遊戲歸成一組。
CREATE TABLE "release_picks" (
	"game_id" integer NOT NULL,
	"platform_id" integer NOT NULL,
	"release_stage" "release_stage" NOT NULL,
	"release_event_id" integer NOT NULL,
	"release_date" date,
	"precision" date_precision NOT NULL,
	CONSTRAINT "release_picks_game_id_platform_id_release_stage_pk" PRIMARY KEY("game_id","platform_id","release_stage")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "release_group" varchar(8) DEFAULT 'tbd' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "publisher_group" smallint DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "release_picks" ADD CONSTRAINT "release_picks_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_picks" ADD CONSTRAINT "release_picks_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_picks_platform_date_idx" ON "release_picks" USING btree ("platform_id","release_date" DESC NULLS LAST,"game_id");--> statement-breakpoint
CREATE INDEX "release_picks_platform_game_idx" ON "release_picks" USING btree ("platform_id","game_id");--> statement-breakpoint
CREATE INDEX "games_release_group_browse_idx" ON "games" USING btree ("release_group","popularity_score" DESC NULLS LAST,"name","id","game_type","game_status","heat_level","first_release_date");--> statement-breakpoint
CREATE INDEX "games_publisher_group_browse_idx" ON "games" USING btree ("publisher_group","popularity_score" DESC NULLS LAST,"name","id","game_type","game_status","heat_level","first_release_date");--> statement-breakpoint
CREATE INDEX "games_browse_pop_idx" ON "games" USING btree ("popularity_score" DESC NULLS LAST,"name","id","game_type","game_status","heat_level","first_release_date");--> statement-breakpoint
CREATE INDEX "games_dname_zh_hant_idx" ON "games" USING btree ((lower(COALESCE(NULLIF("display_names" ->> 'zh-Hant', ''), "name"))),"id","game_type","game_status");--> statement-breakpoint
CREATE INDEX "games_dname_en_idx" ON "games" USING btree ((lower(COALESCE(NULLIF("display_names" ->> 'en', ''), "name"))),"id","game_type","game_status");--> statement-breakpoint
CREATE INDEX "games_dname_ja_idx" ON "games" USING btree ((lower(COALESCE(NULLIF("display_names" ->> 'ja', ''), "name"))),"id","game_type","game_status");--> statement-breakpoint
CREATE INDEX "games_browse_cover_idx" ON "games" USING btree ("id","game_type","game_status","heat_level","popularity_score","first_release_date","first_release_precision","name","display_names");