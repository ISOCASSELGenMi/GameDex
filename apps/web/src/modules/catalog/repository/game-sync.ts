/**
 * 同步一款 IGDB 遊戲（04 §各類資料的寫入規則）：遊戲本體與全部關聯在同一個 transaction 寫完。
 * 關聯 id（平台、公司…）由 Use Case 先對應好；這裡只負責持久化與「同步只動 igdb 列」的規則
 * （上市日例外：IGDB 對同鍵日期有更新時，同交易把 active 的 manual 列標 removed，見 release-events.ts applyReleaseDiffPlan）。
 */
import { and, eq, inArray, isNotNull, ne, notInArray, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type {
  DatePrecision,
  GameCompanyRole,
  GameLinkRecord,
  GameStatus,
  GameType,
  IsoDate,
  LanguageSupportType,
} from "../domain/entities";
import { planReleaseEventDiff, type DesiredRelease } from "../domain/release-diff";
import { resolveDisplayNames } from "../domain/display-names";
import { releaseGroupKey } from "../domain/game-group-keys";
import { buildSearchText } from "../domain/search-text";
import {
  externalIds,
  gameCompanies,
  gameExternalLinks,
  gameFranchises,
  gameGameEngines,
  gameGameModes,
  gameGenres,
  gameLanguageSupports,
  gameLocalizations,
  gamePlatforms,
  gamePlayerPerspectives,
  gameThemes,
  games,
  ratings,
} from "../schema";
import { computePublisherGroups } from "./game-groups";
import { upsertRating } from "./ratings";
import { applyReleaseDiffPlan, listIgdbReleaseRows, type ReleaseDiffApplyStats } from "./release-events";

/** 詳情頁補欄位（storyline、版本、遊戲人數、視角、引擎）；關聯 id 由 Use Case 先對應成我方 id。 */
export interface GameDetailFieldsInput {
  igdbId: number;
  storyline: string | null;
  versionParentId: number | null;
  versionTitle: string | null;
  gameModeIds: number[];
  playerPerspectiveIds: number[];
  engineIds: number[];
}

export interface IgdbGameSyncInput {
  igdbId: number;
  name: string;
  slug: string;
  summary: string | null;
  coverUrl: string | null;
  firstReleaseDate: IsoDate | null;
  firstReleasePrecision: DatePrecision | null;
  gameType: GameType;
  gameStatus: GameStatus | null;
  /** 本體遊戲的 IGDB id（03：刻意不設 FK，本體可能尚未同步）。 */
  parentGameId: number | null;
  alternativeNames: { name: string; comment: string | null }[];
  screenshotUrls: string[];
  trailerUrl: string | null;
  similarIgdbIds: number[];
  detail: GameDetailFieldsInput;
  platformIds: number[];
  genreIds: number[];
  themeIds: number[];
  franchiseIds: number[];
  /** igdbPosition＝IGDB involved_companies 的位置（0 起算）；省略＝NULL。 */
  companies: Array<{ companyId: number; role: GameCompanyRole; igdbPosition?: number | null }>;
  localizations: Array<{ localeCode: string; name: string; coverUrl: string | null }>;
  languageSupports: Array<{ languageId: number; supportType: LanguageSupportType }>;
  links: GameLinkRecord[];
  steamAppId: string | null;
  criticScore: { score: number; reviewCount: number } | null;
  releases: DesiredRelease[];
  sourceUpdatedAt: Date | null;
}

export interface IgdbGameSyncResult {
  gameId: number;
  inserted: boolean;
  slug: string;
  releases: ReleaseDiffApplyStats & {
    unchanged: number;
    duplicatesDropped: number;
    /** 來源資料造成的變動筆數：新增、日期／階段改變、removed／restored（不含只有狀態推進）。滾動校對監控用。 */
    sourceChanges: number;
  };
}

const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];

export interface IgdbGameSyncOptions {
  /** UTC 日期；diff 判斷「已過」與遊戲層級 cancelled 用（04）。 */
  today: IsoDate;
  /** 來源沒給的既有上市日標 removed；回填傳 false（只 upsert）。預設 true。 */
  markMissingRemoved?: boolean;
}

/** 同一款遊戲的寫入互斥鎖（回填與增量同步可能同時寫同一款；release_events 刻意沒有 unique）。 */
const GAME_WRITE_LOCK_SPACE = 0x50a6e;

export async function syncIgdbGame(
  input: IgdbGameSyncInput,
  opts: IgdbGameSyncOptions,
  db: DbOrTx = getDb(),
): Promise<IgdbGameSyncResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GAME_WRITE_LOCK_SPACE}::int, ${input.igdbId}::int)`);

    // ── 遊戲本體 ──
    const [taken] = await tx.select({ igdbId: games.igdbId }).from(games).where(eq(games.slug, input.slug)).limit(1);
    const slug = taken && taken.igdbId !== input.igdbId ? `${input.slug}-${input.igdbId}` : input.slug;
    const values = {
      name: input.name,
      slug,
      summary: input.summary,
      coverUrl: input.coverUrl,
      firstReleaseDate: input.firstReleaseDate,
      firstReleasePrecision: input.firstReleasePrecision,
      releaseGroup: releaseGroupKey(input.firstReleaseDate, input.firstReleasePrecision),
      gameType: input.gameType,
      gameStatus: input.gameStatus,
      parentGameId: input.parentGameId,
      alternativeNames: input.alternativeNames,
      screenshotUrls: input.screenshotUrls,
      trailerUrl: input.trailerUrl,
      similarIgdbIds: uniq(input.similarIgdbIds),
      storyline: input.detail.storyline,
      versionParentId: input.detail.versionParentId,
      versionTitle: input.detail.versionTitle,
      lastFullSyncAt: new Date(),
    };
    const [row] = await tx
      .insert(games)
      .values({ ...values, igdbId: input.igdbId })
      .onConflictDoUpdate({ target: games.igdbId, set: { ...values, updatedAt: new Date() } })
      .returning({ id: games.id, inserted: sql<boolean>`(xmax = 0)` });
    const gameId = row.id;

    // ── 純 IGDB 的中介表（沒有 source 欄位）：整組取代 ──
    await tx.delete(gamePlatforms).where(eq(gamePlatforms.gameId, gameId));
    const platformRows = uniq(input.platformIds).map((platformId) => ({ gameId, platformId }));
    if (platformRows.length > 0) await tx.insert(gamePlatforms).values(platformRows);

    await tx.delete(gameGenres).where(eq(gameGenres.gameId, gameId));
    const genreRows = uniq(input.genreIds).map((genreId) => ({ gameId, genreId }));
    if (genreRows.length > 0) await tx.insert(gameGenres).values(genreRows);

    await tx.delete(gameThemes).where(eq(gameThemes.gameId, gameId));
    const themeRows = uniq(input.themeIds).map((themeId) => ({ gameId, themeId }));
    if (themeRows.length > 0) await tx.insert(gameThemes).values(themeRows);

    await replaceDetailRelations(tx, gameId, input.detail);

    await tx.delete(gameFranchises).where(eq(gameFranchises.gameId, gameId));
    const franchiseRows = uniq(input.franchiseIds).map((franchiseId) => ({ gameId, franchiseId }));
    if (franchiseRows.length > 0) await tx.insert(gameFranchises).values(franchiseRows);

    await tx.delete(gameCompanies).where(eq(gameCompanies.gameId, gameId));
    const companyRows = uniqueRows(input.companies, (c) => `${c.companyId}:${c.role}`).map((c) => ({ gameId, ...c }));
    if (companyRows.length > 0) await tx.insert(gameCompanies).values(companyRows);

    // ── 有 source 欄位的表：只動 igdb 列 ──
    await syncLocalizations(tx, gameId, input.localizations);
    await tx
      .delete(gameLanguageSupports)
      .where(and(eq(gameLanguageSupports.gameId, gameId), eq(gameLanguageSupports.source, "igdb")));
    const langs = uniqueRows(input.languageSupports, (l) => `${l.languageId}:${l.supportType}`);
    if (langs.length > 0) {
      await tx
        .insert(gameLanguageSupports)
        .values(langs.map((l) => ({ gameId, ...l, source: "igdb" })))
        .onConflictDoNothing();
    }
    await syncExternalLinks(tx, gameId, input.links);
    await syncSteamId(tx, gameId, input.steamAppId);
    await syncCriticScore(tx, gameId, input.criticScore);

    // ── 上市事件 diff ──
    const existing = await listIgdbReleaseRows(gameId, tx);
    const plan = planReleaseEventDiff(existing, input.releases, {
      today: opts.today,
      gameCancelled: input.gameStatus === "cancelled",
      markMissingRemoved: opts.markMissingRemoved,
    });
    const applied = await applyReleaseDiffPlan(tx, gameId, plan, input.sourceUpdatedAt);

    // ── 衍生欄位：顯示名稱（人工優先）與搜尋字串 ──
    const locs = await tx
      .select({ localeCode: gameLocalizations.localeCode, name: gameLocalizations.name, source: gameLocalizations.source })
      .from(gameLocalizations)
      .where(eq(gameLocalizations.gameId, gameId));
    const displayNames = resolveDisplayNames(locs, input.alternativeNames);
    const searchText = buildSearchText([input.name, ...input.alternativeNames.map((a) => a.name), ...locs.map((l) => l.name)]);
    // 預先計算的廠商欄（games.publisher_group）；日期組 release_group 已隨本體 upsert 寫入
    const publisherGroup = (await computePublisherGroups(tx, [gameId])).get(gameId) ?? -1;
    await tx.update(games).set({ displayNames, searchText, publisherGroup }).where(eq(games.id, gameId));

    return {
      gameId,
      inserted: row.inserted,
      slug,
      releases: {
        ...applied,
        unchanged: plan.unchanged,
        duplicatesDropped: plan.duplicatesDropped,
        sourceChanges:
          plan.creates.length + plan.updates.filter((u) => u.dateChanged || u.stageChanged || u.sourceStatusChanged).length,
      },
    };
  });
}

/** 遊戲人數／玩家視角／引擎三個中介表整組取代（純 IGDB，沒有 source 欄位）。 */
async function replaceDetailRelations(tx: DbOrTx, gameId: number, d: GameDetailFieldsInput): Promise<void> {
  await tx.delete(gameGameModes).where(eq(gameGameModes.gameId, gameId));
  const modes = uniq(d.gameModeIds).map((gameModeId) => ({ gameId, gameModeId }));
  if (modes.length > 0) await tx.insert(gameGameModes).values(modes);

  await tx.delete(gamePlayerPerspectives).where(eq(gamePlayerPerspectives.gameId, gameId));
  const perspectives = uniq(d.playerPerspectiveIds).map((playerPerspectiveId) => ({ gameId, playerPerspectiveId }));
  if (perspectives.length > 0) await tx.insert(gamePlayerPerspectives).values(perspectives);

  await tx.delete(gameGameEngines).where(eq(gameGameEngines.gameId, gameId));
  const engines = uniq(d.engineIds).map((gameEngineId) => ({ gameId, gameEngineId }));
  if (engines.length > 0) await tx.insert(gameGameEngines).values(engines);
}

/**
 * 只更新詳情補欄位（backfill_detail_fields）：已存在的遊戲才處理，不碰其他欄位、不寫 change_feed、不動 updatedAt／lastFullSyncAt。
 * 與 syncIgdbGame 共用 replaceDetailRelations（同一份寫入邏輯）。
 * @returns 遊戲不在資料庫（尚未同步）時 false
 */
export async function syncGameDetailFields(d: GameDetailFieldsInput, db: DbOrTx = getDb()): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GAME_WRITE_LOCK_SPACE}::int, ${d.igdbId}::int)`);
    const rows = await tx
      .update(games)
      .set({
        storyline: d.storyline,
        versionParentId: d.versionParentId,
        versionTitle: d.versionTitle,
        updatedAt: games.updatedAt, // 明確保留（欄位有 $onUpdate 預設，不明寫會被改成現在）
      })
      .where(eq(games.igdbId, d.igdbId))
      .returning({ id: games.id });
    if (rows.length === 0) return false;
    await replaceDetailRelations(tx, rows[0].id, d);
    return true;
  });
}

/** 依 igdb_id 升冪取下一批已存在遊戲的 igdb_id（回填游標用）。 */
export async function listGameIgdbIdsAfter(afterId: number, limit: number, db: DbOrTx = getDb()): Promise<number[]> {
  const rows = await db
    .select({ igdbId: games.igdbId })
    .from(games)
    .where(sql`${games.igdbId} > ${afterId}`)
    .orderBy(games.igdbId)
    .limit(limit);
  return rows.map((r) => r.igdbId);
}

/**
 * 來源已查不到的遊戲（滾動校對以 id 重抓沒回來，2026-10-13 使用者決定）：
 * 遊戲列保留（可能有收藏／追蹤），尚未上市（status ≠ released）的 igdb 上市列標 removed（history／change_feed 規則同 diff），
 * 並更新 lastFullSyncAt，避免每晚重複挑到。
 * @returns 標 removed 的筆數
 */
export async function markIgdbGameMissing(
  gameId: number,
  igdbId: number,
  opts: Pick<IgdbGameSyncOptions, "today">,
  db: DbOrTx = getDb(),
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GAME_WRITE_LOCK_SPACE}::int, ${igdbId}::int)`);
    const pending = (await listIgdbReleaseRows(gameId, tx)).filter((r) => r.status !== "released");
    const plan = planReleaseEventDiff(pending, [], { today: opts.today, gameCancelled: false, markMissingRemoved: true });
    const applied = await applyReleaseDiffPlan(tx, gameId, plan, null);
    await tx.update(games).set({ lastFullSyncAt: new Date() }).where(eq(games.id, gameId));
    return applied.removed;
  });
}

function uniqueRows<T>(rows: readonly T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) if (!m.has(key(r))) m.set(key(r), r);
  return [...m.values()];
}

/** igdb 列 upsert（人工列不覆蓋），這次沒出現的語系刪除 igdb 列。 */
async function syncLocalizations(
  tx: DbOrTx,
  gameId: number,
  items: IgdbGameSyncInput["localizations"],
): Promise<void> {
  const rows = uniqueRows(items, (l) => l.localeCode);
  await tx
    .delete(gameLocalizations)
    .where(
      and(
        eq(gameLocalizations.gameId, gameId),
        eq(gameLocalizations.source, "igdb"),
        rows.length > 0 ? notInArray(gameLocalizations.localeCode, rows.map((r) => r.localeCode)) : undefined,
      ),
    );
  if (rows.length === 0) return;
  await tx
    .insert(gameLocalizations)
    .values(rows.map((r) => ({ gameId, ...r, source: "igdb" })))
    .onConflictDoUpdate({
      target: [gameLocalizations.gameId, gameLocalizations.localeCode],
      set: { name: sql`excluded.name`, coverUrl: sql`excluded.cover_url` },
      setWhere: sql`${gameLocalizations.source} <> 'manual'`,
    });
}

/**
 * 以 (gameId, categoryLabel) 對應既有 igdb 列（04）：網址相同保留失效檢查結果；網址變了重設；
 * 這次沒出現的分類刪除；同分類多筆只留一筆。人工列不動。
 */
async function syncExternalLinks(tx: DbOrTx, gameId: number, links: readonly GameLinkRecord[]): Promise<void> {
  const desired = uniqueRows(links, (l) => l.categoryLabel);
  const existing = await tx
    .select({ id: gameExternalLinks.id, categoryLabel: gameExternalLinks.categoryLabel, url: gameExternalLinks.url })
    .from(gameExternalLinks)
    .where(and(eq(gameExternalLinks.gameId, gameId), eq(gameExternalLinks.source, "igdb")))
    .orderBy(gameExternalLinks.id);

  const keep = new Map<string, { id: number; url: string }>();
  const drop: number[] = [];
  const wanted = new Set(desired.map((d) => d.categoryLabel));
  for (const e of existing) {
    if (!wanted.has(e.categoryLabel) || keep.has(e.categoryLabel)) drop.push(e.id);
    else keep.set(e.categoryLabel, e);
  }
  if (drop.length > 0) await tx.delete(gameExternalLinks).where(inArray(gameExternalLinks.id, drop));

  const inserts: Array<typeof gameExternalLinks.$inferInsert> = [];
  for (const d of desired) {
    const cur = keep.get(d.categoryLabel);
    const fields = { linkType: d.linkType, igdbCategory: d.igdbCategory, igdbOrigin: d.igdbOrigin, url: d.url };
    if (!cur) inserts.push({ gameId, categoryLabel: d.categoryLabel, ...fields, source: "igdb" });
    else if (cur.url !== d.url) {
      await tx
        .update(gameExternalLinks)
        .set({ ...fields, lastCheckedAt: null, isBroken: false })
        .where(eq(gameExternalLinks.id, cur.id));
    } else {
      await tx.update(gameExternalLinks).set(fields).where(eq(gameExternalLinks.id, cur.id));
    }
  }
  if (inserts.length > 0) await tx.insert(gameExternalLinks).values(inserts);
}

/** Steam AppID → external_ids（confidencePct=100）；人工配對（matchMethod='manual'）不覆寫。來源拿掉時不刪（保留比對結果）。 */
async function syncSteamId(tx: DbOrTx, gameId: number, appId: string | null): Promise<void> {
  if (!appId) return;
  await tx
    .insert(externalIds)
    .values({
      gameId,
      source: "steam",
      externalId: appId,
      externalUrl: `https://store.steampowered.com/app/${appId}`,
      confidencePct: 100,
      needsReview: false,
      matchMethod: "auto",
    })
    .onConflictDoUpdate({
      target: [externalIds.gameId, externalIds.source],
      set: {
        externalId: sql`excluded.external_id`,
        externalUrl: sql`excluded.external_url`,
        confidencePct: 100,
        needsReview: false,
        matchedAt: new Date(),
      },
      setWhere: and(ne(externalIds.matchMethod, "manual"), ne(externalIds.externalId, sql`excluded.external_id`)),
    });
}

/**
 * IGDB 分數（05）：有分數 → upsert；沒有分數但先前有 → 寫 score=NULL（保留 snapshot 歷史）；都沒有 → 不寫列。
 */
async function syncCriticScore(tx: DbOrTx, gameId: number, score: IgdbGameSyncInput["criticScore"]): Promise<void> {
  const base = {
    gameId,
    platformId: null,
    scoreOrigin: "igdb-aggregate",
    scoreProvider: "igdb" as const,
    scoreType: "critic_aggregate",
    nextRefreshAt: null,
  };
  if (score) {
    await upsertRating({ ...base, score: score.score, reviewCount: score.reviewCount }, tx);
    return;
  }
  const [had] = await tx
    .select({ id: ratings.id })
    .from(ratings)
    .where(
      and(
        eq(ratings.gameId, gameId),
        eq(ratings.scoreProvider, "igdb"),
        eq(ratings.scoreType, "critic_aggregate"),
        isNotNull(ratings.score),
      ),
    )
    .limit(1);
  if (had) await upsertRating({ ...base, score: null, reviewCount: null }, tx);
}
