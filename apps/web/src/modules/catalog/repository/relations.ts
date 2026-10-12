/**
 * 相似遊戲、活動關聯的批次解析（03 §相似遊戲）：同步只存原始 id（games.similar_igdb_ids、events.game_igdb_ids），
 * 這裡以 SQL 對應成我方 id。對方還沒同步就先跳過，下次解析補上（全量回填下不會永久遺漏，D24）。
 * 清單改變時，不在清單內的舊配對一併刪除（2026-10-13 使用者決定）；人工活動（source='manual'）的關聯不刪。
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";

export interface RelationResolveStats {
  inserted: number;
  deleted: number;
}

/** 每日全量與回填每批的局部解析可能同時跑；同一把鎖讓它們排隊，避免互相刪插。 */
const RELATIONS_LOCK_SPACE = 0x50a6f;
const SIMILAR_LOCK = 1;
const EVENT_LOCK = 2;

const rowCount = (res: { rowCount?: number | null; rows: unknown[] }) => res.rowCount ?? res.rows.length;

/**
 * 解析 games.similar_igdb_ids → game_similar_games。
 * @param igdbIds 只解析這些遊戲「自己的」清單（回填每批用）；省略＝全量。
 *   局部解析不會補上「別的遊戲指向這批」的配對，那由全量解析負責。
 */
export async function resolveSimilarGames(
  opts: { igdbIds?: readonly number[] } = {},
  db: DbOrTx = getDb(),
): Promise<RelationResolveStats> {
  if (opts.igdbIds && opts.igdbIds.length === 0) return { inserted: 0, deleted: 0 };
  const scope: SQL = opts.igdbIds ? sql`AND g.igdb_id = ANY(${toIntArray(opts.igdbIds)})` : sql``;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${RELATIONS_LOCK_SPACE}::int, ${SIMILAR_LOCK}::int)`);
    const ins = await tx.execute(sql`
      INSERT INTO game_similar_games (game_id, similar_game_id)
      SELECT g.id, s.id FROM games g
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(g.similar_igdb_ids, '[]'::jsonb)) AS x(igdb_id)
      JOIN games s ON s.igdb_id = x.igdb_id::int
      WHERE s.id <> g.id ${scope}
      ON CONFLICT DO NOTHING
    `);
    const del = await tx.execute(sql`
      DELETE FROM game_similar_games gs
      USING games g, games s
      WHERE gs.game_id = g.id AND gs.similar_game_id = s.id ${scope}
        AND NOT (COALESCE(g.similar_igdb_ids, '[]'::jsonb) @> to_jsonb(s.igdb_id))
    `);
    return { inserted: rowCount(ins), deleted: rowCount(del) };
  });
}

/**
 * 解析 events.game_igdb_ids → event_games。
 * 刪除只針對 source='igdb' 的活動；人工活動的關聯可能是手動加的，不動。
 * @param eventIds 只解析這些活動（我方 id）；省略＝全量。
 */
export async function resolveEventGames(
  opts: { eventIds?: readonly number[] } = {},
  db: DbOrTx = getDb(),
): Promise<RelationResolveStats> {
  if (opts.eventIds && opts.eventIds.length === 0) return { inserted: 0, deleted: 0 };
  const scope: SQL = opts.eventIds ? sql`AND e.id = ANY(${toIntArray(opts.eventIds)})` : sql``;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${RELATIONS_LOCK_SPACE}::int, ${EVENT_LOCK}::int)`);
    const ins = await tx.execute(sql`
      INSERT INTO event_games (event_id, game_id)
      SELECT e.id, gm.id FROM events e
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.game_igdb_ids, '[]'::jsonb)) AS x(igdb_id)
      JOIN games gm ON gm.igdb_id = x.igdb_id::int
      WHERE true ${scope}
      ON CONFLICT DO NOTHING
    `);
    const del = await tx.execute(sql`
      DELETE FROM event_games eg
      USING events e, games gm
      WHERE eg.event_id = e.id AND eg.game_id = gm.id AND e.source = 'igdb' ${scope}
        AND NOT (COALESCE(e.game_igdb_ids, '[]'::jsonb) @> to_jsonb(gm.igdb_id))
    `);
    return { inserted: rowCount(ins), deleted: rowCount(del) };
  });
}

/** int[] 參數：數字已 trunc，以陣列字面值傳入（node-postgres 不會自動把 JS 陣列轉成 int[]）。 */
function toIntArray(ids: readonly number[]): SQL {
  return sql`${`{${ids.map((i) => Math.trunc(i)).join(",")}}`}::int[]`;
}
