/**
 * 刪除帳號、資料匯出、偏好的 Route Handler（薄路由 app/api/v1/account/** 以 guardModule("accounts") 包住）。
 * 動態：每個請求都讀 Cookie 與資料庫。
 */
import { connection } from "next/server";
import * as r from "../use-cases/account-self-request";

export async function account(request: Request): Promise<Response> {
  await connection();
  return r.handleAccountDelete(request);
}
export async function accountExport(request: Request): Promise<Response> {
  await connection();
  return r.handleAccountExport(request);
}
export async function accountPreferences(request: Request): Promise<Response> {
  await connection();
  return r.handleAccountPreferences(request);
}
