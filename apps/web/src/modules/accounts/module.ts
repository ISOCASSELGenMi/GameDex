import type { ComponentType } from "react";
import type { ModuleManifestBase } from "@/kernel/modules/types";
import { HeaderRightSlot } from "./ui/header-slot";
import { cleanupExpiredAuthRows } from "./use-cases/cleanup-expired";
import { matchOwnedGames } from "./use-cases/owned-games";

/**
 * accounts 模組（02、09）：帳號、登入（Better Auth；D76）、之後的收藏／追蹤／遊玩紀錄。
 * - 停用時網站照常運作：header 只剩語言選單、`/api/v1/auth/*` 與帳號頁 404。
 * - requiredEnv：AUTH_SECRET（session／cookie 簽章）、TOKEN_ENCRYPTION_KEY（OAuth token 加密）。
 *   各 social provider 的 *_CLIENT_ID／_SECRET 不是必填：兩者都有才啟用該 provider。
 * - 註冊預設關閉（ACCOUNTS_SIGNUP_ENABLED=false；D81）。
 */
export const accountsModule: ModuleManifestBase = {
  name: "accounts",
  kind: "optional",
  requires: [],
  requiredEnv: ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY"],
  ownedTables: ["users", "connected_accounts", "sessions", "auth_verifications", "auth_tokens", "owned_games"],
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
  ],
  uiSlots: { "header.right": HeaderRightSlot as ComponentType },
  i18nNamespaces: ["accounts"],
};
