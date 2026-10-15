import { createHmac } from "node:crypto";

/** 開發與測試用的後備金鑰（production 不使用，缺 REPORT_IP_HASH_SECRET 時端點回 503）。 */
export const DEV_IP_HASH_SECRET = "dev-only-report-ip-hash-secret";

/**
 * IPv6 取前 64 位（同一個家用網路的位址常整段換），IPv4 原樣；統一小寫。
 * 不合法或空值 → "unknown"（同一個桶：寧可誤擋也不放行無法辨識來源的洪水）。
 */
export function normalizeClientIp(ip: string | null | undefined): string {
  const raw = (ip ?? "").trim().toLowerCase();
  if (raw === "") return "unknown";
  const v4mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (v4mapped) return v4mapped[1]!;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return raw;
  if (raw.includes(":") && /^[0-9a-f:]+$/.test(raw) && (raw.match(/::/g) ?? []).length <= 1) {
    const [head = "", tail = ""] = raw.split("::");
    const h = head === "" ? [] : head.split(":");
    const t = tail === "" ? [] : tail.split(":");
    const fill = raw.includes("::") ? 8 - h.length - t.length : 0;
    const groups = [...h, ...Array<string>(Math.max(0, fill)).fill("0"), ...t];
    if (groups.length === 8 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
      return `${groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
    }
  }
  return "unknown";
}

/**
 * 回報者 IP 的雜湊（12：只存雜湊，保留 90 天）。HMAC-SHA256 + 伺服器端密鑰，輸出 64 位十六進位。
 * 用 HMAC 而不是單純 SHA-256：IPv4 只有 2^32 種，無金鑰的雜湊可被窮舉還原。
 */
export function hashReporterIp(ip: string | null | undefined, secret: string): string {
  return createHmac("sha256", secret).update(normalizeClientIp(ip)).digest("hex");
}
