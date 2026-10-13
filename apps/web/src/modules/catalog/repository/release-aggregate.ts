/**
 * 聚合規則的唯一實作（06 §聚合規則；02 資料夾結構）。月曆、時間軸、Discord `/upcoming`、公開 iCal 共用。
 *
 * 1. 每個 (遊戲, 平台, 階段) 挑一筆，優先序（使用者 2026-10-13 定案）：
 *    `manual` 優先於 `igdb`（source 為 NULL 視為 igdb，與 game-detail.ts 一致）
 *    → 來源仍存在（active）優先於 removed（同鍵有有效列時不拿 removed 列）
 *    → **有日期**（precision 非 tbd 且 release_date 非 NULL）優先於未定（例：WW＝tbd、JP＝10/20 day，偏好 WW
 *      仍挑 JP，遊戲出現在 10/20，不會因為挑到 tbd 列而從月曆消失）
 *    → 偏好地區 → `WW` → 最早日期 → id
 *    （`DISTINCT ON`＋優先序，在 DB 端做）。挑選範圍是該鍵的**全部**候選列，不只落在查詢區間內的列——
 *    否則偏好地區的日期在區間外時，會誤把 WW 的日期放進來。挑完再套區間。
 * 2. 同一款遊戲、同一個代表日期＋精度＋階段的多個平台合併成一張卡（平台以 chip 呈現）；不同天分開。
 *    也在 SQL 做（GROUP BY），這裡是唯一一份。
 * 3. 地區偏好（使用者設定 > 瀏覽器語系 > DEFAULT_REGION_PREF）由呼叫端決定後傳入 `regionPref`。
 *
 * 篩選：同維度 OR、跨維度 AND。遊戲層級（類型、傳聞、類型標籤）與平台層級條件在挑選前就套用
 * （它們對同一個鍵是常數）；上市列層級的 status 在挑選時排除，讓有效的列遞補；removed 預設納入（D7）。
 */
import { sql, type SQL } from "drizzle-orm";
import {
  DATE_PRECISIONS,
  type DatePrecision,
  type ImageResolver,
  type IsoDate,
  type PlatformChip,
  type RegionCode,
  type ReleaseCard,
  type ReleaseStage,
  type ReleaseStatus,
  type ResolvedReleaseFilter,
  type SourceStatus,
} from "../domain/entities";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";

export interface AggregateReleasesInput {
  /** 代表日期（release_date）下限，含；未給＝不限。 */
  from?: IsoDate | null;
  /** 代表日期上限，含；未給＝不限。 */
  to?: IsoDate | null;
  /**
   * 納入的精度；預設 day、month、quarter、year。
   * `tbd` 沒有日期，只有明確列入時才納入（不受 from／to 限制）。
   */
  precisions?: readonly DatePrecision[];
  filter: ResolvedReleaseFilter;
  regionPref: RegionCode;
  /** 顯示名稱用的語系鍵（games.displayNames 的 key，例 `zh-Hant`、`ja`）。 */
  locale: string;
  /** 只看這些遊戲（例如追蹤清單）；未給＝不限。 */
  gameIds?: readonly number[];
  /** 結果上限（依排序截斷）；未給＝不限。 */
  limit?: number;
  /** 已存封面網址 → ImageRef（Provider 實作，由 Use Case 傳入；Repository 不知道來源網址格式）。 */
  resolveImage: ImageResolver;
}

export const DEFAULT_AGGREGATE_PRECISIONS: readonly DatePrecision[] = ["day", "month", "quarter", "year"];

interface CardRow extends Record<string, unknown> {
  game_id: number;
  slug: string;
  name: string;
  original_name: string;
  cover_url: string | null;
  release_date: string | null;
  period_start: string | null;
  precision: DatePrecision;
  release_stage: ReleaseStage;
  status: ReleaseStatus;
  source_status: SourceStatus;
  platforms: PlatformChip[];
  popularity_score: number;
  heat_level: number;
  game_type: string;
  game_status: string | null;
  release_event_ids: number[];
}

/** 套用聚合規則，回傳排序好的卡片：代表日期 → 精度（day→tbd）→ 熱度高到低 → 名稱 → gameId。 */
export async function aggregateReleases(input: AggregateReleasesInput, opts: ReadOptions = {}): Promise<ReleaseCard[]> {
  const query = buildAggregateQuery(input);
  const res = await withReadTimeout((tx) => tx.execute<CardRow>(query), opts);
  return res.rows.map((r) => toCard(r, input.resolveImage));
}

/** 查詢本體（匯出供效能量測 EXPLAIN 用；一般請呼叫 aggregateReleases）。 */
export function buildAggregateQuery(input: Omit<AggregateReleasesInput, "resolveImage">): SQL {
  const f = input.filter;
  const precisions = [...new Set(input.precisions ?? DEFAULT_AGGREGATE_PRECISIONS)].filter((p) =>
    (DATE_PRECISIONS as readonly string[]).includes(p),
  );
  const dated = precisions.filter((p) => p !== "tbd");
  const withTbd = precisions.includes("tbd");

  // 上市列層級（挑選前排除，讓其他列遞補）
  const rowConds: SQL[] = [sql`r.status = ANY(${pgArray(f.statuses)}::release_status[])`];
  if (!f.includeRemoved) rowConds.push(sql`r.source_status = 'active'`);

  // 區間＋精度：先用來找候選鍵，挑完再套一次（alias r＝原始列、p＝挑出的列）
  const range = (alias: "r" | "p") => {
    const a = sql.raw(alias);
    const parts: SQL[] = [];
    if (dated.length > 0) {
      const c = [sql`${a}.precision = ANY(${pgArray(dated)}::date_precision[])`];
      if (input.from) c.push(sql`${a}.release_date >= ${input.from}::date`);
      if (input.to) c.push(sql`${a}.release_date <= ${input.to}::date`);
      parts.push(sql`(${sql.join(c, sql` AND `)})`);
    }
    if (withTbd) parts.push(sql`${a}.precision = 'tbd'`);
    return parts.length > 0 ? sql`(${sql.join(parts, sql` OR `)})` : sql`FALSE`;
  };

  // 鍵層級（遊戲、平台）
  const keyConds: SQL[] = [
    range("r"),
    sql`r.release_stage = ANY(${pgArray(f.stages)}::release_stage[])`,
    sql`pl.kind <> 'mobile'`,
    sql`COALESCE(g.game_type, 'main_game') = ANY(${pgArray(f.gameTypes)}::text[])`,
    ...rowConds,
  ];
  if (!f.includeRumored) keyConds.push(sql`g.game_status IS DISTINCT FROM 'rumored'`);
  if (f.platformIds) keyConds.push(sql`r.platform_id = ANY(${pgArray(f.platformIds)}::int[])`);
  if (f.platformKinds) keyConds.push(sql`pl.kind = ANY(${pgArray(f.platformKinds)}::platform_kind[])`);
  if (f.genreIds) {
    keyConds.push(
      sql`EXISTS (SELECT 1 FROM game_genres gg WHERE gg.game_id = r.game_id AND gg.genre_id = ANY(${pgArray(f.genreIds)}::int[]))`,
    );
  }
  if (input.gameIds) keyConds.push(sql`r.game_id = ANY(${pgArray(input.gameIds)}::int[])`);

  const limit = input.limit != null ? sql`LIMIT ${Math.max(0, Math.floor(input.limit))}` : sql``;

  return sql`
    WITH keys AS (
      SELECT DISTINCT r.game_id, r.platform_id, r.release_stage
      FROM release_events r
      JOIN games g ON g.id = r.game_id
      JOIN platforms pl ON pl.id = r.platform_id
      WHERE ${sql.join(keyConds, sql` AND `)}
    ),
    picked AS (
      SELECT DISTINCT ON (r.game_id, r.platform_id, r.release_stage)
        r.id, r.game_id, r.platform_id, r.release_stage, r.release_date, r.period_start,
        r.precision, r.status, r.source_status
      FROM keys k
      JOIN release_events r
        ON r.game_id = k.game_id AND r.platform_id = k.platform_id AND r.release_stage = k.release_stage
      JOIN regions rg ON rg.id = r.region_id
      WHERE ${sql.join(rowConds, sql` AND `)}
      ORDER BY r.game_id, r.platform_id, r.release_stage,
        (COALESCE(r.source, 'igdb') = 'manual') DESC,
        (r.source_status = 'active') DESC,
        (r.precision <> 'tbd' AND r.release_date IS NOT NULL) DESC,
        (rg.code = ${input.regionPref}) DESC,
        (rg.code = 'WW') DESC,
        r.release_date ASC NULLS LAST,
        r.id ASC
    )
    SELECT
      p.game_id,
      g.slug,
      COALESCE(NULLIF(g.display_names ->> ${input.locale}, ''), g.name) AS name,
      g.name AS original_name,
      g.cover_url,
      p.release_date::text AS release_date,
      MIN(p.period_start)::text AS period_start,
      p.precision,
      p.release_stage,
      CASE
        WHEN bool_or(p.status = 'delayed') THEN 'delayed'
        WHEN bool_or(p.status = 'scheduled') THEN 'scheduled'
        WHEN bool_or(p.status = 'released') THEN 'released'
        ELSE 'cancelled'
      END AS status,
      CASE WHEN bool_and(p.source_status = 'removed') THEN 'removed' ELSE 'active' END AS source_status,
      jsonb_agg(
        jsonb_build_object('slug', pl.slug, 'name', pl.name, 'abbreviation', pl.abbreviation, 'kind', pl.kind)
        ORDER BY pl.name, pl.id
      ) AS platforms,
      array_agg(p.id ORDER BY pl.name, pl.id) AS release_event_ids,
      g.popularity_score,
      g.heat_level,
      COALESCE(g.game_type, 'main_game') AS game_type,
      g.game_status
    FROM picked p
    JOIN games g ON g.id = p.game_id
    JOIN platforms pl ON pl.id = p.platform_id
    WHERE ${range("p")}
    GROUP BY p.game_id, p.release_date, p.precision, p.release_stage, g.id
    ORDER BY p.release_date ASC NULLS LAST,
      array_position(ARRAY['day','month','quarter','year','tbd']::date_precision[], p.precision),
      g.popularity_score DESC, name ASC, p.game_id ASC, p.release_stage ASC
    ${limit}
  `;
}

function toCard(r: CardRow, resolveImage: ImageResolver): ReleaseCard {
  return {
    gameId: r.game_id,
    slug: r.slug,
    name: r.name,
    originalName: r.original_name,
    cover: resolveImage(r.cover_url, "cover"),
    date: r.release_date,
    periodStart: r.period_start,
    precision: r.precision,
    stage: r.release_stage,
    status: r.status,
    sourceStatus: r.source_status,
    platforms: r.platforms,
    popularityScore: r.popularity_score,
    heatLevel: r.heat_level,
    gameType: r.game_type,
    gameStatus: r.game_status,
    releaseEventIds: r.release_event_ids,
  };
}
