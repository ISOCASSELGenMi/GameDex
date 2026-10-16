/**
 * Steam OpenID 2.0 的純函式：組跳轉網址、驗證 id_res（含向 Steam 做 check_authentication）。
 * Steam 不是 OAuth：沒有 code／token，只有 checkid_setup → id_res → check_authentication。
 * 唯一的信任來源是 Steam 對 check_authentication 回 `is_valid:true`；本地欄位檢查是縱深防禦。
 */
export const STEAM_PROVIDER_ID = "steam";
export const STEAM_OP_ENDPOINT = "https://steamcommunity.com/openid/login";
export const OPENID_NS = "http://specs.openid.net/auth/2.0";
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
export const NONCE_MAX_AGE_MS = 5 * 60_000;
export const STEAM_VERIFY_TIMEOUT_MS = 8000;

export function buildSteamAuthUrl(returnTo: string, realm: string): string {
  const p = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": `${OPENID_NS}/identifier_select`,
    "openid.claimed_id": `${OPENID_NS}/identifier_select`,
  });
  return `${STEAM_OP_ENDPOINT}?${p}`;
}

export type SteamVerifyFailure = "not_id_res" | "bad_op_endpoint" | "bad_return_to" | "bad_claimed_id" | "identity_mismatch" | "stale_nonce" | "not_valid" | "network";
export type SteamVerifyResult = { ok: true; steamId: string } | { ok: false; reason: SteamVerifyFailure };

export async function verifySteamAssertion(
  query: Record<string, string>,
  expectedReturnTo: string,
  doFetch: typeof fetch,
  now = Date.now(),
): Promise<SteamVerifyResult> {
  if (query["openid.ns"] !== OPENID_NS || query["openid.mode"] !== "id_res") return { ok: false, reason: "not_id_res" };
  if (query["openid.op_endpoint"] !== STEAM_OP_ENDPOINT) return { ok: false, reason: "bad_op_endpoint" };
  if (query["openid.return_to"] !== expectedReturnTo) return { ok: false, reason: "bad_return_to" };
  const m = CLAIMED_ID_RE.exec(query["openid.claimed_id"] ?? "");
  if (!m) return { ok: false, reason: "bad_claimed_id" };
  if (query["openid.identity"] !== query["openid.claimed_id"]) return { ok: false, reason: "identity_mismatch" };
  // response_nonce 前綴為 UTC 時間（2026-10-15T12:00:00Z…）；超過視窗拒絕
  const ts = Date.parse((query["openid.response_nonce"] ?? "").slice(0, 20));
  if (!Number.isFinite(ts) || Math.abs(now - ts) > NONCE_MAX_AGE_MS) return { ok: false, reason: "stale_nonce" };
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (k.startsWith("openid.")) body.set(k, v);
  body.set("openid.mode", "check_authentication");
  let text: string;
  try {
    const res = await doFetch(STEAM_OP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(STEAM_VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: "network" };
    text = await res.text();
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!/^is_valid\s*:\s*true\s*$/m.test(text)) return { ok: false, reason: "not_valid" };
  return { ok: true, steamId: m[1]! };
}
