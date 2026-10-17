/**
 * 單一遊戲的站內追蹤熱度（06 §熱度顯示）：site_follows（人數）與「上升中」（site_follows_7d 在群內前 5%）。
 * 讀 game_popularity_signals（accounts 經 refresh_popularity 每小時寫入），不碰 accounts 的表。
 */
import { sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import { RISING_TOP_FRACTION } from "../domain/follow-display";
import { popularityGroupOf } from "../domain/heat";
import { SITE_FOLLOWS_7D_SIGNAL, SITE_FOLLOWS_SIGNAL, type IsoDate } from "../domain/entities";
import { popularityGroupCondition } from "./popularity";

export interface GameFollowHeat {
  /** site_follows（沒有訊號＝0）。 */
  followers: number;
  /** site_follows_7d（沒有訊號＝0）。 */
  followers7d: number;
  /** site_follows_7d > 0 且在同一群（upcoming／released）有訊號的遊戲之間排名前 5%。 */
  rising: boolean;
}

export async function getGameFollowHeat(
  input: { gameId: number; firstReleaseDate: IsoDate | null; todayUtc: IsoDate },
  db: DbOrTx = getDb(),
): Promise<GameFollowHeat> {
  const group = popularityGroupOf(input.firstReleaseDate, input.todayUtc);
  const inGroup = popularityGroupCondition("g", group, input.todayUtc);
  const res = await db.execute<{ followers: number | null; followers_7d: number | null; pr: number | null }>(sql`
    WITH ranked AS (
      SELECT s.game_id, s.value, PERCENT_RANK() OVER (ORDER BY s.value DESC) AS pr
      FROM game_popularity_signals s JOIN games g ON g.id = s.game_id
      WHERE s.signal_name = ${SITE_FOLLOWS_7D_SIGNAL} AND s.value > 0 AND ${inGroup}
    )
    SELECT
      (SELECT value FROM game_popularity_signals WHERE game_id = ${input.gameId} AND signal_name = ${SITE_FOLLOWS_SIGNAL}) AS followers,
      (SELECT value FROM game_popularity_signals WHERE game_id = ${input.gameId} AND signal_name = ${SITE_FOLLOWS_7D_SIGNAL}) AS followers_7d,
      (SELECT pr FROM ranked WHERE game_id = ${input.gameId}) AS pr
  `);
  const row = res.rows[0];
  const pr = row?.pr == null ? null : Number(row.pr);
  return {
    followers: Number(row?.followers ?? 0),
    followers7d: Number(row?.followers_7d ?? 0),
    rising: pr !== null && pr < RISING_TOP_FRACTION,
  };
}
