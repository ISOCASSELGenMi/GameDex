// 語言支援（06 §語言支援區塊，Phase 3b）。Domain 型別與純函式，零外部依賴。
//
// 三種狀態（絕不產生「不支援」語意——沒有資料 ≠ 不支援）：
// 1. 某語言 × 某類型有資料 → 該格列出（✓）；沒有資料的格是「空白」，不是「不支援」。
// 2. 某類型（介面／字幕／語音）在這款遊戲完全沒資料 → 該欄 "no_data"（UI 顯示「未提供資料」）。
// 3. 三類都沒資料 → status "no_data"（UI 整區顯示「尚無語言資料」＋回報連結）。
// 語言只給代碼（languages.code，例如 'zh-Hant'、'ja-JP'）；顯示名稱由 UI 以 Intl.DisplayNames 依網站語言產生。
import { LANGUAGE_SUPPORT_TYPES, type LanguageSupportType } from "./enums";

export interface LanguageSupportRow {
  /** languages.code（BCP 47）。 */
  languageCode: string;
  /** 這個語言「有資料」的類型（依 LANGUAGE_SUPPORT_TYPES 順序）。不在清單內的類型＝沒有資料（空白），不代表不支援。 */
  types: LanguageSupportType[];
}

/** 欄狀態：has_data＝至少一個語言有這類資料；no_data＝整欄沒有資料（顯示「未提供資料」，絕不顯示「不支援」）。 */
export type LanguageSupportColumnState = "has_data" | "no_data";

export interface GameLanguageSupport {
  /** available＝至少有一筆資料；no_data＝整區「尚無語言資料」。 */
  status: "available" | "no_data";
  columns: Record<LanguageSupportType, LanguageSupportColumnState>;
  /** 只列有資料的語言；當前網站語言置頂，其餘依代碼。 */
  rows: LanguageSupportRow[];
}

/** 卡片最多顯示的語言標籤數（06：其餘「＋M」）。 */
export const LANGUAGE_CARD_MAX_TAGS = 6;

/**
 * 語言代碼與網站語言的相近程度：0＝完全相同（不分大小寫），1＝主語言相同（en 對 en-US；
 * zh 另需文字相同，zh-Hant 不會配到 zh-Hans），2＝無關。
 */
export function languageMatchRank(code: string, siteLocale: string): 0 | 1 | 2 {
  const a = code.toLowerCase();
  const b = siteLocale.toLowerCase();
  if (a === b) return 0;
  const [pa, ...ra] = a.split("-");
  const [pb, ...rb] = b.split("-");
  if (pa !== pb) return 2;
  if (pa === "zh") {
    const script = (rest: string[]) => rest.find((s) => s === "hant" || s === "hans") ?? null;
    const sa = script(ra);
    const sb = script(rb);
    if (sa && sb && sa !== sb) return 2;
  }
  return 1;
}

/**
 * (語言代碼, 類型) 列 → 語言支援區塊的資料。重複列會合併；未知類型忽略。
 * 排序：與網站語言相同 → 主語言相同 → 其他；同層依代碼。
 */
export function buildLanguageSupport(
  entries: ReadonlyArray<{ languageCode: string; supportType: string }>,
  siteLocale: string,
): GameLanguageSupport {
  const known = new Set<string>(LANGUAGE_SUPPORT_TYPES);
  const byCode = new Map<string, Set<LanguageSupportType>>();
  for (const e of entries) {
    if (!known.has(e.supportType) || !e.languageCode) continue;
    const set = byCode.get(e.languageCode) ?? new Set<LanguageSupportType>();
    set.add(e.supportType as LanguageSupportType);
    byCode.set(e.languageCode, set);
  }
  const rows: LanguageSupportRow[] = [...byCode.entries()]
    .map(([languageCode, set]) => ({ languageCode, types: LANGUAGE_SUPPORT_TYPES.filter((t) => set.has(t)) }))
    .sort(
      (a, b) =>
        languageMatchRank(a.languageCode, siteLocale) - languageMatchRank(b.languageCode, siteLocale) ||
        (a.languageCode < b.languageCode ? -1 : a.languageCode > b.languageCode ? 1 : 0),
    );
  const columns = Object.fromEntries(
    LANGUAGE_SUPPORT_TYPES.map((t) => [t, rows.some((r) => r.types.includes(t)) ? "has_data" : "no_data"]),
  ) as Record<LanguageSupportType, LanguageSupportColumnState>;
  return { status: rows.length > 0 ? "available" : "no_data", columns, rows };
}

/** 卡片用的語言標籤：前 max 個代碼（沿用 rows 順序）＋其餘數量（UI 顯示「＋M」）。 */
export function languageCardTags(
  support: GameLanguageSupport,
  max: number = LANGUAGE_CARD_MAX_TAGS,
): { codes: string[]; more: number } {
  const n = Math.max(0, Math.floor(max));
  const codes = support.rows.slice(0, n).map((r) => r.languageCode);
  return { codes, more: Math.max(0, support.rows.length - codes.length) };
}
