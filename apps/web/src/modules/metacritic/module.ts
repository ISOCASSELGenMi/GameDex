import type { ModuleManifest, RatingColumn } from "@/modules/catalog";
import { METACRITIC_SOURCE } from "./provider/provider";
import { refreshSlugIndex, runRepairMatches, runSyncRatings } from "./use-cases/jobs";

/** 評分排名頁的 Metascore 欄（05、06；純文字名稱，不用官方配色或 Logo）。 */
export const metascoreColumn: RatingColumn = {
  id: "metascore",
  scoreProvider: METACRITIC_SOURCE,
  scoreType: "metascore",
  labelKey: "ui.ratings.col.metascore",
  countLabelKey: "ui.ratings.count.critics",
  scale: "hundred",
  defaultMinVotes: () => 10,
};

/** Userscore 欄：10 分制（ratings 內以 100 分制存，÷10 顯示一位小數）。 */
export const userscoreColumn: RatingColumn = {
  id: "userscore",
  scoreProvider: METACRITIC_SOURCE,
  scoreType: "user_score",
  labelKey: "ui.ratings.col.userscore",
  countLabelKey: "ui.ratings.count.userRatings",
  scale: "ten",
  defaultMinVotes: () => 50,
};

/**
 * metacritic 模組（02、05、Phase 6）：Metacritic 的 RatingProvider。**預設關閉**，唯一的開關是 METACRITIC_SCRAPE_ENABLED（原則三），
 * 不受 MODULES 控制。關閉時 registry 不收這個模組：不註冊任務、不註冊排名欄、不碰 metacritic.com。
 * 啟用後還有第二道開關：後台「允許抓取」（kernel/settings metacritic.scrapeAllowed，預設關）——兩者皆開才會發出請求。
 * 擁有的表：metacritic_slugs（sitemap 取得的 slug 索引）；移除模組時 drop，並刪 ratings／external_ids 中 metacritic_scrape 的列。
 */
export const metacriticModule: ModuleManifest = {
  name: "metacritic",
  kind: "optional",
  requires: [],
  requiredEnv: [],
  ownedTables: ["metacritic_slugs"],
  jobs: [
    {
      // 每週：從公開 sitemap 更新 slug 索引（站內搜尋被 robots.txt 禁止）。手動：npm run job -- refresh_metacritic_index
      name: "refresh_metacritic_index",
      cron: "20 5 * * 0",
      lockMode: "session",
      run: async (ctx) => {
        await refreshSlugIndex({ log: ctx.log });
      },
    },
    {
      // 每日：模糊比對、寫 external_ids（05 §修復排程）
      name: "repair_matches_metacritic",
      cron: "40 5 * * *",
      lockMode: "session",
      run: async (ctx) => {
        await runRepairMatches({ log: ctx.log });
      },
    },
    {
      // 每小時：只對已確認的外部 ID 抓分數；每輪有上限、共用每日額度（05 §分層排程）
      name: "sync_ratings",
      cron: "55 * * * *",
      lockMode: "session",
      run: async (ctx) => {
        await runSyncRatings({ log: ctx.log });
      },
    },
  ],
  ratingColumns: [metascoreColumn, userscoreColumn],
};
