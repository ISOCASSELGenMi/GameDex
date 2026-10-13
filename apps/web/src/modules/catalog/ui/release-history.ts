/**
 * 改期紀錄的文字（詳情頁與時間軸共用，原則五：只實作一次）。純函式。
 */
import { formatIsoDate, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import type { ReleaseDateChange } from "../domain/entities";

/** 一筆改期紀錄：「舊日期 → 新日期（更新日）」。舊到新的順序由呼叫端保證。 */
export function releaseHistoryText(history: readonly ReleaseDateChange[], locale: Locale, t: Translator): string[] {
  return history.map((h) => {
    const from = formatReleaseLabel(h.oldDate, h.oldPrecision ?? "tbd", locale);
    const to = formatReleaseLabel(h.newDate, h.newPrecision ?? "tbd", locale);
    const change = t.t("ui.game.historyChange", { from, to });
    return h.changedAt
      ? t.t("ui.game.historyEntry", { change, date: t.t("ui.game.historyChangedAt", { date: formatIsoDate(h.changedAt.slice(0, 10), locale) }) })
      : change;
  });
}
