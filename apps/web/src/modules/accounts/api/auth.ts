/**
 * `/api/v1/auth/*` 的 Route Handler（薄路由 app/api/v1/auth/[...all]/route.ts 以 guardModule("accounts") 包住）。
 * 動態：每個請求都讀 Cookie 與資料庫；回應不可被任何快取存下來（Better Auth 的回應本身就帶 no-store）。
 */
import { connection } from "next/server";
import { handleAuthRequest } from "../use-cases/auth-request";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleAuthRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  await connection();
  return handleAuthRequest(request);
}
