CREATE TABLE "owned_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"connected_account_id" integer NOT NULL,
	"external_game_id" varchar(128) NOT NULL,
	"external_title" text NOT NULL,
	"matched_game_id" integer,
	"match_confidence_pct" integer,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owned_games" ADD CONSTRAINT "owned_games_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owned_games_account_external_uq" ON "owned_games" USING btree ("connected_account_id","external_game_id");--> statement-breakpoint
CREATE INDEX "owned_games_unmatched_idx" ON "owned_games" USING btree ("id") WHERE "owned_games"."match_confidence_pct" IS NULL;--> statement-breakpoint
CREATE INDEX "owned_games_matched_game_idx" ON "owned_games" USING btree ("matched_game_id");--> statement-breakpoint
-- 手寫：跨模組外鍵（accounts → catalog.games）。accounts/schema.ts 不能 import catalog 的 schema（lint:arch），
-- 所以 drizzle 看不到這條；之後 db:generate 不會嘗試移除它。遊戲被刪時只清掉比對結果，不刪匯入紀錄。
ALTER TABLE "owned_games" ADD CONSTRAINT "owned_games_matched_game_id_games_id_fk" FOREIGN KEY ("matched_game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;
