/**
 * 時間軸讀取（06 §時間軸）：垂直議程，分組 月 → 日；模糊日期放所屬期間頂端；tbd 最後「未定」。
 *
 * 卡片一律來自 release-aggregate.ts 的 `buildAggregateCardsQuery`（聚合規則唯一實作），這裡只做：
 * - 排序鍵 `(sk, pr, np, game_id, st)`：sk＝COALESCE(period_start, '9999-12-31')、pr＝精度（year 0 → quarter 1 →
 *   month 2 → day 3 → tbd 4，粗的在期間頂端）、np＝−popularity_score、st＝階段序。spec 的 cursor
 *   `(period_start, popularity_score, game_id)` 加上 pr、st 才能唯一（同一款遊戲同一天可能有不同階段的卡）。
 * - 每組（period_start＋precision）只取前 N 筆（row_number），並帶組內總數。
 * - keyset 分頁（往後／往前），以 period_start 視窗分段查詢：熱門月份一天約 120 筆上市列，一次查整段未來或過去
 *   成本太高，所以從 cursor 起逐段（14 天，之後每段 ×4）查到湊滿一頁。
 *
 * cursor 是 opaque 字串（base64url JSON）；解析失敗回 null，由 Use Case 從起點開始。
 */
import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import {
  RELEASE_STAGES,
  type DatePrecision,
  type ImageResolver,
  type IsoDate,
  type RegionCode,
  type ReleaseCard,
  type ReleaseDateChange,
  type ReleaseEventDateHistory,
  type ResolvedReleaseFilter,
  type TimelineGroup,
} from "../domain/entities";
import { buildAggregateCardsQuery, cardRowToReleaseCard, type AggregateCardRow } from "./release-aggregate";
import { pgArray, toIso, withReadTimeout, type ReadOptions } from "./read-tx";

// ── 排序鍵與 cursor ─────────────────────────────────────────────────────

/** tbd（period_start 為 NULL）的排序日期：排在所有有日期的組之後。 */
export const TIMELINE_TBD_SORT_DATE = "9999-12-31";

const PRECISION_RANK: Record<DatePrecision, number> = { year: 0, quarter: 1, month: 2, day: 3, tbd: 4 };

/** 排序鍵（全序；同一張卡唯一）。 */
export interface TimelineKey {
  /** COALESCE(period_start, TIMELINE_TBD_SORT_DATE) */
  sk: IsoDate;
  /** 精度序（year 0 … tbd 4）；−1＝邊界鍵（某日期之前／之後的分界，不對應任何卡）。 */
  pr: number;
  /** −popularity_score */
  np: number;
  gameId: number;
  /** 階段序（RELEASE_STAGES 的 1-based 位置）。 */
  st: number;
}

export interface TimelineCursor {
  /** after＝取 key 之後（往後載入）；before＝取 key 之前（往前載入）。 */
  dir: "after" | "before";
  key: TimelineKey;
}

/** 某日期的邊界鍵：`after(boundary(d))` ＝ period_start ≥ d 的全部；`before(boundary(d))` ＝ period_start < d。 */
export function boundaryKey(date: IsoDate): TimelineKey {
  return { sk: date, pr: -1, np: 0, gameId: 0, st: 0 };
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

export function encodeTimelineCursor(c: TimelineCursor): string {
  const k = c.key;
  return b64urlEncode(JSON.stringify([1, c.dir === "after" ? "a" : "b", k.sk, k.pr, k.np, k.gameId, k.st]));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** 解析失敗（格式、版本、型別、範圍）一律回 null，不 throw。 */
export function decodeTimelineCursor(s: string | null | undefined): TimelineCursor | null {
  if (!s || s.length > 200 || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== 7 || v[0] !== 1) return null;
    const [, d, sk, pr, np, gameId, st] = v as unknown[];
    if ((d !== "a" && d !== "b") || typeof sk !== "string" || !ISO.test(sk)) return null;
    if (Number.isNaN(Date.parse(`${sk}T00:00:00Z`))) return null;
    if (!isInt(pr) || pr < -1 || pr > 4 || !isInt(np) || !isInt(gameId) || !isInt(st)) return null;
    return { dir: d === "a" ? "after" : "before", key: { sk, pr, np, gameId, st } };
  } catch {
    return null;
  }
}

export function compareTimelineKeys(a: TimelineKey, b: TimelineKey): number {
  return (
    (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0) || a.pr - b.pr || a.np - b.np || a.gameId - b.gameId || a.st - b.st
  );
}

/** 卡片 → 排序鍵。 */
export function timelineKeyOf(card: ReleaseCard): TimelineKey {
  return {
    sk: card.precision === "tbd" || !card.periodStart ? TIMELINE_TBD_SORT_DATE : card.periodStart,
    pr: PRECISION_RANK[card.precision],
    np: -card.popularityScore,
    gameId: card.gameId,
    st: RELEASE_STAGES.indexOf(card.stage) + 1,
  };
}

// ── 組鍵 ───────────────────────────────────────────────────────────────

/** `day:2026-10-13`、`month:2026-12-01`、`quarter:2027-04-01`、`year:2027-01-01`、`tbd`。 */
export function timelineGroupKey(precision: DatePrecision, periodStart: IsoDate | null): string {
  return precision === "tbd" || !periodStart ? "tbd" : `${precision}:${periodStart}`;
}

export function parseTimelineGroupKey(key: string): { precision: DatePrecision; periodStart: IsoDate | null } | null {
  if (key === "tbd") return { precision: "tbd", periodStart: null };
  const m = /^(day|month|quarter|year):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m || Number.isNaN(Date.parse(`${m[2]}T00:00:00Z`))) return null;
  return { precision: m[1] as DatePrecision, periodStart: m[2]! };
}

// ── 查詢 ───────────────────────────────────────────────────────────────

export interface TimelineQueryBase {
  filter: ResolvedReleaseFilter;
  regionPref: RegionCode;
  locale: string;
  today: IsoDate;
  resolveImage: ImageResolver;
}

export interface TimelinePageQuery extends TimelineQueryBase {
  cursor: TimelineCursor;
  /** 顯示卡片數上限。 */
  limit: number;
  /** 每組前 N 筆。 */
  perGroup: number;
  /** period_start 範圍（含）；FilterSpec 的 from／to。有任一個時不含 tbd。 */
  from?: IsoDate | null;
  to?: IsoDate | null;
}

interface RankedRow extends AggregateCardRow {
  sk: string;
  pr: number;
  np: number;
  st: number;
  rn: number;
  group_total: number;
}

export interface TimelineRawPage {
  /** 依排序鍵由小到大。 */
  rows: Array<{ card: ReleaseCard; key: TimelineKey; groupTotal: number; rank: number }>;
  /** 該方向還有更多。 */
  hasMore: boolean;
  /** 全庫（不含篩選）最早／最晚的 period_start；判斷另一方向是否可能有資料。 */
  minPeriodStart: IsoDate | null;
  maxPeriodStart: IsoDate | null;
}

const DATED: readonly DatePrecision[] = ["day", "month", "quarter", "year"];
const FIRST_WINDOW_DAYS = 14;
const WINDOW_GROWTH = 4;

function addDays(d: IsoDate, n: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const keyTuple = (k: TimelineKey) => sql`(${k.sk}::date, ${k.pr}::int, ${k.np}::int, ${k.gameId}::int, ${k.st}::int)`;

/**
 * 一段視窗的查詢：卡片（聚合）→ 排序鍵、組內名次、組內總數 → 只留前 perGroup 筆 → keyset → 排序 → LIMIT。
 * `precisions` 為 ['tbd'] 時查「未定」組（不受 from／to 限制）。
 */
export function buildTimelineWindowQuery(q: {
  base: Omit<TimelineQueryBase, "resolveImage">;
  precisions: readonly DatePrecision[];
  from?: IsoDate | null;
  to?: IsoDate | null;
  cursor: TimelineCursor;
  perGroup: number;
  limit: number;
  /** 展開某組用：跳過 rn ≤ offset 的、不套 perGroup。 */
  offset?: number;
}): SQL {
  const cards = buildAggregateCardsQuery({
    from: q.from,
    to: q.to,
    precisions: q.precisions,
    rangeColumn: "period_start",
    filter: q.base.filter,
    regionPref: q.base.regionPref,
    locale: q.base.locale,
    today: q.base.today,
  });
  const forward = q.cursor.dir === "after";
  const cmp = forward ? sql`>` : sql`<`;
  const dir = forward ? sql`ASC` : sql`DESC`;
  const rnCond = q.offset != null ? sql`t.rn > ${q.offset}` : sql`t.rn <= ${q.perGroup}`;
  return sql`
    WITH cards AS (${cards}),
    ranked AS (
      SELECT c.*,
        COALESCE(c.period_start::date, ${TIMELINE_TBD_SORT_DATE}::date)::text AS sk,
        (CASE c.precision WHEN 'year' THEN 0 WHEN 'quarter' THEN 1 WHEN 'month' THEN 2 WHEN 'day' THEN 3 ELSE 4 END) AS pr,
        (-c.popularity_score) AS np,
        array_position(${pgArray(RELEASE_STAGES)}::release_stage[], c.release_stage) AS st,
        row_number() OVER (PARTITION BY c.period_start, c.precision ORDER BY c.popularity_score DESC, c.game_id, c.release_stage)::int AS rn,
        count(*) OVER (PARTITION BY c.period_start, c.precision)::int AS group_total
      FROM cards c
    )
    SELECT t.* FROM ranked t
    WHERE ${rnCond}
      AND (t.sk::date, t.pr, t.np, t.game_id, t.st) ${cmp} ${keyTuple(q.cursor.key)}
    ORDER BY t.sk ${dir}, t.pr ${dir}, t.np ${dir}, t.game_id ${dir}, t.st ${dir}
    LIMIT ${Math.max(0, Math.floor(q.limit))}
  `;
}

function toRaw(r: RankedRow, resolveImage: ImageResolver) {
  return {
    card: cardRowToReleaseCard(r, resolveImage),
    key: { sk: r.sk, pr: r.pr, np: r.np, gameId: r.game_id, st: r.st },
    groupTotal: r.group_total,
    rank: r.rn,
  };
}

/**
 * 讀一頁（單一方向）。回傳的 rows 依排序鍵由小到大（往前載入時已反轉）。
 * 多取 1 筆判斷 hasMore。
 */
export async function readTimelinePage(q: TimelinePageQuery, opts: ReadOptions = {}): Promise<TimelineRawPage> {
  return withReadTimeout(async (tx) => {
    const bounds = await tx.execute<{ mn: string | null; mx: string | null }>(sql`
      SELECT min(period_start)::text AS mn, max(period_start)::text AS mx FROM release_events
    `);
    const minPs = bounds.rows[0]?.mn ?? null;
    const maxPs = bounds.rows[0]?.mx ?? null;
    const want = q.limit + 1;
    const out: RankedRow[] = [];
    const base = { filter: q.filter, regionPref: q.regionPref, locale: q.locale, today: q.today };
    const includeTbd = !q.from && !q.to;
    const lo = q.from && minPs && q.from > minPs ? q.from : minPs;
    const hi = q.to && maxPs && q.to < maxPs ? q.to : maxPs;

    const run = async (precisions: readonly DatePrecision[], from: IsoDate | null, to: IsoDate | null) => {
      const res = await tx.execute<RankedRow>(
        buildTimelineWindowQuery({ base, precisions, from, to, cursor: q.cursor, perGroup: q.perGroup, limit: want - out.length }),
      );
      out.push(...res.rows);
    };

    const datedPhase = async (forward: boolean) => {
      if (!lo || !hi) return;
      const start = q.cursor.key.sk;
      let days = FIRST_WINDOW_DAYS;
      if (forward) {
        let a = start < lo ? lo : start;
        while (out.length < want && a <= hi) {
          const b = addDays(a, days - 1);
          await run(DATED, a, b < hi ? b : hi);
          a = addDays(b, 1);
          days *= WINDOW_GROWTH;
        }
      } else {
        let b = start > hi ? hi : start;
        while (out.length < want && b >= lo) {
          const a = addDays(b, -(days - 1));
          await run(DATED, a > lo ? a : lo, b);
          b = addDays(a, -1);
          days *= WINDOW_GROWTH;
        }
      }
    };

    const inTbd = q.cursor.key.sk >= TIMELINE_TBD_SORT_DATE;
    if (q.cursor.dir === "after") {
      if (!inTbd) await datedPhase(true);
      if (includeTbd && out.length < want) await run(["tbd"], null, null);
    } else {
      if (inTbd && includeTbd) await run(["tbd"], null, null);
      if (out.length < want) await datedPhase(false);
    }

    const hasMore = out.length > q.limit;
    const rows = out.slice(0, q.limit).map((r) => toRaw(r, q.resolveImage));
    if (q.cursor.dir === "before") rows.reverse();
    return { rows, hasMore, minPeriodStart: minPs, maxPeriodStart: maxPs };
  }, opts);
}

export interface TimelineGroupQuery extends TimelineQueryBase {
  precision: DatePrecision;
  periodStart: IsoDate | null;
  offset: number;
  limit: number;
}

/** 展開某組：組內第 offset+1 筆起（同一排序），多取 1 筆判斷是否還有。 */
export async function readTimelineGroup(
  q: TimelineGroupQuery,
  opts: ReadOptions = {},
): Promise<{ cards: ReleaseCard[]; totalCount: number; hasMore: boolean }> {
  const ps = q.periodStart;
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<RankedRow>(
        buildTimelineWindowQuery({
          base: { filter: q.filter, regionPref: q.regionPref, locale: q.locale, today: q.today },
          precisions: [q.precision],
          from: ps,
          to: ps,
          cursor: { dir: "after", key: ps ? boundaryKey(ps) : boundaryKey(TIMELINE_TBD_SORT_DATE) },
          perGroup: 0,
          offset: q.offset,
          limit: q.limit + 1,
        }),
      ),
    opts,
  );
  const rows = res.rows.slice(0, q.limit);
  return {
    cards: rows.map((r) => cardRowToReleaseCard(r, q.resolveImage)),
    totalCount: res.rows[0]?.group_total ?? 0,
    hasMore: res.rows.length > q.limit,
  };
}

// ── 組裝 ───────────────────────────────────────────────────────────────

/**
 * 依序把 rows 分組（rows 已依排序鍵排好）。continuesFromPrev／continuesToNext 依組內名次判斷：
 * 第一張卡名次 > 1 → 前一頁還有；最後一張名次 < min(總數, perGroup) → 下一頁還有。
 */
export function groupTimelineRows(rows: TimelineRawPage["rows"], perGroup: number): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let current: TimelineGroup | null = null;
  let lastRank = 0;
  const close = () => {
    if (current) current.continuesToNext = lastRank < Math.min(current.totalCount, perGroup);
  };
  for (const r of rows) {
    const key = timelineGroupKey(r.card.precision, r.card.periodStart);
    if (!current || current.key !== key) {
      close();
      const ps = r.card.precision === "tbd" ? null : r.card.periodStart;
      current = {
        key,
        kind: r.card.precision,
        periodStart: ps,
        month: ps ? ps.slice(0, 7) : null,
        cards: [],
        totalCount: r.groupTotal,
        hiddenCount: Math.max(0, r.groupTotal - perGroup),
        continuesFromPrev: r.rank > 1,
        continuesToNext: false,
      };
      groups.push(current);
    }
    current.cards.push(r.card);
    lastRank = r.rank;
  }
  close();
  return groups;
}

// ── 改期紀錄 ───────────────────────────────────────────────────────────

interface HistoryRow extends Record<string, unknown> {
  release_event_id: number;
  old_date: IsoDate | null;
  old_precision: DatePrecision | null;
  new_date: IsoDate | null;
  new_precision: DatePrecision | null;
  changed_at: Date | null;
}

/**
 * 上市列的歷次公告日期（release_date_history，舊到新）。時間軸卡片的 releaseEventIds 傳進來。
 * 欄位對應與 game-detail.ts 的詳情頁改期紀錄相同（ReleaseDateChange）。沒有紀錄的列也回傳（changes 為空）。
 */
export async function listReleaseDateHistory(
  releaseEventIds: readonly number[],
  opts: ReadOptions = {},
): Promise<ReleaseEventDateHistory[]> {
  const ids = [...new Set(releaseEventIds.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 200);
  if (ids.length === 0) return [];
  const res = await withReadTimeout(
    (tx: DbOrTx) =>
      tx.execute<HistoryRow>(sql`
        SELECT h.release_event_id, h.old_date::text AS old_date, h.old_precision,
          h.new_date::text AS new_date, h.new_precision, h.changed_at
        FROM release_date_history h
        WHERE h.release_event_id = ANY(${pgArray(ids)}::int[])
        ORDER BY h.changed_at ASC NULLS FIRST, h.id ASC
      `),
    opts,
  );
  const map = new Map<number, ReleaseDateChange[]>(ids.map((id) => [id, []]));
  for (const h of res.rows) {
    map.get(h.release_event_id)?.push({
      oldDate: h.old_date,
      oldPrecision: h.old_precision,
      newDate: h.new_date,
      newPrecision: h.new_precision,
      changedAt: toIso(h.changed_at),
    });
  }
  return ids.map((id) => ({ releaseEventId: id, changes: map.get(id) ?? [] }));
}
