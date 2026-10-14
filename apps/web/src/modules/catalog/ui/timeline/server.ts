/**
 * 時間軸的資料載入（伺服器端）：頁面與 route handler 共用，只有這裡呼叫 Use Case 並轉成畫面資料。
 */
import { isValidIsoDate, type FilterSpec } from "@sok/api-contract";
import type { Locale } from "@sok/i18n";
import type { IgnoredFilterValue, IsoDate } from "../../domain/entities";
import { expandTimelineGroup, getReleaseDateHistory, getTimeline } from "../../use-cases/read";
import { filterSpecToReadQuery } from "../filter-mapping";
import { filterSpecForPage } from "../filters/filter-labels";
import { getTranslator } from "../labels";
import { releaseHistoryText } from "../release-history";
import type { TimelineChunk, TimelineGroupExpansion, TimelineHistoryResponse } from "./types";
import { buildTimelineChunk, toTimelineCard } from "./view-model";

export interface TimelineQuery {
  locale: Locale;
  /** 已解析的 FilterSpec（內部再套 `filterSpecForPage(…, "timeline")`）。 */
  spec: FilterSpec;
  /** 上一頁回傳的 cursor（原樣傳回）。 */
  cursor?: string | null;
  /** 跳到指定日期（YYYY-MM-DD）；格式不合法 → 忽略。 */
  at?: string | null;
}

/** 時間軸一頁（頁面初始資料與「載入更多／較早」共用）。 */
export async function loadTimelineChunk(q: TimelineQuery): Promise<{ chunk: TimelineChunk; today: IsoDate; anchor: IsoDate | null; ignored: IgnoredFilterValue[] }> {
  const t = getTranslator(q.locale);
  const rq = filterSpecToReadQuery(filterSpecForPage(q.spec, "timeline"));
  const at = q.at && isValidIsoDate(q.at) ? (q.at as IsoDate) : null;
  const page = await getTimeline({
    filter: rq.filter,
    regionPref: rq.regionPref,
    locale: q.locale,
    cursor: q.cursor ?? null,
    at,
    from: rq.from ?? null,
    to: rq.to ?? null,
  });
  return { chunk: buildTimelineChunk(page, q.locale, t), today: page.today, anchor: page.anchor, ignored: page.ignored };
}

/** 展開某組（接在預覽之後；offset 不給＝預覽筆數）。 */
export async function loadTimelineGroup(q: { locale: Locale; spec: FilterSpec; groupKey: string; offset?: number }): Promise<TimelineGroupExpansion> {
  const t = getTranslator(q.locale);
  const rq = filterSpecToReadQuery(filterSpecForPage(q.spec, "timeline"));
  const res = await expandTimelineGroup({
    groupKey: q.groupKey,
    filter: rq.filter,
    regionPref: rq.regionPref,
    locale: q.locale,
    offset: q.offset,
  });
  return {
    key: res.key,
    cards: res.cards.map((c) => toTimelineCard(c, q.locale, t)),
    totalCount: res.totalCount,
    nextOffset: res.nextOffset,
  };
}

/** 一張卡（合併了多個平台的上市列）的歷次公告日期：舊到新，相同文字去重。 */
export async function loadTimelineHistory(locale: Locale, releaseEventIds: readonly number[]): Promise<TimelineHistoryResponse> {
  const t = getTranslator(locale);
  const rows = await getReleaseDateHistory(releaseEventIds);
  const changes = rows.flatMap((r) => r.changes).sort((a, b) => (a.changedAt ?? "").localeCompare(b.changedAt ?? ""));
  return { entries: [...new Set(releaseHistoryText(changes, locale, t))] };
}
