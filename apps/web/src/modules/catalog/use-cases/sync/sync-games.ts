/**
 * sync_games（04 §增量同步）：查 `updated_at > 上次`，逐款寫入遊戲與全部關聯，並對上市日做完整 diff。
 * 進度存 sync_state（jobName='igdb_games'），寫回「任務開始時間」；有任何一款失敗就不推進，下次重抓。
 * writeGameBatch 也供回填使用（同一份寫入邏輯，原則五）。
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import type { DatePrecision, GameRecord, IsoDate } from "../../domain/entities";
import { isEarlierSpan, type DesiredRelease } from "../../domain/release-diff";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";
import { syncIgdbGame, type IgdbGameSyncInput, type IgdbGameSyncResult } from "../../repository/game-sync";
import { listIgdbPlatformRefs } from "../../repository/platforms";
import { listRegions } from "../../repository/regions";
import { autoReleasePastEvents } from "../../repository/release-events";
import {
  franchiseKey,
  upsertCompanies,
  upsertFranchises,
  upsertGenres,
  upsertLanguages,
  upsertThemes,
} from "../../repository/taxonomies";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export const IGDB_GAMES_STATE = "igdb_games";
/** IGDB 單次查詢上限。 */
export const GAMES_PAGE_SIZE = 500;
/** 第一次執行（沒有 sync_state）時往回看多久；正式資料由回填建立。 */
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface GameBatchStats {
  fetched: number;
  inserted: number;
  updated: number;
  skippedMobileOnly: number;
  failed: number;
  /** 寫入失敗的 igdbId（回填記進 sync_state.meta，供重試）。 */
  failedIgdbIds: number[];
  releasesCreated: number;
  releasesUpdated: number;
  releasesRemoved: number;
  releasesRestored: number;
  releasesUnchanged: number;
  releaseDuplicatesDropped: number;
  /** 上市日指向 platforms 表沒有的平台（sync_platforms 未跑或 IGDB 新平台）。 */
  unknownPlatformIgdbIds: number[];
}

export function emptyBatchStats(): GameBatchStats {
  return {
    fetched: 0,
    inserted: 0,
    updated: 0,
    skippedMobileOnly: 0,
    failed: 0,
    failedIgdbIds: [],
    releasesCreated: 0,
    releasesUpdated: 0,
    releasesRemoved: 0,
    releasesRestored: 0,
    releasesUnchanged: 0,
    releaseDuplicatesDropped: 0,
    unknownPlatformIgdbIds: [],
  };
}

export interface WriteContext {
  platforms: Map<number, { id: number; kind: string }>;
  regionIds: Map<string, number>;
  today: IsoDate;
  log: Log;
  /** 回填傳 false：只 upsert，不標 removed（04 §回填）。 */
  markMissingRemoved?: boolean;
  /** 每款寫入成功後呼叫（滾動校對統計 misses 用）。 */
  onWritten?: (record: GameRecord, result: IgdbGameSyncResult) => void;
}

/** 讀一次參照資料（平台、地區）；平台表空的時候丟錯，提示先跑 sync_platforms。 */
export async function loadWriteContext(startedAt: Date, log: Log): Promise<WriteContext> {
  const platforms = await listIgdbPlatformRefs();
  if (platforms.size === 0) throw new Error("platforms 表是空的：請先執行 sync_platforms");
  const regionIds = new Map((await listRegions()).map((r) => [r.code, r.id]));
  return { platforms, regionIds, today: utcDate(startedAt), log };
}

export function utcDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** 只上手機平台的遊戲不收（P35）。沒有平台資料的遊戲照收。 */
export function isMobileOnly(record: GameRecord, ctx: Pick<WriteContext, "platforms">): boolean {
  const kinds = record.platformIgdbIds.map((id) => ctx.platforms.get(id)?.kind);
  return kinds.length > 0 && kinds.every((k) => k === "mobile");
}

/**
 * 來源上市日 → diff 輸入：手機平台不寫入（P35）；不認得的平台略過並回報。
 */
export function toDesiredReleases(
  record: GameRecord,
  ctx: Pick<WriteContext, "platforms" | "regionIds">,
  unknownPlatforms: Set<number>,
): DesiredRelease[] {
  const out: DesiredRelease[] = [];
  for (const rd of record.releaseDates) {
    const platform = ctx.platforms.get(rd.platformIgdbId);
    if (!platform) {
      unknownPlatforms.add(rd.platformIgdbId);
      continue;
    }
    if (platform.kind === "mobile") continue;
    const regionId = ctx.regionIds.get(rd.regionCode);
    if (regionId === undefined) continue; // regions 由 seed 建立；缺少代表 seed 未執行
    out.push({
      platformId: platform.id,
      regionId,
      releaseStage: rd.stage,
      releaseDate: rd.releaseDate,
      periodStart: rd.periodStart,
      precision: rd.precision,
      cancelled: rd.cancelled,
    });
  }
  return out;
}

/** games.firstReleaseDate／Precision：最早一筆（不含取消）；只有 tbd → (NULL, tbd)；沒有上市日 → NULL。 */
export function firstRelease(releases: readonly DesiredRelease[]): { date: IsoDate | null; precision: DatePrecision | null } {
  let best: DesiredRelease | undefined;
  for (const r of releases) if (!r.cancelled && (!best || isEarlierSpan(r, best))) best = r;
  return best ? { date: best.releaseDate, precision: best.precision } : { date: null, precision: null };
}

/**
 * 寫入一批遊戲：先批次 upsert 查找表（類型、公司…），再逐款一個 transaction。
 * 單款失敗不中斷整批，計入 stats.failed。
 */
export async function writeGameBatch(records: readonly GameRecord[], ctx: WriteContext, stats: GameBatchStats): Promise<void> {
  stats.fetched += records.length;
  const wanted = records.filter((r) => {
    if (!isMobileOnly(r, ctx)) return true;
    stats.skippedMobileOnly += 1;
    return false;
  });
  if (wanted.length === 0) return;

  const [genreIds, themeIds, companyIds, franchiseIds, languageIds] = await Promise.all([
    upsertGenres(wanted.flatMap((r) => r.genres)),
    upsertThemes(wanted.flatMap((r) => r.themes)),
    upsertCompanies(wanted.flatMap((r) => r.companies.map((c) => c.company))),
    upsertFranchises(wanted.flatMap((r) => r.franchises)),
    upsertLanguages(wanted.flatMap((r) => r.languageSupports.map((l) => l.language))),
  ]);
  const ids = (m: Map<number, number>, xs: ReadonlyArray<{ igdbId: number }>) =>
    xs.map((x) => m.get(x.igdbId)).filter((x): x is number => x !== undefined);

  const unknown = new Set(stats.unknownPlatformIgdbIds);
  for (const r of wanted) {
    const releases = toDesiredReleases(r, ctx, unknown);
    const first = firstRelease(releases);
    const input: IgdbGameSyncInput = {
      igdbId: r.igdbId,
      name: r.name,
      slug: r.slug,
      summary: r.summary,
      coverUrl: r.coverUrl,
      firstReleaseDate: first.date,
      firstReleasePrecision: first.precision,
      gameType: r.gameType,
      gameStatus: r.gameStatus,
      parentGameId: r.parentIgdbId,
      alternativeNames: r.alternativeNames,
      screenshotUrls: r.screenshotUrls,
      trailerUrl: r.trailerUrl,
      similarIgdbIds: r.similarIgdbIds,
      platformIds: r.platformIgdbIds
        .map((id) => ctx.platforms.get(id))
        .filter((p): p is { id: number; kind: string } => !!p && p.kind !== "mobile")
        .map((p) => p.id),
      genreIds: ids(genreIds, r.genres),
      themeIds: ids(themeIds, r.themes),
      franchiseIds: r.franchises
        .map((f) => franchiseIds.get(franchiseKey(f.kind, f.igdbId)))
        .filter((x): x is number => x !== undefined),
      companies: r.companies.flatMap((c) => {
        const companyId = companyIds.get(c.company.igdbId);
        return companyId === undefined ? [] : c.roles.map((role) => ({ companyId, role }));
      }),
      localizations: r.localizations,
      languageSupports: r.languageSupports.flatMap((l) => {
        const languageId = languageIds.get(l.language.igdbId);
        return languageId === undefined ? [] : [{ languageId, supportType: l.supportType }];
      }),
      links: r.links,
      steamAppId: r.steamAppId,
      criticScore: r.criticScore,
      releases,
      sourceUpdatedAt: r.sourceUpdatedAt,
    };
    try {
      const res = await syncIgdbGame(input, { today: ctx.today, markMissingRemoved: ctx.markMissingRemoved });
      if (res.inserted) stats.inserted += 1;
      else stats.updated += 1;
      stats.releasesCreated += res.releases.created;
      stats.releasesUpdated += res.releases.updated;
      stats.releasesRemoved += res.releases.removed;
      stats.releasesRestored += res.releases.restored;
      stats.releasesUnchanged += res.releases.unchanged;
      stats.releaseDuplicatesDropped += res.releases.duplicatesDropped;
      ctx.onWritten?.(r, res);
    } catch (err) {
      stats.failed += 1;
      stats.failedIgdbIds.push(r.igdbId);
      ctx.log("遊戲寫入失敗", { igdbId: r.igdbId, name: r.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  stats.unknownPlatformIgdbIds = [...unknown].sort((a, b) => a - b);
}

export interface SyncGamesResult extends GameBatchStats {
  updatedSince: string;
  autoReleased: number;
}

/**
 * 增量同步一輪。
 * @param startedAt 任務開始時間（JobContext.startedAt），成功時寫回 sync_state.lastSyncedAt
 */
export async function syncGames(
  provider: GameDataProvider,
  ctx: { startedAt: Date; log: Log },
  opts: { pageSize?: number } = {},
): Promise<SyncGamesResult> {
  const pageSize = opts.pageSize ?? GAMES_PAGE_SIZE;
  const state = await getSyncState(IGDB_GAMES_STATE);
  const since = state?.lastSyncedAt ?? new Date(ctx.startedAt.getTime() - INITIAL_LOOKBACK_MS);
  if (!state?.lastSyncedAt) ctx.log("尚無同步紀錄，往回看 24 小時（完整資料請執行回填）", { since: since.toISOString() });

  const wctx = await loadWriteContext(ctx.startedAt, ctx.log);
  const stats = emptyBatchStats();
  let afterId: number | undefined;
  for (;;) {
    const page = await provider.fetchGames({ updatedSince: since, afterId, limit: pageSize });
    if (page.length === 0) break;
    await writeGameBatch(page, wctx, stats);
    afterId = page[page.length - 1].igdbId;
    if (page.length < pageSize) break;
  }

  const autoReleased = await autoReleasePastEvents(wctx.today);
  const result: SyncGamesResult = { ...stats, updatedSince: since.toISOString(), autoReleased };
  if (stats.unknownPlatformIgdbIds.length > 0) {
    ctx.log("上市日指向未知平台，已略過（sync_platforms 是否最新？）", { igdbPlatformIds: stats.unknownPlatformIgdbIds });
  }
  ctx.log("遊戲同步完成", { ...result });

  if (stats.failed > 0) throw new Error(`sync_games：${stats.failed} 款遊戲寫入失敗（見 log），進度不推進`);
  await saveSyncProgress(IGDB_GAMES_STATE, { lastSyncedAt: ctx.startedAt, meta: { ...result } });
  return result;
}
