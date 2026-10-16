/**
 * accounts 頁面的進入檢查（薄路由在回傳 JSX 之前呼叫，這樣 404 才是真正的 404 狀態碼）。
 * `await connection()`：模組是否啟用、註冊是否開放都是「執行時」環境變數，不能在 build 時預渲染固定下來。
 * 這些頁面沒有使用者專屬的伺服器內容（登入狀態由客戶端元件取得），但本身 noindex、不進 sitemap。
 */
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import type { AccountsPublicConfig } from "../domain/entities/public-config";
import { getAccountsPublicConfig } from "../use-cases/public-config";

export async function gateAccountsPage(options: { requireSignup?: boolean } = {}): Promise<AccountsPublicConfig> {
  await connection();
  if (!isModuleEnabled("accounts")) notFound();
  const config = getAccountsPublicConfig();
  if (options.requireSignup && !config.signupEnabled) notFound();
  return config;
}
