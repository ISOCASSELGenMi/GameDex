/**
 * 活動列表與詳情的純函式（網址參數解析、時間文字）。不依賴 React，可單元測試。
 * 活動時間依使用者時區顯示、下一行補 UTC（2026-10-17）；start_time 為 NULL＝「時間未定」。
 */
import { formatEventTimeText, type Locale, type Translator } from "@sok/i18n";
import { EVENT_KINDS, EVENT_LIST_SCOPES, type EventKind, type EventListScope, type EventTimeStatus } from "../../domain/entities";

/** 活動列表每頁筆數（與 use case 預設一致）。 */
export const EVENTS_PAGE_SIZE = 30;
/** 頁碼上限（use case 上限 500）。 */
export const EVENTS_PAGE_MAX = 500;

export function parseEventScope(value: string | null | undefined): EventListScope {
  return (EVENT_LIST_SCOPES as readonly string[]).includes(value ?? "") ? (value as EventListScope) : "upcoming";
}

/** 未知或缺少＝null（全部類型）。 */
export function parseEventKind(value: string | null | undefined): EventKind | null {
  return (EVENT_KINDS as readonly string[]).includes(value ?? "") ? (value as EventKind) : null;
}

export function parseEventsPage(value: string | null | undefined): number {
  if (!value || !/^\d{1,3}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 && n <= EVENTS_PAGE_MAX ? n : 1;
}

/**
 * 活動時間純文字（預設 UTC，伺服器端／非互動場合用；頁面上的顯示用 `@/kernel/ui/event-time` 的 EventTime，依使用者時區）。
 * - 時間未定（start NULL）：「時間未定」
 * - 只有開始：開始時間
 * - 有結束且不同於開始：「開始 – 結束」
 * 格式化唯一實作在 `@sok/i18n` 的 formatEventTimeText。
 */
export function eventTimeText(
  event: { startTime: string | null; endTime: string | null },
  locale: Locale,
  t: Translator,
  timeZone = "UTC",
): string {
  if (!event.startTime) return t.t("ui.events.timeTbd");
  const { start, end } = formatEventTimeText(event.startTime, event.endTime, locale, timeZone);
  return end === null ? start : t.t("ui.events.timeRange", { start, end });
}

/** 時間狀態標籤；upcoming 不另標（列表預設就是即將舉行），undated 的「時間未定」已由時間欄位顯示。 */
export function eventStatusLabel(t: Translator, status: EventTimeStatus): string | null {
  switch (status) {
    case "ongoing":
      return t.t("ui.events.status.ongoing");
    case "past":
      return t.t("ui.events.status.past");
    default:
      return null;
  }
}
