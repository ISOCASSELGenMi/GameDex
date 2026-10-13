/**
 * 活動列表與詳情（06 §活動，Phase 3b）。
 * 列表條件 COALESCE(end_time, start_time) ≥ now（進行中的多日展會不會被藏起來）；start_time NULL＝時間未定，另列 undated。
 */
import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import type {
  EventDetail,
  EventKind,
  EventListItem,
  EventListScope,
  EventSeriesRef,
  EventTimeStatus,
  GameListItem,
  ImageResolver,
} from "../domain/entities";
import { EVENT_COLUMNS, toCalendarEvent, type EventRow } from "./calendar-events";
import { summaryColumns, toSummary, type SummaryRow } from "./game-detail";
import { withReadTimeout, type ReadOptions } from "./read-tx";

interface EventListRow extends EventRow {
  stream_url: string | null;
  time_status: EventTimeStatus;
  game_count: number;
}

const nowExpr = (now?: Date): SQL => (now ? sql`${now.toISOString()}::timestamptz` : sql`now()`);

const listColumns = (now: SQL) => sql`${EVENT_COLUMNS}, e.stream_url,
  CASE WHEN e.start_time IS NULL THEN 'undated'
       WHEN e.start_time > ${now} THEN 'upcoming'
       WHEN COALESCE(e.end_time, e.start_time) >= ${now} THEN 'ongoing'
       ELSE 'past' END AS time_status,
  (SELECT count(*) FROM event_games eg WHERE eg.event_id = e.id)::int AS game_count`;

function toListItem(r: EventListRow): EventListItem {
  return { ...toCalendarEvent(r), timeStatus: r.time_status, streamUrl: r.stream_url, gameCount: r.game_count };
}

export interface EventListQuery {
  scope: EventListScope;
  kind: EventKind | null;
  limit: number;
  offset: number;
  /** 測試用；預設資料庫 now()。 */
  now?: Date;
}

export async function listEventsPage(
  q: EventListQuery,
  opts: ReadOptions = {},
): Promise<{ items: EventListItem[]; hasMore: boolean }> {
  const now = nowExpr(q.now);
  const scopeCond =
    q.scope === "upcoming"
      ? sql`COALESCE(e.end_time, e.start_time) >= ${now}`
      : q.scope === "past"
        ? sql`COALESCE(e.end_time, e.start_time) < ${now}`
        : sql`e.start_time IS NULL`;
  const order =
    q.scope === "upcoming"
      ? sql`e.start_time ASC NULLS LAST, e.id ASC`
      : q.scope === "past"
        ? sql`e.start_time DESC NULLS LAST, e.id DESC`
        : sql`e.name ASC, e.id ASC`;
  const kindCond = q.kind ? sql`AND e.kind = ${q.kind}` : sql``;
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<EventListRow>(sql`
        SELECT ${listColumns(now)}
        FROM events e
        WHERE ${scopeCond} ${kindCond}
        ORDER BY ${order}
        LIMIT ${q.limit + 1} OFFSET ${q.offset}
      `),
    opts,
  );
  return { items: res.rows.slice(0, q.limit).map(toListItem), hasMore: res.rows.length > q.limit };
}

export interface EventDetailQuery {
  slug: string;
  locale: string;
  /** 相關遊戲上限，預設 100。 */
  gameLimit?: number;
  /** 同系列歷屆上限，預設 50。 */
  seriesLimit?: number;
  now?: Date;
  resolveImage: ImageResolver;
}

/** slug 不存在回 null。 */
export async function getEventDetailBySlug(q: EventDetailQuery, opts: ReadOptions = {}): Promise<EventDetail | null> {
  return withReadTimeout((tx) => readEventDetail(tx, q), opts);
}

async function readEventDetail(tx: DbOrTx, q: EventDetailQuery): Promise<EventDetail | null> {
  const now = nowExpr(q.now);
  const res = await tx.execute<
    EventListRow & {
      description: string | null;
      url: string | null;
      organizer: string | null;
      series_id: number | null;
      series_slug: string | null;
      series_name: string | null;
      series_kind: EventKind | null;
    }
  >(sql`
    SELECT ${listColumns(now)}, e.description, e.url, e.organizer, e.series_id,
      s.slug AS series_slug, s.name AS series_name, s.kind AS series_kind
    FROM events e LEFT JOIN event_series s ON s.id = e.series_id
    WHERE e.slug = ${q.slug} LIMIT 1
  `);
  const e = res.rows[0];
  if (!e) return null;

  const seriesRes =
    e.series_id == null
      ? { rows: [] as EventListRow[] }
      : await tx.execute<EventListRow>(sql`
          SELECT ${listColumns(now)} FROM events e
          WHERE e.series_id = ${e.series_id} AND e.id <> ${e.id}
          ORDER BY e.start_time DESC NULLS LAST, e.id DESC
          LIMIT ${q.seriesLimit ?? 50}
        `);

  const gamesRes = await tx.execute<SummaryRow & { game_status: string | null }>(sql`
    SELECT ${summaryColumns("g", q.locale)}, g.game_status
    FROM event_games eg JOIN games g ON g.id = eg.game_id
    WHERE eg.event_id = ${e.id}
    ORDER BY g.popularity_score DESC, g.name ASC, g.id ASC
    LIMIT ${q.gameLimit ?? 100}
  `);

  const series: EventSeriesRef | null =
    e.series_slug && e.series_name && e.series_kind ? { slug: e.series_slug, name: e.series_name, kind: e.series_kind } : null;
  const games: GameListItem[] = gamesRes.rows.map((r) => ({ ...toSummary(r, q.resolveImage), gameStatus: r.game_status }));
  return {
    ...toListItem(e),
    description: e.description,
    url: e.url,
    organizer: e.organizer,
    series,
    seriesEvents: seriesRes.rows.map(toListItem),
    games,
  };
}
