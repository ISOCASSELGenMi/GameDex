"use client";
/**
 * 帳號頁殼取得的登入狀態（GameDex 第 2 段）。殼（account/layout）在客戶端取一次 session 與停權狀態，
 * 各分頁的 RequireUser 直接讀這裡，不再各自重打 /get-session 與 /account。沒有殼（Provider）時 RequireUser 退回自己取。
 */
import { createContext, useContext } from "react";
import type { SessionUser } from "./auth-api";

export type AccountSession = { kind: "loading" } | { kind: "anonymous" } | { kind: "user"; user: SessionUser; suspended: boolean };

export const AccountSessionContext = createContext<AccountSession | null>(null);

/** 殼提供的登入狀態；沒有殼時為 null。 */
export function useAccountSession(): AccountSession | null {
  return useContext(AccountSessionContext);
}
