/**
 * CalendarMonth（catalog 讀取模型）→ 月曆畫面用的資料。純函式（只依賴字典與 Intl）。
 *
 * 效能（GameDex 第 3 段）：整月上千筆卡片全送會讓 HTML 達 1.7 MB，所以每天只放「第一款」的完整資料與「當日總數」，
 * 其餘款數在使用者切換到該格時才由 day API 載入。「本月未定日」（月／季／年精度）數量有限，照舊整批送。
 */
import { formatDateTime, type Locale, type Translator } from "@sok/i18n";
import type { CalendarEventItem, CalendarMonth, ReleaseCard } from "../../domain/entities";
import { eventKindLabel } from "../labels";
import { isoDate } from "../month";
import { UNDATED_OPEN_MAX } from "../month";
import { buildPreview, joinList, platformChipText, toDayCard, toFoldRow } from "./day-card";
import type { DayCardData, FoldRow, PreviewCardData } from "./types";

export { joinList, platformChipText };

/** 未定日清單裡的卡片（key 對應 previews）。 */
export interface CardItem {
  type: "card";
  key: string;
  card: ReleaseCard;
}

export interface EventItem {
  type: "event";
  key: string;
  event: CalendarEventItem;
  kindLabel: string;
  timeLabel: string;
}

/**
 * 本月未定日的一組（月／季／年精度）。數量少（≤ UNDATED_OPEN_MAX）：完整卡片 items（可開側邊預覽卡）；
 * 數量多：只送熱度最高的前 UNDATED_OPEN_MAX 款的精簡列 rows（RSC payload 小，點了直接進詳情頁），
 * 其餘由「查看全部」連結到瀏覽頁（`more`＝true；`year`＝連結帶的年份）。items 與 rows 只有一個有內容。
 */
export interface UndatedGroup {
  precision: "month" | "quarter" | "year";
  /** 組內遊戲數（總數；多於送出的列數時 rows 只含前 UNDATED_OPEN_MAX 款） */
  count: number;
  /** count > UNDATED_OPEN_MAX：有未送出的款數，要顯示「查看全部」連結 */
  more: boolean;
  /** 「查看全部」連結帶的年份（期間最後一天所在年；沒有代表日時 null） */
  year: number | null;
  /** 組內第一款的代表日期（標題的「2026年10月」文字用） */
  firstDate: string | null;
  items: CardItem[];
  rows: FoldRow[];
}

/** 月曆一天：當日上市總數、第一款（沒有則 null）、活動（開始日在當天）。 */
export interface DayView {
  total: number;
  first: DayCardData | null;
  events: EventItem[];
}

export interface CalendarViewModel {
  days: Record<string, DayView>;
  undated: UndatedGroup[];
  /** 只有未定日卡片（key → 預覽資料）；格內的卡片資料自帶預覽欄位。 */
  previews: Record<string, PreviewCardData>;
  releaseCount: number;
  eventCount: number;
}

/** ISO 日期（yyyy-mm-dd）的年份；格式不對回 null。 */
export function yearOfDate(date: string | null): number | null {
  const y = date ? /^(\d{4})-/.exec(date)?.[1] : undefined;
  return y ? Number(y) : null;
}

/** 活動在月曆中的日期：開始日（UTC）；開始於上個月的多日活動放本月 1 日。 */
export function eventDayInMonth(event: CalendarEventItem, year: number, month: number): string | null {
  if (!event.startTime) return null;
  const monthStart = isoDate(year, month, 1);
  const startDay = event.startTime.slice(0, 10);
  return startDay < monthStart ? monthStart : startDay;
}

export function buildCalendarViewModel(data: CalendarMonth, locale: Locale, t: Translator): CalendarViewModel {
  const days: Record<string, DayView> = {};
  let releaseCount = 0;
  for (const iso of Object.keys(data.days).sort()) {
    const cards = data.days[iso] ?? [];
    if (cards.length === 0) continue;
    days[iso] = { total: cards.length, first: toDayCard(cards[0]!, locale, t), events: [] };
    releaseCount += cards.length;
  }

  let eventCount = 0;
  for (const event of data.events) {
    const day = eventDayInMonth(event, data.year, data.month);
    if (!day) continue;
    const item: EventItem = {
      type: "event",
      key: `e${event.id}`,
      event,
      kindLabel: eventKindLabel(t, event.kind),
      timeLabel: event.startTime ? formatDateTime(event.startTime, locale, "UTC") : t.t("ui.calendar.timeTbd"),
    };
    (days[day] ??= { total: 0, first: null, events: [] }).events.push(item);
    eventCount += 1;
  }

  let seq = 0;
  const previews: Record<string, PreviewCardData> = {};
  const toItem = (card: ReleaseCard): CardItem => {
    const key = (seq++).toString(36);
    previews[key] = buildPreview(card, locale, t);
    return { type: "card", key, card };
  };
  const groups: Record<UndatedGroup["precision"], ReleaseCard[]> = { month: [], quarter: [], year: [] };
  for (const card of data.undated) {
    if (card.precision === "month" || card.precision === "quarter" || card.precision === "year") {
      groups[card.precision].push(card);
      releaseCount += 1;
    }
  }
  const undated: UndatedGroup[] = (["month", "quarter", "year"] as const)
    .filter((p) => groups[p].length > 0)
    .map((precision) => {
      const cards = groups[precision];
      const small = cards.length <= UNDATED_OPEN_MAX;
      return {
        precision,
        count: cards.length,
        more: !small,
        year: yearOfDate(cards[0]?.date ?? null),
        firstDate: cards[0]?.date ?? null,
        items: small ? cards.map(toItem) : [],
        rows: small ? [] : cards.slice(0, UNDATED_OPEN_MAX).map((c) => toFoldRow(c, locale, t)),
      };
    });

  return { days, undated, previews, releaseCount, eventCount };
}
