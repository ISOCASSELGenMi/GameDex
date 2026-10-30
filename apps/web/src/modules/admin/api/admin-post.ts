/**
 * 管理介面 POST 的共同前置檢查（12）：Basic auth（與 proxy 同一個函式）→ 同源 → CSRF token → 解析表單。
 * 回傳表單與操作者（Basic auth 的使用者名稱，稽核用）；任一關不過就回對應的 Response。
 */
import { adminGateResponse, checkAdminGate, parseBasicAuth } from "@/kernel/http/admin-gate";
import { isSameOrigin, verifyCsrfToken } from "../csrf";

export const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

export type AdminPostCheck = { ok: true; form: FormData; actor: string } | { ok: false; response: Response };

export async function checkAdminPost(request: Request): Promise<AdminPostCheck> {
  const authorization = request.headers.get("authorization");
  const denied = adminGateResponse(checkAdminGate(authorization));
  if (denied) return { ok: false, response: denied };
  if (!isSameOrigin(request.headers)) return { ok: false, response: new Response("Forbidden", { status: 403, headers: NO_STORE }) };
  const form = await request.formData().catch(() => null);
  const csrf = form?.get("csrf");
  if (!form || typeof csrf !== "string" || !verifyCsrfToken(csrf, process.env.ADMIN_BASIC_AUTH_PASS ?? "")) {
    return { ok: false, response: new Response("Forbidden", { status: 403, headers: NO_STORE }) };
  }
  return { ok: true, form, actor: parseBasicAuth(authorization)?.user ?? "admin" };
}

/** 303 回到某個內部頁，結果以 query 帶回（相對網址：不依賴對外網域設定）。 */
export function redirectBack(path: string, params: Record<string, string>): Response {
  const q = new URLSearchParams(params).toString();
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: `${path}${q ? `?${q}` : ""}` } });
}
