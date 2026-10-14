/**
 * 熱門榜（06 §熱度顯示：/trending）。accounts 停用時依 popularityScore（site_follows_7d 排序在 Phase 7 加）。
 * 分群條件與 refresh_popularity 共用 popularityGroupCondition（repository/popularity.ts）。
 *
 * 篩選語意與月曆一致：同維度 OR、跨維度 AND；平台與平台種類要落在同一個平台上；mobile 平台不計
 * （只在 mobile 上市的遊戲不上榜，與月曆、篩選選項一致）。heatLevel 0（完全無訊號）與 cancelled 的遊戲不上榜。
 * 排序：popularity_score DESC, id ASC（07 §分頁 `popularity` 的鍵）。
 */
import { sql, type SQL } from "drizzle-orm";
import type {
  DatePrecision,
  ImageResolver,
  IsoDate,
  PopularityGroup,
  TrendingCard,
  TrendingFilter,
} from "../domain/entities";
import { popularityGroupCondition } from "./popularity";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";

export const TRENDING_MAX_LIMIT = 100;

export interface ListTrendingInput {
  group: PopularityGroup;
  todayUtc: IsoDate;
  filter: TrendingFilter;
  locale: string;
  limit: number;
  offset: number;
  resolveImage: ImageResolver;
}

interface TrendingRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  original_name: string;
  cover_url: string | null;
  heat_level: number;
  popularity_score: number;
  first_release_date: string | null;
  first_release_precision: DatePrecision | null;
  game_type: string;
  game_status: string | null;
}

/** 回傳 limit＋1 筆以判斷 hasMore（呼叫端截斷）。limit 夾在 1~100，offset ≥ 0。 */
export async function listTrending(
  input: ListTrendingInput,
  opts: ReadOptions = {},
): Promise<{ items: TrendingCard[]; hasMore: boolean }> {
  const limit = Math.min(TRENDING_MAX_LIMIT, Math.max(1, Math.floor(input.limit)));
  const offset = Math.max(0, Math.floor(input.offset));
  const res = await withReadTimeout((tx) => tx.execute<TrendingRow>(buildTrendingQuery({ ...input, limit, offset })), opts);
  const rows = res.rows.slice(0, limit);
  return {
    items: rows.map((r) => ({
      gameId: r.id,
      slug: r.slug,
      name: r.name,
      originalName: r.original_name,
      cover: input.resolveImage(r.cover_url, "cover"),
      heatLevel: r.heat_level,
      popularityScore: r.popularity_score,
      releaseDate: r.first_release_date,
      releasePrecision: r.first_release_precision,
      gameType: r.game_type,
      gameStatus: r.game_status,
    })),
    hasMore: res.rows.length > limit,
  };
}

/** 查詢本體（匯出供 EXPLAIN 量測）。 */
export function buildTrendingQuery(input: Omit<ListTrendingInput, "resolveImage">): SQL {
  const f = input.filter;
  const platformConds: SQL[] = [sql`pl.kind <> 'mobile'`];
  if (f.platformIds) platformConds.push(sql`gp.platform_id = ANY(${pgArray(f.platformIds)}::int[])`);
  if (f.platformKinds) platformConds.push(sql`pl.kind = ANY(${pgArray(f.platformKinds)}::platform_kind[])`);

  const conds: SQL[] = [
    popularityGroupCondition("g", input.group, input.todayUtc),
    sql`g.heat_level > 0`,
    sql`g.game_status IS DISTINCT FROM 'cancelled'`,
    sql`COALESCE(g.game_type, 'main_game') = ANY(${pgArray(f.gameTypes)}::text[])`,
    sql`EXISTS (SELECT 1 FROM game_platforms gp JOIN platforms pl ON pl.id = gp.platform_id
                WHERE gp.game_id = g.id AND ${sql.join(platformConds, sql` AND `)})`,
  ];
  if (!f.includeRumored) conds.push(sql`g.game_status IS DISTINCT FROM 'rumored'`);
  if (f.genreIds) {
    conds.push(sql`EXISTS (SELECT 1 FROM game_genres gg WHERE gg.game_id = g.id AND gg.genre_id = ANY(${pgArray(f.genreIds)}::int[]))`);
  }

  return sql`
    SELECT g.id, g.slug,
      COALESCE(NULLIF(g.display_names ->> ${input.locale}, ''), g.name) AS name,
      g.name AS original_name, g.cover_url, g.heat_level, g.popularity_score,
      g.first_release_date::text AS first_release_date, g.first_release_precision,
      COALESCE(g.game_type, 'main_game') AS game_type, g.game_status
    FROM games g
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY g.popularity_score DESC, g.id ASC
    LIMIT ${input.limit + 1} OFFSET ${input.offset}
  `;
}
