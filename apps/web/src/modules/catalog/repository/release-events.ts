import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type {
  ReleaseEvent,
  ReleaseEventInput,
  ReleaseEventKey,
  ReleaseEventUpsertResult,
} from "../domain/entities";
import { releaseDateHistory, releaseEvents } from "../schema";
import { appendChange } from "./change-feed";

function monthRange(year: number, month: number): { first: string; last: string } {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`無效的年月：${year}-${month}`);
  }
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { first: `${year}-${mm}-01`, last: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * 代表日期落在該月的上市事件（只取來源仍存在的列）。
 * 注意：這是原始查詢；月曆的聚合規則（一款多平台只出現一次、季／年精度的顯示）
 * 唯一實作在 repository/release-aggregate.ts（Phase 3a，見 06）。
 */
export async function getReleaseEventsByMonth(
  year: number,
  month: number,
  db: DbOrTx = getDb(),
): Promise<ReleaseEvent[]> {
  const { first, last } = monthRange(year, month);
  return db
    .select()
    .from(releaseEvents)
    .where(
      and(
        gte(releaseEvents.releaseDate, first),
        lte(releaseEvents.releaseDate, last),
        eq(releaseEvents.sourceStatus, "active"),
      ),
    )
    .orderBy(asc(releaseEvents.releaseDate), asc(releaseEvents.id));
}

export async function findReleaseEventByKey(
  key: ReleaseEventKey,
  source: string,
  db: DbOrTx = getDb(),
): Promise<ReleaseEvent | null> {
  const rows = await db
    .select()
    .from(releaseEvents)
    .where(
      and(
        eq(releaseEvents.gameId, key.gameId),
        eq(releaseEvents.platformId, key.platformId),
        eq(releaseEvents.regionId, key.regionId),
        eq(releaseEvents.releaseStage, key.releaseStage),
        eq(releaseEvents.source, source),
      ),
    )
    .orderBy(asc(releaseEvents.id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 依 (game, platform, region, stage, source) upsert 一筆上市事件。
 * - 日期或精度變動 → 寫 release_date_history、sequence +1、change_feed `date_changed`
 * - status 變動 → sequence +1、change_feed `status_changed`
 * - 全部在同一個 transaction（03 §change_feed 規則）。
 * 狀態機（何時轉 delayed／released）由 Use Case 決定（04），這裡只負責持久化。
 * 同步只動 source='igdb' 的列；manual 列由人工更正流程處理。
 */
export async function upsertReleaseEvent(
  input: ReleaseEventInput,
  db: DbOrTx = getDb(),
): Promise<ReleaseEventUpsertResult> {
  const source = input.source ?? "igdb";
  return db.transaction(async (tx) => {
    const existing = await findReleaseEventByKey(input, source, tx);

    if (!existing) {
      const [created] = await tx
        .insert(releaseEvents)
        .values({ ...input, source })
        .returning();
      await appendChange(tx, {
        entityType: "release_event",
        entityId: created.id,
        changeType: "created",
        payload: { releaseDate: created.releaseDate, precision: created.precision, status: created.status },
      });
      return { kind: "created", event: created };
    }

    const dateChanged = existing.releaseDate !== input.releaseDate || existing.precision !== input.precision;
    const statusChanged = existing.status !== input.status;
    const sourceStatus = input.sourceStatus ?? existing.sourceStatus;
    const otherChanged =
      existing.periodStart !== input.periodStart ||
      existing.sourceStatus !== sourceStatus ||
      (input.sourceUpdatedAt !== undefined &&
        existing.sourceUpdatedAt?.getTime() !== input.sourceUpdatedAt?.getTime());

    if (!dateChanged && !statusChanged && !otherChanged) {
      return { kind: "unchanged", event: existing };
    }

    const [updated] = await tx
      .update(releaseEvents)
      .set({
        releaseDate: input.releaseDate,
        periodStart: input.periodStart,
        precision: input.precision,
        status: input.status,
        sourceStatus,
        ...(input.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: input.sourceUpdatedAt } : {}),
        sequence: dateChanged || statusChanged ? existing.sequence + 1 : existing.sequence,
      })
      .where(eq(releaseEvents.id, existing.id))
      .returning();

    if (dateChanged) {
      await tx.insert(releaseDateHistory).values({
        releaseEventId: existing.id,
        oldDate: existing.releaseDate,
        oldPrecision: existing.precision,
        newDate: input.releaseDate,
        newPrecision: input.precision,
      });
      await appendChange(tx, {
        entityType: "release_event",
        entityId: existing.id,
        changeType: "date_changed",
        payload: {
          old: { releaseDate: existing.releaseDate, precision: existing.precision },
          new: { releaseDate: input.releaseDate, precision: input.precision },
        },
      });
    }
    if (statusChanged) {
      await appendChange(tx, {
        entityType: "release_event",
        entityId: existing.id,
        changeType: "status_changed",
        payload: { old: existing.status, new: input.status },
      });
    }
    if (existing.sourceStatus !== sourceStatus) {
      await appendChange(tx, {
        entityType: "release_event",
        entityId: existing.id,
        changeType: sourceStatus === "removed" ? "removed" : "restored",
      });
    }
    return { kind: "updated", event: updated, dateChanged, statusChanged };
  });
}
