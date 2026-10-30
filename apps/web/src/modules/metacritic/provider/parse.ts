/**
 * Metacritic 頁面解析（純函式，外部格式只存在 Provider 層；原則二）。
 * 結構依 2026-10-29 在瀏覽器實際觀察的遊戲頁（91 §Metacritic 實測）：
 * - Metascore：`data-testid="product-score"` 區塊內 `global-score-value-wrapper` 的 `title="Metascore 97 out of 100"`、
 *   `global-score-review-count` 的「Based on 109 Critic Reviews」；沒有分數時值為 `tbd`。
 * - 玩家評分：`data-testid="user-reviews"` 區塊內同樣的 testid，`title="User score 8.9 out of 10"`、「Based on 27,453 User Ratings」。
 * - 上市年份：`application/ld+json` 的 VideoGame `datePublished`。
 * 只取數字（分數、評論則數、年份），不存評論全文與評論者。結構認不得（改版）回 null，由呼叫端當作解析失敗處理，不猜。
 */

export interface ParsedScore {
  /** Metascore 為 0~100；玩家評分為 0~10。 */
  value: number;
  count: number | null;
}

export interface ParsedGamePage {
  title: string | null;
  releaseYear: number | null;
  metascore: ParsedScore | null;
  userScore: ParsedScore | null;
}

const SEGMENT = 6000;

function segmentAfter(html: string, marker: string): string | null {
  const i = html.indexOf(marker);
  return i < 0 ? null : html.slice(i, i + SEGMENT);
}

function parseCount(seg: string, noun: RegExp): number | null {
  const m = new RegExp(`Based on ([\\d,]+) ${noun.source}`, "i").exec(seg);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseBlock(seg: string | null, kind: "meta" | "user"): ParsedScore | null {
  if (!seg) return null;
  const titled = kind === "meta" ? /title="Metascore (\d{1,3}) out of 100"/.exec(seg) : /title="User score (\d{1,2}(?:\.\d)?) out of 10"/.exec(seg);
  const valueText = titled?.[1] ?? /data-testid="global-score-value">\s*([\d.]+|tbd)\s*</i.exec(seg)?.[1];
  if (!valueText || /^tbd$/i.test(valueText)) return null;
  const value = Number(valueText);
  const max = kind === "meta" ? 100 : 10;
  if (!Number.isFinite(value) || value < 0 || value > max) return null;
  return { value, count: parseCount(seg, kind === "meta" ? /Critic Reviews?/ : /User Ratings?/) };
}

function parseLd(html: string): { title: string | null; year: number | null } {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]!) as { "@type"?: string; name?: string; datePublished?: string };
      if (data["@type"] === "VideoGame") {
        const y = /^(\d{4})/.exec(data.datePublished ?? "")?.[1];
        return { title: typeof data.name === "string" ? data.name : null, year: y ? Number(y) : null };
      }
    } catch {
      /* 下一個 */
    }
  }
  return { title: null, year: null };
}

/** 解析遊戲頁。認不得結構（沒有 product-score 區塊）回 null＝解析失敗。 */
export function parseGamePage(html: string): ParsedGamePage | null {
  const meta = segmentAfter(html, 'data-testid="product-score"');
  if (meta === null) return null;
  const user = segmentAfter(html, 'data-testid="user-reviews"');
  const ld = parseLd(html);
  return { title: ld.title, releaseYear: ld.year, metascore: parseBlock(meta, "meta"), userScore: parseBlock(user, "user") };
}

/** 擋頁偵測：Cloudflare／驗證碼之類的挑戰頁（不繞過，遇到就停）。 */
export function looksLikeChallenge(status: number, html: string): boolean {
  if (status === 403 || status === 401) return true;
  const head = html.slice(0, 6000);
  return /cf-chl|challenge-platform|Just a moment\.\.\.|captcha|Attention Required/i.test(head);
}

/** sitemap（index 或 urlset）的 `<loc>` 清單。 */
export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
}

/** 遊戲頁網址 → slug；不是 /game/<slug>/ 形式回 null。 */
export function slugFromGameUrl(url: string): string | null {
  const m = /^https:\/\/www\.metacritic\.com\/game\/([a-z0-9][a-z0-9-]{0,200})\/?$/.exec(url);
  return m ? m[1]! : null;
}

/** slug 還原成可比對的名稱（連字號 → 空白）；實際標題以遊戲頁為準。 */
export function slugToName(slug: string): string {
  return slug.replace(/-/g, " ").trim();
}

/** robots.txt 中適用於 `User-agent: *` 的 Disallow 前綴。 */
export function parseRobotsDisallow(text: string): string[] {
  const out: string[] = [];
  let applies = false;
  let inGroupHeader = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!inGroupHeader) applies = false;
      if (val === "*") applies = true;
      inGroupHeader = true;
    } else {
      inGroupHeader = false;
      if (key === "disallow" && applies && val) out.push(val);
    }
  }
  return out;
}

export function isPathAllowed(path: string, disallow: readonly string[]): boolean {
  return !disallow.some((d) => path.startsWith(d));
}
