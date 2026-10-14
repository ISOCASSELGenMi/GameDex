/**
 * Accept-Language 協商（spec 06 §多語系「無前綴入口的語系決定順序」第三步）。
 * Cookie `sok_locale` 與 `users.locale` 的優先序由呼叫端（網站的 proxy）處理，這裡只看 header。
 *
 * 對照：
 * - `zh-Hant`（含 `zh-Hant-TW` 等）、`zh-TW`、`zh-HK`、`zh-MO` → zh-Hant
 * - `zh-CN`、`zh-SG`、`zh-Hans*`、單獨的 `zh` → 不對應（我方沒有簡體字典，也不把簡體使用者當繁體）；
 *   繼續看下一個語言，全部不符才退回預設語系。
 * - `en`、`en-*` → en；`ja`、`ja-*` → ja（僅在 supported 內時）
 * - 其他標籤若與某個 supported 語系完全相同（不分大小寫）也採用，方便日後加語系。
 */
import { DEFAULT_LOCALE, type Locale } from "./locales";

interface WeightedTag {
  tag: string;
  q: number;
  index: number;
}

function parseAcceptLanguage(header: string): WeightedTag[] {
  const out: WeightedTag[] = [];
  header.split(",").forEach((part, index) => {
    const [rawTag, ...params] = part.trim().split(";");
    const tag = rawTag?.trim();
    if (!tag || tag === "*") return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) {
        const n = Number(m[1]);
        q = Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
      }
    }
    if (q > 0) out.push({ tag, q, index });
  });
  // q 由高到低；同 q 保留原順序
  return out.sort((a, b) => b.q - a.q || a.index - b.index);
}

/** 單一語言標籤 → 我方語系代碼（不檢查是否 supported）；不對應回傳 null。 */
export function mapLanguageTag(tag: string): string | null {
  const subtags = tag.toLowerCase().split(/[-_]/);
  const lang = subtags[0];
  const rest = subtags.slice(1);
  if (lang === "zh") {
    if (rest.includes("hant")) return "zh-Hant";
    if (rest.includes("hans")) return null;
    if (rest.some((s) => s === "tw" || s === "hk" || s === "mo")) return "zh-Hant";
    return null;
  }
  if (lang === "en") return "en";
  if (lang === "ja") return "ja";
  return tag;
}

/**
 * 依 Accept-Language 選出 supported 中最適合的語系；都不符 → fallback（預設 DEFAULT_LOCALE；
 * 若 fallback 不在 supported 內則用 supported[0]）。
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  supported: readonly Locale[],
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  const byLower = new Map(supported.map((l) => [l.toLowerCase(), l] as const));
  if (acceptLanguage) {
    for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
      const mapped = mapLanguageTag(tag);
      if (mapped == null) continue;
      const hit = byLower.get(mapped.toLowerCase());
      if (hit) return hit;
    }
  }
  if (supported.includes(fallback)) return fallback;
  return supported[0] ?? fallback;
}
