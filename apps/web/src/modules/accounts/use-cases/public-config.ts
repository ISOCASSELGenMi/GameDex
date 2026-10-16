import type { AccountsPublicConfig } from "../domain/entities/public-config";
import { readAccountsPublicConfig } from "../providers/auth";

/** 登入頁／註冊頁要顯示什麼：哪些社群登入可用、是否開放註冊。只讀環境變數，不含 secret、不建立 Better Auth。 */
export function getAccountsPublicConfig(): AccountsPublicConfig {
  return readAccountsPublicConfig();
}
