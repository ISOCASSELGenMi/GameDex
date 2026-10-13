/**
 * CalendarMonth（catalog 讀取模型）→ 月曆畫面用的資料。純函式（只依賴字典與 Intl）。
 */
import { formatDateTime, formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import type { CalendarEventItem, CalendarMonth, ReleaseCard } from "../../domain/entities";
import { heatBadgeLabel } from "../heat-badge";
import { eventKindLabel, getTranslator, stageLabel, statusLabel } from "../labels";
import { gameHref } from "../links";
import { isoDate } from "../month";
import type { PreviewCardData } from "./types";

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

export type DayItem = CardItem | EventItem;

export interface UndatedGroup {
  precision: "month" | "quarter" | "year";
  items: CardItem[];
}

export interface CalendarViewModel {
  days: Record<string, DayItem[]>;
  undated: UndatedGroup[];
  previews: Record<string, PreviewCardData>;
  releaseCount: number;
  eventCount: number;
}

/** 列舉（平台、類型…）：分隔符號來自字典（zh-Hant「、」、en「, 」；Intl.ListFormat 的中文 unit 格式沒有分隔符號）。 */
export function joinList(locale: Locale, values: readonly string[]): string {
  return values.join(getTranslator(locale).t("ui.common.listSeparator"));
}

/** 卡片上的平台 chip 文字（有縮寫用縮寫）。 */
export function platformChipText(p: { abbreviation: string | null; name: string }): string {
  return p.abbreviation?.trim() || p.name;
}

/** 活動在月曆中的日期：開始日（UTC）；開始於上個月的多日活動放本月 1 日。 */
export function eventDayInMonth(event: CalendarEventItem, year: number, month: number): string | null {
  if (!event.startTime) return null;
  const monthStart = isoDate(year, month, 1);
  const startDay = event.startTime.slice(0, 10);
  return startDay < monthStart ? monthStart : startDay;
}

export function buildCalendarViewModel(data: CalendarMonth, locale: Locale, t: Translator): CalendarViewModel {
  let seq = 0;
  const previews: Record<string, PreviewCardData> = {};
  const toItem = (card: ReleaseCard): CardItem => {
    const key = (seq++).toString(36);
    const preview: PreviewCardData = {
      h: gameHref(locale, card.slug),
      n: card.name,
      d: formatReleaseLabel(card.date, card.precision, locale),
      p: joinList(locale, card.platforms.map((p) => p.name)),
      sk: card.stage,
      s: stageLabel(t, card.stage),
    };
    if (card.originalName && card.originalName !== card.name) preview.o = card.originalName;
    if (card.cover) preview.c = card.cover.medium;
    if (card.status !== "scheduled") {
      preview.tk = card.status;
      preview.t = statusLabel(t, card.status);
    }
    if (card.sourceStatus === "removed") preview.r = 1;
    const heat = heatBadgeLabel(t, card.heatLevel);
    if (heat) {
      preview.hv = card.heatLevel;
      preview.hl = heat;
    }
    const abbr = card.platforms.map(platformChipText).join(" · ");
    if (abbr) preview.a = abbr;
    const notes: string[] = [];
    if (card.stage !== "full") notes.push(preview.s);
    if (card.status === "delayed" || card.status === "cancelled") notes.push(statusLabel(t, card.status));
    if (card.sourceStatus === "removed") notes.push(t.t("ui.release.sourceUnconfirmed"));
    if (notes.length > 0) preview.x = t.t("ui.common.parenthetical", { text: joinList(locale, notes) });
    previews[key] = preview;
    return { type: "card", key, card };
  };

  const days: Record<string, DayItem[]> = {};
  let releaseCount = 0;
  for (const iso of Object.keys(data.days).sort()) {
    const cards = data.days[iso] ?? [];
    days[iso] = cards.map(toItem);
    releaseCount += cards.length;
  }

  let eventCount = 0;
  const eventCountByDay: Record<string, number> = {};
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
    // 活動數量少且是重點，排在當天的上市卡片之前（不會被折疊進「＋N」）
    (days[day] ??= []).splice(eventCountByDay[day] ?? 0, 0, item);
    eventCountByDay[day] = (eventCountByDay[day] ?? 0) + 1;
    eventCount += 1;
  }

  const groups: Record<UndatedGroup["precision"], CardItem[]> = { month: [], quarter: [], year: [] };
  for (const card of data.undated) {
    if (card.precision === "month" || card.precision === "quarter" || card.precision === "year") {
      groups[card.precision].push(toItem(card));
      releaseCount += 1;
    }
  }
  const undated: UndatedGroup[] = (["month", "quarter", "year"] as const)
    .filter((p) => groups[p].length > 0)
    .map((precision) => ({ precision, items: groups[precision] }));

  return { days, undated, previews, releaseCount, eventCount };
}
