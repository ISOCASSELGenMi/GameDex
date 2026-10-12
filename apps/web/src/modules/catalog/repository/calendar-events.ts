import { sql } from "drizzle-orm";
import type { CalendarEventItem, EventKind } from "../domain/entities";
import { toIso, withReadTimeout, type ReadOptions } from "./read-tx";

export interface EventRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  kind: EventKind;
  start_time: Date | null;
  end_time: Date | null;
  timezone: string | null;
  logo_url: string | null;
}

export const EVENT_COLUMNS = sql`e.id, e.slug, e.name, e.kind, e.start_time, e.end_time, e.timezone, e.logo_url`;

export function toCalendarEvent(r: EventRow): CalendarEventItem {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    startTime: toIso(r.start_time),
    endTime: toIso(r.end_time),
    timezone: r.timezone,
    logoUrl: r.logo_url,
  };
}

/**
 * 與 [from, to) 有交集的活動：start_time < to 且 COALESCE(end_time, start_time) ≥ from。
 * start_time 為 NULL（時間未定）不列入月曆。依開始時間排序。
 */
export async function listEventsInRange(
  range: { from: Date; to: Date },
  opts: ReadOptions = {},
): Promise<CalendarEventItem[]> {
  const res = await withReadTimeout(
    (tx) =>
      tx.execute<EventRow>(sql`
        SELECT ${EVENT_COLUMNS}
        FROM events e
        WHERE e.start_time < ${range.to.toISOString()}::timestamptz
          AND COALESCE(e.end_time, e.start_time) >= ${range.from.toISOString()}::timestamptz
        ORDER BY e.start_time ASC, e.id ASC
      `),
    opts,
  );
  return res.rows.map(toCalendarEvent);
}
