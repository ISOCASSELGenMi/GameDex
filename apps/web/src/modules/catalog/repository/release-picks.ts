/**
 * release_picks（預先計算的代表上市列）的維護。挑選 SQL 在 release-aggregate.ts（buildReleasePicksQuery，與聚合共用 keys／picked CTE）；
 * 這裡只負責「刪掉這些遊戲的舊列、整批重算插入」。所有改動 release_events 的寫入路徑（applyReleaseDiffPlan、upsertReleaseEvent）
 * 在同一個 transaction 內呼叫；全庫回填見 use-cases/sync/backfill-game-groups.ts。
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import { pgArray } from "./read-tx";
import { buildReleasePicksQuery } from "./release-aggregate";

/** 重算這些遊戲的 release_picks。@returns 寫入的列數 */
export async function refreshReleasePicks(db: DbOrTx, gameIds: readonly number[]): Promise<number> {
  if (gameIds.length === 0) return 0;
  await db.execute(sql`DELETE FROM release_picks WHERE game_id = ANY(${pgArray(gameIds)}::int[])`);
  const res = await db.execute(sql`
    INSERT INTO release_picks (game_id, platform_id, release_stage, release_event_id, release_date, precision)
    ${buildReleasePicksQuery(gameIds)}
  `);
  return res.rowCount ?? 0;
}
