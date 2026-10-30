/**
 * metacritic 的三個排程任務（05 §分層排程、§修復排程）。每個任務開頭先過 checkCanRun（兩道開關、冷卻、額度），
 * 不通過就直接結束——此時對 metacritic.com 的請求數為 0。
 *
 * - refresh_metacritic_index（每週）：讀公開 sitemap 建本機 slug 索引（站內搜尋被 robots.txt 禁止）。
 * - repair_matches_metacritic（每日）：窗口內尚未配對的遊戲 → 本機索引找候選 → findBestMatch → 寫 external_ids（<85 或有疑慮進覆核）。
 * - sync_ratings（每小時）：只對已確認的外部 ID 抓分數；查無分數寫負向快取；每次有數量上限，與其他任務共用每日額度。
 * 被擋（403／挑戰頁）：記冷卻、告警、結束；解析失敗率偏高：告警。絕不重試繞過。
 */
import { getSyncState, saveSyncProgress } from "@/kernel/db/sync-state";
import {
  findBestMatch,
  getRejectedExternalIds,
  normalizeTitle,
  recordMatchAttempt,
  saveExternalRatings,
  selectRatingSyncTargets,
  selectRepairCandidates,
  upsertExternalIdMatch,
  type Candidate,
} from "@/modules/catalog";
import { MetacriticBlockedError, MetacriticDisabledError, MetacriticTransientError, type MetacriticHttp } from "../provider/http";
import { METACRITIC_SCORE_ORIGIN, METACRITIC_SCORE_TYPES, METACRITIC_SOURCE, createMetacriticProvider, gameUrl, type MetacriticProvider } from "../provider/provider";
import { slugToName } from "../provider/parse";
import { insertSlugs, countSlugs, searchSlugs } from "../repository/slugs";
import { checkCanRun, createHttp, defaultAlert, loadBudget, markBlocked, type Budget } from "./runtime";

export interface JobIo {
  log: (message: string, extra?: Record<string, unknown>) => void;
  now?: Date;
  /** 測試注入。 */
  http?: MetacriticHttp;
  alert?: (message: string) => Promise<unknown>;
  dailyLimit?: number;
  /** 測試用：只修復這些遊戲（整合測試共用同一個資料庫，其他測試檔的遊戲不該被算進 tried）。 */
  onlyGameIds?: readonly number[];
}

const INDEX_STATE = "metacritic_slug_index";
/** 一次索引更新最多抓幾個分片（每片約 1000 筆、1 個請求）。 */
const INDEX_SHARDS_PER_RUN = 40;
export const SYNC_BATCH = 100;
export const REPAIR_BATCH = 200;
/** 解析失敗率警戒：至少 10 次嘗試且 30% 以上失敗（改版徵兆）。 */
export const PARSE_FAIL_ALERT = { minAttempts: 10, ratio: 0.3 } as const;

async function setup(io: JobIo): Promise<{ http: MetacriticHttp; budget: Budget; now: Date } | null> {
  const now = io.now ?? new Date();
  const gate = await checkCanRun(now);
  if (!gate.run) {
    io.log(`略過：${gate.reason}`);
    return null;
  }
  const budget = await loadBudget(now, io.dailyLimit);
  if (budget.remaining() <= 0) {
    io.log("略過：今日請求額度已用完");
    return null;
  }
  return { http: io.http ?? createHttp(), budget, now };
}

/** 被擋就記冷卻並告警；其他錯誤往外丟（任務失敗由心跳記錄）。 */
async function handleFatal(err: unknown, io: JobIo): Promise<boolean> {
  if (err instanceof MetacriticDisabledError) {
    io.log("略過：抓取在執行中被關閉");
    return true;
  }
  if (err instanceof MetacriticBlockedError) {
    await markBlocked(err.message, io.now ?? new Date(), io.alert ?? defaultAlert);
    io.log(`被擋，停止：${err.message}`);
    return true;
  }
  if (err instanceof MetacriticTransientError) {
    io.log(`暫時性錯誤，本輪結束：${err.message}`);
    return true;
  }
  return false;
}

// ── 索引 ───────────────────────────────────────────────────────────────────
export async function refreshSlugIndex(io: JobIo): Promise<{ shards: number; added: number }> {
  const ctx = await setup(io);
  if (!ctx) return { shards: 0, added: 0 };
  const provider = createMetacriticProvider(ctx.http);
  let shards = 0;
  let added = 0;
  try {
    const all = await provider.listSitemapShards();
    if (!all) {
      io.log("sitemap 索引讀不到或格式不符，結束");
      return { shards, added };
    }
    const state = await getSyncState(INDEX_STATE);
    let next = Number(state?.cursor ?? 0);
    if (!Number.isInteger(next) || next < 0 || next >= all.length) next = 0;
    while (shards < INDEX_SHARDS_PER_RUN && shards < all.length && ctx.budget.remaining() - ctx.http.requests > 0) {
      const slugs = await provider.fetchSitemapSlugs(all[next]!);
      if (slugs) added += await insertSlugs(slugs.map((slug) => ({ slug, nameNorm: normalizeTitle(slugToName(slug)) })));
      shards += 1;
      next = (next + 1) % all.length;
      await saveSyncProgress(INDEX_STATE, { cursor: String(next), meta: { shards: all.length, lastRunAdded: added } });
    }
    io.log("slug 索引更新", { shards, added, totalShards: all.length });
  } catch (err) {
    if (!(await handleFatal(err, io))) throw err;
  } finally {
    await ctx.budget.spend(ctx.http.requests);
  }
  return { shards, added };
}

// ── 修復比對 ────────────────────────────────────────────────────────────────
async function candidatesFor(name: string, altNames: readonly string[], rejected: ReadonlySet<string>): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  for (const n of [name, ...altNames.slice(0, 3)]) {
    for (const row of await searchSlugs(normalizeTitle(n), 10)) {
      if (rejected.has(row.slug)) continue;
      out.set(row.slug, { externalId: row.slug, name: slugToName(row.slug), releaseYear: null, externalUrl: gameUrl(row.slug) });
    }
  }
  return [...out.values()];
}

export interface RepairStats {
  tried: number;
  matched: number;
  review: number;
  noCandidate: number;
  verifiedMismatch: number;
}

export async function runRepairMatches(io: JobIo, batch: number = REPAIR_BATCH): Promise<RepairStats> {
  const stats: RepairStats = { tried: 0, matched: 0, review: 0, noCandidate: 0, verifiedMismatch: 0 };
  const ctx = await setup(io);
  if (!ctx) return stats;
  if ((await countSlugs()) === 0) {
    io.log("slug 索引是空的：先執行 refresh_metacritic_index");
    return stats;
  }
  const provider = createMetacriticProvider(ctx.http);
  const today = ctx.now.toISOString().slice(0, 10);
  try {
    for (const game of await selectRepairCandidates(METACRITIC_SOURCE, today, batch, undefined, io.onlyGameIds)) {
      const rejected = await getRejectedExternalIds(game.gameId, METACRITIC_SOURCE);
      const cands = await candidatesFor(game.name, game.altNames, rejected);
      const match = findBestMatch(game.name, game.altNames, game.year, cands);
      stats.tried += 1;
      if (!match) {
        stats.noCandidate += 1;
        await recordMatchAttempt(game.gameId, METACRITIC_SOURCE, "no_candidate");
        continue;
      }
      let needsReview = match.needsReview;
      // 自動採用前用遊戲頁驗證上市年份（slug 沒有年份）：差距 > 2 年 → 進覆核。額度用完就不驗證、一律進覆核。
      if (!needsReview) {
        if (ctx.budget.remaining() - ctx.http.requests <= 0) needsReview = true;
        else {
          const page = await provider.getScoreById(match.externalId);
          if (page.kind !== "ok" || (game.year !== null && page.year !== null && Math.abs(page.year - game.year) > 2)) {
            needsReview = true;
            stats.verifiedMismatch += 1;
          }
        }
      }
      await upsertExternalIdMatch({
        gameId: game.gameId,
        source: METACRITIC_SOURCE,
        externalId: match.externalId,
        externalUrl: match.externalUrl,
        confidencePct: match.confidencePct,
        needsReview,
      });
      await recordMatchAttempt(game.gameId, METACRITIC_SOURCE, needsReview ? "low_confidence" : "matched");
      if (needsReview) stats.review += 1;
      else stats.matched += 1;
    }
    io.log("repair_matches_metacritic", { ...stats, requests: ctx.http.requests });
  } catch (err) {
    if (!(await handleFatal(err, io))) throw err;
  } finally {
    await ctx.budget.spend(ctx.http.requests);
  }
  return stats;
}

// ── 抓分數 ──────────────────────────────────────────────────────────────────
export interface SyncStats {
  attempted: number;
  saved: number;
  notFound: number;
  parseFailed: number;
}

export async function runSyncRatings(io: JobIo, batch: number = SYNC_BATCH): Promise<SyncStats> {
  const stats: SyncStats = { attempted: 0, saved: 0, notFound: 0, parseFailed: 0 };
  const ctx = await setup(io);
  if (!ctx) return stats;
  const provider: MetacriticProvider = createMetacriticProvider(ctx.http);
  const today = ctx.now.toISOString().slice(0, 10);
  try {
    const limit = Math.min(batch, ctx.budget.remaining());
    for (const t of await selectRatingSyncTargets(METACRITIC_SOURCE, METACRITIC_SOURCE, today, limit)) {
      if (ctx.budget.remaining() - ctx.http.requests <= 0) break;
      stats.attempted += 1;
      const page = await provider.getScoreById(t.externalId);
      if (page.kind === "parse_failed") {
        stats.parseFailed += 1;
        // 解析失敗不寫負向快取（結構改版時不該把整批遊戲標成「沒有分數」）；下一輪再試
        if (stats.attempted >= PARSE_FAIL_ALERT.minAttempts && stats.parseFailed / stats.attempted >= PARSE_FAIL_ALERT.ratio) {
          await (io.alert ?? defaultAlert)(`[GameDex] Metacritic 頁面解析失敗率偏高（${stats.parseFailed}/${stats.attempted}），可能改版；本輪停止`);
          io.log("解析失敗率偏高，停止本輪", { ...stats });
          break;
        }
        continue;
      }
      await saveExternalRatings({
        gameId: t.gameId,
        scoreProvider: METACRITIC_SOURCE,
        scoreOrigin: METACRITIC_SCORE_ORIGIN,
        sourceUrl: gameUrl(t.externalId),
        expectedTypes: METACRITIC_SCORE_TYPES,
        scores: page.kind === "ok" ? page.scores : [],
        releaseDate: t.releaseDate,
        precision: t.precision,
        now: ctx.now,
      });
      if (page.kind === "not_found") stats.notFound += 1;
      else stats.saved += 1;
    }
    io.log("sync_ratings", { ...stats, requests: ctx.http.requests });
  } catch (err) {
    if (!(await handleFatal(err, io))) throw err;
  } finally {
    await ctx.budget.spend(ctx.http.requests);
  }
  return stats;
}
