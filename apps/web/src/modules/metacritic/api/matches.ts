/**
 * POST /internal/matches/action：確認／清除／手動輸入外部 ID（12 §比對覆核）。薄路由 app/internal/matches/action/route.ts 以 guardModule("metacritic") 包住，
 * 並注入 admin 模組的 CSRF 與同源檢查（metacritic 不能 import admin；同 accounts 的停權 POST）。
 * 檢查順序：Basic auth（與 proxy 同一個函式）→ 同源 → CSRF token → 動作。
 */
import { connection } from "next/server";
import { adminGateResponse, checkAdminGate } from "@/kernel/http/admin-gate";
import { applyReviewAction, type ReviewAction } from "../use-cases/review";

export interface AdminCsrfDeps {
  verifyCsrfToken(token: string | null | undefined, secretMaterial: string): boolean;
  isSameOrigin(headers: Headers): boolean;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

function back(params: Record<string, string>): Response {
  const q = new URLSearchParams(params).toString();
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: `/internal/matches${q ? `?${q}` : ""}` } });
}

const posInt = (v: FormDataEntryValue | null): number => (typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : NaN);

export function createMatchesPost(deps: AdminCsrfDeps) {
  return async function POST(request: Request): Promise<Response> {
    await connection();
    const denied = adminGateResponse(checkAdminGate(request.headers.get("authorization")));
    if (denied) return denied;
    if (!deps.isSameOrigin(request.headers)) return new Response("Forbidden", { status: 403, headers: NO_STORE });
    const form = await request.formData().catch(() => null);
    const csrf = form?.get("csrf");
    if (!form || typeof csrf !== "string" || !deps.verifyCsrfToken(csrf, process.env.ADMIN_BASIC_AUTH_PASS ?? "")) {
      return new Response("Forbidden", { status: 403, headers: NO_STORE });
    }
    const action = form.get("action");
    let parsed: ReviewAction | null = null;
    if (action === "confirm" || action === "reject") {
      const id = posInt(form.get("id"));
      if (Number.isInteger(id)) parsed = { action, id };
    } else if (action === "manual") {
      const gameId = posInt(form.get("gameId"));
      const slug = form.get("slug");
      if (Number.isInteger(gameId) && typeof slug === "string" && slug.length <= 255) parsed = { action, gameId, slug };
    }
    if (!parsed) return new Response("Bad Request", { status: 400, headers: NO_STORE });
    const res = await applyReviewAction(parsed);
    return res.ok ? back({ done: parsed.action }) : back({ error: res.error });
  };
}
