/**
 * 遊戲詳情頁的讀取（06 §遊戲詳情頁；Phase 3a，3b 補語言支援）。分數列（ratings，score 非 NULL）一併讀出，顯示規則在 domain/rating-display.ts。
 * 全部查詢在同一個唯讀 transaction（statement_timeout 保護）。
 */
import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/kernel/db/client";
import {
  GAME_COMPANY_ROLES,
  GAME_LINK_TYPES,
  RELEASE_STAGES,
  type DatePrecision,
  type ImageResolver,
  type FranchiseKind,
  type GameCompanyCredit,
  type GameCompanyRole,
  type GameDetail,
  type GameFranchiseGroup,
  type GameLink,
  type GameLinkType,
  type GameReleaseGroup,
  type GameReleaseRow,
  type GameSummary,
  type IsoDate,
  type PlatformChip,
  type PlatformKind,
  type RegionCode,
  type ReleaseStage,
  type ScoreProvider,
  type ReleaseStatus,
  type SourceStatus,
  type TaxonomyItem,
  buildLanguageSupport,
} from "../domain/entities";
import { EVENT_COLUMNS, toCalendarEvent, type EventRow } from "./calendar-events";
import { readLanguageSupportEntries } from "./language-support";
import { pgArray, toIso, withReadTimeout, type ReadOptions } from "./read-tx";

export interface GameDetailQuery {
  slug: string;
  locale: string;
  regionPref: RegionCode;
  /** 同系列作品只列這些遊戲類型（避免 DLC 洗版）；通常是 CALENDAR_VISIBLE_GAME_TYPES。 */
  franchiseGameTypes: readonly string[];
  /** 每個系列最多幾款，預設 20。 */
  franchiseLimit?: number;
  /** 相似遊戲上限，預設 12。 */
  similarLimit?: number;
  /** DLC 上限，預設 50。 */
  dlcLimit?: number;
  /** 即將亮相的活動上限，預設 10。 */
  eventLimit?: number;
  /** 「現在」（活動是否已結束的基準）；測試用，預設資料庫 now()。 */
  now?: Date;
  /** 已存圖片網址 → ImageRef（Provider 實作，由 Use Case 傳入；Repository 不知道來源網址格式）。 */
  resolveImage: ImageResolver;
}

export interface SummaryRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  original_name: string;
  cover_url: string | null;
  first_release_date: IsoDate | null;
  first_release_precision: DatePrecision | null;
  game_type: string;
  popularity_score: number;
}

/** 遊戲摘要欄位（平台／公司／系列／活動頁共用）。 */
export const summaryColumns = (alias: string, locale: string): SQL => {
  const a = sql.raw(alias);
  return sql`${a}.id, ${a}.slug,
    COALESCE(NULLIF(${a}.display_names ->> ${locale}, ''), ${a}.name) AS name,
    ${a}.name AS original_name, ${a}.cover_url,
    ${a}.first_release_date::text AS first_release_date, ${a}.first_release_precision,
    COALESCE(${a}.game_type, 'main_game') AS game_type, ${a}.popularity_score`;
};

export function toSummary(r: SummaryRow, resolveImage: ImageResolver): GameSummary {
  return {
    gameId: r.id,
    slug: r.slug,
    name: r.name,
    originalName: r.original_name,
    cover: resolveImage(r.cover_url, "cover"),
    firstReleaseDate: r.first_release_date,
    firstReleasePrecision: r.first_release_precision,
    gameType: r.game_type,
    popularityScore: r.popularity_score,
  };
}

interface GameRow extends SummaryRow {
  igdb_id: number;
  summary: string | null;
  screenshot_urls: string[] | null;
  trailer_url: string | null;
  age_rating_label: string | null;
  game_status: string | null;
  heat_level: number;
  parent_game_id: number | null;
}

interface ReleaseRow extends Record<string, unknown> {
  id: number;
  region_code: string;
  release_stage: ReleaseStage;
  release_date: IsoDate | null;
  period_start: IsoDate | null;
  precision: DatePrecision;
  status: ReleaseStatus;
  source_status: SourceStatus;
  source: string;
  platform_slug: string;
  platform_name: string;
  platform_abbreviation: string | null;
  platform_kind: PlatformKind;
}

interface RatingRow extends Record<string, unknown> {
  score_provider: ScoreProvider;
  score_type: string;
  score: number;
  score_max: number;
  review_count: number | null;
  platform_id: number | null;
  source_url: string | null;
}

interface HistoryRow extends Record<string, unknown> {
  release_event_id: number;
  old_date: IsoDate | null;
  old_precision: DatePrecision | null;
  new_date: IsoDate | null;
  new_precision: DatePrecision | null;
  changed_at: Date | null;
}

/** 依 slug 讀取詳情；找不到回 null。 */
export async function getGameDetailBySlug(q: GameDetailQuery, opts: ReadOptions = {}): Promise<GameDetail | null> {
  return withReadTimeout((tx) => readDetail(tx, q), opts);
}

async function readDetail(tx: DbOrTx, q: GameDetailQuery): Promise<GameDetail | null> {
  const { locale } = q;
  const gameRes = await tx.execute<GameRow>(sql`
    SELECT ${summaryColumns("g", locale)}, g.igdb_id, g.summary, g.screenshot_urls, g.trailer_url,
      g.age_rating_label, g.game_status, g.heat_level, g.parent_game_id
    FROM games g WHERE g.slug = ${q.slug} LIMIT 1
  `);
  const g = gameRes.rows[0];
  if (!g) return null;
  const id = g.id;
  const now = q.now ? sql`${q.now.toISOString()}::timestamptz` : sql`now()`;

  const platformsRes = await tx.execute<{ slug: string; name: string; abbreviation: string | null; kind: PlatformKind }>(sql`
    SELECT pl.slug, pl.name, pl.abbreviation, pl.kind
    FROM game_platforms gp JOIN platforms pl ON pl.id = gp.platform_id
    WHERE gp.game_id = ${id} AND pl.kind <> 'mobile'
    ORDER BY pl.name, pl.id
  `);

  const taxRes = await tx.execute<{ dim: "genre" | "theme"; slug: string; name: string }>(sql`
    SELECT 'genre' AS dim, x.slug, x.name FROM game_genres gx JOIN genres x ON x.id = gx.genre_id WHERE gx.game_id = ${id}
    UNION ALL
    SELECT 'theme' AS dim, x.slug, x.name FROM game_themes gx JOIN themes x ON x.id = gx.theme_id WHERE gx.game_id = ${id}
    ORDER BY 1, 3
  `);

  const releaseRes = await tx.execute<ReleaseRow>(sql`
    SELECT r.id, rg.code AS region_code, r.release_stage, r.release_date::text AS release_date,
      r.period_start::text AS period_start, r.precision, r.status, r.source_status,
      COALESCE(r.source, 'igdb') AS source,
      pl.slug AS platform_slug, pl.name AS platform_name, pl.abbreviation AS platform_abbreviation, pl.kind AS platform_kind
    FROM release_events r
    JOIN platforms pl ON pl.id = r.platform_id
    JOIN regions rg ON rg.id = r.region_id
    WHERE r.game_id = ${id} AND pl.kind <> 'mobile'
  `);
  const releaseIds = releaseRes.rows.map((r) => r.id);
  const historyRes =
    releaseIds.length === 0
      ? { rows: [] as HistoryRow[] }
      : await tx.execute<HistoryRow>(sql`
          SELECT h.release_event_id, h.old_date::text AS old_date, h.old_precision,
            h.new_date::text AS new_date, h.new_precision, h.changed_at
          FROM release_date_history h
          WHERE h.release_event_id = ANY(${pgArray(releaseIds)}::int[])
          ORDER BY h.changed_at ASC NULLS FIRST, h.id ASC
        `);

  const companyRes = await tx.execute<{ slug: string; name: string; role: GameCompanyRole }>(sql`
    SELECT c.slug, c.name, gc.role
    FROM game_companies gc JOIN companies c ON c.id = gc.company_id
    WHERE gc.game_id = ${id}
    ORDER BY c.name, c.id
  `);

  const linkRes = await tx.execute<{ link_type: GameLinkType; category_label: string; url: string; is_broken: boolean }>(sql`
    SELECT l.link_type, l.category_label, l.url, l.is_broken
    FROM game_external_links l WHERE l.game_id = ${id}
    ORDER BY l.id
  `);

  const parentRes =
    g.parent_game_id == null
      ? { rows: [] as SummaryRow[] }
      : await tx.execute<SummaryRow>(sql`
          SELECT ${summaryColumns("p", locale)} FROM games p WHERE p.igdb_id = ${g.parent_game_id} LIMIT 1
        `);

  const franchiseLimit = q.franchiseLimit ?? 20;
  const franchiseRes = await tx.execute<
    { f_id: number; f_slug: string; f_name: string; f_kind: FranchiseKind } & Partial<SummaryRow>
  >(sql`
    SELECT f.id AS f_id, f.slug AS f_slug, f.name AS f_name, f.kind AS f_kind, s.*
    FROM game_franchises gf
    JOIN franchises f ON f.id = gf.franchise_id
    LEFT JOIN LATERAL (
      SELECT ${summaryColumns("g2", locale)}, g2.first_release_date AS sort_date
      FROM game_franchises gf2 JOIN games g2 ON g2.id = gf2.game_id
      WHERE gf2.franchise_id = f.id AND gf2.game_id <> ${id}
        AND COALESCE(g2.game_type, 'main_game') = ANY(${pgArray(q.franchiseGameTypes)}::text[])
      ORDER BY g2.first_release_date ASC NULLS LAST, g2.name ASC, g2.id ASC
      LIMIT ${franchiseLimit}
    ) s ON TRUE
    WHERE gf.game_id = ${id}
    ORDER BY f.kind, f.name, f.id, s.sort_date ASC NULLS LAST, s.original_name ASC, s.id ASC
  `);

  const similarRes = await tx.execute<SummaryRow>(sql`
    SELECT ${summaryColumns("s", locale)}
    FROM game_similar_games gs JOIN games s ON s.id = gs.similar_game_id
    WHERE gs.game_id = ${id}
    ORDER BY s.popularity_score DESC, s.first_release_date DESC NULLS LAST, s.name ASC, s.id ASC
    LIMIT ${q.similarLimit ?? 12}
  `);

  const dlcRes = await tx.execute<SummaryRow>(sql`
    SELECT ${summaryColumns("d", locale)}
    FROM games d
    WHERE d.parent_game_id = ${g.igdb_id} AND d.id <> ${id}
    ORDER BY d.first_release_date ASC NULLS LAST, d.name ASC, d.id ASC
    LIMIT ${q.dlcLimit ?? 50}
  `);

  const eventRes = await tx.execute<EventRow>(sql`
    SELECT ${EVENT_COLUMNS}
    FROM event_games eg JOIN events e ON e.id = eg.event_id
    WHERE eg.game_id = ${id} AND COALESCE(e.end_time, e.start_time) >= ${now}
    ORDER BY e.start_time ASC, e.id ASC
    LIMIT ${q.eventLimit ?? 10}
  `);

  const languageEntries = await readLanguageSupportEntries(tx, id);

  // 分數：score=NULL（負向快取、分數消失）的列不是分數，不讀
  const ratingRes = await tx.execute<RatingRow>(sql`
    SELECT r.score_provider, r.score_type, r.score, COALESCE(r.score_max, 100) AS score_max, r.review_count,
      r.platform_id, r.source_url
    FROM ratings r WHERE r.game_id = ${id} AND r.score IS NOT NULL
      AND r.score_provider::text <> 'site_players' -- 站內玩家平均走 accounts 的 game.sections（06）；ratings 裡這列只給評分排名頁用
    ORDER BY r.id
  `);

  const taxonomy = (dim: "genre" | "theme"): TaxonomyItem[] =>
    taxRes.rows.filter((r) => r.dim === dim).map((r) => ({ slug: r.slug, name: r.name }));
  const companies = groupCompanies(companyRes.rows);

  return {
    gameId: id,
    igdbId: g.igdb_id,
    slug: g.slug,
    name: g.name,
    originalName: g.original_name,
    summary: g.summary,
    cover: q.resolveImage(g.cover_url, "cover"),
    screenshots: (g.screenshot_urls ?? [])
      .map((u) => q.resolveImage(u, "screenshot"))
      .filter((x): x is NonNullable<typeof x> => x != null),
    trailerUrl: g.trailer_url,
    ageRatingLabel: g.age_rating_label,
    gameType: g.game_type,
    gameStatus: g.game_status,
    firstReleaseDate: g.first_release_date,
    firstReleasePrecision: g.first_release_precision,
    popularityScore: g.popularity_score,
    heatLevel: g.heat_level,
    platforms: platformsRes.rows.map((p) => ({ slug: p.slug, name: p.name, abbreviation: p.abbreviation, kind: p.kind })),
    genres: taxonomy("genre"),
    themes: taxonomy("theme"),
    releaseGroups: groupReleases(releaseRes.rows, historyRes.rows, q.regionPref),
    developers: companies.filter((c) => c.roles.includes("developer")),
    publishers: companies.filter((c) => c.roles.includes("publisher")),
    companies,
    links: sortLinks(
      linkRes.rows.map((l) => ({ linkType: l.link_type, categoryLabel: l.category_label, url: l.url, isBroken: l.is_broken })),
    ),
    parent: parentRes.rows[0] ? toSummary(parentRes.rows[0], q.resolveImage) : null,
    franchises: groupFranchises(franchiseRes.rows, q.resolveImage),
    similarGames: similarRes.rows.map((r) => toSummary(r, q.resolveImage)),
    dlcs: dlcRes.rows.map((r) => toSummary(r, q.resolveImage)),
    upcomingEvents: eventRes.rows.map((r) => toCalendarEvent(r, q.resolveImage)),
    languageSupport: buildLanguageSupport(languageEntries, locale),
    ratings: ratingRes.rows.map((r) => ({
      scoreProvider: r.score_provider,
      scoreType: r.score_type,
      score: r.score,
      scoreMax: r.score_max,
      reviewCount: r.review_count,
      platformId: r.platform_id,
      sourceUrl: r.source_url,
    })),
  };
}

// ── 純函式（排序與分組）────────────────────────────────────────────────

const STAGE_ORDER = new Map(RELEASE_STAGES.map((s, i) => [s, i]));
const ROLE_ORDER = new Map(GAME_COMPANY_ROLES.map((r, i) => [r, i]));

/**
 * 詳情頁要列出的上市列（使用者 2026-10-15 決定）：
 * - 同 (平台, 地區, 階段) 有 active 的 manual 列 → 隱藏 igdb 那筆（人工更正取代顯示；IGDB 之後有日期更新時由同步把 manual 標 removed，
 *   見 release-events.ts applyReleaseDiffPlan）。
 * - sourceStatus='removed' 的 manual 列不顯示（被覆蓋或下架）。
 * 與聚合（release-aggregate.ts）同一個優先序：active 優先於 removed，其次 manual 優先於 igdb。
 */
export function visibleReleaseRows(rows: readonly ReleaseRow[]): ReleaseRow[] {
  const key = (r: ReleaseRow) => `${r.platform_slug}:${r.region_code}:${r.release_stage}`;
  const manualActive = new Set(rows.filter((r) => r.source === "manual" && r.source_status === "active").map(key));
  return rows.filter((r) => (r.source === "manual" ? r.source_status === "active" : !manualActive.has(key(r))));
}

/** 依平台分行；平台內：偏好地區 → WW → 其他（依代表日期，tbd 最後）→ 階段 → id。同鍵 manual 隱藏 igdb 列（visibleReleaseRows）。 */
export function groupReleases(allRows: readonly ReleaseRow[], history: readonly HistoryRow[], regionPref: RegionCode): GameReleaseGroup[] {
  const rows = visibleReleaseRows(allRows);
  const hist = new Map<number, GameReleaseRow["history"]>();
  for (const h of history) {
    const list = hist.get(h.release_event_id) ?? [];
    list.push({
      oldDate: h.old_date,
      oldPrecision: h.old_precision,
      newDate: h.new_date,
      newPrecision: h.new_precision,
      changedAt: toIso(h.changed_at),
    });
    hist.set(h.release_event_id, list);
  }
  const regionRank = (code: string) => (code === regionPref ? 0 : code === "WW" ? 1 : 2);
  const groups = new Map<string, { platform: PlatformChip; rows: ReleaseRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.platform_slug) ?? {
      platform: { slug: r.platform_slug, name: r.platform_name, abbreviation: r.platform_abbreviation, kind: r.platform_kind },
      rows: [],
    };
    g.rows.push(r);
    groups.set(r.platform_slug, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.platform.name.localeCompare(b.platform.name, "en") || a.platform.slug.localeCompare(b.platform.slug))
    .map(({ platform, rows: list }) => ({
      platform,
      releases: [...list]
        .sort(
          (a, b) =>
            regionRank(a.region_code) - regionRank(b.region_code) ||
            compareNullableDate(a.release_date, b.release_date) ||
            a.region_code.localeCompare(b.region_code) ||
            (STAGE_ORDER.get(a.release_stage) ?? 99) - (STAGE_ORDER.get(b.release_stage) ?? 99) ||
            a.id - b.id,
        )
        .map((r) => ({
          releaseEventId: r.id,
          regionCode: r.region_code,
          stage: r.release_stage,
          date: r.release_date,
          periodStart: r.period_start,
          precision: r.precision,
          status: r.status,
          sourceStatus: r.source_status,
          source: r.source,
          history: hist.get(r.id) ?? [],
        })),
    }));
}

function compareNullableDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

export function groupCompanies(rows: ReadonlyArray<{ slug: string; name: string; role: GameCompanyRole }>): GameCompanyCredit[] {
  const map = new Map<string, GameCompanyCredit>();
  for (const r of rows) {
    const c = map.get(r.slug) ?? { slug: r.slug, name: r.name, roles: [] };
    if (!c.roles.includes(r.role)) c.roles.push(r.role);
    map.set(r.slug, c);
  }
  for (const c of map.values()) c.roles.sort((a, b) => (ROLE_ORDER.get(a) ?? 99) - (ROLE_ORDER.get(b) ?? 99));
  return [...map.values()];
}

const LINK_TYPE_ORDER = new Map(GAME_LINK_TYPES.map((t, i) => [t, i]));
/** 同類型內的固定順序（未列者依名稱排在後面，'other' 最後）。 */
const CATEGORY_ORDER = [
  "steam", "playstation_store", "xbox_store", "nintendo_eshop", "epic", "gog", "microsoft_store", "itch", "meta",
  "gamejolt", "google_play", "app_store",
  "official_website",
  "discord", "twitter", "bluesky", "facebook", "instagram", "subreddit",
  "youtube", "twitch", "wikipedia", "community_wiki", "giantbomb",
];
const CATEGORY_RANK = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));

/**
 * 商店 → 官網 → 社群 → 媒體；同類型依固定分類順序。
 * 資料沒有地區欄位（IGDB 連結不分區），所以 06 的「依偏好地區排序」目前無從套用（見報告待決）。
 * 失效連結（isBroken）排在同類型最後。
 */
export function sortLinks(links: readonly GameLink[]): GameLink[] {
  const rank = (c: string) => (c === "other" ? 1000 : (CATEGORY_RANK.get(c) ?? 500));
  return [...links].sort(
    (a, b) =>
      (LINK_TYPE_ORDER.get(a.linkType) ?? 99) - (LINK_TYPE_ORDER.get(b.linkType) ?? 99) ||
      Number(a.isBroken) - Number(b.isBroken) ||
      rank(a.categoryLabel) - rank(b.categoryLabel) ||
      a.categoryLabel.localeCompare(b.categoryLabel) ||
      a.url.localeCompare(b.url),
  );
}

function groupFranchises(
  rows: ReadonlyArray<{ f_id: number; f_slug: string; f_name: string; f_kind: FranchiseKind } & Partial<SummaryRow>>,
  resolveImage: ImageResolver,
): GameFranchiseGroup[] {
  const map = new Map<number, GameFranchiseGroup>();
  for (const r of rows) {
    const grp = map.get(r.f_id) ?? { slug: r.f_slug, name: r.f_name, kind: r.f_kind, games: [] };
    if (r.id != null) grp.games.push(toSummary(r as SummaryRow, resolveImage));
    map.set(r.f_id, grp);
  }
  return [...map.values()];
}
