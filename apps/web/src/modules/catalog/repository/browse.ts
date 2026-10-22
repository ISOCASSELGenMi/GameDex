/**
 * 瀏覽／搜尋（06 §瀏覽與搜尋）：遊戲列表，篩選是遊戲層級的維度，不經上市日聚合。
 *
 * - 平台／平台類型：game_platforms（不含 mobile）。類型、主題、公司（任何角色）、系列：關聯表 EXISTS。
 * - 年份：games.first_release_date（索引 games_first_release_date_idx）。
 * - 上市狀態（遊戲層級）：upcoming＝首發日期未定或首發期間尚未結束；released＝首發期間已結束；
 *   delayed＝任一上市列有延期紀錄（同 release-aggregate 的 delayedHistoryCondition）。
 * - 搜尋：查詢字串經 tokenizeForSearch（呼叫端做），以 `word_similarity`（`<%`，GIN trigram 可用）比對 search_text；
 *   只有 1 個字元時退回 ILIKE（06：只輸入 1 個中文字時）。
 * - 排序：popularity（熱度高到低）｜release_date（首發日期早到晚，未定在最後）｜name（原文 games.name）。
 */
import { expandPlatformKindFilter } from "../domain/platform-groups";
import { sql, type SQL } from "drizzle-orm";
import type {
  BrowseGameCard,
  BrowseSort,
  DatePrecision,
  ImageResolver,
  IsoDate,
  PlatformChip,
  ResolvedReleaseFilter,
} from "../domain/entities";
import { delayedHistoryCondition, periodEndSql } from "./release-aggregate";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";

export interface BrowseGamesQuery {
  filter: ResolvedReleaseFilter;
  yearFrom?: number;
  yearTo?: number;
  /** tokenizeForSearch 後的字串；空＝不搜尋。 */
  searchTokens?: string | null;
  sort: BrowseSort;
  offset: number;
  limit: number;
  locale: string;
  today: IsoDate;
  resolveImage: ImageResolver;
}

export interface BrowseRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  original_name: string;
  cover_url: string | null;
  first_release_date: IsoDate | null;
  first_release_precision: DatePrecision | null;
  heat_level: number;
  popularity_score: number;
  game_type: string;
  game_status: string | null;
  platforms: PlatformChip[] | null;
}

/** LIKE 特殊字元跳脫。 */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 瀏覽的 WHERE 條件（games 別名 g）。評分排名頁（repository/ratings-ranking.ts）共用同一份，不另寫一套篩選。 */
export function buildBrowseConditions(q: Pick<BrowseGamesQuery, "filter" | "yearFrom" | "yearTo" | "searchTokens" | "today">): SQL[] {
  const f = q.filter;
  const conds: SQL[] = [sql`COALESCE(g.game_type, 'main_game') = ANY(${pgArray(f.gameTypes)}::text[])`];
  if (!f.includeRumored) conds.push(sql`g.game_status IS DISTINCT FROM 'rumored'`);
  if (f.platformIds || f.platformKinds) {
    const pc: SQL[] = [sql`gp.game_id = g.id`, sql`pl.kind <> 'mobile'`];
    if (f.platformIds) pc.push(sql`gp.platform_id = ANY(${pgArray(f.platformIds)}::int[])`);
    if (f.platformKinds) pc.push(sql`pl.kind = ANY(${pgArray(expandPlatformKindFilter(f.platformKinds))}::platform_kind[])`);
    conds.push(sql`EXISTS (SELECT 1 FROM game_platforms gp JOIN platforms pl ON pl.id = gp.platform_id WHERE ${sql.join(pc, sql` AND `)})`);
  }
  const rel = (table: string, col: string, ids: readonly number[] | undefined) => {
    if (!ids) return;
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${sql.raw(table)} x WHERE x.game_id = g.id AND x.${sql.raw(col)} = ANY(${pgArray(ids)}::int[]))`,
    );
  };
  rel("game_genres", "genre_id", f.genreIds);
  rel("game_themes", "theme_id", f.themeIds);
  rel("game_companies", "company_id", f.companyIds);
  rel("game_franchises", "franchise_id", f.franchiseIds);
  if (f.minHeat != null) conds.push(sql`g.heat_level >= ${f.minHeat}`);
  if (q.yearFrom != null) conds.push(sql`g.first_release_date >= ${`${q.yearFrom}-01-01`}::date`);
  if (q.yearTo != null) conds.push(sql`g.first_release_date <= ${`${q.yearTo}-12-31`}::date`);

  if (f.releaseStates && f.releaseStates.length > 0) {
    const end = periodEndSql(sql`g.first_release_precision`, sql`g.first_release_date`);
    const st: SQL[] = [];
    if (f.releaseStates.includes("upcoming")) {
      st.push(sql`(g.first_release_date IS NULL OR g.first_release_precision = 'tbd' OR ${end} >= ${q.today}::date)`);
    }
    if (f.releaseStates.includes("released")) {
      st.push(sql`(g.first_release_precision IS DISTINCT FROM 'tbd' AND ${end} < ${q.today}::date)`);
    }
    if (f.releaseStates.includes("delayed")) {
      st.push(sql`EXISTS (SELECT 1 FROM release_events re JOIN release_date_history h ON h.release_event_id = re.id
        WHERE re.game_id = g.id AND ${delayedHistoryCondition("h")})`);
    }
    conds.push(sql`(${sql.join(st, sql` OR `)})`);
  }

  const tokens = q.searchTokens?.trim() ?? "";
  if (tokens) {
    if ([...tokens.replace(/\s+/g, "")].length <= 1) {
      conds.push(sql`g.search_text ILIKE ${`%${likeEscape(tokens)}%`}`);
    } else {
      conds.push(sql`${tokens} <% g.search_text`);
    }
  }
  return conds;
}

/** 瀏覽卡片的 SELECT 欄位（games 別名 g）；分組檢視（browse-groups.ts）共用。 */
export function browseCardColumns(locale: string): SQL {
  return sql`g.id, g.slug,
  COALESCE(NULLIF(g.display_names ->> ${locale}, ''), g.name) AS name,
  g.name AS original_name, g.cover_url,
  g.first_release_date::text AS first_release_date, g.first_release_precision,
  g.heat_level, g.popularity_score, COALESCE(g.game_type, 'main_game') AS game_type, g.game_status,
  (SELECT jsonb_agg(jsonb_build_object('slug', pl.slug, 'name', pl.name, 'abbreviation', pl.abbreviation, 'kind', pl.kind)
                    ORDER BY pl.name, pl.id)
     FROM game_platforms gp JOIN platforms pl ON pl.id = gp.platform_id
     WHERE gp.game_id = g.id AND pl.kind <> 'mobile') AS platforms`;
}

export function buildBrowseQuery(q: Omit<BrowseGamesQuery, "resolveImage">): SQL {
  const conds = buildBrowseConditions(q);
  const order =
    q.sort === "name"
      ? sql`g.name ASC, g.id ASC`
      : q.sort === "release_date"
        ? sql`g.first_release_date ASC NULLS LAST, g.popularity_score DESC, g.id ASC`
        : sql`g.popularity_score DESC, g.name ASC, g.id ASC`;

  return sql`
    SELECT ${browseCardColumns(q.locale)}
    FROM games g
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY ${order}
    LIMIT ${q.limit} OFFSET ${q.offset}
  `;
}

export function browseRowToCard(r: BrowseRow, resolveImage: ImageResolver): BrowseGameCard {
  return {
    gameId: r.id,
    slug: r.slug,
    name: r.name,
    originalName: r.original_name,
    cover: resolveImage(r.cover_url, "cover"),
    platforms: r.platforms ?? [],
    firstReleaseDate: r.first_release_date,
    firstReleasePrecision: r.first_release_precision,
    heatLevel: r.heat_level,
    popularityScore: r.popularity_score,
    gameType: r.game_type,
    gameStatus: r.game_status,
  };
}

/** 多取 1 筆判斷 hasMore。 */
export async function browseGameList(
  q: BrowseGamesQuery,
  opts: ReadOptions = {},
): Promise<{ games: BrowseGameCard[]; hasMore: boolean }> {
  const res = await withReadTimeout((tx) => tx.execute<BrowseRow>(buildBrowseQuery({ ...q, limit: q.limit + 1 })), opts);
  const rows = res.rows.slice(0, q.limit);
  return {
    hasMore: res.rows.length > q.limit,
    games: rows.map((r) => browseRowToCard(r, q.resolveImage)),
  };
}
