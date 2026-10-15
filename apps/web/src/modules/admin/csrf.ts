/**
 * 管理介面 POST 的 CSRF 防護（12）。Basic auth 的帳密由瀏覽器自動附帶，所以跨站表單也能帶著登入狀態送出，
 * 需要兩道檢查：同源（Origin 與 Host 一致）＋ token（頁面渲染時產生，只有讀得到頁面的人才拿得到）。
 * token 是無狀態的 HMAC：`<到期毫秒>.<HMAC-SHA256(金鑰, "csrf:" + 到期毫秒)>`，金鑰由管理密碼派生。
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 12 * 60 * 60 * 1000;

function key(secretMaterial: string): Buffer {
  return createHash("sha256").update(`sok-admin-csrf:${secretMaterial}`).digest();
}

const mac = (secretMaterial: string, expires: string) =>
  createHmac("sha256", key(secretMaterial)).update(`csrf:${expires}`).digest("hex");

export function createCsrfToken(secretMaterial: string, now: number = Date.now()): string {
  const expires = String(now + TTL_MS);
  return `${expires}.${mac(secretMaterial, expires)}`;
}

export function verifyCsrfToken(token: string | null | undefined, secretMaterial: string, now: number = Date.now()): boolean {
  if (!token) return false;
  const [expires, given] = token.split(".");
  if (!expires || !given || !/^\d{10,16}$/.test(expires) || !/^[0-9a-f]{64}$/.test(given)) return false;
  if (Number(expires) < now) return false;
  return timingSafeEqual(Buffer.from(mac(secretMaterial, expires), "hex"), Buffer.from(given, "hex"));
}

/** Origin（沒有時用 Referer）的主機必須等於請求的主機（反向代理後用 X-Forwarded-Host）。兩者都沒有 → 拒絕。 */
export function isSameOrigin(headers: Headers): boolean {
  const source = headers.get("origin") ?? headers.get("referer");
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]?.trim().toLowerCase();
  if (!source || !host) return false;
  try {
    return new URL(source).host.toLowerCase() === host;
  } catch {
    return false;
  }
}
