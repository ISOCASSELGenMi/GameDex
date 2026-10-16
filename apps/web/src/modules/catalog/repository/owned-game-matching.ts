import { sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { Candidate } from "../domain/entities";

/**
 * 給「外部遊戲庫（Steam 等）比對」用的唯讀查詢（Phase 7 第 3 波；accounts 經 catalog/index.ts 取用，不碰 catalog 的表）。
 * 不寫入任何東西。
 */

/** 候選上限：findBestMatch 只需要少數最像的幾筆。 */
export const TITLE_CANDIDATE_LIMIT = 20;

/**
 * 依 (source, externalIds[]) 批次查我方 gameId（例如 source='steam'、Steam AppID）。
 * 同一個外部 ID 對到多款遊戲時（版本／合輯）取：needs_review=false 優先、信心高優先、gameId 小優先。
 * 回傳 Map<externalId, gameId>；沒對到的不在 Map 裡。
 */
export async function findGameIdsByExternalIds(
  source: string,
  externalIds: readonly string[],
  db: DbOrTx = getDb(),
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(externalIds)];
  if (ids.length === 0) return out;
  const result = await db.execute<{ external_id: string; game_id: number }>(sql`
    SELECT DISTINCT ON (external_id) external_id, game_id
    FROM external_ids
    WHERE source = ${source} AND external_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
    ORDER BY external_id, needs_review ASC, confidence_pct DESC NULLS LAST, game_id ASC`);
  for (const r of result.rows) out.set(r.external_id, Number(r.game_id));
  return out;
}

/**
 * 依搜尋字串（已經 tokenizeForSearch）取比對候選（games.search_text 的 trigram）。
 * Candidate.externalId＝遊戲 id 字串、name＝games.name、releaseYear＝first_release_date 的年份。
 */
export async function findCandidatesBySearchTokens(
  tokens: string,
  limit: number = TITLE_CANDIDATE_LIMIT,
  db: DbOrTx = getDb(),
): Promise<Candidate[]> {
  const result = await db.execute<{ id: number; name: string; year: number | null }>(sql`
    SELECT g.id, g.name, EXTRACT(YEAR FROM g.first_release_date)::int AS year
    FROM games g
    WHERE ${tokens} <% g.search_text
    ORDER BY word_similarity(${tokens}, g.search_text) DESC, g.popularity_score DESC, g.id ASC
    LIMIT ${Math.max(1, Math.min(limit, 100))}`);
  return result.rows.map((r) => ({ externalId: String(r.id), name: r.name, releaseYear: r.year === null ? null : Number(r.year) }));
}

export interface GameBrief {
  id: number;
  slug: string;
  name: string;
}

/** 依 id 批次取遊戲的 slug 與名稱（帳號頁顯示已比對的遊戲連結）。 */
export async function getGameBriefsByIds(ids: readonly number[], db: DbOrTx = getDb()): Promise<Map<number, GameBrief>> {
  const out = new Map<number, GameBrief>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const result = await db.execute<{ id: number; slug: string; name: string }>(sql`
    SELECT id, slug, name FROM games WHERE id IN (${sql.join(unique.map((i) => sql`${i}`), sql`, `)})`);
  for (const r of result.rows) out.set(Number(r.id), { id: Number(r.id), slug: r.slug, name: r.name });
  return out;
}
