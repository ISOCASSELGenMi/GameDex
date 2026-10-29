import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import { SUGGEST_CANDIDATE_POOL, SUGGEST_EXACT_PROBE, SUGGEST_HOT_MAX_CHARS, SUGGEST_HOT_WINDOW, SUGGEST_PLATFORM_MAX, type GameSuggestion, type ImageResolver } from "../domain/entities";
import { withReadTimeout } from "./read-tx";

/**
 * 搜尋候選（打字時的下拉清單）。查詢字串已經 tokenizeForSearch（呼叫端做）；比對方式與瀏覽頁搜尋相同
 * （≥ 2 字元用 trigram `<%`，1 字元用 ILIKE）。排序：名稱完全符合 → 名稱開頭符合 → 熱度。
 * 效能：先取「符合者中熱度最高的 SUGGEST_CANDIDATE_POOL 筆」，只對這些算顯示名稱（games.display_names 是 TOAST 的 jsonb，對全部符合列解開要 2 秒以上），
 * 再排序。熱度較低、不在候選池內的「名稱完全相同」者，另用 games_lower_name_prefix_idx（lower(name) = 輸入）補進候選（最多 SUGGEST_EXACT_PROBE 筆），
 * 短字（≤ SUGGEST_HOT_MAX_CHARS 個字元）先走第一段：只在熱度最高的 SUGGEST_HOT_WINDOW 筆（games_browse_pop_idx 的順序，必須寫 NULLS LAST 才用得到）內找符合者，
 * 找滿候選池就直接用，不足才退回全表（量測與取捨見 SUGGEST_HOT_WINDOW 的註解）。窗口內的順序是索引順序（熱度、名稱、id），與全表的（熱度、id）只在同熱度的邊界有差。
 * 所以像 z 這種符合數萬筆的短字，名稱剛好是 Z 的遊戲仍會排第一。顯示名稱（非原名）完全相同但不在池內的仍不保證（沒有索引，量測見 Z2B 報告）。
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
  /** 兩段式候選池的參數覆寫；測試用，正式呼叫不傳。hotWindow 為 0 表示關閉第一段。 */
  tuning?: { hotWindow?: number; hotMaxChars?: number; pool?: number };
}

export async function suggestGames(q: SuggestGamesQuery, resolveImage: ImageResolver, db?: DbOrTx): Promise<GameSuggestion[]> {
  const single = [...q.tokens.replace(/\s+/g, "")].length <= 1;
  const matchOn = (a: SQL) => (single ? sql`${a}.search_text ILIKE ${`%${likeEscape(q.tokens)}%`}` : sql`${q.tokens} <% ${a}.search_text`);
  const match = matchOn(sql.raw("g"));
  const loc = q.locale ?? "";
  const shown = sql`COALESCE(NULLIF(g.display_names ->> ${loc}, ''), g.name)`;
  const exactCond = sql`(lower(g.name) = ${q.exact} OR lower(${shown}) = ${q.exact})`;
  const pool = q.tuning?.pool ?? SUGGEST_CANDIDATE_POOL;
  const hotWindow = q.tuning?.hotWindow ?? SUGGEST_HOT_WINDOW;
  const useHot = hotWindow > 0 && [...q.exact.replace(/\s+/g, "")].length <= (q.tuning?.hotMaxChars ?? SUGGEST_HOT_MAX_CHARS);
  const exactProbe = sql`SELECT g.id FROM games g WHERE lower(g.name) = ${q.exact} ORDER BY g.popularity_score DESC, g.id ASC LIMIT ${SUGGEST_EXACT_PROBE}`;
  const prefix = `${likeEscape(q.exact)}%`;
  const prefixCond = sql`(lower(g.name) LIKE ${prefix} OR lower(${shown}) LIKE ${prefix})`;
  const rows = await withReadTimeout(
    async (tx) => {
      let hotIds: number[] | null = null;
      if (useHot) {
        const hot = await tx.execute<{ id: number }>(sql`
          SELECT h.id FROM (SELECT g.id, g.search_text FROM games g ORDER BY g.popularity_score DESC NULLS LAST, g.name, g.id LIMIT ${hotWindow}) h
          WHERE ${matchOn(sql.raw("h"))} LIMIT ${pool}`);
        if (hot.rows.length >= pool) hotIds = hot.rows.map((r) => Number(r.id));
      }
      const poolSource = hotIds
        ? sql`(SELECT unnest(ARRAY[${sql.join(hotIds.map((i) => sql`${i}`), sql`,`)}]::int[]) AS id) UNION (${exactProbe})`
        : sql`(SELECT g.id FROM games g WHERE ${match} ORDER BY g.popularity_score DESC, g.id ASC LIMIT ${pool}) UNION (${exactProbe})`;
      return (
        await tx.execute<SuggestRow>(sql`
          SELECT g.id, g.slug, g.name, NULLIF(g.display_names ->> ${loc}, '') AS display_name, g.cover_url,
            EXTRACT(YEAR FROM g.first_release_date)::int AS year,
            (SELECT array_agg(label ORDER BY ord) FROM (
               SELECT COALESCE(NULLIF(pl.abbreviation, ''), pl.name) AS label, row_number() OVER (ORDER BY pl.name, pl.id) AS ord
               FROM game_platforms gp JOIN platforms pl ON pl.id = gp.platform_id
               WHERE gp.game_id = g.id AND pl.kind <> 'mobile'
               ORDER BY pl.name, pl.id LIMIT ${SUGGEST_PLATFORM_MAX}) p) AS platforms
          FROM games g
          JOIN (${poolSource}) pool ON pool.id = g.id
          ORDER BY (CASE WHEN ${exactCond} THEN 0 WHEN ${prefixCond} THEN 1 ELSE 2 END) ASC, g.popularity_score DESC, g.id ASC
          LIMIT ${Math.max(1, Math.min(q.limit, 50))}`)
      ).rows;
    },
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
