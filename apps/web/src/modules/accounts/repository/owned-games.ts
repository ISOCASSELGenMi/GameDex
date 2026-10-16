/**
 * owned_games 與「匯入對象」連結帳號的查詢。匯入對象一律排除 provider='credential'（密碼不是外部帳號；03 註解、D7）——
 * 這個條件只在這個檔案出現一次（externalAccountCondition）。
 */
import { and, asc, eq, inArray, isNull, max, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import { IMPORT_PROVIDERS, type ExternalOwnedGame, type OwnedGameMatch, type OwnedGamesSummary } from "../domain/entities/owned-game";
import { connectedAccounts, ownedGames } from "../schema";

const externalAccountCondition = (): SQL => ne(connectedAccounts.provider, "credential");

export interface ImportTarget {
  /** connected_accounts.id */
  id: number;
  /** 平台上的使用者 ID（Steam：SteamID64）。 */
  providerAccountId: string;
}

/** 使用者綁定的某個外部帳號（沒綁回 null）。 */
export async function findImportTarget(userId: number, provider: string): Promise<ImportTarget | null> {
  const [row] = await getDb()
    .select({ id: connectedAccounts.id, providerAccountId: connectedAccounts.providerAccountId })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.userId, userId), eq(connectedAccounts.provider, provider), externalAccountCondition()))
    .limit(1);
  return row ?? null;
}

/** 該帳號最近一次匯入時間（沒有任何列＝從未匯入）。冷卻用這個判斷，不另建表。 */
export async function lastImportedAt(connectedAccountId: number): Promise<Date | null> {
  const [row] = await getDb()
    .select({ at: max(ownedGames.importedAt) })
    .from(ownedGames)
    .where(eq(ownedGames.connectedAccountId, connectedAccountId));
  return row?.at ?? null;
}

const UPSERT_CHUNK = 1000;

/**
 * 以 (connectedAccountId, externalGameId) upsert：更新 externalTitle、importedAt；新列 matchedGameId／matchConfidencePct 為 NULL。
 * 已存在的列保留比對結果；平台回應裡沒有的舊列不刪。回傳該帳號目前的總列數。
 */
export async function upsertOwnedGames(connectedAccountId: number, games: readonly ExternalOwnedGame[], now: Date): Promise<{ total: number }> {
  const db = getDb();
  const unique = [...new Map(games.map((g) => [g.externalGameId, g])).values()];
  await db.transaction(async (tx) => {
    for (let i = 0; i < unique.length; i += UPSERT_CHUNK) {
      const chunk = unique.slice(i, i + UPSERT_CHUNK);
      await tx
        .insert(ownedGames)
        .values(chunk.map((g) => ({ connectedAccountId, externalGameId: g.externalGameId, externalTitle: g.title, importedAt: now })))
        .onConflictDoUpdate({
          target: [ownedGames.connectedAccountId, ownedGames.externalGameId],
          set: { externalTitle: sql`excluded.external_title`, importedAt: sql`excluded.imported_at` },
        });
    }
  });
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(ownedGames).where(eq(ownedGames.connectedAccountId, connectedAccountId));
  return { total: row?.n ?? 0 };
}

export async function summarizeOwnedGames(connectedAccountId: number): Promise<OwnedGamesSummary> {
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      matched: sql<number>`(count(*) FILTER (WHERE ${ownedGames.matchedGameId} IS NOT NULL))::int`,
      needsReview: sql<number>`(count(*) FILTER (WHERE ${ownedGames.matchedGameId} IS NULL AND ${ownedGames.matchConfidencePct} > 0))::int`,
      notFound: sql<number>`(count(*) FILTER (WHERE ${ownedGames.matchedGameId} IS NULL AND ${ownedGames.matchConfidencePct} = 0))::int`,
      queued: sql<number>`(count(*) FILTER (WHERE ${ownedGames.matchConfidencePct} IS NULL))::int`,
      last: max(ownedGames.importedAt),
    })
    .from(ownedGames)
    .where(eq(ownedGames.connectedAccountId, connectedAccountId));
  return {
    total: row?.total ?? 0,
    matched: row?.matched ?? 0,
    needsReview: row?.needsReview ?? 0,
    notFound: row?.notFound ?? 0,
    queued: row?.queued ?? 0,
    lastImportedAt: row?.last ? row.last.toISOString() : null,
  };
}

export interface OwnedGameRow {
  id: number;
  externalGameId: string;
  externalTitle: string;
  matchedGameId: number | null;
  matchConfidencePct: number | null;
}

/** 清單（標題排序）。多取一筆用來判斷還有沒有下一頁。 */
export async function listOwnedGameRows(connectedAccountId: number, limit: number, offset: number): Promise<{ rows: OwnedGameRow[]; hasMore: boolean }> {
  const rows = await getDb()
    .select({
      id: ownedGames.id,
      externalGameId: ownedGames.externalGameId,
      externalTitle: ownedGames.externalTitle,
      matchedGameId: ownedGames.matchedGameId,
      matchConfidencePct: ownedGames.matchConfidencePct,
    })
    .from(ownedGames)
    .where(eq(ownedGames.connectedAccountId, connectedAccountId))
    .orderBy(asc(sql`lower(${ownedGames.externalTitle})`), asc(ownedGames.id))
    .limit(limit + 1)
    .offset(offset);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

export interface UnmatchedRow {
  id: number;
  provider: string;
  externalGameId: string;
  externalTitle: string;
}

/** 尚未比對（matchConfidencePct IS NULL）的列；可限定單一帳號。 */
export async function pickUnmatched(limit: number, connectedAccountId?: number): Promise<UnmatchedRow[]> {
  const conds: SQL[] = [isNull(ownedGames.matchConfidencePct), externalAccountCondition(), inArray(connectedAccounts.provider, [...IMPORT_PROVIDERS])];
  if (connectedAccountId !== undefined) conds.push(eq(ownedGames.connectedAccountId, connectedAccountId));
  return getDb()
    .select({ id: ownedGames.id, provider: connectedAccounts.provider, externalGameId: ownedGames.externalGameId, externalTitle: ownedGames.externalTitle })
    .from(ownedGames)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, ownedGames.connectedAccountId))
    .where(and(...conds))
    .orderBy(asc(ownedGames.id))
    .limit(limit);
}

/** 寫回比對結果；只更新仍是「未比對」的列（避免與另一個處理程序互相覆蓋）。回傳實際更新列數。 */
export async function applyOwnedGameMatches(results: readonly OwnedGameMatch[]): Promise<number> {
  if (results.length === 0) return 0;
  let updated = 0;
  await getDb().transaction(async (tx) => {
    for (const r of results) {
      const res = await tx
        .update(ownedGames)
        .set({ matchedGameId: r.matchedGameId, matchConfidencePct: r.confidencePct })
        .where(and(eq(ownedGames.id, r.ownedGameId), isNull(ownedGames.matchConfidencePct)))
        .returning({ id: ownedGames.id });
      updated += res.length;
    }
  });
  return updated;
}
