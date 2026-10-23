/**
 * 遊戲詳情頁的純函式（GameDex 第二輪 Z4B）：About 區的公司分欄、版本標註、相對時間、地區名稱。
 * 不含 JSX，方便單元測試；文字一律走 @sok/i18n 字典。
 */
import { type Locale, type Translator } from "@sok/i18n";
import type { DatePrecision, GameCompanyCredit, GameDetail, GameSummary, TaxonomyItem } from "../../domain/entities";

// ── 公司分欄 ────────────────────────────────────────────────────────────

export interface CompanyEntry {
  company: GameCompanyCredit;
  /** 協力欄中標「移植」的項目（porting 角色）。 */
  porting: boolean;
}

export interface CompanyColumns {
  mainDevelopers: CompanyEntry[];
  publishers: CompanyEntry[];
  /** supporting 與 porting；同公司兼 supporting 與 porting 時只列一次、不標移植。 */
  supporting: CompanyEntry[];
}

/** 把 GameDetail.companies（角色合併後的列）分成主要開發商／發行商／協力開發商三欄。 */
export function companyColumns(companies: readonly GameCompanyCredit[]): CompanyColumns {
  const has = (c: GameCompanyCredit, role: string): boolean => (c.roles as readonly string[]).includes(role);
  const entry = (company: GameCompanyCredit, porting = false): CompanyEntry => ({ company, porting });
  return {
    mainDevelopers: companies.filter((c) => has(c, "developer")).map((c) => entry(c)),
    publishers: companies.filter((c) => has(c, "publisher")).map((c) => entry(c)),
    supporting: companies
      .filter((c) => has(c, "supporting") || has(c, "porting"))
      .map((c) => entry(c, !has(c, "supporting") && has(c, "porting"))),
  };
}

// ── 版本標註 ────────────────────────────────────────────────────────────

export type EditionNotice =
  | { kind: "none" }
  | { kind: "edition"; parent: GameSummary; versionTitle: string }
  /** 本身是 DLC／衍生版本：`typeKey` 是 enums.gameType 的 key，`generic` 為 true 時改用「版本」字樣。 */
  | { kind: "derived"; parent: GameSummary; typeKey: string; generic: boolean };

/**
 * 本作在版本／衍生關係中的位置。
 * - 有 version_title 與本體 → 「這是《X》的 Nintendo Switch 2 Edition」
 * - 是版本（version_parent）但沒有 version_title → 「這是《X》的版本」
 * - gameType 不是主遊戲、且有本體（parent）→ 「這是《X》的 DLC」等
 * - 其餘不顯示標註
 */
export function editionNotice(game: Pick<GameDetail, "gameType" | "parent" | "extra">): EditionNotice {
  const { versionParent, versionTitle } = game.extra.edition;
  if (versionParent) {
    if (versionTitle) return { kind: "edition", parent: versionParent, versionTitle };
    const derivedType = game.gameType !== "main_game" && game.gameType !== "other";
    return { kind: "derived", parent: versionParent, typeKey: game.gameType, generic: !derivedType };
  }
  if (game.parent && game.gameType !== "main_game") {
    return { kind: "derived", parent: game.parent, typeKey: game.gameType, generic: game.gameType === "other" };
  }
  return { kind: "none" };
}

/** 標註句（純文字；元件把本體名稱換成連結時用 {@link editionNoticeParts}）。 */
export function editionNoticeText(t: Translator, notice: EditionNotice): string | null {
  if (notice.kind === "none") return null;
  const name = notice.parent.name;
  if (notice.kind === "edition") return t.t("ui.game.edition.editionOf", { name, title: notice.versionTitle });
  return t.t("ui.game.edition.partOf", { name, type: derivedTypeLabel(t, notice) });
}

function derivedTypeLabel(t: Translator, notice: Extract<EditionNotice, { kind: "derived" }>): string {
  return notice.generic ? t.t("ui.game.edition.genericVersion") : t.t(`enums.gameType.${notice.typeKey}`);
}

/** 把標註句拆成「本體名稱前／後」兩段，讓元件在中間放連結。 */
export function editionNoticeParts(t: Translator, notice: EditionNotice): { before: string; after: string } | null {
  if (notice.kind === "none") return null;
  const marker = "\u0000";
  const text =
    notice.kind === "edition"
      ? t.t("ui.game.edition.editionOf", { name: marker, title: notice.versionTitle })
      : t.t("ui.game.edition.partOf", { name: marker, type: derivedTypeLabel(t, notice) });
  const [before = "", after = ""] = text.split(marker);
  return { before, after };
}

// ── 相對時間 ────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function utcDayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/**
 * 上市日期的相對時間（「3 個月後」「2 年前」）。只在日期精確到「日」時顯示：
 * 月／季／年精度的日期是期間末日，換算相對時間會誤導。today 由呼叫端傳入（UTC 日期，方便測試）。
 */
export function relativeReleaseText(
  date: string | null,
  precision: DatePrecision | null,
  today: string,
  locale: Locale,
): string | null {
  if (!date || precision !== "day") return null;
  const a = utcDayNumber(date);
  const b = utcDayNumber(today);
  if (a === null || b === null) return null;
  const days = a - b;
  const abs = Math.abs(days);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs <= 30) return rtf.format(days, "day");
  if (abs < 365) return rtf.format(Math.round(days / 30.4375), "month");
  return rtf.format(Math.round(days / 365.25), "year");
}

// ── 標籤 ────────────────────────────────────────────────────────────────

/** 遊戲人數／玩家視角：字典（enums.gameMode、enums.playerPerspective）→ 原文名稱。 */
export function enumTaxonomyLabel(t: Translator, ns: "gameMode" | "playerPerspective", item: TaxonomyItem): string {
  const key = `enums.${ns}.${item.slug}`;
  return t.has(key) ? t.t(key) : item.name;
}

/** 各語言標題的地區名：字典 → Intl.DisplayNames（語言名）→ 代碼本身。 */
export function localizedTitleRegionLabel(t: Translator, locale: Locale, code: string): string {
  const key = `enums.localizedTitleRegion.${code}`;
  if (t.has(key)) return t.t(key);
  try {
    return new Intl.DisplayNames(locale, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** 空陣列、全空白字串視為「沒有」，用來決定整欄是否顯示。 */
export function nonEmpty<T>(items: readonly T[] | null | undefined): items is readonly T[] {
  return Array.isArray(items) && items.length > 0;
}
