import type { ComponentType } from "react";
import type { ModuleManifest } from "@/modules/catalog";
import { GameActionsSlot, PlayerRatingSlot } from "./ui/game-slots";
import { HeaderRightSlot } from "./ui/header-slot";
import { cleanupExpiredAuthRows } from "./use-cases/cleanup-expired";
import { mineGameFilter, siteFollows7dSignal, siteFollowsSignal } from "./use-cases/catalog-extensions";
import { cleanupOrphanFollows } from "./use-cases/follows";
import { matchOwnedGames } from "./use-cases/owned-games";
import { runRefreshPlayerRatings } from "./use-cases/play-records";

/**
 * accounts 模組（02、09）：帳號、登入（Better Auth；D76）、之後的收藏／追蹤／遊玩紀錄。
 * - 停用時網站照常運作：header 只剩語言選單、`/api/v1/auth/*` 與帳號頁 404。
 * - requiredEnv：AUTH_SECRET（session／cookie 簽章）、TOKEN_ENCRYPTION_KEY（OAuth token 加密）。
 *   各 social provider 的 *_CLIENT_ID／_SECRET 不是必填：兩者都有才啟用該 provider。
 * - 註冊預設關閉（ACCOUNTS_SIGNUP_ENABLED=false；D81）。
 */
export const accountsModule: ModuleManifest = {
  name: "accounts",
  kind: "optional",
  requires: [],
  requiredEnv: ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY"],
  ownedTables: ["users", "connected_accounts", "sessions", "auth_verifications", "auth_tokens", "owned_games", "user_lists", "user_list_games", "play_records", "game_player_ratings", "follows", "calendar_feeds"],
  jobs: [
    {
      name: "cleanup_auth_rows",
      cron: "35 3 * * *", // 每日：過期 session 與 auth_verifications
      run: async (ctx) => {
        await cleanupExpiredAuthRows(ctx.startedAt, ctx.log);
      },
    },
    {
      // 第 3 波：遊戲庫（Steam）比對。每次最多 500 列、只處理尚未比對的列；匯入當下另由 after() 先比對該帳號
      name: "match_owned_games",
      cron: "7,22,37,52 * * * *",
      lockMode: "session",
      run: async (ctx) => {
        const s = await matchOwnedGames({ log: ctx.log });
        ctx.log("match_owned_games", { ...s });
      },
    },
    {
      // 第 6 波：追蹤的孤兒清理（03：follows 沒有 FK；catalog 刪除目標後由這裡刪列）。每晚，非整點。
      name: "cleanup_orphan_follows",
      cron: "47 3 * * *",
      run: async (ctx) => {
        const r = await cleanupOrphanFollows();
        ctx.log("cleanup_orphan_follows", { ...r });
      },
    },
    {
      // 第 5 波：玩家平均（D68）。全量重算（一個 SQL statement、毫秒～秒級）；每小時、避開整點與其他任務。
      // 用 tx 鎖即可：單一 statement，不是長任務。
      name: "refresh_player_ratings",
      cron: "17 * * * *",
      run: async (ctx) => {
        const r = await runRefreshPlayerRatings();
        ctx.log("refresh_player_ratings", { ...r });
      },
    },
  ],
  // 第 6 波：擴充點（catalog 的 PopularitySignal／GameFilterProvider）。registry 收集已啟用模組的這兩個欄位後注入 catalog；
  // accounts 停用時兩者都不存在，catalog 行為與沒有擴充點時完全相同。
  popularitySignals: [siteFollowsSignal, siteFollows7dSignal],
  gameFilters: [mineGameFilter],
  uiSlots: {
    "header.right": HeaderRightSlot as ComponentType,
    // 第 5 波：詳情頁動作列（加入清單、記錄遊玩）與玩家平均區。伺服器 HTML 與使用者無關，使用者狀態由客戶端元件取得
    "game.actions": GameActionsSlot as ComponentType,
    "game.sections": PlayerRatingSlot as ComponentType,
  },
  i18nNamespaces: ["accounts"],
};
