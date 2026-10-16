/**
 * Better Auth 的資料庫轉接器：整個 accounts 唯一同時碰 drizzle adapter 與 schema.ts 的地方（K 報告 §5）。
 * adapter 的 schema 物件 key 必須等於 modelName（我方 drizzle 匯出名）。
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDb } from "@/kernel/db/client";
import { authVerifications, connectedAccounts, sessions, users } from "../schema";

export function createAuthDatabaseAdapter() {
  return drizzleAdapter(getDb(), {
    provider: "pg",
    schema: { users, connectedAccounts, sessions, authVerifications },
  });
}
