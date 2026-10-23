import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import {
  planManualSupersedes,
  type ExistingReleaseRow,
  type IgdbDateUpdate,
  type ReleaseDiffPlan,
} from "../domain/release-diff";
import type {
  IsoDate,
  ReleaseEvent,
  ReleaseEventInput,
  ReleaseEventKey,
  ReleaseEventUpsertResult,
} from "../domain/entities";
import { releaseDateHistory, releaseEvents } from "../schema";
import { appendChange, appendChanges } from "./change-feed";
import { refreshReleasePicks } from "./release-picks";

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
 * 注意：這是原始查詢，不套聚合規則，不要拿來做顯示。月曆、時間軸、Discord、iCal 一律用
 * repository/release-aggregate.ts 的 aggregateReleases（聚合規則唯一實作，06；use case：getCalendarMonth／listReleaseCards）。
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
 * 同步只 upsert source='igdb' 的列；manual 列由人工更正流程寫入，唯一例外是 applyReleaseDiffPlan 在 IGDB 日期更新時把同鍵 manual 標 removed。
 */
export async function upsertReleaseEvent(
  input: ReleaseEventInput,
  db: DbOrTx = getDb(),
): Promise<ReleaseEventUpsertResult> {
  const source = input.source ?? "igdb";
  return db.transaction(async (tx) => {
    const existing = await findReleaseEventByKey(input, source, tx);

    if (!existing) {
      const { minSequence, ...values } = input;
      const [created] = await tx
        .insert(releaseEvents)
        .values({ ...values, source, ...(minSequence !== undefined ? { sequence: minSequence } : {}) })
        .returning();
      await appendChange(tx, {
        entityType: "release_event",
        entityId: created.id,
        changeType: "created",
        payload: { releaseDate: created.releaseDate, precision: created.precision, status: created.status },
      });
      await refreshReleasePicks(tx, [created.gameId]);
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
        sequence:
          dateChanged || statusChanged
            ? Math.max(existing.sequence + 1, input.minSequence ?? 0)
            : existing.sequence,
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
    await refreshReleasePicks(tx, [updated.gameId]);
    return { kind: "updated", event: updated, dateChanged, statusChanged };
  });
}

// ── IGDB diff 同步（04 §上市日 diff 同步）────────────────────────────────

/** 這款遊戲 source='igdb' 的全部列（含 removed），diff 的「既有」輸入。人工列不在內。 */
export async function listIgdbReleaseRows(gameId: number, db: DbOrTx = getDb()): Promise<ExistingReleaseRow[]> {
  return db
    .select({
      id: releaseEvents.id,
      platformId: releaseEvents.platformId,
      regionId: releaseEvents.regionId,
      releaseStage: releaseEvents.releaseStage,
      releaseDate: releaseEvents.releaseDate,
      periodStart: releaseEvents.periodStart,
      precision: releaseEvents.precision,
      status: releaseEvents.status,
      sourceStatus: releaseEvents.sourceStatus,
      sequence: releaseEvents.sequence,
    })
    .from(releaseEvents)
    .where(and(eq(releaseEvents.gameId, gameId), eq(releaseEvents.source, "igdb")))
    .orderBy(asc(releaseEvents.id));
}

export interface ReleaseDiffApplyStats {
  created: number;
  updated: number;
  removed: number;
  restored: number;
}

/**
 * 寫入 planReleaseEventDiff 的結果。必須在呼叫端的 transaction 內（change_feed 同交易）。
 * - 日期或精度變動 → release_date_history＋change_feed date_changed
 * - 日期或 status 變動 → sequence + 1（removed／restored 不算，status 沒變）
 * - igdb 列新建、或日期／精度變動，且同鍵有 active 的 manual 列 → 同交易內 manual 標 removed、igdb sequence 提高到 manual + 1
 *   （IGDB 日期更新覆蓋人工更正；2026-10-15 使用者決定）。只有 status 變動、或 igdb 被標 removed 不覆蓋。
 */
export async function applyReleaseDiffPlan(
  tx: DbOrTx,
  gameId: number,
  plan: ReleaseDiffPlan,
  sourceUpdatedAt: Date | null,
): Promise<ReleaseDiffApplyStats> {
  const stats: ReleaseDiffApplyStats = { created: 0, updated: 0, removed: 0, restored: 0 };
  const changes: Parameters<typeof appendChanges>[1][number][] = [];
  const dateUpdates: IgdbDateUpdate[] = [];

  if (plan.creates.length > 0) {
    const created = await tx
      .insert(releaseEvents)
      .values(plan.creates.map((c) => ({ ...c, gameId, source: "igdb", sourceUpdatedAt })))
      .returning({
        id: releaseEvents.id,
        platformId: releaseEvents.platformId,
        releaseStage: releaseEvents.releaseStage,
        regionId: releaseEvents.regionId,
        sequence: releaseEvents.sequence,
        releaseDate: releaseEvents.releaseDate,
        precision: releaseEvents.precision,
        status: releaseEvents.status,
      });
    stats.created = created.length;
    for (const c of created) {
      dateUpdates.push({ igdbEventId: c.id, platformId: c.platformId, regionId: c.regionId, releaseStage: c.releaseStage, sequence: c.sequence });
      changes.push({
        entityType: "release_event",
        entityId: c.id,
        changeType: "created",
        payload: { releaseDate: c.releaseDate, precision: c.precision, status: c.status },
      });
    }
  }

  const history: Array<typeof releaseDateHistory.$inferInsert> = [];
  for (const u of plan.updates) {
    const { before: b, after: a } = u;
    const nextSequence = u.dateChanged || u.statusChanged ? b.sequence + 1 : b.sequence;
    await tx
      .update(releaseEvents)
      .set({
        releaseStage: a.releaseStage,
        releaseDate: a.releaseDate,
        periodStart: a.periodStart,
        precision: a.precision,
        status: a.status,
        sourceStatus: a.sourceStatus,
        sequence: nextSequence,
        ...(a.sourceStatus === "active" ? { sourceUpdatedAt } : {}),
      })
      .where(eq(releaseEvents.id, b.id));

    if (u.dateChanged && a.sourceStatus === "active") {
      dateUpdates.push({ igdbEventId: b.id, platformId: a.platformId, regionId: a.regionId, releaseStage: a.releaseStage, sequence: nextSequence });
    }
    if (u.dateChanged) {
      history.push({
        releaseEventId: b.id,
        oldDate: b.releaseDate,
        oldPrecision: b.precision,
        newDate: a.releaseDate,
        newPrecision: a.precision,
      });
      changes.push({
        entityType: "release_event",
        entityId: b.id,
        changeType: "date_changed",
        payload: {
          old: { releaseDate: b.releaseDate, precision: b.precision },
          new: { releaseDate: a.releaseDate, precision: a.precision },
        },
      });
    }
    if (u.statusChanged) {
      changes.push({
        entityType: "release_event",
        entityId: b.id,
        changeType: "status_changed",
        payload: { old: b.status, new: a.status },
      });
    }
    if (u.sourceStatusChanged) {
      const removed = a.sourceStatus === "removed";
      if (removed) stats.removed += 1;
      else stats.restored += 1;
      changes.push({ entityType: "release_event", entityId: b.id, changeType: removed ? "removed" : "restored" });
    }
    if (u.dateChanged || u.statusChanged || u.stageChanged) stats.updated += 1;
  }

  if (history.length > 0) await tx.insert(releaseDateHistory).values(history);
  await supersedeManualRows(tx, gameId, dateUpdates, changes);
  await appendChanges(tx, changes);
  // 預先計算的代表上市列（release_picks）與上市列在同一個 transaction 內更新
  if (plan.creates.length > 0 || plan.updates.length > 0) await refreshReleasePicks(tx, [gameId]);
  return stats;
}

/**
 * IGDB 日期更新覆蓋人工更正：同鍵 active 的 manual 列標 removed（沿用 sourceStatus enum），
 * 取代它的 igdb 列 sequence 提高到 manual + 1（聚合輸出的 sequence 不倒退）。change_feed 項目併入 changes 一起寫。
 * 之後管理員再核可同鍵回報，upsertReleaseEvent 會把 manual 列改回 active（restored）。
 */
async function supersedeManualRows(
  tx: DbOrTx,
  gameId: number,
  dateUpdates: readonly IgdbDateUpdate[],
  changes: Parameters<typeof appendChanges>[1][number][],
): Promise<void> {
  if (dateUpdates.length === 0) return;
  const manuals = await tx
    .select({
      id: releaseEvents.id,
      platformId: releaseEvents.platformId,
      regionId: releaseEvents.regionId,
      releaseStage: releaseEvents.releaseStage,
      sequence: releaseEvents.sequence,
    })
    .from(releaseEvents)
    .where(and(eq(releaseEvents.gameId, gameId), eq(releaseEvents.source, "manual"), eq(releaseEvents.sourceStatus, "active")));
  if (manuals.length === 0) return;
  const seqById = new Map(dateUpdates.map((u) => [u.igdbEventId, u.sequence]));
  for (const s of planManualSupersedes(dateUpdates, manuals)) {
    await tx.update(releaseEvents).set({ sourceStatus: "removed" }).where(eq(releaseEvents.id, s.manualId));
    changes.push({
      entityType: "release_event",
      entityId: s.manualId,
      changeType: "removed",
      payload: { reason: "superseded_by_igdb", igdbEventId: s.igdbEventId },
    });
    const current = seqById.get(s.igdbEventId) ?? 0;
    if (s.igdbMinSequence > current) {
      await tx.update(releaseEvents).set({ sequence: s.igdbMinSequence }).where(eq(releaseEvents.id, s.igdbEventId));
      seqById.set(s.igdbEventId, s.igdbMinSequence);
    }
  }
}

/**
 * 自動轉 released（04）：精度 day 且日期已過的 scheduled／delayed。
 * 不寫 history、不加 sequence（日期沒變）；change_feed 用同一個語句寫入（INSERT … SELECT）。
 * @param today UTC 日期（與 diff 判斷「已過」用同一個值）
 * @returns 轉換筆數
 */
export async function autoReleasePastEvents(today: IsoDate, db: DbOrTx = getDb()): Promise<number> {
  const res = await db.execute<{ id: number }>(sql`
    WITH due AS (
      SELECT id, status AS old_status FROM release_events
      WHERE status IN ('scheduled', 'delayed') AND precision = 'day' AND release_date <= ${today}
      FOR UPDATE
    ), released AS (
      UPDATE release_events r SET status = 'released', updated_at = now()
      FROM due WHERE r.id = due.id
      RETURNING r.id, due.old_status
    )
    INSERT INTO change_feed (entity_type, entity_id, change_type, payload)
    SELECT 'release_event', id, 'status_changed', jsonb_build_object('old', old_status, 'new', 'released')
    FROM released
    RETURNING entity_id AS id
  `);
  return res.rowCount ?? res.rows.length;
}
