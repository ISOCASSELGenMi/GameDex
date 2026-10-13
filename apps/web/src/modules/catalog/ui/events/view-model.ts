/**
 * 活動列表與詳情的純函式（網址參數解析、時間文字、連結安全檢查）。不依賴 React，可單元測試。
 * 活動時間一律顯示 UTC 並標註（沿用 3a）；start_time 為 NULL＝「時間未定」。
 */
import { formatDateTime, type Locale, type Translator } from "@sok/i18n";
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
 * 活動時間文字（UTC）。
 * - 時間未定（start NULL）：「時間未定」
 * - 只有開始：開始時間
 * - 有結束且不同於開始：「開始 – 結束」
 */
export function eventTimeText(
  event: { startTime: string | null; endTime: string | null },
  locale: Locale,
  t: Translator,
): string {
  if (!event.startTime) return t.t("ui.events.timeTbd");
  const start = formatDateTime(event.startTime, locale, "UTC");
  if (!event.endTime || event.endTime === event.startTime) return start;
  // 同一個 UTC 日期：結束只顯示時間，避免重複日期
  const sameDay = event.startTime.slice(0, 10) === event.endTime.slice(0, 10);
  const end = sameDay
    ? formatDateTime(event.endTime, locale, "UTC", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : formatDateTime(event.endTime, locale, "UTC");
  return t.t("ui.events.timeRange", { start, end });
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

/** 只放行 http(s) 外部連結（直播、官網來自外部資料，不可直接當 javascript: 等網址）。 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
