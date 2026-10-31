/**
 * POST /internal/reports/{id}：核可／駁回／標重複（12）。app/internal/reports/[id]/route.ts 只是薄路由。
 * 表單欄位：action（accept|reject|duplicate）、note、csrf。成功後 303 回佇列頁，結果以 query 帶回（flash）。
 * 檢查順序：Basic auth（與 proxy 同一個函式）→ 同源 → CSRF token → 動作。
 */
import { revalidateTag } from "next/cache";
import { connection } from "next/server";
import { adminGateResponse, checkAdminGate } from "@/kernel/http/admin-gate";
import { REPORT_ACTIONS, gameDetailTag, resolveReport, type ReportAction } from "@/modules/catalog";
import { isSameOrigin, verifyCsrfToken } from "../csrf";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

function back(request: Request, params: Record<string, string>): Response {
  const q = new URLSearchParams(params).toString();
  // 相對網址：不依賴對外網域設定
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: `/internal/reports${q ? `?${q}` : ""}` } });
}

const isAction = (v: unknown): v is ReportAction => typeof v === "string" && (REPORT_ACTIONS as readonly string[]).includes(v);

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const denied = adminGateResponse(checkAdminGate(request.headers.get("authorization")));
  if (denied) return denied;
  if (!isSameOrigin(request.headers)) return new Response("Forbidden", { status: 403, headers: NO_STORE });

  const pass = process.env.ADMIN_BASIC_AUTH_PASS ?? "";
  const form = await request.formData().catch(() => null);
  const csrf = form?.get("csrf");
  if (!form || typeof csrf !== "string" || !verifyCsrfToken(csrf, pass)) {
    return new Response("Forbidden", { status: 403, headers: NO_STORE });
  }

  const { id: rawId } = await ctx.params;
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : NaN;
  const action = form.get("action");
  const note = form.get("note");
  if (!Number.isInteger(id) || !isAction(action) || (note !== null && typeof note !== "string")) {
    return new Response("Bad Request", { status: 400, headers: NO_STORE });
  }

  const res = await resolveReport(id, action, note);
  if (!res.ok) return back(request, { error: res.error, id: String(id), ...(res.detail ? { detail: res.detail } : {}) });
  // 詳情頁是 ISR 快取：寫入 manual 上市列後立刻讓該遊戲的詳情頁重建
  // localized_title 改的是顯示名稱，同樣要重建詳情頁
  const slug = res.applied?.gameSlug ?? res.titleApplied?.gameSlug;
  if (slug) revalidateTag(gameDetailTag(slug), { expire: 0 });
  return back(request, { done: action, id: String(id), ...(res.applied ? { applied: res.applied.result } : {}) });
}
