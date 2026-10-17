/**
 * iCal feed 的查詢（08）。聚合規則（每個 (遊戲, 平台, 階段) 挑一列）只有 release-aggregate.ts 一份，這裡只決定：
 * - 公開 feed 的視窗（SQL 條件，透過 `windowSql` 注入聚合查詢）
 * - 每個項目的整組 sequence 總和與 updatedAt 最大值（聚合查詢的 `sequence_sum`／`group_updated_at`）
 * - tbd／取消項目的「原本的日期」（release_date_history）
 * - ETag 用的摘要（count＋max(updated_at)），與產生內容用同一個挑選結果。
 *
 * 視窗（公開 feed，「今天」＝UTC 日期 T）：
 * 1. 一般項目：`COALESCE(period_start, release_date) ≤ T+90 且 release_date ≥ T`（季／年在期間結束前都留著；月精度過了月初就不在）；
 *    或該 (遊戲, 平台, 階段) 近 60 天內有改期紀錄（release_date_history.changed_at）——否則延期到視窗外的遊戲會從訂閱中消失。
 * 2. 延期成 tbd：該組有 old_date 非 NULL、new_date 為 NULL 或 new_precision＝tbd 的改期紀錄，且 changed_at 在近 30 天內
 *    （「原本有日期」的依據）；從未有過日期的 tbd 不輸出。
 * 3. 取消：status＝cancelled 且該列 sequence > 0（status／日期變動過＝訂閱者可能看過這個項目；建立時就是 cancelled、
 *    從沒變動的不輸出，否則首次回填會把大量舊的取消遊戲灌進 feed）且 updated_at 在近 30 天內（updated_at 當作取消時間：
 *    只有內容改變才會寫入，取消後若又被更新則保留期往後延，不會短於 30 天）；取消的項目不受 90 天視窗限制。
 */
import { sql, type SQL } from "drizzle-orm";
import {
  ICAL_RECENT_CHANGE_DAYS,
  ICAL_RETAIN_DAYS,
  ICAL_WINDOW_DAYS,
  type DatePrecision,
  type EventKind,
  type IcalEventItem,
  type IcalFeedMeta,
  type IcalReleaseItem,
  type IsoDate,
  type ResolvedReleaseFilter,
} from "../domain/entities";
import { buildAggregatePicksQuery, periodEndSql, type AggregatePickRow } from "./release-aggregate";
import { pgArray } from "./read-tx";
import { withReadTimeout, type ReadOptions } from "./read-tx";

export type IcalReleaseScope =
  | { type: "public"; today: IsoDate; limit: number }
  | { type: "game"; gameId: number; today: IsoDate }
  /**
   * 私人追蹤 feed（Phase 7 第 6 波；08 §私人 feed）：
   * - gameIds＝追蹤的遊戲：不受 90 天視窗限制，過去的上市保留近 30 天（`followedWindowSql`）。
   * - platformIds／franchiseIds／companyIds＝追蹤的平台／系列／公司：旗下遊戲的上市事件（平台＝該平台上的上市列），
   *   用公開 feed 的 90 天視窗，且這三類合計最多 limit 筆（ICAL_PUBLIC_MAX_EVENTS，依熱度取前 N）。
   * 使用者的篩選（平台、類型、階段…）在 IcalReleaseQuery.filter；同一個 (遊戲, 平台, 階段) 只輸出一次（追蹤的遊戲優先）。
   */
  | {
      type: "following";
      today: IsoDate;
      limit: number;
      gameIds: readonly number[];
      platformIds: readonly number[];
      franchiseIds: readonly number[];
      companyIds: readonly number[];
    };

export interface IcalReleaseQuery {
  scope: IcalReleaseScope;
  filter: ResolvedReleaseFilter;
  locale: string;
  regionPref: string;
}

const dayStart = (today: IsoDate, minusDays: number): SQL =>
  sql`((${today}::date - ${minusDays}::int)::timestamp AT TIME ZONE 'UTC')`;

/** 同一個 (遊戲, 平台, 階段) 的全部改期紀錄（alias 是帶 game_id／platform_id／release_stage 的列）。 */
function keyHistory(alias: string, extra: SQL): SQL {
  const a = sql.raw(alias);
  return sql`EXISTS (
    SELECT 1 FROM release_date_history h JOIN release_events x ON x.id = h.release_event_id
    WHERE x.game_id = ${a}.game_id AND x.platform_id = ${a}.platform_id AND x.release_stage = ${a}.release_stage AND ${extra}
  )`;
}

/** 公開 feed 視窗（見檔頭）。alias r＝候選列（列層級的寬鬆條件，只負責縮小候選鍵），p＝挑出的列（精確條件）。 */
export function publicWindowSql(today: IsoDate): (alias: "r" | "p") => SQL {
  const horizon = sql`(${today}::date + ${ICAL_WINDOW_DAYS}::int)`;
  return windowSql(today, (a) =>
    sql`(COALESCE(${a}.period_start, ${a}.release_date) <= ${horizon} AND ${a}.release_date >= ${today}::date)`,
  );
}

/**
 * 私人 feed「追蹤的遊戲」視窗：沒有 90 天上限，代表期間的最後一天 ≥ 今天 − 30 天（過去的上市保留近 30 天）；
 * 取消／延期成 tbd 的過渡期規則與公開 feed 相同（共用 windowSql）。
 */
export function followedWindowSql(today: IsoDate): (alias: "r" | "p") => SQL {
  return windowSql(today, (a) => sql`(${periodEndSql(sql`${a}.precision`, sql`${a}.release_date`)} >= (${today}::date - ${ICAL_RETAIN_DAYS}::int))`);
}

/** 視窗的共同骨架：只有「一般項目在不在視窗內」(inWindow) 因 feed 而異；取消、tbd 過渡期的規則共用。 */
function windowSql(today: IsoDate, inWindow: (a: SQL) => SQL): (alias: "r" | "p") => SQL {
  return (alias) => {
    const a = sql.raw(alias);
    if (alias === "r") {
      return sql`(
        (${a}.status <> 'cancelled' AND ${a}.precision <> 'tbd' AND ${a}.release_date IS NOT NULL AND ${inWindow(a)})
        OR ${a}.id IN (SELECT release_event_id FROM release_date_history WHERE changed_at >= ${dayStart(today, ICAL_RECENT_CHANGE_DAYS)})
        OR (${a}.status = 'cancelled' AND ${a}.sequence > 0 AND ${a}.updated_at >= ${dayStart(today, ICAL_RETAIN_DAYS)})
      )`;
    }
    const hasDatedHistory = sql`h.old_date IS NOT NULL`;
    return sql`(CASE
      WHEN ${a}.status = 'cancelled' THEN
        ${a}.sequence > 0 AND ${a}.updated_at >= ${dayStart(today, ICAL_RETAIN_DAYS)}
        AND (${a}.release_date IS NOT NULL OR ${keyHistory(alias, hasDatedHistory)})
      WHEN ${a}.precision = 'tbd' OR ${a}.release_date IS NULL THEN
        ${keyHistory(
          alias,
          sql`${hasDatedHistory} AND (h.new_date IS NULL OR h.new_precision = 'tbd') AND h.changed_at >= ${dayStart(today, ICAL_RETAIN_DAYS)}`,
        )}
      ELSE
        ${inWindow(a)}
        OR ${keyHistory(alias, sql`h.changed_at >= ${dayStart(today, ICAL_RECENT_CHANGE_DAYS)}`)}
    END)`;
  };
}

/** 單一遊戲：不受視窗限制（過去的、很遠的、取消的都給）；只排除「從未有過日期」的 tbd（沒有位置可放）。 */
function gameWindowSql(alias: "r" | "p"): SQL {
  if (alias === "r") return sql`TRUE`;
  return sql`(p.release_date IS NOT NULL OR ${keyHistory("p", sql`h.old_date IS NOT NULL`)})`;
}

/** 兩個 id 清單取交集；第一個未給（undefined）＝不限制，直接用第二個。 */
function intersectIds(userIds: readonly number[] | undefined, followed: readonly number[]): number[] {
  if (!userIds) return [...followed];
  const set = new Set(userIds);
  return followed.filter((id) => set.has(id));
}

/**
 * 私人追蹤 feed 的挑選：追蹤的遊戲（followedWindow、不限筆數）＋平台／系列／公司旗下（公開視窗、合計取前 limit 筆）。
 * 每一段都是同一個 buildAggregatePicksQuery（聚合規則只有一份）；這裡只決定各段的篩選與視窗，再依
 * (遊戲, 平台, 階段) 去重（追蹤的遊戲優先）並對「旗下」那一段套上限。
 */
function followingPicksQuery(q: IcalReleaseQuery, s: Extract<IcalReleaseScope, { type: "following" }>): SQL {
  const base = { regionPref: q.regionPref, locale: q.locale, today: s.today, preferLiveStatus: true };
  const parts: SQL[] = [];
  if (s.gameIds.length > 0) {
    const query = buildAggregatePicksQuery({ ...base, filter: q.filter, gameIds: s.gameIds, windowSql: followedWindowSql(s.today) });
    parts.push(sql`SELECT 0 AS prio, a.* FROM (${query}) a`);
  }
  const fanOut = (filter: ResolvedReleaseFilter) =>
    parts.push(sql`SELECT 1 AS prio, b.* FROM (${buildAggregatePicksQuery({ ...base, filter, windowSql: publicWindowSql(s.today) })}) b`);
  if (s.platformIds.length > 0) {
    const ids = intersectIds(q.filter.platformIds, s.platformIds);
    if (ids.length > 0) fanOut({ ...q.filter, platformIds: ids });
  }
  if (s.franchiseIds.length > 0) {
    const ids = intersectIds(q.filter.franchiseIds, s.franchiseIds);
    if (ids.length > 0) fanOut({ ...q.filter, franchiseIds: ids });
  }
  if (s.companyIds.length > 0) {
    const ids = intersectIds(q.filter.companyIds, s.companyIds);
    if (ids.length > 0) fanOut({ ...q.filter, companyIds: ids });
  }
  if (parts.length === 0) {
    // 沒有任何有效範圍（例如篩選的平台與追蹤的平台沒有交集）：同樣的欄位、零列（遊戲 id 0 不存在）
    const none = buildAggregatePicksQuery({ ...base, filter: q.filter, gameIds: [0], windowSql: followedWindowSql(s.today) });
    parts.push(sql`SELECT 0 AS prio, a.* FROM (${none}) a`);
  }
  const cap = Math.max(0, Math.floor(s.limit));
  return sql`
    SELECT r.* FROM (
      SELECT m.*,
        CASE WHEN m.prio = 0 THEN 0 ELSE row_number() OVER (
          PARTITION BY m.prio
          ORDER BY m.popularity_score DESC, m.release_date ASC NULLS LAST, m.game_id ASC, m.platform_id ASC, m.release_stage ASC
        ) END AS fan_rank
      FROM (
        SELECT DISTINCT ON (u.game_id, u.platform_id, u.release_stage) u.*
        FROM (${sql.join(parts, sql` UNION ALL `)}) u
        ORDER BY u.game_id, u.platform_id, u.release_stage, u.prio
      ) m
    ) r
    WHERE r.prio = 0 OR r.fan_rank <= ${cap}
  `;
}

function picksQuery(q: IcalReleaseQuery): SQL {
  const base = {
    filter: q.filter,
    regionPref: q.regionPref,
    locale: q.locale,
    today: q.scope.today,
    preferLiveStatus: true,
  };
  if (q.scope.type === "game") {
    return buildAggregatePicksQuery({ ...base, gameIds: [q.scope.gameId], windowSql: gameWindowSql });
  }
  if (q.scope.type === "following") return followingPicksQuery(q, q.scope);
  return buildAggregatePicksQuery({ ...base, windowSql: publicWindowSql(q.scope.today) });
}

/** 熱度高到低（取前 N 筆時誰先被留下）→ 日期 → 固定鍵，結果確定性。 */
const PICK_ORDER = sql`q.popularity_score DESC, q.release_date ASC NULLS LAST, q.game_id ASC, q.platform_id ASC, q.release_stage ASC`;

function limitOf(q: IcalReleaseQuery): SQL {
  return q.scope.type === "public" ? sql`LIMIT ${Math.max(0, Math.floor(q.scope.limit))}` : sql``;
}

interface IcalReleaseRow extends AggregatePickRow {
  last_known_date: string | null;
  last_known_precision: DatePrecision | null;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/** 依視窗與篩選挑出的上市項目（尚未排成輸出順序；由產生函式排序）。逾時丟 CatalogQueryTimeoutError。 */
export async function listIcalReleases(q: IcalReleaseQuery, opts: ReadOptions = {}): Promise<IcalReleaseItem[]> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<IcalReleaseRow>(sql`
        SELECT q.*, lk.old_date::text AS last_known_date, lk.old_precision AS last_known_precision
        FROM (${picksQuery(q)}) q
        LEFT JOIN LATERAL (
          SELECT h.old_date, h.old_precision
          FROM release_date_history h JOIN release_events x ON x.id = h.release_event_id
          WHERE (q.precision = 'tbd' OR q.release_date IS NULL)
            AND x.game_id = q.game_id AND x.platform_id = q.platform_id AND x.release_stage = q.release_stage
            AND h.old_date IS NOT NULL
          ORDER BY h.changed_at DESC, h.id DESC
          LIMIT 1
        ) lk ON TRUE
        ORDER BY ${PICK_ORDER}
        ${limitOf(q)}
      `),
    opts,
  );
  return res.rows.map((r) => ({
    gameId: r.game_id,
    gameSlug: r.game_slug,
    gameName: r.name,
    platformId: r.platform_id,
    platformName: r.platform_name,
    platformAbbreviation: r.platform_abbreviation,
    stage: r.release_stage,
    regionCode: r.region_code,
    date: r.release_date,
    precision: r.precision,
    status: r.status,
    sequence: r.sequence_sum,
    updatedAt: toDate(r.group_updated_at ?? new Date(0)),
    lastKnownDate: r.last_known_date,
    lastKnownPrecision: r.last_known_precision,
  }));
}

/** ETag 摘要：和 listIcalReleases 同一組挑選結果（含熱度取前 N），一個聚合查詢，不產生內容。 */
export async function getIcalReleaseMeta(q: IcalReleaseQuery, opts: ReadOptions = {}): Promise<IcalFeedMeta> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<{ n: number; max_updated: Date | string | null }>(sql`
        SELECT count(*)::int AS n, max(t.group_updated_at) AS max_updated
        FROM (
          SELECT q.group_updated_at FROM (${picksQuery(q)}) q ORDER BY ${PICK_ORDER} ${limitOf(q)}
        ) t
      `),
    opts,
  );
  const row = res.rows[0];
  return { count: row?.n ?? 0, maxUpdatedAt: row?.max_updated ? toDate(row.max_updated) : null };
}

// ── 活動 ─────────────────────────────────────────────────────────────────

/** 活動 feed 保留已結束的活動多少天（避免剛結束就憑空消失）。 */
export const ICAL_EVENT_PAST_DAYS = ICAL_RETAIN_DAYS;

interface IcalEventRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  kind: EventKind;
  description: string | null;
  start_time: Date | string;
  end_time: Date | string | null;
  url: string | null;
  stream_url: string | null;
  organizer: string | null;
  updated_at: Date | string;
  sequence: number;
}

function eventWhere(today: IsoDate): SQL {
  return sql`e.start_time IS NOT NULL AND COALESCE(e.end_time, e.start_time) >= ${dayStart(today, ICAL_EVENT_PAST_DAYS)}`;
}

/** 活動 feed 的項目：start_time 非 NULL，結束時間在近 30 天內或之後；依開始時間取前 limit 筆。 */
export async function listIcalEvents(
  input: { today: IsoDate; limit: number },
  opts: ReadOptions = {},
): Promise<IcalEventItem[]> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<IcalEventRow>(sql`
        SELECT e.id, e.slug, e.name, e.kind, e.description, e.start_time, e.end_time, e.url, e.stream_url, e.organizer, e.updated_at, e.sequence
        FROM events e
        WHERE ${eventWhere(input.today)}
        ORDER BY e.start_time ASC, e.id ASC
        LIMIT ${Math.max(0, Math.floor(input.limit))}
      `),
    opts,
  );
  return res.rows.map(rowToEvent);
}

function rowToEvent(r: IcalEventRow): IcalEventItem {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    description: r.description,
    startTime: toDate(r.start_time),
    endTime: r.end_time ? toDate(r.end_time) : null,
    url: r.url,
    streamUrl: r.stream_url,
    organizer: r.organizer,
    sequence: r.sequence,
    updatedAt: toDate(r.updated_at),
  };
}

export async function getIcalEventMeta(
  input: { today: IsoDate; limit: number },
  opts: ReadOptions = {},
): Promise<IcalFeedMeta> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<{ n: number; max_updated: Date | string | null }>(sql`
        SELECT count(*)::int AS n, max(t.updated_at) AS max_updated
        FROM (
          SELECT e.updated_at FROM events e WHERE ${eventWhere(input.today)}
          ORDER BY e.start_time ASC, e.id ASC LIMIT ${Math.max(0, Math.floor(input.limit))}
        ) t
      `),
    opts,
  );
  const row = res.rows[0];
  return { count: row?.n ?? 0, maxUpdatedAt: row?.max_updated ? toDate(row.max_updated) : null };
}

// ── 私人追蹤 feed 的活動 ─────────────────────────────────────────────────

export interface IcalFollowingEventScope {
  today: IsoDate;
  /** 明確追蹤的活動：不受上限。 */
  eventIds: readonly number[];
  /** 與這些遊戲相關的活動（event_games）；空＝不含相關活動。 */
  relatedGameIds: readonly number[];
  /** 相關活動的筆數上限（依開始時間取前 N）。 */
  relatedLimit: number;
}

/** 追蹤 feed 的活動 SELECT（含 explicit／rn 欄位）；沒有任何範圍時呼叫端不該呼叫。 */
function followingEventsSql(s: IcalFollowingEventScope, columns: SQL): SQL {
  const explicit = s.eventIds.length > 0 ? sql`e.id = ANY(${pgArray(s.eventIds)}::int[])` : sql`FALSE`;
  const related =
    s.relatedGameIds.length > 0
      ? sql`EXISTS (SELECT 1 FROM event_games eg WHERE eg.event_id = e.id AND eg.game_id = ANY(${pgArray(s.relatedGameIds)}::int[]))`
      : sql`FALSE`;
  return sql`
    SELECT ${columns} FROM (
      SELECT e.*, (${explicit}) AS is_explicit,
        row_number() OVER (PARTITION BY (${explicit}) ORDER BY e.start_time ASC, e.id ASC) AS rn
      FROM events e
      WHERE ${eventWhere(s.today)} AND ((${explicit}) OR (${related}))
    ) e
    WHERE e.is_explicit OR e.rn <= ${Math.max(0, Math.floor(s.relatedLimit))}
  `;
}

const hasFollowingEventScope = (s: IcalFollowingEventScope) => s.eventIds.length > 0 || s.relatedGameIds.length > 0;

/** 追蹤 feed 的活動：追蹤的活動（全部）＋相關活動（前 relatedLimit 筆）；結束時間在近 30 天內或之後。 */
export async function listIcalFollowingEvents(s: IcalFollowingEventScope, opts: ReadOptions = {}): Promise<IcalEventItem[]> {
  if (!hasFollowingEventScope(s)) return [];
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<IcalEventRow>(sql`
        SELECT x.* FROM (${followingEventsSql(s, sql`e.id, e.slug, e.name, e.kind, e.description, e.start_time, e.end_time, e.url, e.stream_url, e.organizer, e.updated_at, e.sequence`)}) x
        ORDER BY x.start_time ASC, x.id ASC
      `),
    opts,
  );
  return res.rows.map(rowToEvent);
}

export async function getIcalFollowingEventMeta(s: IcalFollowingEventScope, opts: ReadOptions = {}): Promise<IcalFeedMeta> {
  if (!hasFollowingEventScope(s)) return { count: 0, maxUpdatedAt: null };
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<{ n: number; max_updated: Date | string | null }>(sql`
        SELECT count(*)::int AS n, max(x.updated_at) AS max_updated FROM (${followingEventsSql(s, sql`e.id, e.updated_at`)}) x
      `),
    opts,
  );
  const row = res.rows[0];
  return { count: row?.n ?? 0, maxUpdatedAt: row?.max_updated ? toDate(row.max_updated) : null };
}

// ── 單一遊戲 ─────────────────────────────────────────────────────────────

export interface IcalGameRef {
  id: number;
  slug: string;
  name: string;
}

/** 單一遊戲 .ics 用：slug → id＋顯示名稱（依語系 displayNames）。 */
export async function findIcalGameBySlug(slug: string, locale: string, opts: ReadOptions = {}): Promise<IcalGameRef | null> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<{ id: number; slug: string; name: string }>(sql`
        SELECT g.id, g.slug, COALESCE(NULLIF(g.display_names ->> ${locale}, ''), g.name) AS name
        FROM games g WHERE g.slug = ${slug} LIMIT 1
      `),
    opts,
  );
  return res.rows[0] ?? null;
}

// ── 單一平台 ─────────────────────────────────────────────────────────────

export interface IcalPlatformRef {
  id: number;
  slug: string;
  name: string;
}

/** 平台 feed 用：slug → 平台。mobile 平台不提供（P35，與平台頁相同）→ null。 */
export async function findIcalPlatformBySlug(slug: string, opts: ReadOptions = {}): Promise<IcalPlatformRef | null> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<IcalPlatformRef & Record<string, unknown>>(sql`
        SELECT p.id, p.slug, p.name FROM platforms p WHERE p.slug = ${slug} AND p.kind <> 'mobile' LIMIT 1
      `),
    opts,
  );
  return res.rows[0] ?? null;
}
