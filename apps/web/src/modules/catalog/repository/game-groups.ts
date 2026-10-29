/**
 * games.release_group／games.publisher_group（預先計算的分組鍵）的計算與寫入。
 * 規則只有一份：日期組 key＝domain/game-group-keys.ts releaseGroupKey；廠商欄＝domain/publisher-groups.ts publisherGroupIndexOfGame。
 * syncIgdbGame（單款，同 transaction）與 backfill_game_groups（分批）都呼叫這裡。
 */
import { sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import { releaseGroupKey } from "../domain/game-group-keys";
import {
  OTHER_PUBLISHER_INDEX,
  publisherGroupIndexOfGame,
  publisherGroupSqlMap,
  type GameCompanyRef,
} from "../domain/publisher-groups";
import type { DatePrecision } from "../domain/entities";
import { pgArray } from "./read-tx";
import { refreshReleasePicks } from "./release-picks";

/** backfill_game_groups 的進度 key（sync_state.job_name）。 */
export const GAME_GROUPS_BACKFILL_STATE = "game_groups_backfill";

/**
 * backfill_game_groups 是否已全部完成。平台頁「全部遊戲」只在完成後才用 release_picks（回填前／回填到一半時 picks 不完整，會少遊戲），
 * 沒完成就退回即時聚合（慢但正確）。
 */
export async function isGameGroupsBackfillDone(db: DbOrTx): Promise<boolean> {
  const res = await db.execute<{ cursor: string | null }>(sql`SELECT cursor FROM sync_state WHERE job_name = ${GAME_GROUPS_BACKFILL_STATE}`);
  try {
    return (JSON.parse(res.rows[0]?.cursor ?? "null") as { done?: boolean } | null)?.done === true;
  } catch {
    return false;
  }
}

const LISTED_IGDB_COMPANY_IDS = publisherGroupSqlMap().igdbIds;

/** 這些遊戲的 publisher_group（名單內公司才查；沒有任何名單公司的遊戲＝OTHER_PUBLISHER_INDEX）。 */
export async function computePublisherGroups(db: DbOrTx, gameIds: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>(gameIds.map((id) => [id, OTHER_PUBLISHER_INDEX]));
  if (gameIds.length === 0) return out;
  const res = await db.execute<{ game_id: number; igdb_id: number; role: string; igdb_position: number | null }>(sql`
    SELECT gc.game_id, c.igdb_id, gc.role::text AS role, gc.igdb_position
    FROM game_companies gc JOIN companies c ON c.id = gc.company_id
    WHERE gc.game_id = ANY(${pgArray(gameIds)}::int[])
      AND gc.role IN ('developer', 'publisher')
      AND c.igdb_id = ANY(${pgArray(LISTED_IGDB_COMPANY_IDS)}::int[])
  `);
  const refs = new Map<number, GameCompanyRef[]>();
  for (const r of res.rows) {
    const list = refs.get(r.game_id) ?? [];
    list.push(r.igdb_position === null ? { igdbId: r.igdb_id, role: r.role } : { igdbId: r.igdb_id, role: r.role, order: r.igdb_position });
    refs.set(r.game_id, list);
  }
  for (const [id, list] of refs) out.set(id, publisherGroupIndexOfGame(list));
  return out;
}

export interface GameGroupColumns {
  gameId: number;
  releaseGroup: string;
  publisherGroup: number;
}

/** 重算這些遊戲的兩個分組鍵（從資料庫現有的日期與公司關聯）。 */
export async function computeGameGroupColumns(db: DbOrTx, gameIds: readonly number[]): Promise<GameGroupColumns[]> {
  if (gameIds.length === 0) return [];
  const dates = await db.execute<{ id: number; first_release_date: string | null; first_release_precision: DatePrecision | null }>(sql`
    SELECT id, first_release_date::text AS first_release_date, first_release_precision
    FROM games WHERE id = ANY(${pgArray(gameIds)}::int[])
  `);
  const publishers = await computePublisherGroups(db, dates.rows.map((r) => r.id));
  return dates.rows.map((r) => ({
    gameId: r.id,
    releaseGroup: releaseGroupKey(r.first_release_date, r.first_release_precision),
    publisherGroup: publisherGroups(publishers, r.id),
  }));
}

function publisherGroups(m: ReadonlyMap<number, number>, id: number): number {
  return m.get(id) ?? OTHER_PUBLISHER_INDEX;
}

/** 寫入（只動值有變的列）。@returns 實際改變的列數 */
export async function writeGameGroupColumns(db: DbOrTx, rows: readonly GameGroupColumns[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await db.execute(sql`
    UPDATE games g SET release_group = v.rg, publisher_group = v.pg
    FROM unnest(${pgArray(rows.map((r) => r.gameId))}::int[], ${pgArray(rows.map((r) => r.releaseGroup))}::text[], ${pgArray(rows.map((r) => r.publisherGroup))}::int[]) AS v(id, rg, pg)
    WHERE g.id = v.id AND (g.release_group IS DISTINCT FROM v.rg OR g.publisher_group IS DISTINCT FROM v.pg::smallint)
  `);
  return res.rowCount ?? 0;
}

export interface CompanyPositionEntry {
  igdbGameId: number;
  igdbCompanyId: number;
  position: number;
}

/**
 * backfill_company_positions 的一批：把 IGDB 的公司順序寫進既有的 game_companies.igdb_position（只動值有變的列），
 * 再重算這些遊戲的 publisher_group。一個 transaction；冪等。不寫 change_feed（衍生欄位，與 backfill_game_groups 相同）。
 * @param igdbGameIds 本批涵蓋的遊戲（IGDB id）；entries 沒出現的公司列不動（維持 NULL）。
 */
export async function applyCompanyPositionsBatch(
  entries: readonly CompanyPositionEntry[],
  igdbGameIds: readonly number[],
  db: DbOrTx = getDb(),
): Promise<{ positionsUpdated: number; groupsUpdated: number }> {
  return db.transaction(async (tx) => {
    let positionsUpdated = 0;
    if (entries.length > 0) {
      const res = await tx.execute(sql`
        UPDATE game_companies gc SET igdb_position = v.pos
        FROM unnest(${pgArray(entries.map((e) => e.igdbGameId))}::int[], ${pgArray(entries.map((e) => e.igdbCompanyId))}::int[], ${pgArray(entries.map((e) => e.position))}::int[]) AS v(gid, cid, pos)
        JOIN games g ON g.igdb_id = v.gid
        JOIN companies c ON c.igdb_id = v.cid
        WHERE gc.game_id = g.id AND gc.company_id = c.id AND gc.igdb_position IS DISTINCT FROM v.pos::smallint
      `);
      positionsUpdated = res.rowCount ?? 0;
    }
    const idRows = igdbGameIds.length === 0 ? [] : (await tx.execute<{ id: number }>(sql`SELECT id FROM games WHERE igdb_id = ANY(${pgArray(igdbGameIds)}::int[])`)).rows;
    const groupsUpdated = await writeGameGroupColumns(tx, await computeGameGroupColumns(tx, idRows.map((r) => r.id)));
    return { positionsUpdated, groupsUpdated };
  });
}

/** 依 id 升冪的下一批遊戲 id（回填的游標分頁）。 */
export async function listGameIdsAfter(db: DbOrTx, afterId: number, limit: number): Promise<number[]> {
  const res = await db.execute<{ id: number }>(sql`SELECT id FROM games WHERE id > ${afterId} ORDER BY id LIMIT ${limit}`);
  return res.rows.map((r) => r.id);
}

export interface GameGroupsBatchResult {
  scanned: number;
  /** 分組鍵實際改變的遊戲數。 */
  updated: number;
  /** 重算後的 release_picks 列數。 */
  picks: number;
  /** 本批最後一款的 id；沒有資料＝null（掃描結束）。 */
  lastId: number | null;
}

/**
 * backfill_game_groups 的一批：重算 id > afterId 的 limit 款遊戲的 release_group／publisher_group 與 release_picks。
 * 一個 transaction；冪等（重做同一批結果相同），所以中斷後從游標續傳即可。
 */
export async function backfillGameGroupsBatch(afterId: number, limit: number, db: DbOrTx = getDb()): Promise<GameGroupsBatchResult> {
  return db.transaction(async (tx) => {
    const ids = await listGameIdsAfter(tx, afterId, limit);
    if (ids.length === 0) return { scanned: 0, updated: 0, picks: 0, lastId: null };
    const columns = await computeGameGroupColumns(tx, ids);
    const updated = await writeGameGroupColumns(tx, columns);
    const picks = await refreshReleasePicks(tx, ids);
    return { scanned: ids.length, updated, picks, lastId: ids[ids.length - 1]! };
  });
}

/** 回填完成後更新統計與可見性資訊（讓規劃器與 index-only scan 立刻可用）；不能在 transaction 內執行。 */
export async function vacuumAnalyzeBrowseTables(db: DbOrTx = getDb()): Promise<void> {
  await db.execute(sql`VACUUM (ANALYZE) games`);
  await db.execute(sql`VACUUM (ANALYZE) release_picks`);
}
