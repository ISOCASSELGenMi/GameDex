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
  hasForeignSupplementary,
  listAutoMatchesToVerify,
  loadGameFacts,
  markMatchVerified,
  normalizeTitle,
  recordMatchAttempt,
  rejectExternalMatch,
  saveExternalRatings,
  selectRatingSyncTargets,
  selectRepairCandidates,
  upsertExternalIdMatch,
  verifyExternalMatch,
  type Candidate,
  type ExternalFacts,
  type OurGameFacts,
  type VerifyVerdict,
} from "@/modules/catalog";
import { MetacriticBlockedError, MetacriticDisabledError, MetacriticTransientError, type MetacriticHttp } from "../provider/http";
import { METACRITIC_SCORE_ORIGIN, METACRITIC_SCORE_TYPES, METACRITIC_SOURCE, createMetacriticProvider, gameUrl } from "../provider/provider";
import { slugToName } from "../provider/parse";
import { createSteamHintClient, type SteamHintClient } from "../provider/steam";
import { insertSlugs, countSlugs, searchSlugs } from "../repository/slugs";
import { createCachedPages } from "./pages";
import { checkCanRun, createHttp, defaultAlert, loadBudget, markBlocked, type Budget } from "./runtime";

export interface JobIo {
  log: (message: string, extra?: Record<string, unknown>) => void;
  now?: Date;
  /** 測試注入。 */
  http?: MetacriticHttp;
  alert?: (message: string) => Promise<unknown>;
  dailyLimit?: number;
  /** 測試注入：Steam 對 Metacritic 頁面的記錄（配對佐證）；預設用真實的 Steam appdetails。 */
  steam?: SteamHintClient;
  /** 測試用：只修復這些遊戲（整合測試共用同一個資料庫，其他測試檔的遊戲不該被算進 tried）。 */
  onlyGameIds?: readonly number[];
}

const INDEX_STATE = "metacritic_slug_index";
/** 一次索引更新最多抓幾個分片（每片約 1000 筆、1 個請求）。 */
const INDEX_SHARDS_PER_RUN = 40;
export const SYNC_BATCH = 100;
export const REPAIR_BATCH = 200;
/** slug 比對信心低於此值就不花請求去驗證遊戲頁（實測低於這個幾乎全是別款遊戲）。 */
export const PAGE_VERIFY_MIN = 70;
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
  const http = io.http ?? createHttp();
  budget.track(http); // 每個請求即時記帳（行程被殺最多少算一小批）
  return { http, budget, now };
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
    while (shards < INDEX_SHARDS_PER_RUN && shards < all.length && ctx.budget.remaining() > 0) {
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
    await ctx.budget.flush();
  }
  return { shards, added };
}

// ── 修復比對 ────────────────────────────────────────────────────────────────
async function candidatesFor(name: string, altNames: readonly string[], rejected: ReadonlySet<string>): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  for (const n of [name, ...altNames.slice(0, 3)]) {
    for (const row of await searchSlugs(normalizeTitle(n), 10)) {
      if (rejected.has(row.slug)) continue;
      // Season Pass／Pack／DLC 之類的追加內容頁不是遊戲本體：我方名稱沒有同樣字樣就不當候選
      if (hasForeignSupplementary([name, ...altNames], slugToName(row.slug))) continue;
      out.set(row.slug, { externalId: row.slug, name: slugToName(row.slug), releaseYear: null, externalUrl: gameUrl(row.slug) });
    }
  }
  return [...out.values()];
}

/**
 * 頁面驗證＋Steam 佐證：先只看頁面；沒被拒絕且我方有 Steam AppID 才多問一次 Steam（不佔 Metacritic 額度）。
 * Steam 記錄的 Metacritic slug 與候選相同＝強證據；不同＝進覆核；查不到＝不影響。
 */
async function verifyPage(ours: OurGameFacts, facts: ExternalFacts, slug: string, steam: SteamHintClient): Promise<VerifyVerdict> {
  const base = verifyExternalMatch(ours, facts);
  if (base.decision === "reject" || !ours.steamAppId) return base;
  return verifyExternalMatch(ours, facts, { steamSlug: await steam.getMetacriticSlug(ours.steamAppId), candidateSlug: slug });
}

export interface RepairStats {
  tried: number;
  matched: number;
  review: number;
  noCandidate: number;
  /** 遊戲頁驗證不通過（標題不符或日期差太多）而放棄的候選。 */
  rejected: number;
}

const EMPTY_FACTS = { dates: [], companies: [], platforms: [] } as const;

/**
 * 修復比對（05 §修復排程）：slug 索引找候選 → 標題粗篩（≥ PAGE_VERIFY_MIN）→ 抓遊戲頁 → 用頁面上的標題、發售日（±3 天，任一平台）、
 * 開發／發行商、平台驗證（verifyExternalMatch）。通過才自動採用；有疑慮進覆核；明顯不是同一款就放棄，不佔覆核佇列。
 */
export async function runRepairMatches(io: JobIo, batch: number = REPAIR_BATCH): Promise<RepairStats> {
  const stats: RepairStats = { tried: 0, matched: 0, review: 0, noCandidate: 0, rejected: 0 };
  const ctx = await setup(io);
  if (!ctx) return stats;
  if ((await countSlugs()) === 0) {
    io.log("slug 索引是空的：先執行 refresh_metacritic_index");
    return stats;
  }
  const provider = createCachedPages(createMetacriticProvider(ctx.http), () => ctx.now);
  const steam = io.steam ?? createSteamHintClient();
  const today = ctx.now.toISOString().slice(0, 10);
  try {
    const games = await selectRepairCandidates(METACRITIC_SOURCE, today, batch, undefined, io.onlyGameIds);
    const facts = await loadGameFacts(games.map((g) => g.gameId));
    for (const game of games) {
      const rejected = await getRejectedExternalIds(game.gameId, METACRITIC_SOURCE);
      const cands = await candidatesFor(game.name, game.altNames, rejected);
      const match = findBestMatch(game.name, game.altNames, game.year, cands);
      if (!match || match.confidencePct < PAGE_VERIFY_MIN) {
        stats.tried += 1;
        stats.noCandidate += 1;
        await recordMatchAttempt(game.gameId, METACRITIC_SOURCE, "no_candidate");
        continue;
      }
      if (ctx.budget.remaining() <= 0) break; // 額度用完：這款留到下一輪，不記嘗試
      const page = await provider.getScoreById(match.externalId);
      if (page.kind === "parse_failed") continue; // 下一輪再試，不記嘗試
      stats.tried += 1;
      const ours = facts.get(game.gameId) ?? { names: [game.name, ...game.altNames], ...EMPTY_FACTS };
      const verdict = page.kind === "ok" ? await verifyPage(ours, page.facts, match.externalId, steam) : null;
      if (!verdict || verdict.decision === "reject") {
        stats.rejected += 1;
        await recordMatchAttempt(game.gameId, METACRITIC_SOURCE, "no_candidate");
        continue;
      }
      const needsReview = verdict.decision === "review";
      await upsertExternalIdMatch({
        gameId: game.gameId,
        source: METACRITIC_SOURCE,
        externalId: match.externalId,
        externalUrl: match.externalUrl,
        confidencePct: verdict.confidencePct,
        needsReview,
        matchMethod: "auto2",
      });
      await recordMatchAttempt(game.gameId, METACRITIC_SOURCE, needsReview ? "low_confidence" : "matched");
      if (needsReview) stats.review += 1;
      else stats.matched += 1;
    }
    io.log("repair_matches_metacritic", { ...stats, requests: ctx.http.requests });
  } catch (err) {
    if (!(await handleFatal(err, io))) throw err;
  } finally {
    await ctx.budget.flush();
  }
  return stats;
}

export interface ReverifyStats {
  checked: number;
  kept: number;
  downgraded: number;
  removed: number;
  skipped: number;
}

/**
 * 重新驗證既有的自動配對（match_method='auto'，舊規則只比 slug 名稱）：抓遊戲頁，用新規則重判。
 * 通過→維持（已確認的維持已確認）；有疑慮→降為覆核並刪分數；不是同一款→刪配對、記拒絕、刪分數。manual 不動。驗證過的標成 auto2，每輪接著做。
 */
export async function runReverifyMatches(io: JobIo, batch: number = REPAIR_BATCH): Promise<ReverifyStats> {
  const stats: ReverifyStats = { checked: 0, kept: 0, downgraded: 0, removed: 0, skipped: 0 };
  const ctx = await setup(io);
  if (!ctx) return stats;
  const provider = createCachedPages(createMetacriticProvider(ctx.http), () => ctx.now);
  const steam = io.steam ?? createSteamHintClient();
  try {
    const rows = await listAutoMatchesToVerify(METACRITIC_SOURCE, batch, io.onlyGameIds);
    const facts = await loadGameFacts(rows.map((r) => r.gameId));
    for (const row of rows) {
      if (ctx.budget.remaining() <= 0) break;
      const page = await provider.getScoreById(row.externalId);
      if (page.kind === "parse_failed") {
        stats.skipped += 1;
        continue;
      }
      stats.checked += 1;
      const ours = facts.get(row.gameId);
      const verdict = page.kind === "ok" && ours ? await verifyPage(ours, page.facts, row.externalId, steam) : null;
      if (!verdict || verdict.decision === "reject") {
        await rejectExternalMatch(row.id, METACRITIC_SOURCE, METACRITIC_SOURCE);
        stats.removed += 1;
      } else if (verdict.decision === "review") {
        await markMatchVerified(row.id, METACRITIC_SOURCE, verdict.confidencePct, true, METACRITIC_SOURCE);
        stats.downgraded += 1;
      } else {
        await markMatchVerified(row.id, METACRITIC_SOURCE, verdict.confidencePct, false);
        stats.kept += 1;
      }
    }
    io.log("reverify_matches_metacritic", { ...stats, requests: ctx.http.requests });
  } catch (err) {
    if (!(await handleFatal(err, io))) throw err;
  } finally {
    await ctx.budget.flush();
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
  const provider = createCachedPages(createMetacriticProvider(ctx.http), () => ctx.now);
  const today = ctx.now.toISOString().slice(0, 10);
  try {
    const limit = Math.min(batch, ctx.budget.remaining());
    for (const t of await selectRatingSyncTargets(METACRITIC_SOURCE, METACRITIC_SOURCE, today, limit)) {
      if (ctx.budget.remaining() <= 0) break;
      stats.attempted += 1;
      const page = await provider.getScoreById(t.externalId, { forceRefresh: true }); // 分數到了更新時間：強制重抓並更新快取
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
    await ctx.budget.flush();
  }
  return stats;
}
