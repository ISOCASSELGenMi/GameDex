/**
 * 待回饋 IGDB 項目的資料存取（12 §待回饋 IGDB 清單，D91；schema 的 igdb_feedback_items）。
 * - 建立：回報核可的 transaction 內呼叫（report-resolution.ts），reportId unique 擋重複。
 * - 清單／狀態：後台用（管理者手動標已提交、略過、改回待回饋）。
 * - markAdoptedFeedback：同步寫入一款遊戲後（同一個 transaction）偵測 IGDB 是否已採納；比對規則在 domain/igdb-feedback-fields.ts。
 */
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { IgdbFeedbackDraft, IgdbFeedbackItem, IgdbFeedbackStatus } from "../domain/entities";
import { isFeedbackAdopted, type FeedbackGameInfo, type IgdbAdoptionSnapshot } from "../domain/igdb-feedback-fields";
import { gameLanguageSupports, gameLocalizations, games, igdbFeedbackItems, languages, platforms, regions, releaseEvents } from "../schema";

/** 建立項目需要的遊戲資料（IGDB id、slug、現況、核可前的 zh-Hant 標題）。 */
export async function getFeedbackGameInfo(gameId: number, db: DbOrTx = getDb()): Promise<FeedbackGameInfo | null> {
  const [g] = await db
    .select({ id: games.id, igdbId: games.igdbId, slug: games.slug, name: games.name, gameStatus: games.gameStatus, displayNames: games.displayNames })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  return g ? { id: g.id, igdbId: g.igdbId, slug: g.slug, name: g.name, gameStatus: g.gameStatus, zhHantTitle: g.displayNames?.["zh-Hant"] ?? null } : null;
}

/** 寫入一筆項目；同一回報已有項目時不重複建立（回 null）。 */
export async function insertFeedbackItem(
  v: { reportId: number; game: FeedbackGameInfo; draft: IgdbFeedbackDraft; sourceUrl: string | null; reporterNote: string | null },
  db: DbOrTx = getDb(),
): Promise<IgdbFeedbackItem | null> {
  const [row] = await db
    .insert(igdbFeedbackItems)
    .values({
      reportId: v.reportId,
      gameId: v.game.id,
      igdbGameId: v.game.igdbId,
      gameSlug: v.game.slug,
      field: v.draft.field,
      platformId: v.draft.platformId,
      regionCode: v.draft.regionCode,
      stage: v.draft.stage,
      oldValue: v.draft.oldValue,
      newValue: v.draft.newValue,
      sourceUrl: v.sourceUrl,
      reporterNote: v.reporterNote,
    })
    .onConflictDoNothing({ target: igdbFeedbackItems.reportId })
    .returning();
  return row ?? null;
}

/** 回報 → 已建立的項目（審核佇列顯示「已建立待回饋項目」）。 */
export async function getFeedbackByReportIds(reportIds: readonly number[], db: DbOrTx = getDb()): Promise<Map<number, { id: number; status: IgdbFeedbackStatus }>> {
  if (reportIds.length === 0) return new Map();
  const rows = await db
    .select({ reportId: igdbFeedbackItems.reportId, id: igdbFeedbackItems.id, status: igdbFeedbackItems.status })
    .from(igdbFeedbackItems)
    .where(inArray(igdbFeedbackItems.reportId, [...reportIds]));
  return new Map(rows.map((r) => [r.reportId, { id: r.id, status: r.status }]));
}

export interface FeedbackRow {
  item: IgdbFeedbackItem;
  gameName: string;
  platformName: string | null;
}

/** 後台清單：待回饋由舊到新，其餘由最近處理的開始。 */
export async function listFeedbackRows(
  status: IgdbFeedbackStatus,
  opts: { limit: number; offset?: number },
  db: DbOrTx = getDb(),
): Promise<FeedbackRow[]> {
  return db
    .select({ item: igdbFeedbackItems, gameName: games.name, platformName: platforms.name })
    .from(igdbFeedbackItems)
    .innerJoin(games, eq(games.id, igdbFeedbackItems.gameId))
    .leftJoin(platforms, eq(platforms.id, igdbFeedbackItems.platformId))
    .where(eq(igdbFeedbackItems.status, status))
    .orderBy(
      ...(status === "pending"
        ? [asc(igdbFeedbackItems.createdAt), asc(igdbFeedbackItems.id)]
        : [desc(igdbFeedbackItems.statusChangedAt), desc(igdbFeedbackItems.id)]),
    )
    .limit(opts.limit)
    .offset(opts.offset ?? 0);
}

export async function countFeedbackByStatus(db: DbOrTx = getDb()): Promise<Record<IgdbFeedbackStatus, number>> {
  const rows = await db
    .select({ status: igdbFeedbackItems.status, n: sql<number>`count(*)::int` })
    .from(igdbFeedbackItems)
    .groupBy(igdbFeedbackItems.status);
  const out: Record<IgdbFeedbackStatus, number> = { pending: 0, submitted: 0, adopted: 0, skipped: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** 改狀態（已被 IGDB 採納的不動）。回傳實際更新的筆數。 */
export async function setFeedbackStatus(
  ids: readonly number[],
  status: Exclude<IgdbFeedbackStatus, "adopted">,
  handlerNote: string | null,
  db: DbOrTx = getDb(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const now = new Date();
  const rows = await db
    .update(igdbFeedbackItems)
    .set({ status, handlerNote, statusChangedAt: now, updatedAt: now })
    .where(and(inArray(igdbFeedbackItems.id, [...ids]), ne(igdbFeedbackItems.status, "adopted")))
    .returning({ id: igdbFeedbackItems.id });
  return rows.length;
}

/**
 * 同步剛寫入一款遊戲後呼叫（同一個 transaction）：該遊戲 pending／submitted 的項目若 IGDB 資料已含新值 → adopted。
 * 沒有項目時只花一次查詢（走 (gameId, status) 索引）；有項目時再各取一次上市列、語言、遊戲本體與在地化名稱，於記憶體比對。
 * 已 skipped／adopted 的不動。回傳新標為 adopted 的筆數。
 */
export async function markAdoptedFeedback(tx: DbOrTx, gameId: number): Promise<number> {
  const items = await tx
    .select({
      id: igdbFeedbackItems.id,
      field: igdbFeedbackItems.field,
      platformId: igdbFeedbackItems.platformId,
      regionCode: igdbFeedbackItems.regionCode,
      stage: igdbFeedbackItems.stage,
      newValue: igdbFeedbackItems.newValue,
    })
    .from(igdbFeedbackItems)
    .where(and(eq(igdbFeedbackItems.gameId, gameId), inArray(igdbFeedbackItems.status, ["pending", "submitted"])));
  if (items.length === 0) return 0;

  const releaseRows = await tx
    .select({
      platformId: releaseEvents.platformId,
      regionCode: regions.code,
      stage: releaseEvents.releaseStage,
      date: releaseEvents.releaseDate,
      precision: releaseEvents.precision,
      status: releaseEvents.status,
    })
    .from(releaseEvents)
    .innerJoin(regions, eq(regions.id, releaseEvents.regionId))
    .where(and(eq(releaseEvents.gameId, gameId), eq(releaseEvents.source, "igdb"), eq(releaseEvents.sourceStatus, "active")));
  const langRows = await tx
    .select({ code: languages.code, supportType: gameLanguageSupports.supportType })
    .from(gameLanguageSupports)
    .innerJoin(languages, eq(languages.id, gameLanguageSupports.languageId))
    .where(and(eq(gameLanguageSupports.gameId, gameId), eq(gameLanguageSupports.source, "igdb")));
  const gameRows = await tx.select({ gameStatus: games.gameStatus, alternativeNames: games.alternativeNames }).from(games).where(eq(games.id, gameId)).limit(1);
  const locRows = await tx
    .select({ name: gameLocalizations.name })
    .from(gameLocalizations)
    .where(and(eq(gameLocalizations.gameId, gameId), eq(gameLocalizations.source, "igdb")));
  const snapshot: IgdbAdoptionSnapshot = {
    releases: releaseRows,
    languages: langRows,
    gameStatus: gameRows[0]?.gameStatus ?? null,
    names: [...(gameRows[0]?.alternativeNames ?? []).map((a) => a.name), ...locRows.map((l) => l.name)],
  };

  const adopted = items.filter((i) => isFeedbackAdopted(i, snapshot)).map((i) => i.id);
  if (adopted.length === 0) return 0;
  const now = new Date();
  await tx
    .update(igdbFeedbackItems)
    .set({ status: "adopted", adoptedAt: now, statusChangedAt: now, updatedAt: now })
    .where(inArray(igdbFeedbackItems.id, adopted));
  return adopted.length;
}
