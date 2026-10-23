/**
 * 評分排名（06 §評分排名、05）：把 ratings 表中某一欄（scoreProvider／scoreType、不分平台）的分數排名，
 * 篩選條件與瀏覽頁共用同一份（buildBrowseConditions，原則五）。
 *
 * - 排序欄的最低票數門檻（`review_count >= minVotes`）在這裡套用；其他欄只顯示有的值，不套門檻。
 * - 名次 `rank()`：依排序欄分數由高到低，同分同名次；與 dir 無關（asc 只是把顯示順序整個反過來，1 仍是最高分）。
 * - 同分的顯示順序：評論人數多的在前，再依熱度、id（全部隨 dir 反轉，所以 asc 是 desc 的精確倒序）。
 * - `prev`：另一欄的名次（用它自己的門檻與同一組篩選），讓畫面標示「相對上一個排序標準」的名次升降。
 * 唯讀 transaction＋statement_timeout（withReadTimeout）；逾時丟 CatalogQueryTimeoutError。
 */
import { sql, type SQL } from "drizzle-orm";
import type {
  ImageResolver,
  IsoDate,
  RatingCell,
  RatingColumn,
  RatingRankDir,
  RatingRankRow,
  ResolvedReleaseFilter,
} from "../domain/entities";
import { buildBrowseConditions } from "./browse";
import { withReadTimeout, type ReadOptions } from "./read-tx";

export interface RatingsRankingQuery {
  filter: ResolvedReleaseFilter;
  yearFrom?: number;
  yearTo?: number;
  today: IsoDate;
  /** 排序欄與它的最低票數。 */
  sort: RatingColumn;
  minVotes: number;
  dir: RatingRankDir;
  /** 前一個排序欄（算名次升降用）；省略＝不算。 */
  prev?: { column: RatingColumn; minVotes: number };
  /** 要顯示的所有欄位（含 sort）。 */
  columns: readonly RatingColumn[];
  offset: number;
  limit: number;
  locale: string;
  resolveImage: ImageResolver;
}

interface Row extends Record<string, unknown> {
  game_id: number;
  slug: string;
  name: string;
  original_name: string;
  cover_url: string | null;
  year: number | null;
  rnk: string | number;
  prnk: string | number | null;
  total: string | number;
}

function eligible(col: RatingColumn, minVotes: number, conds: readonly SQL[]): SQL {
  return sql`
    SELECT g.id AS game_id, r.score, COALESCE(r.review_count, 0) AS cnt, g.popularity_score
    FROM games g
    JOIN ratings r ON r.game_id = g.id AND r.score_provider::text = ${col.scoreProvider}
      AND r.score_type = ${col.scoreType} AND r.platform_id IS NULL
    WHERE r.score IS NOT NULL AND COALESCE(r.review_count, 0) >= ${minVotes} AND ${sql.join(conds as SQL[], sql` AND `)}`;
}

export function buildRatingsRankingQuery(q: RatingsRankingQuery): SQL {
  const conds = buildBrowseConditions({ filter: q.filter, yearFrom: q.yearFrom, yearTo: q.yearTo, searchTokens: null, today: q.today });
  const dirSql = q.dir === "asc" ? sql`ASC` : sql`DESC`;
  const usePrev = q.prev !== undefined;
  const prevCte = usePrev
    ? sql`, prev AS (
        SELECT e.game_id, rank() OVER (ORDER BY e.score DESC) AS prnk FROM (${eligible(q.prev!.column, q.prev!.minVotes, conds)}) e
      )`
    : sql``;
  const laterals = q.columns.map((c, i) => {
    const a = sql.raw(`c${i}`);
    return sql`LEFT JOIN LATERAL (
        SELECT x.score, x.review_count FROM ratings x
        WHERE x.game_id = pg.game_id AND x.score_provider::text = ${c.scoreProvider} AND x.score_type = ${c.scoreType}
          AND x.platform_id IS NULL AND x.score IS NOT NULL
        LIMIT 1) ${a} ON true`;
  });
  const colSelect = q.columns.map((_, i) => sql.raw(`c${i}.score AS c${i}_score, c${i}.review_count AS c${i}_count`));
  return sql`
    WITH eligible AS (${eligible(q.sort, q.minVotes, conds)}),
    ranked AS (
      SELECT e.*, rank() OVER (ORDER BY e.score DESC) AS rnk, count(*) OVER () AS total FROM eligible e
    ),
    pg AS (
      SELECT * FROM ranked
      ORDER BY score ${dirSql}, cnt ${dirSql}, popularity_score ${dirSql}, game_id ${dirSql}
      LIMIT ${q.limit} OFFSET ${q.offset}
    )${prevCte}
    SELECT g.slug, pg.game_id,
      COALESCE(NULLIF(g.display_names ->> ${q.locale}, ''), g.name) AS name, g.name AS original_name, g.cover_url,
      EXTRACT(YEAR FROM g.first_release_date)::int AS year,
      pg.rnk, pg.total, ${usePrev ? sql`prev.prnk` : sql`NULL::bigint`} AS prnk,
      ${sql.join(colSelect, sql`, `)}
    FROM pg
    JOIN games g ON g.id = pg.game_id
    ${usePrev ? sql`LEFT JOIN prev ON prev.game_id = pg.game_id` : sql``}
    ${sql.join(laterals, sql` `)}
    ORDER BY pg.score ${dirSql}, pg.cnt ${dirSql}, pg.popularity_score ${dirSql}, pg.game_id ${dirSql}`;
}

export async function listRatingsRanking(
  q: RatingsRankingQuery,
  opts: ReadOptions = {},
): Promise<{ rows: RatingRankRow[]; total: number }> {
  const res = await withReadTimeout((tx) => tx.execute<Row>(buildRatingsRankingQuery(q)), opts);
  const total = res.rows.length > 0 ? Number(res.rows[0]!.total) : 0;
  const rows = res.rows.map((r): RatingRankRow => {
    const cells: Record<string, RatingCell> = {};
    q.columns.forEach((c, i) => {
      const score = r[`c${i}_score`];
      const count = r[`c${i}_count`];
      cells[c.id] = { score: score == null ? null : Number(score), count: count == null ? null : Number(count) };
    });
    return {
      gameId: Number(r.game_id),
      slug: r.slug,
      name: r.name,
      originalName: r.original_name,
      cover: q.resolveImage(r.cover_url, "cover"),
      year: r.year == null ? null : Number(r.year),
      rank: Number(r.rnk),
      prevRank: r.prnk == null ? null : Number(r.prnk),
      cells,
    };
  });
  return { rows, total };
}
