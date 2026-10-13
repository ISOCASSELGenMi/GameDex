import {
  TIMELINE_GROUP_PAGE_MAX,
  TIMELINE_GROUP_PREVIEW,
  TIMELINE_PAGE_SIZE,
  TIMELINE_PAGE_SIZE_MAX,
  type IsoDate,
  type ReleaseEventDateHistory,
  type ReleaseFilter,
  type TimelineGroupCards,
  type TimelinePage,
} from "../../domain/entities";
import { isValidIsoDate } from "@sok/api-contract";
import { resolveImageRef } from "../../providers/image-ref";
import { utcToday } from "../../repository/release-aggregate";
import {
  boundaryKey,
  decodeTimelineCursor,
  encodeTimelineCursor,
  groupTimelineRows,
  listReleaseDateHistory,
  parseTimelineGroupKey,
  readTimelineGroup,
  readTimelinePage,
  TIMELINE_TBD_SORT_DATE,
  type TimelineCursor,
} from "../../repository/timeline";
import { resolveFilterSlugs, resolveRegionPrefWithNotice } from "./resolve-filter";

export interface GetTimelineInput {
  filter?: ReleaseFilter;
  /** regions.code（URL `region`）；無效 → 預設並在 ignored 回報。 */
  regionPref?: string | null;
  /** games.displayNames 的語系鍵。 */
  locale: string;
  /** 上一頁回傳的 nextCursor／prevCursor；解析失敗＝忽略，從 `at`（或今天）開始。 */
  cursor?: string | null;
  /** 跳到指定日期（YYYY-MM-DD，UTC）；未給＝今天。給了 cursor 時忽略。 */
  at?: IsoDate | null;
  /** FilterSpec from／to（比對 period_start，含）。任一個有值時不顯示「未定」組。 */
  from?: IsoDate | null;
  to?: IsoDate | null;
  /** 一頁顯示幾張卡；預設 TIMELINE_PAGE_SIZE，上限 TIMELINE_PAGE_SIZE_MAX。 */
  limit?: number;
  /** 「今天」；測試用，預設現在。 */
  now?: Date;
}

const validDate = (d: string | null | undefined): d is IsoDate => !!d && isValidIsoDate(d);

/**
 * 時間軸一頁（06 §時間軸）。未給 cursor：從 `at`（或今天 UTC）往後；給 cursor：依 cursor 方向（往後或往前）。
 * - 分組：月 → 日；模糊日期在期間頂端（同 periodStart 時 year → quarter → month → day）；tbd 最後。
 * - 每組只回前 TIMELINE_GROUP_PREVIEW 筆，其餘數量在 hiddenCount，用 expandTimelineGroup 取。
 * - 卡片 hasDateHistory＝有改期紀錄，用 getReleaseDateHistory(card.releaseEventIds) 取歷次日期。
 * 逾時丟 CatalogQueryTimeoutError。
 */
export async function getTimeline(input: GetTimelineInput): Promise<TimelinePage> {
  const today = utcToday(input.now);
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const region = resolveRegionPrefWithNotice(input.regionPref);
  const limit = clampInt(input.limit, TIMELINE_PAGE_SIZE, 1, TIMELINE_PAGE_SIZE_MAX);
  const decoded = decodeTimelineCursor(input.cursor);
  const anchor = decoded ? null : validDate(input.at) ? input.at : today;
  const cursor: TimelineCursor = decoded ?? { dir: "after", key: boundaryKey(anchor!) };
  const from = validDate(input.from) ? input.from : null;
  const to = validDate(input.to) ? input.to : null;

  const raw = await readTimelinePage({
    filter,
    regionPref: region.regionPref,
    locale: input.locale,
    today,
    resolveImage: resolveImageRef,
    cursor,
    limit,
    perGroup: TIMELINE_GROUP_PREVIEW,
    from,
    to,
  });

  const first = raw.rows[0]?.key;
  const last = raw.rows.at(-1)?.key;
  let nextCursor: string | null = null;
  let prevCursor: string | null = null;
  let nextPartial = false;
  let prevPartial = false;
  if (cursor.dir === "after") {
    if (raw.hasMore && last) nextCursor = encodeTimelineCursor({ dir: "after", key: last });
    else if (raw.partial) {
      // 掃描量用完仍湊不滿：cursor 指向已掃描範圍的邊界，下次從那裡繼續（不是「到盡頭」）
      nextCursor = encodeTimelineCursor({ dir: "after", key: raw.partial });
      nextPartial = true;
    }
    // 往前：從這頁第一張（或起點）之前；全庫最早日期在其之前才給（不保證篩選後有資料）
    const edge = first ?? cursor.key;
    const lowest = from && raw.minPeriodStart && from > raw.minPeriodStart ? from : raw.minPeriodStart;
    if (lowest && lowest < edge.sk) prevCursor = encodeTimelineCursor({ dir: "before", key: edge });
    else if (lowest && lowest === edge.sk && edge.pr > 0) prevCursor = encodeTimelineCursor({ dir: "before", key: edge });
  } else {
    if (raw.hasMore && first) prevCursor = encodeTimelineCursor({ dir: "before", key: first });
    else if (raw.partial) {
      prevCursor = encodeTimelineCursor({ dir: "before", key: raw.partial });
      prevPartial = true;
    }
    // 往後：從 cursor 來的，cursor 之後一定還有資料
    const edge = last ?? cursor.key;
    if (raw.rows.length > 0 || edge.sk < TIMELINE_TBD_SORT_DATE) nextCursor = encodeTimelineCursor({ dir: "after", key: edge });
  }

  return {
    groups: groupTimelineRows(raw.rows, TIMELINE_GROUP_PREVIEW),
    nextCursor,
    prevCursor,
    nextPartial,
    prevPartial,
    today,
    anchor,
    groupPreview: TIMELINE_GROUP_PREVIEW,
    ignored: [...ignored, ...region.ignored],
  };
}

export interface ExpandTimelineGroupInput {
  /** TimelineGroup.key（`day:2026-10-13`、`month:2026-12-01`、`tbd`…）。 */
  groupKey: string;
  filter?: ReleaseFilter;
  regionPref?: string | null;
  locale: string;
  /** 從組內第幾筆之後開始；預設 TIMELINE_GROUP_PREVIEW（接在預覽之後）。 */
  offset?: number;
  /** 預設 100，上限 TIMELINE_GROUP_PAGE_MAX。 */
  limit?: number;
  now?: Date;
}

/** 展開某組（「展開某日」）：組內排序與時間軸相同（熱度高到低）。groupKey 無效回空結果（不 throw）。 */
export async function expandTimelineGroup(input: ExpandTimelineGroupInput): Promise<TimelineGroupCards> {
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const region = resolveRegionPrefWithNotice(input.regionPref);
  const allIgnored = [...ignored, ...region.ignored];
  const parsed = parseTimelineGroupKey(input.groupKey);
  if (!parsed) return { key: input.groupKey, cards: [], totalCount: 0, nextOffset: null, ignored: allIgnored };
  const offset = clampInt(input.offset, TIMELINE_GROUP_PREVIEW, 0, 100_000);
  const limit = clampInt(input.limit, 100, 1, TIMELINE_GROUP_PAGE_MAX);
  const res = await readTimelineGroup({
    filter,
    regionPref: region.regionPref,
    locale: input.locale,
    today: utcToday(input.now),
    resolveImage: resolveImageRef,
    precision: parsed.precision,
    periodStart: parsed.periodStart,
    offset,
    limit,
  });
  return {
    key: input.groupKey,
    cards: res.cards,
    totalCount: res.totalCount,
    nextOffset: res.hasMore ? offset + res.cards.length : null,
    ignored: allIgnored,
  };
}

/** 歷次公告日期（release_date_history，舊到新）。傳卡片的 releaseEventIds（最多 200 個）。 */
export async function getReleaseDateHistory(releaseEventIds: readonly number[]): Promise<ReleaseEventDateHistory[]> {
  return listReleaseDateHistory(releaseEventIds);
}

function clampInt(v: number | undefined, dflt: number, min: number, max: number): number {
  if (v === undefined || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(v)));
}
