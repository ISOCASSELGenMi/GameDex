/**
 * 平台總覽與平台頁（06 §路由，Phase 3b）。mobile 平台不顯示（P35）：總覽不列、平台頁視為不存在。
 * 平台頁的遊戲清單以「該平台」的上市列為準，不用 games.firstReleaseDate（移植版的首發日是別的平台）。
 * 代表上市列的挑選**直接用聚合規則**（release-aggregate.ts 的 buildAggregateCardsQuery，platform 篩選＝本平台），
 * 不另寫挑選邏輯（原則五）：地區偏好、manual 優先、有日期優先……與月曆完全一致；一張卡＝(遊戲, 階段)。
 * upcoming／recent 用聚合的上市狀態篩選（filter.releaseStates）判斷，這裡只多加 recent 的天數下限。
 */
import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import type {
  DatePrecision,
  ImageResolver,
  IsoDate,
  PagedList,
  RegionCode,
  ResolvedReleaseFilter,
  PlatformGameItem,
  PlatformGamesSection,
  PlatformGamesSort,
  PlatformInfo,
  PlatformKind,
  PlatformKindGroup,
  PlatformListItem,
  PlatformOverviewOrder,
  PlatformStatus,
  ReleaseStage,
} from "../domain/entities";
import { PLATFORM_GROUP_KINDS, platformGroupsFor } from "../domain/platform-groups";
import { isCommonPlatform } from "./filter-options";
import { isGameGroupsBackfillDone } from "./game-groups";
import { summaryColumns, toSummary, type SummaryRow } from "./game-detail";
import { pgArray, withReadTimeout, type ReadOptions } from "./read-tx";
import { buildAggregateCardsQuery, periodEndSql, releasePicksUsable } from "./release-aggregate";

/** 總覽的分組順序（mobile 不列；other 放最後，UI 可預設收合；hybrid 不獨立成組，見 domain/platform-groups.ts）。 */
export const PLATFORM_OVERVIEW_KIND_ORDER: readonly PlatformKind[] = PLATFORM_GROUP_KINDS;

interface PlatformRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  abbreviation: string | null;
  kind: PlatformKind;
  generation: number | null;
  status: PlatformStatus;
  logo_url: string | null;
  family_slug: string | null;
  family_name: string | null;
  recent: number;
  first_release: IsoDate | null;
  first_precision: DatePrecision | null;
}

// first_release／first_precision＝平台發售日：platform_release_dates 裡最早一筆有日期的（同日取地區 id 小的）
const platformSelect = (today: IsoDate) => sql`
  SELECT pl.id, pl.slug, pl.name, pl.abbreviation, pl.kind, pl.generation, pl.status, pl.logo_url,
    pf.slug AS family_slug, pf.name AS family_name,
    COALESCE((
      SELECT count(*) FROM release_events r
      WHERE r.platform_id = pl.id AND r.release_date BETWEEN (${today}::date - 365) AND (${today}::date + 365)
    ), 0)::int AS recent,
    fr.release_date::text AS first_release, fr.precision::text AS first_precision
  FROM platforms pl LEFT JOIN platform_families pf ON pf.id = pl.family_id
  LEFT JOIN LATERAL (
    SELECT d.release_date, d.precision FROM platform_release_dates d
    WHERE d.platform_id = pl.id AND d.release_date IS NOT NULL
    ORDER BY d.release_date ASC, d.region_id ASC LIMIT 1
  ) fr ON true`;

/** 日期比較：升冪 sign=1、降冪 sign=-1；沒有日期的永遠最後。 */
function compareFirstRelease(a: IsoDate | null, b: IsoDate | null, sign: number): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a < b ? -1 : 1) * sign;
}

function toListItem(r: PlatformRow, resolveImage: ImageResolver): PlatformListItem {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    abbreviation: r.abbreviation,
    kind: r.kind,
    generation: r.generation,
    family: r.family_slug && r.family_name ? { slug: r.family_slug, name: r.family_name } : null,
    status: r.status,
    logo: resolveImage(r.logo_url, "logo"),
    logoUrl: r.logo_url,
    recentReleaseCount: r.recent,
    isCommon: isCommonPlatform(r.kind, r.recent),
    firstReleaseDate: r.first_release,
    firstReleasePrecision: r.first_precision,
  };
}

/**
 * 組內排序：預設常用在前（依近期事件數多到少），其餘世代新到舊、名稱。
 * 指定 order（平台總覽的 `sort=release&dir=`）時改依平台發售日（沒有日期的永遠最後），平手再依上面的順序。
 */
export function groupPlatformsByKind(items: readonly PlatformListItem[], order?: PlatformOverviewOrder): PlatformKindGroup[] {
  const sign = order?.dir === "asc" ? 1 : -1;
  return PLATFORM_OVERVIEW_KIND_ORDER.map((kind) => ({
    kind,
    platforms: items
      .filter((p) => platformGroupsFor(p.kind).includes(kind))
      .sort(
        (a, b) =>
          (order ? compareFirstRelease(a.firstReleaseDate, b.firstReleaseDate, sign) : 0) ||
          Number(b.isCommon) - Number(a.isCommon) ||
          (a.isCommon ? b.recentReleaseCount - a.recentReleaseCount : 0) ||
          (b.generation ?? -1) - (a.generation ?? -1) ||
          a.name.localeCompare(b.name, "en") ||
          a.slug.localeCompare(b.slug),
      ),
  })).filter((g) => g.platforms.length > 0);
}

/**
 * 平台總覽（不含 mobile），依 kind 分組。@param today UTC 日期（近期事件數的中心）。
 * @param resolveImage logo 網址 → ImageRef（Provider 實作，由 Use Case 傳入）。
 */
export async function listPlatformGroups(
  today: IsoDate,
  resolveImage: ImageResolver,
  opts: ReadOptions = {},
  order?: PlatformOverviewOrder,
): Promise<PlatformKindGroup[]> {
  const res = await withReadTimeout(
    (tx) => tx.execute<PlatformRow>(sql`${platformSelect(today)} WHERE pl.kind <> 'mobile'`),
    opts,
  );
  return groupPlatformsByKind(res.rows.map((r) => toListItem(r, resolveImage)), order);
}

export interface PlatformPageQuery {
  slug: string;
  locale: string;
  /** UTC 日期：upcoming／released 的判斷基準（聚合的 releaseStates）。 */
  today: IsoDate;
  section: PlatformGamesSection;
  sort: PlatformGamesSort;
  /** 預設 90。 */
  recentDays?: number;
  limit: number;
  offset: number;
  /**
   * 基本篩選（通常是月曆預設：可見階段、可見遊戲類型、scheduled／delayed／released、不含 rumored、含 removed）。
   * platformIds 與 releaseStates 會被這裡覆寫（本平台；upcoming／released）。
   */
  filter: ResolvedReleaseFilter;
  /** 聚合的地區偏好。 */
  regionPref: RegionCode;
  resolveImage: ImageResolver;
  /**
   * 「全部遊戲」是否使用預先計算的 release_picks 決定這一頁。未給＝backfill_game_groups 已完成才用；地區偏好不是 WW 或篩選不是預設值時一律退回即時聚合。
   * true／false＝強制（測試比對與效能量測用；true 不檢查回填是否完成）。
   */
  usePicks?: boolean;
}

interface PlatformGameRow extends SummaryRow {
  game_status: string | null;
  rep_date: IsoDate | null;
  rep_precision: DatePrecision;
  rep_stage: ReleaseStage;
}

/** 平台頁；slug 不存在或是 mobile 平台回 null。 */
export async function getPlatformPageBySlug(
  q: PlatformPageQuery,
  opts: ReadOptions = {},
): Promise<{ platform: PlatformInfo; games: PagedList<PlatformGameItem> } | null> {
  return withReadTimeout((tx) => readPlatformPage(tx, q), opts);
}

async function readPlatformPage(
  tx: DbOrTx,
  q: PlatformPageQuery,
): Promise<{ platform: PlatformInfo; games: PagedList<PlatformGameItem> } | null> {
  const res = await tx.execute<PlatformRow & { alternative_name: string | null; summary: string | null; discontinued_on: IsoDate | null }>(sql`
    SELECT x.*, p2.alternative_name, p2.summary, p2.discontinued_on::text AS discontinued_on
    FROM (${platformSelect(q.today)} WHERE pl.slug = ${q.slug} AND pl.kind <> 'mobile' LIMIT 1) x
    JOIN platforms p2 ON p2.id = x.id
  `);
  const p = res.rows[0];
  if (!p) return null;

  const datesRes = await tx.execute<{ code: string; release_date: IsoDate | null; precision: DatePrecision }>(sql`
    SELECT rg.code, d.release_date::text AS release_date, d.precision
    FROM platform_release_dates d JOIN regions rg ON rg.id = d.region_id
    WHERE d.platform_id = ${p.id}
    ORDER BY d.release_date ASC NULLS LAST, rg.code ASC
  `);

  const upcoming = q.section === "upcoming";
  const all = q.section === "all";
  const recentDays = Math.max(1, Math.floor(q.recentDays ?? 90));
  const dateDir = upcoming ? sql`ASC` : sql`DESC`;
  // 日期未定（只有 all 會出現）一律排最後
  const dateKey = sql`c.release_date ${dateDir} NULLS LAST`;
  const outerOrder =
    q.sort === "popularity"
      ? sql`g.popularity_score DESC, ${dateKey}, g.name ASC, g.id ASC, c.release_stage ASC`
      : q.sort === "name"
        ? sql`lower(COALESCE(NULLIF(g.display_names ->> ${q.locale}, ''), g.name)) ASC, g.id ASC, c.release_stage ASC`
        : sql`${dateKey}, g.popularity_score DESC, g.name ASC, g.id ASC, c.release_stage ASC`;

  // all：先用預先計算的 release_picks 決定這一頁是哪些 (遊戲, 階段)（不必挑 18 萬個鍵的代表列），
  // 再只對這一頁的遊戲跑真正的聚合查詢取卡片（代表列規則與其他頁完全相同）。篩選不是預設時退回即時聚合。
  const paged =
    all && q.regionPref === "WW" && picksFastPathOk(q.filter) && (q.usePicks ?? (await isGameGroupsBackfillDone(tx)))
      ? await readAllPagePairs(tx, q, p.id)
      : null;
  // upcoming／recent：代表日期的寬範圍：month 精度的代表日是當月 1 日，往前多 31 天才不會漏掉「本月未定日」；
  // 是否 upcoming／released 由聚合的 releaseStates 以期間結束日判斷（與月曆、時間軸同一份規則）。
  // all：不限日期、不限上市狀態，日期未定（tbd）的列也納入（排最後）。
  const cards = buildAggregateCardsQuery({
    from: all ? null : upcoming ? addDays(q.today, -31) : addDays(q.today, -(recentDays + 31)),
    to: all || upcoming ? null : q.today,
    ...(all ? { precisions: ["day", "month", "quarter", "year", "tbd"] as DatePrecision[] } : {}),
    filter: {
      ...q.filter,
      platformIds: [p.id],
      releaseStates: all ? undefined : [upcoming ? "upcoming" : "released"],
    },
    regionPref: q.regionPref,
    locale: q.locale,
    today: q.today,
    ...(paged ? { gameIds: [...new Set(paged.pairs.map((x) => x.gameId))] } : {}),
  });
  // recent 只列期間結束日在今天前 recentDays 天內的（quarter／year 的代表日已是期間最後一天）
  const recentCond =
    upcoming || all
      ? sql``
      : sql`WHERE ${periodEndSql(sql`c.precision`, sql`c.release_date::date`)} >= (${q.today}::date - ${recentDays}::int)`;

  const gamesRes = paged
    ? paged.pairs.length === 0
      ? { rows: [] as PlatformGameRow[] }
      : await tx.execute<PlatformGameRow>(sql`
          SELECT ${summaryColumns("g", q.locale)}, g.game_status,
            c.release_date AS rep_date, c.precision AS rep_precision, c.release_stage AS rep_stage
          FROM (${cards}) c JOIN games g ON g.id = c.game_id
          JOIN unnest(${pgArray(paged.pairs.map((x) => x.gameId))}::int[], ${pgArray(paged.pairs.map((x) => x.stage))}::release_stage[]) AS pg(game_id, stage)
            ON pg.game_id = c.game_id AND pg.stage = c.release_stage
          ORDER BY ${outerOrder}
        `)
    : await tx.execute<PlatformGameRow>(sql`
        SELECT ${summaryColumns("g", q.locale)}, g.game_status,
          c.release_date AS rep_date, c.precision AS rep_precision, c.release_stage AS rep_stage
        FROM (${cards}) c JOIN games g ON g.id = c.game_id
        ${recentCond}
        ORDER BY ${outerOrder}
        LIMIT ${q.limit + 1} OFFSET ${q.offset}
      `);
  const rows = gamesRes.rows.slice(0, q.limit);
  const hasMore = paged ? paged.hasMore : gamesRes.rows.length > q.limit;

  return {
    platform: {
      ...toListItem(p, q.resolveImage),
      alternativeName: p.alternative_name,
      summary: p.summary,
      discontinuedOn: p.discontinued_on,
      releaseDates: datesRes.rows.map((d) => ({ regionCode: d.code, date: d.release_date, precision: d.precision })),
    },
    games: {
      items: rows.map((r) => ({
        ...toSummary(r, q.resolveImage),
        gameStatus: r.game_status,
        date: r.rep_date,
        precision: r.rep_precision,
        stage: r.rep_stage,
      })),
      limit: q.limit,
      offset: q.offset,
      hasMore,
    },
  };
}

/** YYYY-MM-DD 加減天數（UTC）。 */
function addDays(d: IsoDate, days: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** 預先計算的 release_picks 能不能代替即時聚合：上市列篩選是預設值，且沒有其他維度的篩選。 */
function picksFastPathOk(f: ResolvedReleaseFilter): boolean {
  return (
    releasePicksUsable(f) &&
    !f.genreIds &&
    !f.themeIds &&
    !f.companyIds &&
    !f.franchiseIds &&
    !f.platformKinds &&
    f.minHeat == null
  );
}

type AllPageInput = Pick<PlatformPageQuery, "sort" | "locale" | "limit" | "offset" | "filter">;

/** 「全部遊戲」兩側共用的條件：階段（picks 側）與遊戲類型／傳聞（games 側）。 */
function allPageConds(q: AllPageInput, platformId: number): { picks: SQL[]; games: SQL[] } {
  return {
    picks: [sql`p.platform_id = ${platformId}`, sql`p.release_stage = ANY(${pgArray(q.filter.stages)}::release_stage[])`],
    games: [
      sql`COALESCE(g.game_type, 'main_game') = ANY(${pgArray(q.filter.gameTypes)}::text[])`,
      ...(q.filter.includeRumored ? [] : [sql`g.game_status IS DISTINCT FROM 'rumored'`]),
    ],
  };
}

/**
 * 排名第 (offset+limit+1) 位的排序值（日期排序＝代表日期，熱度排序＝熱度；沒有那麼多筆＝null 列）。
 * 用 LATERAL＋OFFSET 0 固定 join 順序：由有排序的 index（release_picks_platform_date_idx／games_browse_pop_idx）依序往下走，
 * 取到第 N 筆就停，成本只和 offset 成正比，不隨平台大小增加（規劃器自己選會在大 offset 時改成整個平台 hash join）。
 */
export function buildPlatformAllBoundaryQuery(q: AllPageInput, platformId: number): SQL | null {
  const c = allPageConds(q, platformId);
  const n = Math.max(0, Math.floor(q.offset + q.limit));
  if (q.sort === "date") {
    return sql`
      SELECT p.release_date::text AS v FROM release_picks p
      CROSS JOIN LATERAL (SELECT 1 FROM games g WHERE g.id = p.game_id AND ${sql.join(c.games, sql` AND `)} OFFSET 0) x
      WHERE ${sql.join(c.picks, sql` AND `)}
      ORDER BY p.release_date DESC NULLS LAST OFFSET ${n} LIMIT 1`;
  }
  if (q.sort === "popularity") {
    return sql`
      SELECT g.popularity_score::text AS v FROM games g
      CROSS JOIN LATERAL (SELECT 1 FROM release_picks p WHERE p.game_id = g.id AND ${sql.join(c.picks, sql` AND `)} OFFSET 0) x
      WHERE ${sql.join(c.games, sql` AND `)}
      ORDER BY g.popularity_score DESC NULLS LAST OFFSET ${n} LIMIT 1`;
  }
  return null;
}

/**
 * 「全部遊戲」這一頁的 (遊戲, 階段) 清單（已排序）。資料來自 release_picks（每個 (遊戲, 平台, 階段) 的代表上市列，預設地區偏好）與 games 的
 * 窄欄位 index（games_browse_cover_idx，index-only）。多取 1 筆判斷 hasMore。
 * bound：只取排序值落在邊界之前（含邊界，所以同值的平手都在內）的列——日期排序＝代表日期 ≥ 邊界（邊界為 null＝全部），熱度排序＝熱度 ≥ 邊界；
 * 候選筆數 ≈ offset+limit+平手，最後的完整排序（日期、熱度、名稱、id、階段）只在候選上做。
 */
export function buildPlatformAllPairsQuery(q: AllPageInput, platformId: number, bound?: { value: string | null } | null): SQL {
  const c = allPageConds(q, platformId);
  const conds = [...c.picks, ...c.games];
  if (bound && bound.value !== null) {
    conds.push(q.sort === "date" ? sql`p.release_date >= ${bound.value}::date` : sql`g.popularity_score >= ${Number(bound.value)}`);
  }
  const dateKey = sql`p.release_date DESC NULLS LAST`;
  const order =
    q.sort === "popularity"
      ? sql`g.popularity_score DESC NULLS LAST, ${dateKey}, g.name ASC, g.id ASC, p.release_stage ASC`
      : q.sort === "name"
        ? sql`lower(COALESCE(NULLIF(g.display_names ->> ${q.locale}, ''), g.name)) ASC, g.id ASC, p.release_stage ASC`
        : sql`${dateKey}, g.popularity_score DESC NULLS LAST, g.name ASC, g.id ASC, p.release_stage ASC`;
  return sql`
    SELECT p.game_id, p.release_stage::text AS stage
    FROM release_picks p JOIN games g ON g.id = p.game_id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY ${order}
    LIMIT ${q.limit + 1} OFFSET ${q.offset}
  `;
}

async function readAllPagePairs(
  tx: DbOrTx,
  q: PlatformPageQuery,
  platformId: number,
): Promise<{ pairs: Array<{ gameId: number; stage: ReleaseStage }>; hasMore: boolean }> {
  let bound: { value: string | null } | null = null;
  const boundary = buildPlatformAllBoundaryQuery(q, platformId);
  if (boundary) {
    const b = await tx.execute<{ v: string | null }>(boundary);
    // 沒有那麼多筆＝整個平台都在候選內（不加邊界）；有邊界值就取到邊界為止
    bound = b.rows.length > 0 ? { value: b.rows[0]!.v } : null;
  }
  const res = await tx.execute<{ game_id: number; stage: ReleaseStage }>(buildPlatformAllPairsQuery(q, platformId, bound));
  return {
    pairs: res.rows.slice(0, q.limit).map((r) => ({ gameId: r.game_id, stage: r.stage })),
    hasMore: res.rows.length > q.limit,
  };
}
