/**
 * 其他模組（accounts 的私人行事曆設定）要列出「類型」選項時用：沿用 catalog 篩選面板的同一份清單與同一套翻譯（labels.ts 的 genreLabel），
 * 不另外維護第二份。查詢逾時會丟 QueryTimeoutPageError，呼叫端（薄路由）自行 try/catch 並退化為「不提供類型篩選」。
 */
import type { Locale } from "@sok/i18n";
import { loadFilterOptions } from "./calendar/filter-options";
import { genreLabel, getTranslator } from "./labels";

export interface GenreChoice {
  slug: string;
  label: string;
}

export async function listGenreChoices(locale: Locale): Promise<GenreChoice[]> {
  const options = await loadFilterOptions(locale);
  const t = getTranslator(locale);
  return options.genres.map((g) => ({ slug: g.slug, label: genreLabel(t, g.slug, g.name) }));
}
