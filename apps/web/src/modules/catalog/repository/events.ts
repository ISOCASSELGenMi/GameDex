/**
 * 活動同步的持久化（04 §活動同步）：以 igdb_event_id 為自然鍵 upsert。
 * - source='manual' 的活動不覆蓋、不刪除。
 * - kind：IGDB 沒有，由 Provider 依名稱推斷（EventRecord.kind）。新活動直接寫入；既有活動只在目前仍是 `other`
 *   時覆蓋（管理員改過的類型不被同步蓋掉）。類型變更不寫 change_feed（與名稱、logo 等其他欄位的更新一致，
 *   change_feed 只記 created／date_changed）。
 * - seriesId／url／organizer 由人工標註，同步不碰。
 * - 參與遊戲只存原始 id（game_igdb_ids），由 resolve_relations 解析成 event_games。
 * - slug 撞到別的活動 → 加 `-{igdbId}`（與遊戲同慣例）。
 * - change_feed：新活動 `created`、開始時間改變 `date_changed`，與變更同一個 transaction。
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import { EVENT_KINDS, type EventKind, type EventRecord } from "../domain/entities";
import { events } from "../schema";
import { appendChange } from "./change-feed";
import { pgArray } from "./read-tx";

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
      .values({ ...values, kind: record.kind, igdbEventId: record.igdbId, source: "igdb" })
      .onConflictDoUpdate({
        target: events.igdbEventId,
        set: {
          ...values,
          // 只覆蓋仍是 other 的類型（管理員標註過的保留）
          kind: sql`CASE WHEN "events"."kind" = 'other' THEN excluded."kind" ELSE "events"."kind" END`,
          updatedAt: new Date(),
        },
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

export interface ReclassifyEventKindsResult {
  /** 檢查的 IGDB 活動數（source='igdb'；未給 all 時只含目前是 other 的）。 */
  checked: number;
  /** 實際改變類型的筆數，依新類型分組。 */
  changed: Record<EventKind, number>;
}

/**
 * 依名稱重新推斷 IGDB 活動的類型（`npm run job -- sync_events --reclassify`）。人工活動（source='manual'）不動。
 * 預設只改目前是 `other` 的活動（與同步相同，不覆蓋管理員標註）；`all`＝所有 IGDB 活動都依規則重算（規則改版時用）。
 * 不寫 change_feed（理由同 syncIgdbEvent）。單一 transaction。
 * @param classify 名稱 → 類型（Provider 的推斷函式，由 Use Case 傳入；Repository 不 import Provider）。
 */
export async function reclassifyIgdbEventKinds(
  classify: (name: string) => EventKind,
  opts: { all?: boolean } = {},
  db: DbOrTx = getDb(),
): Promise<ReclassifyEventKindsResult> {
  return db.transaction(async (tx) => {
    const cond = opts.all ? eq(events.source, "igdb") : and(eq(events.source, "igdb"), eq(events.kind, "other"));
    const rows = await tx.select({ id: events.id, name: events.name, kind: events.kind }).from(events).where(cond).for("update");
    const changed = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0])) as Record<EventKind, number>;
    const byKind = new Map<EventKind, number[]>();
    for (const r of rows) {
      const k = classify(r.name);
      if (k === r.kind) continue;
      changed[k] += 1;
      byKind.set(k, [...(byKind.get(k) ?? []), r.id]);
    }
    for (const [kind, ids] of byKind) {
      await tx
        .update(events)
        .set({ kind, updatedAt: new Date() })
        .where(sql`${events.id} = ANY(${pgArray(ids)}::int[])`);
    }
    return { checked: rows.length, changed };
  });
}
