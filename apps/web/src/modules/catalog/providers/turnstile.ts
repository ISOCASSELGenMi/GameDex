/**
 * Cloudflare Turnstile 的伺服器端驗證（siteverify）。外部 API 的欄位名稱（`success`、`error-codes`）只出現在這個檔案。
 * 文件：https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare 官方測試金鑰（永遠通過／永遠失敗；僅供開發與自動測試，不可用在 production）。 */
export const TURNSTILE_TEST_SITE_KEY_PASS = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_PASS = "1x0000000000000000000000000000000AA";
export const TURNSTILE_TEST_SECRET_FAIL = "2x0000000000000000000000000000000AA";

export type TurnstileResult =
  | { ok: true }
  /** 驗證不通過（token 無效、過期、重複使用…）。 */
  | { ok: false; reason: "rejected"; codes: string[] }
  /** 驗證服務連不上或回應異常；呼叫端不應當成使用者的錯。 */
  | { ok: false; reason: "unavailable" };

export interface TurnstileOptions {
  secret: string;
  /** 預設 Cloudflare 官方網址；測試可指向本機假伺服器。 */
  verifyUrl?: string;
  remoteIp?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function verifyTurnstileToken(token: string, opts: TurnstileOptions): Promise<TurnstileResult> {
  if (token.trim() === "" || token.length > 4096) return { ok: false, reason: "rejected", codes: ["missing-input-response"] };
  const body = new URLSearchParams({ secret: opts.secret, response: token });
  if (opts.remoteIp) body.set("remoteip", opts.remoteIp);
  try {
    const res = await (opts.fetchImpl ?? fetch)(opts.verifyUrl ?? TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const json = (await res.json()) as { success?: unknown; "error-codes"?: unknown };
    if (json.success === true) return { ok: true };
    const codes = Array.isArray(json["error-codes"]) ? json["error-codes"].filter((c): c is string => typeof c === "string") : [];
    // internal-error 是 Cloudflare 端的問題，不是 token 的問題
    if (codes.includes("internal-error")) return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "rejected", codes };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
