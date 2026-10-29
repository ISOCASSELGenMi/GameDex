import { sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import { WHITELIST_GAME_TYPES } from "../domain/entities";
import { REFRESH_WINDOW_AFTER_DAYS, REFRESH_WINDOW_BEFORE_DAYS } from "../domain/rating-refresh";

/**
 * 需要獨立請求的外部評分來源（Metacritic）所用的查詢與寫入（05 §分層排程、§修復排程；12 §比對覆核）。
 * 來源模組（metacritic）經 catalog/index.ts 取用，不直接碰 catalog 的表。
 */

/** 上市期間最後一天的 SQL 運算式（games g）；tbd／無日期為 NULL。 */
const PERIOD_END = sql`(CASE g.first_release_precision
  WHEN 'month' THEN (date_trunc('month', g.first_release_date) + interval '1 month - 1 day')::date
  WHEN 'quarter' THEN (date_trunc('quarter', g.first_release_date) + interval '3 months - 1 day')::date
  WHEN 'year' THEN (date_trunc('year', g.first_release_date) + interval '1 year - 1 day')::date
  WHEN 'tbd' THEN NULL
  ELSE g.first_release_date END)`;

/** 上市窗口＋類型白名單（05：範圍限分層排程窗口，不對全庫跑）。 */
function inWindow(today: string) {
  const types = sql.join(WHITELIST_GAME_TYPES.map((t) => sql`${t}`), sql`, `);
  return sql`g.game_type IN (${types})
    AND ${PERIOD_END} IS NOT NULL
    AND ${PERIOD_END} <= (${today}::date + ${REFRESH_WINDOW_BEFORE_DAYS}::int)
    AND ${PERIOD_END} >= (${today}::date - ${REFRESH_WINDOW_AFTER_DAYS}::int)`;
}

export interface RepairCandidateGame {
  gameId: number;
  name: string;
  altNames: string[];
  year: number | null;
  releaseDate: string | null;
}

/** 窗口內、尚未有該來源外部 ID 的遊戲；最久沒試的優先（external_match_attempts.last_attempted_at NULLS FIRST），再依 id。 */
export async function selectRepairCandidates(source: string, today: string, limit: number, db: DbOrTx = getDb()): Promise<RepairCandidateGame[]> {
  const res = await db.execute<{ id: number; name: string; alt: { name: string }[] | null; year: number | null; rd: string | null }>(sql`
    SELECT g.id, g.name, g.alternative_names AS alt, EXTRACT(YEAR FROM g.first_release_date)::int AS year, g.first_release_date::text AS rd
    FROM games g
    LEFT JOIN external_match_attempts a ON a.game_id = g.id AND a.source = ${source}
    WHERE ${inWindow(today)}
      AND NOT EXISTS (SELECT 1 FROM external_ids e WHERE e.game_id = g.id AND e.source = ${source})
    ORDER BY a.last_attempted_at ASC NULLS FIRST, g.id ASC
    LIMIT ${Math.max(1, Math.min(limit, 1000))}`);
  return res.rows.map((r) => ({
    gameId: Number(r.id),
    name: r.name,
    altNames: (r.alt ?? []).map((a) => a.name).filter((n): n is string => typeof n === "string"),
    year: r.year === null ? null : Number(r.year),
    releaseDate: r.rd,
  }));
}

export interface RatingSyncTarget {
  gameId: number;
  externalId: string;
  releaseDate: string | null;
  precision: string | null;
}

/**
 * 窗口內、外部 ID 已確認（needs_review=false）、且該來源的分數列不存在或已到更新時間的遊戲。
 * 以 (遊戲, 來源) 為單位用 EXISTS（不用 DISTINCT）：IGDB 列（next_refresh_at 為 NULL）不會讓 Metacritic 永遠不被選到。
 */
export async function selectRatingSyncTargets(source: string, provider: string, today: string, limit: number, db: DbOrTx = getDb()): Promise<RatingSyncTarget[]> {
  const res = await db.execute<{ id: number; ext: string; rd: string | null; prec: string | null }>(sql`
    SELECT g.id, e.external_id AS ext, g.first_release_date::text AS rd, g.first_release_precision AS prec
    FROM external_ids e
    JOIN games g ON g.id = e.game_id
    WHERE e.source = ${source} AND e.needs_review = false
      AND ${inWindow(today)}
      AND ( NOT EXISTS (SELECT 1 FROM ratings r WHERE r.game_id = g.id AND r.score_provider = ${provider})
            OR EXISTS (SELECT 1 FROM ratings r WHERE r.game_id = g.id AND r.score_provider = ${provider} AND r.next_refresh_at < now()) )
    ORDER BY g.popularity_score DESC, g.id ASC
    LIMIT ${Math.max(1, Math.min(limit, 1000))}`);
  return res.rows.map((r) => ({ gameId: Number(r.id), externalId: r.ext, releaseDate: r.rd, precision: r.prec }));
}

export async function getRejectedExternalIds(gameId: number, source: string, db: DbOrTx = getDb()): Promise<Set<string>> {
  const res = await db.execute<{ external_id: string }>(sql`SELECT external_id FROM external_id_rejections WHERE game_id = ${gameId} AND source = ${source}`);
  return new Set(res.rows.map((r) => r.external_id));
}

export type MatchAttemptResult = "matched" | "low_confidence" | "no_candidate";

/** 不論成敗都記一次嘗試（修復排程推進的依據）。 */
export async function recordMatchAttempt(gameId: number, source: string, result: MatchAttemptResult, db: DbOrTx = getDb()): Promise<void> {
  await db.execute(sql`
    INSERT INTO external_match_attempts (game_id, source, last_attempted_at, attempts, last_result)
    VALUES (${gameId}, ${source}, now(), 1, ${result})
    ON CONFLICT (game_id, source) DO UPDATE
      SET last_attempted_at = now(), attempts = external_match_attempts.attempts + 1, last_result = EXCLUDED.last_result`);
}

export interface ExternalMatchInput {
  gameId: number;
  source: string;
  externalId: string;
  externalUrl: string | null;
  confidencePct: number;
  needsReview: boolean;
}

/**
 * 寫入自動比對結果。已存在 matchMethod='manual' 的列不覆寫（回傳 false）。
 * 同一 (source, externalId) 被兩款以上遊戲配到 → 一律進覆核（含先前已確認的那一筆也標回覆核，除非它是 manual）。
 */
export async function upsertExternalIdMatch(input: ExternalMatchInput, db: DbOrTx = getDb()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx.execute<{ match_method: string }>(
      sql`SELECT match_method FROM external_ids WHERE game_id = ${input.gameId} AND source = ${input.source}`,
    );
    if (existing.rows[0]?.match_method === "manual") return false;
    const dup = await tx.execute<{ game_id: number }>(
      sql`SELECT game_id FROM external_ids WHERE source = ${input.source} AND external_id = ${input.externalId} AND game_id <> ${input.gameId}`,
    );
    const review = input.needsReview || dup.rows.length > 0;
    await tx.execute(sql`
      INSERT INTO external_ids (game_id, source, external_id, external_url, confidence_pct, needs_review, match_method, matched_at)
      VALUES (${input.gameId}, ${input.source}, ${input.externalId}, ${input.externalUrl}, ${input.confidencePct}, ${review}, 'auto', now())
      ON CONFLICT (game_id, source) DO UPDATE
        SET external_id = EXCLUDED.external_id, external_url = EXCLUDED.external_url, confidence_pct = EXCLUDED.confidence_pct,
            needs_review = EXCLUDED.needs_review, matched_at = now()`);
    if (dup.rows.length > 0) {
      await tx.execute(sql`
        UPDATE external_ids SET needs_review = true
        WHERE source = ${input.source} AND external_id = ${input.externalId} AND match_method <> 'manual'`);
    }
    return true;
  });
}

export interface MatchReviewItem {
  id: number;
  gameId: number;
  gameName: string;
  gameSlug: string;
  year: number | null;
  externalId: string;
  externalUrl: string | null;
  confidencePct: number | null;
  matchedAt: Date | null;
}

/** 覆核佇列（needs_review=true），信心由低到高。 */
export async function listMatchReviewQueue(source: string, limit: number, db: DbOrTx = getDb()): Promise<MatchReviewItem[]> {
  const res = await db.execute<{ id: number; gid: number; name: string; slug: string; year: number | null; ext: string; url: string | null; pct: number | null; at: Date | null }>(sql`
    SELECT e.id, g.id AS gid, g.name, g.slug, EXTRACT(YEAR FROM g.first_release_date)::int AS year,
           e.external_id AS ext, e.external_url AS url, e.confidence_pct AS pct, e.matched_at AS at
    FROM external_ids e JOIN games g ON g.id = e.game_id
    WHERE e.source = ${source} AND e.needs_review = true
    ORDER BY e.confidence_pct ASC NULLS FIRST, e.id ASC
    LIMIT ${Math.max(1, Math.min(limit, 200))}`);
  return res.rows.map((r) => ({
    id: Number(r.id),
    gameId: Number(r.gid),
    gameName: r.name,
    gameSlug: r.slug,
    year: r.year === null ? null : Number(r.year),
    externalId: r.ext,
    externalUrl: r.url,
    confidencePct: r.pct === null ? null : Number(r.pct),
    matchedAt: r.at ? new Date(r.at) : null,
  }));
}

export async function countMatchReviewQueue(source: string, db: DbOrTx = getDb()): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM external_ids WHERE source = ${source} AND needs_review = true`);
  return Number(res.rows[0]?.n ?? 0);
}

/** 確認：needs_review=false、標 manual（排程不再覆寫）。回傳是否有這筆。 */
export async function confirmExternalMatch(id: number, source: string, db: DbOrTx = getDb()): Promise<boolean> {
  const res = await db.execute(sql`UPDATE external_ids SET needs_review = false, match_method = 'manual', matched_at = now() WHERE id = ${id} AND source = ${source}`);
  return (res.rowCount ?? 0) > 0;
}

/** 清除配對：刪列並寫 external_id_rejections（否則下次排程又提出同一個錯誤候選）；同遊戲該來源的分數列一併刪除。 */
export async function rejectExternalMatch(id: number, source: string, scoreProvider: string | null = null, db: DbOrTx = getDb()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const res = await tx.execute<{ game_id: number; external_id: string }>(sql`DELETE FROM external_ids WHERE id = ${id} AND source = ${source} RETURNING game_id, external_id`);
    const row = res.rows[0];
    if (!row) return false;
    await tx.execute(sql`INSERT INTO external_id_rejections (game_id, source, external_id) VALUES (${row.game_id}, ${source}, ${row.external_id}) ON CONFLICT DO NOTHING`);
    if (scoreProvider) await tx.execute(sql`DELETE FROM ratings WHERE game_id = ${row.game_id} AND score_provider = ${scoreProvider}::score_provider`);
    return true;
  });
}

/** 手動輸入外部 ID：標 manual、不需覆核。 */
export async function setManualExternalMatch(gameId: number, source: string, externalId: string, externalUrl: string | null, db: DbOrTx = getDb()): Promise<boolean> {
  const exists = await db.execute(sql`SELECT 1 FROM games WHERE id = ${gameId}`);
  if ((exists.rowCount ?? 0) === 0) return false;
  await db.execute(sql`
    INSERT INTO external_ids (game_id, source, external_id, external_url, confidence_pct, needs_review, match_method, matched_at)
    VALUES (${gameId}, ${source}, ${externalId}, ${externalUrl}, 100, false, 'manual', now())
    ON CONFLICT (game_id, source) DO UPDATE
      SET external_id = EXCLUDED.external_id, external_url = EXCLUDED.external_url, confidence_pct = 100, needs_review = false, match_method = 'manual', matched_at = now()`);
  return true;
}
