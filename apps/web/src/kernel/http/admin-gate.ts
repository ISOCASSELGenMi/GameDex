import { createHash, timingSafeEqual } from "node:crypto";
import type { EnvLike } from "../config/env";
import { isModuleEnabled } from "../modules/enabled";

/**
 * `/internal/*`（admin 模組）的入口檢查（12：首版以 ADMIN_BASIC_AUTH_USER／_PASS 保護）。
 * proxy.ts（頁面）與 admin 的 route handler（POST）共用同一份判斷（原則五）。kernel 不 import 任何模組，所以只認模組名稱。
 *
 * 結果與對應回應：
 * - disabled：MODULES 沒有 admin → 404
 * - unconfigured：帳密未設 → 404（「未設＝拒絕全部」；回 404 不透露這個路徑存在，設定問題由啟動 log 的 warn 提醒）
 * - unauthorized：缺少或錯誤的帳密 → 401＋WWW-Authenticate
 * - ok：放行
 */
export type AdminGateResult = "ok" | "disabled" | "unconfigured" | "unauthorized";

const sha = (s: string) => createHash("sha256").update(s).digest();

/** 解析 `Authorization: Basic …`；格式不對回 null。密碼可含冒號（只切第一個）。 */
export function parseBasicAuth(header: string | null | undefined): { user: string; pass: string } | null {
  if (!header) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

export function checkAdminGate(authorization: string | null | undefined, env: EnvLike = process.env): AdminGateResult {
  if (!isModuleEnabled("admin", env)) return "disabled";
  const user = env.ADMIN_BASIC_AUTH_USER?.trim() ? env.ADMIN_BASIC_AUTH_USER : "";
  const pass = env.ADMIN_BASIC_AUTH_PASS?.trim() ? env.ADMIN_BASIC_AUTH_PASS : "";
  if (user === "" || pass === "") return "unconfigured";
  const given = parseBasicAuth(authorization);
  if (!given) return "unauthorized";
  // 兩個欄位都比對（不短路），並比雜湊以避免長度洩漏
  const okUser = timingSafeEqual(sha(given.user), sha(user));
  const okPass = timingSafeEqual(sha(given.pass), sha(pass));
  return okUser && okPass ? "ok" : "unauthorized";
}

/** 對應的 Response（ok 回 null）。所有回應都 no-store。 */
export function adminGateResponse(result: AdminGateResult): Response | null {
  if (result === "ok") return null;
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (result === "unauthorized") {
    headers["WWW-Authenticate"] = 'Basic realm="SoK admin", charset="UTF-8"';
    return new Response("Unauthorized", { status: 401, headers });
  }
  return new Response("Not Found", { status: 404, headers });
}

let warnedUnconfigured = false;
/** 啟動時提醒（bootstrap 呼叫）：admin 啟用但帳密未設，/internal 會整個回 404。 */
export function warnIfAdminUnconfigured(env: EnvLike = process.env, log: (m: string) => void = console.warn): void {
  if (warnedUnconfigured) return;
  if (isModuleEnabled("admin", env) && checkAdminGate(null, env) === "unconfigured") {
    warnedUnconfigured = true;
    log("[kernel] admin 模組已啟用，但 ADMIN_BASIC_AUTH_USER／ADMIN_BASIC_AUTH_PASS 未設定：/internal/* 一律回 404");
  }
}
