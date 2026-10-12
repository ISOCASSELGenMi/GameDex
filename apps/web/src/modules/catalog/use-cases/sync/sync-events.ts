/**
 * sync_events（04 §活動同步，每 6 小時）：抓 updated_at > 上次的活動逐筆 upsert，再解析這些活動的 event_games。
 * 第一次執行（沒有 sync_state）抓全部（約千筆）。進度存 sync_state（jobName='igdb_events'），
 * 寫回任務開始時間；有任何一筆失敗就不推進。
 * 遊戲晚於活動同步進來時，關聯由每日的 resolve_relations 補上。
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";
import { syncIgdbEvent } from "../../repository/events";
import { resolveEventGames, type RelationResolveStats } from "../../repository/relations";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const IGDB_EVENTS_STATE = "igdb_events";

export interface SyncEventsResult {
  updatedSince: string | null;
  fetched: number;
  inserted: number;
  updated: number;
  skippedManual: number;
  startTimeChanged: number;
  failed: number;
  failedIgdbIds: number[];
  eventGames: RelationResolveStats;
}

export async function syncEvents(provider: GameDataProvider, ctx: { startedAt: Date; log: Log }): Promise<SyncEventsResult> {
  const since = (await getSyncState(IGDB_EVENTS_STATE))?.lastSyncedAt ?? undefined;
  if (!since) ctx.log("尚無活動同步紀錄，抓取全部活動");
  const records = await provider.fetchEvents({ updatedSince: since });

  const result: SyncEventsResult = {
    updatedSince: since?.toISOString() ?? null,
    fetched: records.length,
    inserted: 0,
    updated: 0,
    skippedManual: 0,
    startTimeChanged: 0,
    failed: 0,
    failedIgdbIds: [],
    eventGames: { inserted: 0, deleted: 0 },
  };
  const touched: number[] = [];
  for (const r of records) {
    try {
      const res = await syncIgdbEvent(r);
      if (res.skippedManual) {
        result.skippedManual += 1;
        continue;
      }
      if (res.inserted) result.inserted += 1;
      else result.updated += 1;
      if (res.startTimeChanged) result.startTimeChanged += 1;
      if (res.eventId !== null) touched.push(res.eventId);
    } catch (err) {
      result.failed += 1;
      result.failedIgdbIds.push(r.igdbId);
      ctx.log("活動寫入失敗", { igdbId: r.igdbId, name: r.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  result.eventGames = await resolveEventGames({ eventIds: touched });
  ctx.log("活動同步完成", { ...result });

  if (result.failed > 0) throw new Error(`sync_events：${result.failed} 筆活動寫入失敗（見 log），進度不推進`);
  await saveSyncProgress(IGDB_EVENTS_STATE, { lastSyncedAt: ctx.startedAt, meta: { ...result } });
  return result;
}
