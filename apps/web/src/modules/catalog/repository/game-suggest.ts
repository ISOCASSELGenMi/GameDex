import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import { SUGGEST_CANDIDATE_POOL, SUGGEST_PLATFORM_MAX, type GameSuggestion, type ImageResolver } from "../domain/entities";
import { withReadTimeout } from "./read-tx";

/**
 * 搜尋候選（打字時的下拉清單）。查詢字串已經 tokenizeForSearch（呼叫端做）；比對方式與瀏覽頁搜尋相同
 * （≥ 2 字元用 trigram `<%`，1 字元用 ILIKE）。排序：名稱完全符合 → 名稱開頭符合 → 熱度。
 * 效能：先取「符合者中熱度最高的 SUGGEST_CANDIDATE_POOL 筆」，只對這些算顯示名稱（games.display_names 是 TOAST 的 jsonb，對全部符合列解開要 2 秒以上），
 * 再排序；所以「完全符合優先」只在這個候選池內生效（常見短字如 the 符合數萬筆時，熱度更低的完全符合者不在池內）。
 * `exact` 是 NFKC＋小寫後的原始輸入（不經 bigram 拆字），用來和 games.name／顯示名稱比對。
 */

interface SuggestRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  display_name: string | null;
  cover_url: string | null;
  year: number | null;
  platforms: string[] | null;
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface SuggestGamesQuery {
  tokens: string;
  exact: string;
  locale: string | null;
  limit: number;
}

export async function suggestGames(q: SuggestGamesQuery, resolveImage: ImageResolver, db?: DbOrTx): Promise<GameSuggestion[]> {
  const single = [...q.tokens.replace(/\s+/g, "")].length <= 1;
  const match = single ? sql`g.search_text ILIKE ${`%${likeEscape(q.tokens)}%`}` : sql`${q.tokens} <% g.search_text`;
  const loc = q.locale ?? "";
  const shown = sql`COALESCE(NULLIF(g.display_names ->> ${loc}, ''), g.name)`;
  const exactCond = sql`(lower(g.name) = ${q.exact} OR lower(${shown}) = ${q.exact})`;
  const prefix = `${likeEscape(q.exact)}%`;
  const prefixCond = sql`(lower(g.name) LIKE ${prefix} OR lower(${shown}) LIKE ${prefix})`;
  const rows = await withReadTimeout(
    async (tx) =>
      (
        await tx.execute<SuggestRow>(sql`
          SELECT g.id, g.slug, g.name, NULLIF(g.display_names ->> ${loc}, '') AS display_name, g.cover_url,
            EXTRACT(YEAR FROM g.first_release_date)::int AS year,
            (SELECT array_agg(label ORDER BY ord) FROM (
               SELECT COALESCE(NULLIF(pl.abbreviation, ''), pl.name) AS label, row_number() OVER (ORDER BY pl.name, pl.id) AS ord
               FROM game_platforms gp JOIN platforms pl ON pl.id = gp.platform_id
               WHERE gp.game_id = g.id AND pl.kind <> 'mobile'
               ORDER BY pl.name, pl.id LIMIT ${SUGGEST_PLATFORM_MAX}) p) AS platforms
          FROM (
            SELECT * FROM games g WHERE ${match}
            ORDER BY g.popularity_score DESC, g.id ASC
            LIMIT ${SUGGEST_CANDIDATE_POOL}
          ) g
          ORDER BY (CASE WHEN ${exactCond} THEN 0 WHEN ${prefixCond} THEN 1 ELSE 2 END) ASC, g.popularity_score DESC, g.id ASC
          LIMIT ${Math.max(1, Math.min(q.limit, 50))}`)
      ).rows,
    { db },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    name: r.display_name ?? r.name,
    originalName: r.name,
    cover: resolveImage(r.cover_url, "cover"),
    year: r.year === null ? null : Number(r.year),
    platforms: r.platforms ?? [],
  }));
}
