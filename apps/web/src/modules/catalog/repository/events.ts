/**
 * 活動同步的持久化（04 §活動同步）：以 igdb_event_id 為自然鍵 upsert。
 * - source='manual' 的活動不覆蓋、不刪除。
 * - kind／seriesId／url／organizer 由人工標註，同步不碰。
 * - 參與遊戲只存原始 id（game_igdb_ids），由 resolve_relations 解析成 event_games。
 * - slug 撞到別的活動 → 加 `-{igdbId}`（與遊戲同慣例）。
 * - change_feed：新活動 `created`、開始時間改變 `date_changed`，與變更同一個 transaction。
 */
import { eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { EventRecord } from "../domain/entities";
import { events } from "../schema";
import { appendChange } from "./change-feed";

export interface IgdbEventSyncResult {
  eventId: number | null;
  inserted: boolean;
  /** 同 igdbId 的列已轉為人工維護，略過。 */
  skippedManual: boolean;
  startTimeChanged: boolean;
}

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

export async function syncIgdbEvent(record: EventRecord, db: DbOrTx = getDb()): Promise<IgdbEventSyncResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: events.id, source: events.source, startTime: events.startTime })
      .from(events)
      .where(eq(events.igdbEventId, record.igdbId))
      .for("update")
      .limit(1);
    if (existing?.source === "manual") {
      return { eventId: existing.id, inserted: false, skippedManual: true, startTimeChanged: false };
    }

    const [taken] = await tx.select({ id: events.id }).from(events).where(eq(events.slug, record.slug)).limit(1);
    const slug = taken && taken.id !== existing?.id ? `${record.slug}-${record.igdbId}` : record.slug;
    const values = {
      name: record.name,
      slug,
      description: record.description,
      startTime: record.startTime,
      endTime: record.endTime,
      timezone: record.timeZone,
      logoUrl: record.logoUrl,
      streamUrl: record.streamUrl,
      gameIgdbIds: record.gameIgdbIds,
    };
    const [row] = await tx
      .insert(events)
      .values({ ...values, igdbEventId: record.igdbId, source: "igdb" })
      .onConflictDoUpdate({
        target: events.igdbEventId,
        set: { ...values, updatedAt: new Date() },
        setWhere: sql`${events.source} <> 'manual'`,
      })
      .returning({ id: events.id });

    const iso = (d: Date | null) => d?.toISOString() ?? null;
    if (!existing) {
      await appendChange(tx, {
        entityType: "event",
        entityId: row.id,
        changeType: "created",
        payload: { startTime: iso(record.startTime), endTime: iso(record.endTime) },
      });
      return { eventId: row.id, inserted: true, skippedManual: false, startTimeChanged: false };
    }
    const startTimeChanged = !sameTime(existing.startTime, record.startTime);
    if (startTimeChanged) {
      await appendChange(tx, {
        entityType: "event",
        entityId: row.id,
        changeType: "date_changed",
        payload: { old: { startTime: iso(existing.startTime) }, new: { startTime: iso(record.startTime) } },
      });
    }
    return { eventId: row.id, inserted: false, skippedManual: false, startTimeChanged };
  });
}
