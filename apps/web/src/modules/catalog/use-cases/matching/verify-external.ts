/**
 * 外部遊戲頁的二次驗證（05 §信心評分）。純函式、無 DB。
 * 標題相似只能當候選篩選：真正決定採用與否的是遊戲頁上的標題、發售日、開發／發行商、平台（寧可少配，不配錯）。
 * 發售日：同一款遊戲各平台上架日可能不同，所以拿「我方所有平台／地區的日精度日期」逐一與對方日期比，任一個在 ±3 天內即相符。
 */
import type { ExternalFacts, ExternalHint, OurGameFacts, VerifyVerdict } from "../../domain/entities";
import { normalizeTitle } from "./normalize-title";
import { levenshteinSimilarity } from "./similarity";

export const VERIFY_THRESHOLDS = {
  /** 日期相符的容許天數（正負）。 */
  dateToleranceDays: 3,
  /** 與我方每個日期都差超過這麼多天 → 視為不同遊戲。 */
  dateFarDays: 365,
  /** 頁面標題與我方名稱相似度低於此值（且不是副標題／前綴關係）→ 直接不採用。頁面標題是官方原文，不會有錯字級的差異。 */
  titleMin: 0.9,
  /** 非自動採用的信心上限，確保 ≥ 90 只會出現在自動採用。 */
  reviewCap: 89,
  /** Steam 指向別的 Metacritic 頁時的信心上限。 */
  steamConflictCap: 60,
} as const;

const DAY_MS = 86_400_000;
const COMPANY_NOISE = /\b(inc|ltd|llc|co|corp|corporation|gmbh|games?|studios?|entertainment|interactive|publishing|software|digital|productions?|the)\b/g;

export function normalizeCompany(name: string): string {
  const n = normalizeTitle(name);
  const stripped = n.replace(COMPANY_NOISE, " ").replace(/\s+/g, " ").trim();
  return stripped === "" ? n : stripped;
}

const PLATFORM_FAMILIES: [RegExp, string][] = [
  [/playstation\s*5|\bps\s*5\b/, "ps5"],
  [/playstation\s*4|\bps\s*4\b/, "ps4"],
  [/playstation\s*3|\bps\s*3\b/, "ps3"],
  [/vita/, "vita"],
  [/xbox series/, "xbox-series"],
  [/xbox one/, "xbox-one"],
  [/xbox 360/, "xbox-360"],
  [/switch\s*2/, "switch2"],
  [/switch/, "switch"],
  [/windows|^pc\b|\bpc$|\bpc\b|linux|\bmac|macos|dos|steam/, "pc"],
  [/ios|iphone|ipad/, "ios"],
  [/android/, "android"],
];

/** 平台名稱 → 家族鍵（Metacritic 的 "PC" 對上我方的 "PC (Microsoft Windows)"、Mac、Linux 都算同一家族）。 */
export function platformFamily(name: string): string {
  const n = name.toLowerCase();
  for (const [re, key] of PLATFORM_FAMILIES) if (re.test(n)) return key;
  return normalizeTitle(name);
}

/** 一方的 token 是另一方的真子集（例如「Sugardew Island」對「Sugardew Island: Your Cozy Farm Shop」）：可能只是副標題差異，交給覆核。 */
function isTokenSubset(a: string, b: string): boolean {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (x.size === 0 || y.size === 0 || x.size === y.size) return false;
  const [small, big] = x.size < y.size ? [x, y] : [y, x];
  return small.size >= 2 && [...small].every((t) => big.has(t));
}

function daysBetween(a: string, b: string): number | null {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  return Number.isNaN(x) || Number.isNaN(y) ? null : Math.abs(x - y) / DAY_MS;
}

type Signal = "match" | "unknown" | "off" | "far" | "conflict";

function dateSignal(ours: readonly string[], theirs: string | null): Signal {
  if (!theirs || ours.length === 0) return "unknown";
  const diffs = ours.map((d) => daysBetween(d, theirs)).filter((d): d is number => d !== null);
  if (diffs.length === 0) return "unknown";
  const min = Math.min(...diffs);
  if (min <= VERIFY_THRESHOLDS.dateToleranceDays) return "match";
  return min > VERIFY_THRESHOLDS.dateFarDays ? "far" : "off";
}

function companySignal(ours: readonly string[], theirs: readonly string[]): Signal {
  const a = ours.map(normalizeCompany).filter(Boolean);
  const b = theirs.map(normalizeCompany).filter(Boolean);
  if (a.length === 0 || b.length === 0) return "unknown";
  const same = a.some((x) => b.some((y) => x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)))));
  return same ? "match" : "conflict";
}

function platformSignal(ours: readonly string[], theirs: readonly string[]): Signal {
  const a = new Set(ours.map(platformFamily));
  const b = new Set(theirs.map(platformFamily));
  if (a.size === 0 || b.size === 0) return "unknown";
  return [...a].some((k) => b.has(k)) ? "match" : "conflict";
}

/** 追加內容／附屬商品的字樣（正規化後的整詞）。 */
const SUPPLEMENTARY: [RegExp, string][] = [
  [/\bseason pass\b/, "season pass"],
  [/\bdlc\b/, "dlc"],
  [/\bexpansion\b/, "expansion"],
  [/\bpack\b/, "pack"],
  [/\bbundle\b/, "bundle"],
  [/\badd ?on\b/, "addon"],
  [/\bsoundtrack\b/, "soundtrack"],
  [/\bupgrade\b/, "upgrade"],
];

export function supplementaryMarkers(text: string): Set<string> {
  const n = normalizeTitle(text);
  return new Set(SUPPLEMENTARY.filter(([re]) => re.test(n)).map(([, key]) => key));
}

/**
 * 對方（頁面標題或 slug 還原的名稱）帶有 Season Pass／Pack／DLC 這類追加內容字樣，而我方任何名稱都沒有同樣字樣
 * ＝對方是追加內容頁，不是這款遊戲本體（Metacritic 把追加內容獨立成頁）。我方名稱本身有該字樣則不算。
 */
export function hasForeignSupplementary(ourNames: readonly string[], theirText: string): boolean {
  const theirs = supplementaryMarkers(theirText);
  if (theirs.size === 0) return false;
  const ours = new Set(ourNames.flatMap((n) => [...supplementaryMarkers(n)]));
  return [...theirs].some((k) => !ours.has(k));
}

function steamSignal(hint: ExternalHint | undefined): Signal {
  if (!hint?.steamSlug) return "unknown";
  return hint.steamSlug === hint.candidateSlug ? "match" : "conflict";
}

/**
 * 採用：標題完全相同＋日期相符（±3 天，任一平台）＋（開發／發行商相符 或 平台相符 或 Steam 指向同一個 Metacritic 頁），且沒有任何衝突。
 * Steam 佐證（hint）：Steam 記錄的 Metacritic slug 與候選相同＝強證據（也允許我方日期未知時採用，但日期偏離仍進覆核）；
 * 不同＝衝突，一律進覆核（信心上限 60）；Steam 沒有記錄＝未知。
 * 拒絕：標題相似度 < 0.8，或日期與每個平台都差 > 1 年且標題不完全相同。其餘進覆核。
 * 信心：標題 55、日期 25、公司 12、平台 8（未知給少量分數）；非採用上限 89。
 */
export function verifyExternalMatch(ours: OurGameFacts, theirs: ExternalFacts, hint?: ExternalHint): VerifyVerdict {
  const reasons: string[] = [];
  const theirTitle = theirs.title ? normalizeTitle(theirs.title) : "";
  const titleSim = theirTitle === "" ? 0 : Math.max(0, ...ours.names.map((n) => levenshteinSimilarity(normalizeTitle(n), theirTitle)));
  const titleExact = titleSim === 1;
  const date = dateSignal(ours.dates, theirs.releaseDate);
  const company = companySignal(ours.companies, theirs.companies);
  const platform = platformSignal(ours.platforms, theirs.platforms);
  const steam = steamSignal(hint);
  reasons.push(`title ${Math.round(titleSim * 100)}`, `date ${date}`, `company ${company}`, `platform ${platform}`, `steam ${steam}`);

  if (theirs.title && hasForeignSupplementary(ours.names, theirs.title)) return { decision: "reject", confidencePct: 0, reasons: [...reasons, "supplementary page"] };
  const subtitle = theirTitle !== "" && ours.names.some((n) => isTokenSubset(normalizeTitle(n), theirTitle));
  if (titleSim < VERIFY_THRESHOLDS.titleMin && !subtitle) return { decision: "reject", confidencePct: Math.round(titleSim * 55), reasons };
  if (date === "far" && !titleExact) return { decision: "reject", confidencePct: Math.round(titleSim * 55), reasons };

  const dateScore = { match: 25, unknown: 8, off: 5, far: 0, conflict: 0 }[date];
  const companyScore = { match: 12, unknown: 4, conflict: 0, off: 0, far: 0 }[company];
  const platformScore = { match: 8, unknown: 3, conflict: 0, off: 0, far: 0 }[platform];
  const raw = Math.min(100, Math.round(titleSim * 55 + dateScore + companyScore + platformScore + (steam === "match" ? 8 : 0)));

  const corroborated = company === "match" || platform === "match" || steam === "match";
  const dateOk = date === "match" || (steam === "match" && date === "unknown");
  const adopt = titleExact && dateOk && corroborated && company !== "conflict" && platform !== "conflict" && steam !== "conflict";
  if (adopt) return { decision: "adopt", confidencePct: Math.max(90, raw), reasons };
  const cap = steam === "conflict" ? VERIFY_THRESHOLDS.steamConflictCap : VERIFY_THRESHOLDS.reviewCap;
  return { decision: "review", confidencePct: Math.min(raw, cap), reasons };
}
