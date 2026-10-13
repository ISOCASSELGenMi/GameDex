/**
 * 語言支援區塊的呈現邏輯（純函式，06 §語言支援區塊）。三態：
 * 1. 整區沒資料 → `{ state: "no_data" }`（「尚無語言資料」）
 * 2. 有資料 → 逐語言一列；某欄完全沒資料 → 該欄標 "no_data"（「未提供資料」，用 rowSpan 合併成一格）
 * 3. 某語言在某欄沒有資料 → 空白格（不是「不支援」；模型裡沒有表示不支援的值）
 * 語言名稱用 Intl.DisplayNames 依網站語言產生；自稱（以該語言顯示）附在後面，且標 lang。
 */
import type { GameLanguageSupport, LanguageSupportColumnState } from "../../domain/entities";
import { LANGUAGE_SUPPORT_TYPES, type LanguageSupportType } from "../../domain/entities";

export interface LanguageRowView {
  code: string;
  /** 依網站語言顯示的名稱（查不到時＝代碼）。 */
  name: string;
  /** 該語言的自稱；與 name 相同或查不到時為 null。 */
  nativeName: string | null;
  /** 這一列各類型是否有資料。 */
  has: Record<LanguageSupportType, boolean>;
}

export interface LanguageColumnView {
  type: LanguageSupportType;
  state: LanguageSupportColumnState;
}

export type LanguageSupportView =
  | { state: "no_data" }
  | { state: "available"; columns: LanguageColumnView[]; rows: LanguageRowView[] };

function displayName(code: string, inLocale: string): string | null {
  try {
    const name = new Intl.DisplayNames([inLocale], { type: "language" }).of(code);
    return name && name !== code ? name : null;
  } catch {
    // 代碼不是合法的 BCP 47（RangeError）或語系不被支援
    return null;
  }
}

export function languageNames(code: string, siteLocale: string): { name: string; nativeName: string | null } {
  const name = displayName(code, siteLocale) ?? code;
  const native = displayName(code, code);
  return { name, nativeName: native !== null && native !== name ? native : null };
}

export function buildLanguageSupportView(support: GameLanguageSupport, siteLocale: string): LanguageSupportView {
  if (support.status === "no_data" || support.rows.length === 0) return { state: "no_data" };
  const columns = LANGUAGE_SUPPORT_TYPES.map((type) => ({ type, state: support.columns[type] }));
  const rows = support.rows.map((r) => {
    const has = Object.fromEntries(LANGUAGE_SUPPORT_TYPES.map((type) => [type, r.types.includes(type)])) as Record<LanguageSupportType, boolean>;
    return { code: r.languageCode, ...languageNames(r.languageCode, siteLocale), has };
  });
  return { state: "available", columns, rows };
}
