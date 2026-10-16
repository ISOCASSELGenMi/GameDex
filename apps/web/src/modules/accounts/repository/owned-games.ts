/**
 * owned_games 與「匯入對象」連結帳號的查詢。匯入對象一律排除 provider='credential'（密碼不是外部帳號；03 註解、D7）——
 * 這個條件只在這個檔案出現一次（externalAccountCondition）。
 */
import { and, asc, eq, inArray, isNotNull, isNull, max, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import { IMPORT_PROVIDERS, type ExternalOwnedGame, type OwnedGameMatch, type OwnedGameStatus, type OwnedGamesSummary } from "../domain/entities/owned-game";
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
 * 已存在的列保留比對結果（matched、needs_review 不動）；平台回應裡沒有的舊列不刪。
 * 同一個 transaction 內把該帳號「找不到」（matchedGameId IS NULL 且 matchConfidencePct = 0）的列重設為未比對（NULL），
 * 讓之後 catalog 新增的遊戲有機會被重新比對；只動這個 connectedAccountId，且不動 match_method='manual' 的列（手動否決）。回傳該帳號目前的總列數。
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
    await tx
      .update(ownedGames)
      .set({ matchConfidencePct: null })
      .where(
        and(
          eq(ownedGames.connectedAccountId, connectedAccountId),
          isNull(ownedGames.matchedGameId),
          eq(ownedGames.matchConfidencePct, 0),
          ne(ownedGames.matchMethod, "manual"), // 使用者手動否決的列不重比
        ),
      );
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
      notFound: sql<number>`(count(*) FILTER (WHERE ${ownedGames.matchedGameId} IS NULL AND ${ownedGames.matchConfidencePct} = 0 AND ${ownedGames.matchMethod} <> 'manual'))::int`,
      dismissed: sql<number>`(count(*) FILTER (WHERE ${ownedGames.matchedGameId} IS NULL AND ${ownedGames.matchConfidencePct} = 0 AND ${ownedGames.matchMethod} = 'manual'))::int`,
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
    dismissed: row?.dismissed ?? 0,
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
  matchMethod: string;
}

/** 狀態篩選的 SQL 條件（與 ownedGameStatus 的判定一致）。 */
function statusCondition(status: OwnedGameStatus): SQL {
  const noGame = sql`${ownedGames.matchedGameId} IS NULL`;
  switch (status) {
    case "queued":
      return sql`${ownedGames.matchConfidencePct} IS NULL`;
    case "matched":
      return sql`${ownedGames.matchedGameId} IS NOT NULL`;
    case "needs_review":
      return sql`${noGame} AND ${ownedGames.matchConfidencePct} > 0`;
    case "not_found":
      return sql`${noGame} AND ${ownedGames.matchConfidencePct} = 0 AND ${ownedGames.matchMethod} <> 'manual'`;
    case "dismissed":
      return sql`${noGame} AND ${ownedGames.matchConfidencePct} = 0 AND ${ownedGames.matchMethod} = 'manual'`;
  }
}

/** 清單（標題排序；status 省略＝全部）。多取一筆用來判斷還有沒有下一頁。 */
export async function listOwnedGameRows(
  connectedAccountId: number,
  limit: number,
  offset: number,
  status?: OwnedGameStatus,
): Promise<{ rows: OwnedGameRow[]; hasMore: boolean }> {
  const rows = await getDb()
    .select({
      id: ownedGames.id,
      externalGameId: ownedGames.externalGameId,
      externalTitle: ownedGames.externalTitle,
      matchedGameId: ownedGames.matchedGameId,
      matchConfidencePct: ownedGames.matchConfidencePct,
      matchMethod: ownedGames.matchMethod,
    })
    .from(ownedGames)
    .where(status ? and(eq(ownedGames.connectedAccountId, connectedAccountId), statusCondition(status)) : eq(ownedGames.connectedAccountId, connectedAccountId))
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

const rowColumns = {
  id: ownedGames.id,
  externalGameId: ownedGames.externalGameId,
  externalTitle: ownedGames.externalTitle,
  matchedGameId: ownedGames.matchedGameId,
  matchConfidencePct: ownedGames.matchConfidencePct,
  matchMethod: ownedGames.matchMethod,
};

/** 某連結帳號底下的一列（不屬於該帳號回 null，不洩漏別人的列）。 */
export async function findOwnedGameRow(connectedAccountId: number, ownedGameId: number): Promise<OwnedGameRow | null> {
  const [row] = await getDb()
    .select(rowColumns)
    .from(ownedGames)
    .where(and(eq(ownedGames.id, ownedGameId), eq(ownedGames.connectedAccountId, connectedAccountId)))
    .limit(1);
  return row ?? null;
}

/**
 * 手動指定（第 5 波）：assign＝指定（信心 100）；dismiss＝否決（matchedGameId NULL、信心 0）；兩者 match_method 都是 manual。
 * reset＝回到自動（matchedGameId NULL、信心 NULL、auto），交給比對重跑。只改該連結帳號的列。
 */
export async function setOwnedGameManualMatch(
  connectedAccountId: number,
  ownedGameId: number,
  change: { kind: "assign"; gameId: number } | { kind: "dismiss" } | { kind: "reset" },
): Promise<OwnedGameRow | null> {
  const set =
    change.kind === "assign"
      ? { matchedGameId: change.gameId, matchConfidencePct: 100, matchMethod: "manual" }
      : change.kind === "dismiss"
        ? { matchedGameId: null, matchConfidencePct: 0, matchMethod: "manual" }
        : { matchedGameId: null, matchConfidencePct: null, matchMethod: "auto" };
  const [row] = await getDb()
    .update(ownedGames)
    .set(set)
    .where(and(eq(ownedGames.id, ownedGameId), eq(ownedGames.connectedAccountId, connectedAccountId)))
    .returning(rowColumns);
  return row ?? null;
}

/** 這位使用者已比對到 catalog 遊戲的 owned_games（去重；`mine=owned` 用）。需要連到 connected_accounts 取得擁有者。 */
export async function matchedOwnedGameIds(userId: number): Promise<number[]> {
  const rows = await getDb()
    .selectDistinct({ gameId: ownedGames.matchedGameId })
    .from(ownedGames)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, ownedGames.connectedAccountId))
    .where(and(eq(connectedAccounts.userId, userId), externalAccountCondition(), isNotNull(ownedGames.matchedGameId)))
    .orderBy(asc(ownedGames.matchedGameId));
  return rows.flatMap((r) => (r.gameId === null ? [] : [r.gameId]));
}
