-- GameDex 第 2 輪（Z2B）：站內玩家平均寫入 ratings 的來源名（評分排名頁 players 欄）＋搜尋候選的名稱完全相同索引
ALTER TYPE "public"."score_provider" ADD VALUE 'site_players';--> statement-breakpoint
CREATE INDEX "games_lower_name_prefix_idx" ON "games" USING btree (lower("name") text_pattern_ops);