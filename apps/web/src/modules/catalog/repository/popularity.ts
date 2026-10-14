/**
 * 熱度（03 §熱度）：寫 game_popularity_signals，並以 PERCENT_RANK() 在群內算 popularityScore／heatLevel。
 * 全部在 SQL 端做（30 萬款一次 UPDATE … FROM），權重、門檻、分群天數來自 domain/heat.ts（原則五）。
 *
 * 分群（03 §熱度 步驟 2）：upcoming＝games.first_release_date 為 NULL 或 ≥ 今天（UTC）− 30 天；released＝其餘。
 * 熱門榜（repository/trending.ts）用同一個 popularityGroupCondition。
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import {
  CATALOG_SIGNAL_NAMES,
  SITE_FOLLOWS_SIGNAL,
  type IsoDate,
  type PopularityGroup,
} from "../domain/entities";
import { HEAT_LEVEL_THRESHOLDS, POPULARITY_SCORE_MAX, upcomingCutoff, type HeatWeights } from "../domain/heat";
import { pgArray } from "./read-tx";

const rowCount = (res: { rowCount?: number | null; rows: unknown[] }) => res.rowCount ?? res.rows.length;

/** 一次 unnest 寫入的筆數（參數是兩個 int[]，不受 65535 個參數限制；分批只為控制單一語句大小）。 */
const UNNEST_CHUNK = 20_000;

/** 分群條件（alias＝games 的別名）。`todayUtc` 為 `YYYY-MM-DD`。 */
export function popularityGroupCondition(alias: string, group: PopularityGroup, todayUtc: IsoDate): SQL {
  const g = sql.raw(alias);
  const cutoff = upcomingCutoff(todayUtc);
  return group === "upcoming"
    ? sql`(${g}.first_release_date IS NULL OR ${g}.first_release_date >= ${cutoff}::date)`
    : sql`(${g}.first_release_date < ${cutoff}::date)`;
}

export interface SignalWriteStats {
  /** 對應到我方遊戲的筆數。 */
  matched: number;
  /** 新增或值有變的列。 */
  upserted: number;
  /** 不在新資料內而刪除的列。 */
  deleted: number;
}

async function loadTemp(tx: DbOrTx, keys: number[], values: number[]): Promise<void> {
  // 呼叫端傳入 transaction 時這裡是 savepoint，ON COMMIT DROP 還沒發生，先清掉同名暫存表
  await tx.execute(sql`DROP TABLE IF EXISTS tmp_popularity_signal`);
  await tx.execute(sql`CREATE TEMP TABLE tmp_popularity_signal (k int PRIMARY KEY, v int NOT NULL) ON COMMIT DROP`);
  for (let i = 0; i < keys.length; i += UNNEST_CHUNK) {
    await tx.execute(sql`
      INSERT INTO tmp_popularity_signal (k, v)
      SELECT k, v FROM unnest(${pgArray(keys.slice(i, i + UNNEST_CHUNK))}::int[], ${pgArray(values.slice(i, i + UNNEST_CHUNK))}::int[]) AS x(k, v)
      ON CONFLICT (k) DO UPDATE SET v = GREATEST(tmp_popularity_signal.v, excluded.v)
    `);
  }
}

/**
 * 以整份新資料取代某個訊號（不在新資料內的列刪除）。`by`：鍵是 IGDB id 或我方 games.id。
 * 值 ≤ 0 的列不存（缺訊號視為 0，03 §熱度）。整個過程一個 transaction。
 */
async function replaceSignal(
  signalName: string,
  by: "igdb_id" | "game_id",
  entries: Iterable<readonly [number, number]>,
  db: DbOrTx,
): Promise<SignalWriteStats> {
  const keys: number[] = [];
  const values: number[] = [];
  for (const [k, v] of entries) {
    const n = Math.round(v);
    if (!Number.isInteger(k) || !Number.isFinite(n) || n <= 0) continue;
    keys.push(k);
    values.push(Math.min(n, 2_147_483_647));
  }
  const join = by === "igdb_id" ? sql`JOIN games g ON g.igdb_id = t.k` : sql`JOIN games g ON g.id = t.k`;
  return db.transaction(async (tx) => {
    await loadTemp(tx, keys, values);
    const matched = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tmp_popularity_signal t ${join}`);
    const up = await tx.execute(sql`
      INSERT INTO game_popularity_signals (game_id, signal_name, value, updated_at)
      SELECT g.id, ${signalName}, t.v, now() FROM tmp_popularity_signal t ${join}
      ON CONFLICT (game_id, signal_name) DO UPDATE SET value = excluded.value, updated_at = now()
      WHERE game_popularity_signals.value IS DISTINCT FROM excluded.value
    `);
    const del = await tx.execute(sql`
      DELETE FROM game_popularity_signals s
      WHERE s.signal_name = ${signalName}
        AND NOT EXISTS (SELECT 1 FROM tmp_popularity_signal t ${join} WHERE g.id = s.game_id)
    `);
    return { matched: matched.rows[0]?.n ?? 0, upserted: rowCount(up), deleted: rowCount(del) };
  });
}

/** igdb_hype：鍵為 IGDB 遊戲 id（我方沒有的遊戲略過），值為 domain/heat.ts combineHypeRecords 的結果。 */
export async function replaceIgdbHypeSignal(
  byIgdbId: ReadonlyMap<number, number>,
  db: DbOrTx = getDb(),
): Promise<SignalWriteStats> {
  return replaceSignal("igdb_hype", "igdb_id", byIgdbId.entries(), db);
}

/** 外部擴充點訊號（PopularitySignal）：鍵為我方 games.id。名稱不可與 catalog 自己的訊號相同。 */
export async function replaceExternalSignal(
  signalName: string,
  rows: ReadonlyArray<{ gameId: number; value: number }>,
  db: DbOrTx = getDb(),
): Promise<SignalWriteStats> {
  if ((CATALOG_SIGNAL_NAMES as readonly string[]).includes(signalName)) {
    throw new Error(`外部熱度訊號不可使用保留名稱：${signalName}`);
  }
  if (signalName.length === 0 || signalName.length > 32) throw new Error(`熱度訊號名稱長度須為 1~32：${signalName}`);
  return replaceSignal(signalName, "game_id", rows.map((r) => [r.gameId, r.value] as const), db);
}

/**
 * structural＝IGDB aggregated_rating_count（ratings 表 igdb／critic_aggregate 列的 review_count）
 * ＋平台數（game_platforms）＋地區數（release_events 中 active 列的不同地區）。只算這一群的遊戲；
 * 值為 0 的不存（並刪掉舊列）。
 */
export async function refreshStructuralSignal(
  input: { group: PopularityGroup; todayUtc: IsoDate },
  db: DbOrTx = getDb(),
): Promise<{ upserted: number; deleted: number }> {
  const inGroup = popularityGroupCondition("g", input.group, input.todayUtc);
  const res = await db.execute<{ upserted: number; deleted: number }>(sql`
    WITH v AS (
      SELECT g.id AS game_id,
        COALESCE(rc.c, 0) + COALESCE(pc.c, 0) + COALESCE(regc.c, 0) AS value
      FROM games g
      LEFT JOIN (
        SELECT game_id, MAX(review_count) AS c FROM ratings
        WHERE score_provider = 'igdb' AND score_type = 'critic_aggregate' AND review_count > 0
        GROUP BY game_id
      ) rc ON rc.game_id = g.id
      LEFT JOIN (SELECT game_id, count(*) AS c FROM game_platforms GROUP BY game_id) pc ON pc.game_id = g.id
      LEFT JOIN (
        SELECT game_id, count(DISTINCT region_id) AS c FROM release_events
        WHERE source_status = 'active' GROUP BY game_id
      ) regc ON regc.game_id = g.id
      WHERE ${inGroup}
    ),
    up AS (
      INSERT INTO game_popularity_signals (game_id, signal_name, value, updated_at)
      SELECT game_id, 'structural', LEAST(value, 2147483647)::int, now() FROM v WHERE value > 0
      ON CONFLICT (game_id, signal_name) DO UPDATE SET value = excluded.value, updated_at = now()
      WHERE game_popularity_signals.value IS DISTINCT FROM excluded.value
      RETURNING 1
    ),
    del AS (
      DELETE FROM game_popularity_signals s USING v
      WHERE s.game_id = v.game_id AND s.signal_name = 'structural' AND v.value <= 0
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM up)::int AS upserted, (SELECT count(*) FROM del)::int AS deleted
  `);
  return res.rows[0] ?? { upserted: 0, deleted: 0 };
}

export interface PopularityContext {
  /** 群內有任何一款有 igdb_hype（沒有 → 權重全給結構）。 */
  hasIgdbSignal: boolean;
  /** 全站 site_follows 總和（wSite 用；accounts 停用時為 0）。 */
  siteFollowsTotal: number;
}

export async function getPopularityContext(
  input: { group: PopularityGroup; todayUtc: IsoDate },
  db: DbOrTx = getDb(),
): Promise<PopularityContext> {
  const inGroup = popularityGroupCondition("g", input.group, input.todayUtc);
  const res = await db.execute<{ has_igdb: boolean; site_total: string | number | null }>(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM game_popularity_signals s JOIN games g ON g.id = s.game_id
        WHERE s.signal_name = 'igdb_hype' AND s.value > 0 AND ${inGroup}
      ) AS has_igdb,
      (SELECT COALESCE(SUM(value), 0) FROM game_popularity_signals WHERE signal_name = ${SITE_FOLLOWS_SIGNAL}) AS site_total
  `);
  const row = res.rows[0];
  return { hasIgdbSignal: !!row?.has_igdb, siteFollowsTotal: Number(row?.site_total ?? 0) };
}

export type RecomputeStats = {
  /** 群內遊戲數。 */
  games: number;
  /** 有任何訊號（heatLevel ≥ 1）的遊戲數。 */
  withSignal: number;
  /** 實際改變分數或等級的遊戲數。 */
  updated: number;
};

/**
 * 03 §熱度 步驟 2~4，一個 UPDATE … FROM：
 * - 各訊號在群內取 PERCENT_RANK()（缺訊號＝0，所以沒有訊號的遊戲排在最低）。
 * - popularityScore = round(1000 × (wSite·pSite + wIgdb·pIgdb + wStruct·pStruct))。
 * - heatLevel：「有訊號的遊戲」之間依分數由高到低取 PERCENT_RANK，套門檻；完全無訊號 → 0。
 * 只更新值有變的列（避免 30 萬列全部改寫）。
 */
export async function recomputePopularity(
  input: { group: PopularityGroup; todayUtc: IsoDate; weights: HeatWeights },
  db: DbOrTx = getDb(),
): Promise<RecomputeStats> {
  const inGroup = popularityGroupCondition("g", input.group, input.todayUtc);
  const w = input.weights;
  const levelCase = sql.join(
    HEAT_LEVEL_THRESHOLDS.map((t) => sql`WHEN r.top_frac < ${t.topFraction}::float8 THEN ${t.level}::int`),
    sql` `,
  );
  const res = await db.execute<RecomputeStats>(sql`
    WITH sig AS (
      SELECT g.id AS game_id,
        COALESCE(MAX(s.value) FILTER (WHERE s.signal_name = ${SITE_FOLLOWS_SIGNAL}), 0) AS v_site,
        COALESCE(MAX(s.value) FILTER (WHERE s.signal_name = 'igdb_hype'), 0) AS v_igdb,
        COALESCE(MAX(s.value) FILTER (WHERE s.signal_name = 'structural'), 0) AS v_struct,
        COALESCE(bool_or(s.value > 0), false) AS has_signal
      FROM games g
      LEFT JOIN game_popularity_signals s ON s.game_id = g.id
      WHERE ${inGroup}
      GROUP BY g.id
    ),
    pr AS (
      SELECT game_id, has_signal,
        PERCENT_RANK() OVER (ORDER BY v_site) AS p_site,
        PERCENT_RANK() OVER (ORDER BY v_igdb) AS p_igdb,
        PERCENT_RANK() OVER (ORDER BY v_struct) AS p_struct
      FROM sig
    ),
    scored AS (
      SELECT game_id, has_signal,
        LEAST(${POPULARITY_SCORE_MAX}::int, GREATEST(0, round((${POPULARITY_SCORE_MAX}::float8 * (
          ${w.site}::float8 * p_site + ${w.igdb}::float8 * p_igdb + ${w.struct}::float8 * p_struct
        ))::numeric)))::int AS score
      FROM pr
    ),
    ranked AS (
      SELECT game_id, has_signal, score,
        PERCENT_RANK() OVER (PARTITION BY has_signal ORDER BY score DESC) AS top_frac
      FROM scored
    ),
    final AS (
      SELECT r.game_id, r.has_signal,
        CASE WHEN r.has_signal THEN r.score ELSE 0 END AS score,
        CASE WHEN NOT r.has_signal THEN 0 ${levelCase} ELSE 1 END AS level
      FROM ranked r
    ),
    upd AS (
      UPDATE games g SET popularity_score = f.score, heat_level = f.level
      FROM final f
      WHERE g.id = f.game_id AND (g.popularity_score <> f.score OR g.heat_level <> f.level)
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM final)::int AS games,
      (SELECT count(*) FROM final WHERE has_signal)::int AS "withSignal",
      (SELECT count(*) FROM upd)::int AS updated
  `);
  return res.rows[0] ?? { games: 0, withSignal: 0, updated: 0 };
}
