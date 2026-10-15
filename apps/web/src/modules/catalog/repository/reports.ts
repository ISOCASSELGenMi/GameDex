/**
 * 資料更正回報的資料存取（12；schema 的 data_reports）。
 * 只做 CRUD 與目標查詢；核可的 transaction 在 report-resolution.ts。
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type {
  DataReport,
  NewReportInput,
  ReleaseEvent,
  ReportStatus,
  ReportTargetType,
} from "../domain/entities";
import { dataReports, events, gamePlatforms, games, languages, platforms, releaseEvents } from "../schema";

export async function insertReport(input: NewReportInput, db: DbOrTx = getDb()): Promise<DataReport> {
  const [row] = await db
    .insert(dataReports)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      reportType: input.reportType,
      proposed: input.proposed,
      sourceUrl: input.sourceUrl,
      note: input.note,
      reporterUserId: input.reporterUserId ?? null,
      reporterIpHash: input.reporterIpHash,
    })
    .returning();
  return row;
}

/** 某 IP 雜湊自 `since` 起送出的回報數（每 IP 每日上限用；任何狀態都算）。 */
export async function countReportsByIpHashSince(ipHash: string, since: Date, db: DbOrTx = getDb()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dataReports)
    .where(and(eq(dataReports.reporterIpHash, ipHash), gte(dataReports.createdAt, since)));
  return row?.n ?? 0;
}

/** 把 `cutoff` 之前建立的回報的 IP 雜湊設為 NULL（保留 90 天，12）。回傳清除筆數。 */
export async function clearReporterIpHashBefore(cutoff: Date, db: DbOrTx = getDb()): Promise<number> {
  const rows = await db
    .update(dataReports)
    .set({ reporterIpHash: null })
    .where(and(isNotNull(dataReports.reporterIpHash), lt(dataReports.createdAt, cutoff)))
    .returning({ id: dataReports.id });
  return rows.length;
}

export async function getReport(id: number, db: DbOrTx = getDb()): Promise<DataReport | null> {
  const rows = await db.select().from(dataReports).where(eq(dataReports.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 審核佇列：建立時間舊到新（用 (status, created_at) 索引）。 */
export async function listReportsByStatus(
  status: ReportStatus,
  opts: { limit: number; offset?: number },
  db: DbOrTx = getDb(),
): Promise<DataReport[]> {
  return db
    .select()
    .from(dataReports)
    .where(eq(dataReports.status, status))
    .orderBy(asc(dataReports.createdAt), asc(dataReports.id))
    .limit(opts.limit)
    .offset(opts.offset ?? 0);
}

export async function countReportsByStatus(db: DbOrTx = getDb()): Promise<Record<ReportStatus, number>> {
  const rows = await db
    .select({ status: dataReports.status, n: sql<number>`count(*)::int` })
    .from(dataReports)
    .groupBy(dataReports.status);
  const out: Record<ReportStatus, number> = { open: 0, accepted: 0, rejected: 0, duplicate: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** 同目標的其他回報（任何狀態，不含 `excludeId`），新到舊。 */
export async function listReportsForTarget(
  targetType: ReportTargetType,
  targetId: number,
  excludeId: number,
  limit: number,
  db: DbOrTx = getDb(),
): Promise<DataReport[]> {
  return db
    .select()
    .from(dataReports)
    .where(and(eq(dataReports.targetType, targetType), eq(dataReports.targetId, targetId), ne(dataReports.id, excludeId)))
    .orderBy(desc(dataReports.createdAt), desc(dataReports.id))
    .limit(limit);
}

// ── 目標查詢 ────────────────────────────────────────────────────────────

export interface NamedRef {
  id: number;
  slug: string;
  name: string;
}

export async function findGameRef(by: { id: number } | { slug: string }, db: DbOrTx = getDb()): Promise<NamedRef | null> {
  const where = "id" in by ? eq(games.id, by.id) : eq(games.slug, by.slug);
  const rows = await db.select({ id: games.id, slug: games.slug, name: games.name }).from(games).where(where).limit(1);
  return rows[0] ?? null;
}

export async function findPlatformRef(by: { id: number } | { slug: string }, db: DbOrTx = getDb()): Promise<NamedRef | null> {
  const where = "id" in by ? eq(platforms.id, by.id) : eq(platforms.slug, by.slug);
  const rows = await db.select({ id: platforms.id, slug: platforms.slug, name: platforms.name }).from(platforms).where(where).limit(1);
  return rows[0] ?? null;
}

export async function findEventRef(by: { id: number } | { slug: string }, db: DbOrTx = getDb()): Promise<NamedRef | null> {
  const where = "id" in by ? eq(events.id, by.id) : eq(events.slug, by.slug);
  const rows = await db.select({ id: events.id, slug: events.slug, name: events.name }).from(events).where(where).limit(1);
  return rows[0] ?? null;
}

export async function findReleaseEventRow(id: number, db: DbOrTx = getDb()): Promise<ReleaseEvent | null> {
  const rows = await db.select().from(releaseEvents).where(eq(releaseEvents.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 這款遊戲在某平台的全部上市列（任何地區、來源、狀態）。 */
export async function listReleaseRowsForPlatform(gameId: number, platformId: number, db: DbOrTx = getDb()): Promise<ReleaseEvent[]> {
  return db
    .select()
    .from(releaseEvents)
    .where(and(eq(releaseEvents.gameId, gameId), eq(releaseEvents.platformId, platformId)))
    .orderBy(asc(releaseEvents.id));
}

/** 遊戲的平台（不含 mobile，P35），表單的平台選單用。 */
export async function listReportablePlatforms(gameId: number, db: DbOrTx = getDb()): Promise<Array<{ id: number; slug: string; name: string }>> {
  return db
    .select({ id: platforms.id, slug: platforms.slug, name: platforms.name })
    .from(gamePlatforms)
    .innerJoin(platforms, eq(platforms.id, gamePlatforms.platformId))
    .where(and(eq(gamePlatforms.gameId, gameId), ne(platforms.kind, "mobile")))
    .orderBy(asc(platforms.name), asc(platforms.id));
}

export async function isReportablePlatform(gameId: number, platformId: number, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db
    .select({ id: platforms.id })
    .from(gamePlatforms)
    .innerJoin(platforms, eq(platforms.id, gamePlatforms.platformId))
    .where(and(eq(gamePlatforms.gameId, gameId), eq(gamePlatforms.platformId, platformId), ne(platforms.kind, "mobile")))
    .limit(1);
  return rows.length > 0;
}

export async function getPlatformNames(ids: readonly number[], db: DbOrTx = getDb()): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: platforms.id, name: platforms.name })
    .from(platforms)
    .where(inArray(platforms.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** 語言支援回報的語言選單（languages 全表，約百餘列）。 */
export async function listLanguageOptions(db: DbOrTx = getDb()): Promise<Array<{ code: string; name: string; nativeName: string | null }>> {
  return db
    .select({ code: languages.code, name: languages.name, nativeName: languages.nativeName })
    .from(languages)
    .orderBy(asc(languages.name), asc(languages.code));
}

export async function languageCodeExists(code: string, db: DbOrTx = getDb()): Promise<boolean> {
  const rows = await db.select({ id: languages.id }).from(languages).where(eq(languages.code, code)).limit(1);
  return rows.length > 0;
}
