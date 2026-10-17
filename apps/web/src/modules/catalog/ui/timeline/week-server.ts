/**
 * 時間軸（週）的資料載入（伺服器端）：頁面與 route handler 共用，只有這裡呼叫 Use Case 並轉成畫面資料。
 * 篩選與月曆共用 FilterSpec；`from`／`to`（日期範圍）對「一週」沒有意義，這裡一律略過。
 */
import { filterSpecToQueryString, isValidIsoDate, type FilterSpec } from "@sok/api-contract";
import { formatIsoDate, type Locale, type Translator } from "@sok/i18n";
import type { IgnoredFilterValue, IsoDate } from "../../domain/entities";
import { getTimelineWeek } from "../../use-cases/read";
import { toDayCard } from "../calendar/day-card";
import { filterSpecToReadQuery } from "../filter-mapping";
import { filterSpecForPage } from "../filters/filter-labels";
import { getTranslator } from "../labels";
import { localeHref } from "../links";
import type { TimelineWeekData, WeekDayData, WeekNavLink } from "./week-types";
import { addDays, isoWeekOf, parseWeekParam, weekStartOf } from "./week";

export interface TimelineWeekQuery {
  locale: Locale;
  /** 已解析的 FilterSpec（內部再套 `filterSpecForPage(…, "timeline")` 並去掉 from／to）。 */
  spec: FilterSpec;
  /** `2026-W43`；格式錯誤 → 忽略。 */
  week?: string | null;
  /** 跳到指定日期所在的週（YYYY-MM-DD；舊版時間軸網址 `at=`）；`week` 優先。 */
  at?: string | null;
}

/** 這一頁用的篩選：時間軸欄位，但去掉對「一週」沒有意義的日期範圍。 */
export function weekFilterSpec(spec: FilterSpec): FilterSpec {
  const { from: _from, to: _to, ...rest } = filterSpecForPage(spec, "timeline");
  void _from;
  void _to;
  return rest;
}

export function utcToday(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10) as IsoDate;
}

function rangeText(start: string, locale: Locale, t: Translator): string {
  const end = addDays(start, 6) ?? start;
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return t.t("ui.timeline.weekRange", { from: formatIsoDate(start, locale, opts), to: formatIsoDate(end, locale, opts) });
}

function navLink(locale: Locale, query: string, start: string | null, kind: "prev" | "next", t: Translator): WeekNavLink | null {
  if (!start) return null;
  const week = isoWeekOf(start);
  if (!week) return null;
  const label = t.t(kind === "prev" ? "ui.timeline.prevWeek" : "ui.timeline.nextWeek");
  return {
    week,
    href: localeHref(locale, "/timeline", [query, `week=${week}`].filter(Boolean).join("&")),
    aria: t.t("ui.timeline.weekNavAria", { label, range: rangeText(start, locale, t) }),
  };
}

/** 決定要顯示哪一週（星期一的日期）：`week` → `at` 所在週 → 今天所在週。 */
export function resolveWeekStart(q: Pick<TimelineWeekQuery, "week" | "at">, today: IsoDate): string {
  const fromWeek = q.week ? parseWeekParam(q.week) : null;
  if (fromWeek) return fromWeek;
  if (q.at && isValidIsoDate(q.at)) {
    const s = weekStartOf(q.at);
    if (s) return s;
  }
  return weekStartOf(today) ?? today;
}

export async function loadTimelineWeek(q: TimelineWeekQuery): Promise<{ data: TimelineWeekData; ignored: IgnoredFilterValue[] }> {
  const t = getTranslator(q.locale);
  const today = utcToday();
  const start = resolveWeekStart(q, today) as IsoDate;
  const end = (addDays(start, 6) ?? start) as IsoDate;
  const spec = weekFilterSpec(q.spec);
  const rq = filterSpecToReadQuery(spec);
  const query = filterSpecToQueryString(spec);

  const week = await getTimelineWeek({ start, end, filter: rq.filter, regionPref: rq.regionPref, locale: q.locale });
  const weekParam = isoWeekOf(start) ?? "";
  const range = rangeText(start, q.locale, t);

  const days: WeekDayData[] = week.days.map((d) => ({
    date: d.date,
    dayNum: Number(d.date.slice(8, 10)),
    weekday: formatIsoDate(d.date, q.locale, { weekday: "short" }),
    title: formatIsoDate(d.date, q.locale, { month: "long", day: "numeric", weekday: "long" }),
    label: t.t("a11y.dayCell", { date: formatIsoDate(d.date, q.locale, { dateStyle: "long" }), count: d.cards.length }),
    total: d.cards.length,
    first: toDayCard(d.cards[0]!, q.locale, t),
  }));
  const total = days.reduce((n, d) => n + d.total, 0);

  const data: TimelineWeekData = {
    week: weekParam,
    start,
    end,
    range,
    today,
    todayInWeek: today >= start && today <= end,
    todayText: t.t("ui.timeline.todayLine", { date: formatIsoDate(today, q.locale, { dateStyle: "long" }) }),
    href: localeHref(q.locale, "/timeline", [query, `week=${weekParam}`].filter(Boolean).join("&")),
    todayHref: localeHref(q.locale, "/timeline", query),
    prev: navLink(q.locale, query, addDays(start, -7), "prev", t),
    next: navLink(q.locale, query, addDays(start, 7), "next", t),
    days,
    total,
    announce: t.t("ui.timeline.weekLoaded", { range, count: total }),
  };
  return { data, ignored: week.ignored };
}
