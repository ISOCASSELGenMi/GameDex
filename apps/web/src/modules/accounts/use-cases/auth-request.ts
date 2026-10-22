/**
 * `/api/v1/auth/*` 的請求處理（薄路由 app/api/v1/auth/[...all] 經 api/auth.ts 呼叫）。
 * 在交給 Better Auth 之前做三件事：
 * 1. 註冊關閉（ACCOUNTS_SIGNUP_ENABLED=false）時 POST sign-up/email 回 404（入口不存在；既有帳號登入不受影響）。
 * 2. 封鎖我們不開放的 BA 端點（回傳 token 密文／帳號資訊；本專案的匯入走自己的 use case）。
 * 3. 註冊欄位長度（資料庫欄位上限）：超過回 400，避免變成 500。
 */
import { DISPLAY_NAME_MAX } from "../domain/entities/account-self";
import { AUTH_BASE_PATH, readAccountsPublicConfig } from "../providers/auth";
import { getAuth } from "./auth-instance";

const BLOCKED_PATHS = new Set(["/get-access-token", "/refresh-token", "/account-info"]);
export const EMAIL_MAX = 255;

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

function badRequest(code: string): Response {
  return Response.json({ code, message: code }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export function authSubPath(url: string): string {
  const p = new URL(url).pathname;
  return p.startsWith(AUTH_BASE_PATH) ? p.slice(AUTH_BASE_PATH.length) || "/" : p;
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const path = authSubPath(request.url);
  if (BLOCKED_PATHS.has(path)) return notFound();
  // header 的帳號選單要知道是否開放註冊（執行時的環境變數；頁面 HTML 是預渲染的，不能把它烤進去）
  if (path === "/public-config") {
    if (request.method !== "GET") return notFound();
    return Response.json(readAccountsPublicConfig(), { headers: { "Cache-Control": "public, max-age=300" } });
  }
  if (path === "/sign-up/email") {
    if (request.method !== "POST" || !readAccountsPublicConfig().signupEnabled) return notFound();
    const body = (await request.clone().json().catch(() => null)) as { name?: unknown; email?: unknown } | null;
    if (typeof body?.name === "string" && body.name.length > DISPLAY_NAME_MAX) return badRequest("NAME_TOO_LONG");
    if (typeof body?.email === "string" && body.email.length > EMAIL_MAX) return badRequest("EMAIL_TOO_LONG");
  }
  return getAuth().handler(request);
}
