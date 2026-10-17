/**
 * 遊戲庫匯入與比對（09 §遊戲庫匯入）。
 * - importOwnedGames：抓清單 → upsert（不比對；同 transaction 把該帳號 not_found 的列重設為未比對）。比對由 matchOwnedGames 做（after() 觸發 + 排程兜底）。
 * - matchOwnedGames：AppID 對 external_ids 精確比對（信心 100）→ 其餘標題 trigram 候選 → findBestMatch。
 *   ≥ 自動門檻且非 needsReview 才寫 matchedGameId；needsReview 寫信心但 matchedGameId 保持 NULL；無候選寫 0。
 * - getOwnedGamesPage：帳號頁清單（含已比對遊戲的 slug／名稱）。
 */
import {
  findGameIdsByExternalIds,
  findBestMatch,
  findTitleMatchCandidates,
  gameExists,
  getGameBriefsByIds,
  getGameCardsByIds,
  MATCH_THRESHOLDS,
  type GameMiniCard,
} from "@/modules/catalog";
import {
  EXTERNAL_ID_SOURCE,
  IMPORT_COOLDOWN_MS,
  MATCH_BATCH_SIZE,
  asMatchMethod,
  isImportProvider,
  ownedGameStatus,
  type ImportErrorCode,
  type ImportProvider,
  type OwnedGameMatch,
  type OwnedGameStatus,
  type OwnedGamesPage,
  type OwnedGamesSummary,
  type OwnedGameView,
} from "../domain/entities/owned-game";
import { createSteamClient, SteamApiError } from "../providers/steam";
import {
  applyOwnedGameMatches,
  findImportTarget,
  findOwnedGameRow,
  setOwnedGameManualMatch,
  type OwnedGameRow,
  lastImportedAt,
  listOwnedGameRows,
  pickUnmatched,
  summarizeOwnedGames,
  upsertOwnedGames,
  type ImportTarget,
} from "../repository/owned-games";
import { getSteamFetch } from "./auth-instance";

export type ImportOutcome =
  | { ok: true; imported: number; total: number; connectedAccountId: number }
  | { ok: false; code: ImportErrorCode; retryAfterSec?: number };

export interface ImportOwnedGamesInput {
  userId: number;
  provider: ImportProvider;
  /** STEAM_WEB_API_KEY；未設 → steam_import_unavailable（不連線）。 */
  apiKey: string | undefined;
  now?: Date;
  /** 測試注入；預設用 getSteamFetch()（再預設全域 fetch）。 */
  fetch?: typeof fetch;
}

export async function importOwnedGames(input: ImportOwnedGamesInput): Promise<ImportOutcome> {
  const now = input.now ?? new Date();
  const target = await findImportTarget(input.userId, input.provider);
  if (!target) return { ok: false, code: "steam_not_linked" };
  if (!input.apiKey) return { ok: false, code: "steam_import_unavailable" };

  const last = await lastImportedAt(target.id);
  if (last) {
    const waitMs = last.getTime() + IMPORT_COOLDOWN_MS - now.getTime();
    if (waitMs > 0) return { ok: false, code: "import_cooldown", retryAfterSec: Math.ceil(waitMs / 1000) };
  }

  try {
    const client = createSteamClient({ apiKey: input.apiKey, fetch: input.fetch ?? getSteamFetch() });
    const games = await client.getOwnedGames(target.providerAccountId);
    const { total } = await upsertOwnedGames(target.id, games, now);
    return { ok: true, imported: games.length, total, connectedAccountId: target.id };
  } catch (e) {
    if (e instanceof SteamApiError) {
      if (e.code === "steam_profile_private") return { ok: false, code: "steam_profile_private" };
      if (e.code === "steam_key_rejected") return { ok: false, code: "steam_import_unavailable" };
      return { ok: false, code: "steam_upstream_error" };
    }
    throw e;
  }
}

export interface MatchSummary {
  processed: number;
  matched: number;
  needsReview: number;
  notFound: number;
  /** 查詢失敗而留待下次的列數。 */
  deferred: number;
}

const TITLE_CONCURRENCY = 6;

export interface MatchOwnedGamesOptions {
  limit?: number;
  connectedAccountId?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

export async function matchOwnedGames(opts: MatchOwnedGamesOptions = {}): Promise<MatchSummary> {
  const rows = await pickUnmatched(opts.limit ?? MATCH_BATCH_SIZE, opts.connectedAccountId);
  const summary: MatchSummary = { processed: 0, matched: 0, needsReview: 0, notFound: 0, deferred: 0 };
  if (rows.length === 0) return summary;
  const results: OwnedGameMatch[] = [];

  // 第一步：AppID 精確比對（依來源分組）
  const bySource = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!isImportProvider(r.provider)) continue;
    const source = EXTERNAL_ID_SOURCE[r.provider];
    (bySource.get(source) ?? bySource.set(source, []).get(source)!).push(r);
  }
  const rest: typeof rows = [];
  for (const [source, group] of bySource) {
    const hits = await findGameIdsByExternalIds(source, group.map((g) => g.externalGameId));
    for (const r of group) {
      const gameId = hits.get(r.externalGameId);
      if (gameId !== undefined) {
        results.push({ ownedGameId: r.id, matchedGameId: gameId, confidencePct: 100 });
        summary.matched++;
      } else rest.push(r);
    }
  }

  // 第二步：標題比對
  for (let i = 0; i < rest.length; i += TITLE_CONCURRENCY) {
    const chunk = rest.slice(i, i + TITLE_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((r) => findTitleMatchCandidates(r.externalTitle)));
    settled.forEach((s, idx) => {
      const r = chunk[idx]!;
      if (s.status === "rejected") {
        summary.deferred++;
        opts.log?.("match_owned_games_row_failed", { ownedGameId: r.id });
        return;
      }
      const best = findBestMatch(r.externalTitle, [], null, s.value);
      if (!best) {
        results.push({ ownedGameId: r.id, matchedGameId: null, confidencePct: 0 });
        summary.notFound++;
      } else if (!best.needsReview && best.confidencePct >= MATCH_THRESHOLDS.autoMin) {
        results.push({ ownedGameId: r.id, matchedGameId: Number(best.externalId), confidencePct: best.confidencePct });
        summary.matched++;
      } else {
        results.push({ ownedGameId: r.id, matchedGameId: null, confidencePct: best.confidencePct });
        summary.needsReview++;
      }
    });
  }

  await applyOwnedGameMatches(results);
  summary.processed = results.length;
  return summary;
}

export async function getOwnedGamesPage(target: ImportTarget, limit: number, offset: number, status?: OwnedGameStatus): Promise<OwnedGamesPage> {
  const [summary, { rows, hasMore }] = await Promise.all([summarizeOwnedGames(target.id), listOwnedGameRows(target.id, limit, offset, status)]);
  const briefs = await getGameBriefsByIds(rows.flatMap((r) => (r.matchedGameId === null ? [] : [r.matchedGameId])));
  return {
    summary,
    hasMore,
    items: rows.map((r) => {
      const brief = r.matchedGameId === null ? undefined : briefs.get(r.matchedGameId);
      return {
        id: r.id,
        externalGameId: r.externalGameId,
        title: r.externalTitle,
        status: ownedGameStatus(r),
        confidencePct: r.matchConfidencePct,
        matchMethod: asMatchMethod(r.matchMethod),
        game: brief ? { slug: brief.slug, name: brief.name } : null,
      };
    }),
  };
}

export async function findOwnedGamesTarget(userId: number, provider: ImportProvider): Promise<ImportTarget | null> {
  return findImportTarget(userId, provider);
}

// ── 第 5 波：手動指定／否決／重設，與候選查詢 ─────────────────────────────

async function toOwnedGameView(row: OwnedGameRow): Promise<OwnedGameView> {
  const brief = row.matchedGameId === null ? undefined : (await getGameBriefsByIds([row.matchedGameId])).get(row.matchedGameId);
  return {
    id: row.id,
    externalGameId: row.externalGameId,
    title: row.externalTitle,
    status: ownedGameStatus(row),
    confidencePct: row.matchConfidencePct,
    matchMethod: asMatchMethod(row.matchMethod),
    game: brief ? { slug: brief.slug, name: brief.name } : null,
  };
}

export type ManualMatchChange = { kind: "assign"; gameId: number } | { kind: "dismiss" } | { kind: "reset" };

export type ManualMatchOutcome =
  | { ok: true; item: OwnedGameView; summary: OwnedGamesSummary }
  | { ok: false; code: "owned_game_not_found" | "game_not_found" };

/** 手動指定／否決／重設。只能改該連結帳號底下的列；重設後由 after() 或排程比對重跑（呼叫端負責觸發 matchOwnedGames）。 */
export async function setManualMatch(target: ImportTarget, ownedGameId: number, change: ManualMatchChange): Promise<ManualMatchOutcome> {
  if (!(await findOwnedGameRow(target.id, ownedGameId))) return { ok: false, code: "owned_game_not_found" };
  if (change.kind === "assign" && !(await gameExists(change.gameId))) return { ok: false, code: "game_not_found" };
  const row = await setOwnedGameManualMatch(target.id, ownedGameId, change);
  if (!row) return { ok: false, code: "owned_game_not_found" };
  return { ok: true, item: await toOwnedGameView(row), summary: await summarizeOwnedGames(target.id) };
}

export interface MatchCandidateView {
  game: GameMiniCard;
  /** 標題相似度（0~100；findBestMatch 的信心，低於 60 記為 0）。 */
  confidencePct: number;
}

/** 候選：標題 trigram 取前幾名，逐一用 findBestMatch 評信心，高到低。列不屬於該帳號 → null。 */
export async function getMatchCandidates(target: ImportTarget, ownedGameId: number, locale: string | null): Promise<MatchCandidateView[] | null> {
  const row = await findOwnedGameRow(target.id, ownedGameId);
  if (!row) return null;
  const candidates = await findTitleMatchCandidates(row.externalTitle);
  const cards = await getGameCardsByIds(candidates.map((c) => Number(c.externalId)), locale);
  const out: MatchCandidateView[] = [];
  for (const c of candidates) {
    const game = cards.get(Number(c.externalId));
    if (!game) continue;
    out.push({ game, confidencePct: findBestMatch(row.externalTitle, [], null, [c])?.confidencePct ?? 0 });
  }
  return out.sort((a, b) => b.confidencePct - a.confidencePct);
}
