/**
 * POST /internal/users/{id}：停權／解除停權（12 §帳號停權）。app/internal/users/[id]/route.ts 是薄路由。
 * 檢查順序同 admin 的回報審核：Basic auth（與 proxy 同一個函式）→ 同源 → CSRF token → 動作。
 * CSRF 與同源檢查的實作在 admin 模組（原則五：只實作一次）；accounts 不能 import admin，所以由薄路由注入。
 * 表單欄位：action（suspend|unsuspend）、csrf、q（回到搜尋結果用）。成功後 303 回 /internal/users，結果以 query 帶回。
 */
import { adminGateResponse, checkAdminGate } from "@/kernel/http/admin-gate";
import { adminSetSuspended } from "./account-self";

export interface AdminCsrfDeps {
  verifyCsrfToken(token: string | null | undefined, secretMaterial: string): boolean;
  isSameOrigin(headers: Headers): boolean;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

function back(params: Record<string, string>): Response {
  const q = new URLSearchParams(params).toString();
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: `/internal/users${q ? `?${q}` : ""}` } });
}

export async function handleAdminUserAction(request: Request, rawId: string, deps: AdminCsrfDeps): Promise<Response> {
  const denied = adminGateResponse(checkAdminGate(request.headers.get("authorization")));
  if (denied) return denied;
  if (!deps.isSameOrigin(request.headers)) return new Response("Forbidden", { status: 403, headers: NO_STORE });

  const form = await request.formData().catch(() => null);
  const csrf = form?.get("csrf");
  if (!form || typeof csrf !== "string" || !deps.verifyCsrfToken(csrf, process.env.ADMIN_BASIC_AUTH_PASS ?? "")) {
    return new Response("Forbidden", { status: 403, headers: NO_STORE });
  }
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : NaN;
  const action = form.get("action");
  const q = form.get("q");
  if (!Number.isInteger(id) || (action !== "suspend" && action !== "unsuspend") || (q !== null && typeof q !== "string")) {
    return new Response("Bad Request", { status: 400, headers: NO_STORE });
  }
  const keep: Record<string, string> = q && q.length <= 200 ? { q } : {};
  const res = await adminSetSuspended(id, action === "suspend");
  if (!res.ok) return back({ ...keep, error: res.code, id: String(id) });
  return back({ ...keep, done: action, id: String(id), ...(res.changed ? {} : { unchanged: "1" }), ...(action === "suspend" ? { revoked: String(res.revokedSessions) } : {}) });
}
