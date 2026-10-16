import { sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { GameMiniCard, GamePlatformOption, ImageResolver, IsoDate } from "../domain/entities";

/**
 * 給其他模組（accounts）顯示遊戲卡片、驗證平台、搜尋選擇器用的唯讀查詢（Phase 7 第 5 波）。不寫入任何東西。
 */

interface CardRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  display_names: Record<string, string> | null;
  cover_url: string | null;
  first_release_date: string | null;
}

function toCard(r: CardRow, locale: string | null, resolveImage: ImageResolver): GameMiniCard {
  const localized = locale ? r.display_names?.[locale] : undefined;
  return {
    id: Number(r.id),
    slug: r.slug,
    name: localized && localized.trim() !== "" ? localized : r.name,
    originalName: r.name,
    cover: resolveImage(r.cover_url, "cover"),
    firstReleaseDate: (r.first_release_date as IsoDate | null) ?? null,
  };
}

/** 依 id 批次取迷你卡片；不存在的 id 不在 Map 裡。 */
export async function getGameMiniCardsByIds(
  ids: readonly number[],
  locale: string | null,
  resolveImage: ImageResolver,
  db: DbOrTx = getDb(),
): Promise<Map<number, GameMiniCard>> {
  const out = new Map<number, GameMiniCard>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const result = await db.execute<CardRow>(sql`
    SELECT id, slug, name, display_names, cover_url, first_release_date::text AS first_release_date
    FROM games WHERE id IN (${sql.join(unique.map((i) => sql`${i}`), sql`, `)})`);
  for (const r of result.rows) out.set(Number(r.id), toCard(r, locale, resolveImage));
  return out;
}

export async function gameExists(gameId: number, db: DbOrTx = getDb()): Promise<boolean> {
  const result = await db.execute<{ ok: number }>(sql`SELECT 1 AS ok FROM games WHERE id = ${gameId} LIMIT 1`);
  return result.rows.length > 0;
}

/** 平台是否屬於該遊戲（game_platforms；含 mobile）。 */
export async function gameHasPlatform(gameId: number, platformId: number, db: DbOrTx = getDb()): Promise<boolean> {
  const result = await db.execute<{ ok: number }>(
    sql`SELECT 1 AS ok FROM game_platforms WHERE game_id = ${gameId} AND platform_id = ${platformId} LIMIT 1`,
  );
  return result.rows.length > 0;
}

/** 該遊戲的平台選項（不含 mobile，P35），依名稱排序。 */
export async function listGamePlatformOptions(gameId: number, db: DbOrTx = getDb()): Promise<GamePlatformOption[]> {
  const result = await db.execute<{ id: number; slug: string; name: string; abbreviation: string | null }>(sql`
    SELECT p.id, p.slug, p.name, p.abbreviation
    FROM game_platforms gp JOIN platforms p ON p.id = gp.platform_id
    WHERE gp.game_id = ${gameId} AND p.kind <> 'mobile'
    ORDER BY p.name ASC, p.id ASC`);
  return result.rows.map((r) => ({ id: Number(r.id), slug: r.slug, name: r.name, abbreviation: r.abbreviation }));
}

/** 搜尋選擇器：games.search_text 的 trigram（tokens 已經 tokenizeForSearch）。 */
export async function searchGameMiniCards(
  tokens: string,
  limit: number,
  locale: string | null,
  resolveImage: ImageResolver,
  db: DbOrTx = getDb(),
): Promise<GameMiniCard[]> {
  const result = await db.execute<CardRow>(sql`
    SELECT g.id, g.slug, g.name, g.display_names, g.cover_url, g.first_release_date::text AS first_release_date
    FROM games g
    WHERE ${tokens} <% g.search_text
    ORDER BY word_similarity(${tokens}, g.search_text) DESC, g.popularity_score DESC, g.id ASC
    LIMIT ${Math.max(1, Math.min(limit, 100))}`);
  return result.rows.map((r) => toCard(r, locale, resolveImage));
}
