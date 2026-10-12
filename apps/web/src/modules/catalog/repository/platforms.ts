import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { DatePrecision, IsoDate, PlatformFamilyRecord, PlatformKind } from "../domain/entities";
import { platformFamilies, platformReleaseDates, platforms } from "../schema";

export type Platform = typeof platforms.$inferSelect;
export type PlatformInput = typeof platforms.$inferInsert;
export type PlatformReleaseDateRow = typeof platformReleaseDates.$inferSelect;

export async function getPlatformBySlug(slug: string, db: DbOrTx = getDb()): Promise<Platform | null> {
  const rows = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getPlatformByIgdbId(igdbId: number, db: DbOrTx = getDb()): Promise<Platform | null> {
  const rows = await db.select().from(platforms).where(eq(platforms.igdbId, igdbId)).limit(1);
  return rows[0] ?? null;
}

export async function getPlatformReleaseDates(platformId: number, db: DbOrTx = getDb()): Promise<PlatformReleaseDateRow[]> {
  return db.select().from(platformReleaseDates).where(eq(platformReleaseDates.platformId, platformId));
}

/** 以 slug 為自然鍵 upsert（人工新增的主機沒有 igdbId）。IGDB 同步用 syncIgdbPlatform。 */
export async function upsertPlatform(input: PlatformInput, db: DbOrTx = getDb()): Promise<Platform> {
  const [row] = await db
    .insert(platforms)
    .values(input)
    .onConflictDoUpdate({ target: platforms.slug, set: input })
    .returning();
  return row;
}

/** 以 igdbId upsert 平台家族；回傳 igdbId → 我方 id。 */
export async function upsertIgdbPlatformFamilies(
  items: readonly PlatformFamilyRecord[],
  db: DbOrTx = getDb(),
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (items.length === 0) return map;
  const rows = await db
    .insert(platformFamilies)
    .values(items.map((f) => ({ igdbId: f.igdbId, name: f.name, slug: f.slug })))
    .onConflictDoUpdate({
      target: platformFamilies.igdbId,
      set: { name: sql`excluded.name`, slug: sql`excluded.slug` },
    })
    .returning({ id: platformFamilies.id, igdbId: platformFamilies.igdbId });
  for (const r of rows) if (r.igdbId != null) map.set(r.igdbId, r.id);
  return map;
}

export interface IgdbPlatformSyncInput {
  igdbId: number;
  name: string;
  slug: string;
  abbreviation: string | null;
  alternativeName: string | null;
  kind: PlatformKind;
  generation: number | null;
  familyId: number | null;
  logoUrl: string | null;
  summary: string | null;
  /** 每個地區最多一筆（已取最早）；完整取代該平台的 igdb 列。 */
  releaseDates: ReadonlyArray<{ regionId: number; releaseDate: IsoDate | null; precision: DatePrecision }>;
}

export type IgdbPlatformSyncResult =
  | { kind: "inserted" | "updated"; platformId: number; slug: string }
  | { kind: "manual_skipped"; platformId: number | null };

/**
 * 同步一個 IGDB 平台與其硬體上市日（同一 transaction）。
 * - `source='manual'` 的平台不覆蓋，上市日也不動（04 §平台同步）。
 * - 不寫 status、discontinuedOn、source：這些只能人工維護。
 * - slug 已被別的平台（例如人工新增）佔用 → 改用 `{slug}-{igdbId}`，不讓同步失敗。
 * - 上市日：這次沒出現的地區刪除 igdb 列；`source='manual'` 的列不覆蓋、不刪除。
 */
export async function syncIgdbPlatform(
  input: IgdbPlatformSyncInput,
  db: DbOrTx = getDb(),
): Promise<IgdbPlatformSyncResult> {
  return db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ igdbId: platforms.igdbId })
      .from(platforms)
      .where(eq(platforms.slug, input.slug))
      .limit(1);
    const slug = taken && taken.igdbId !== input.igdbId ? `${input.slug}-${input.igdbId}` : input.slug;

    const values = {
      name: input.name,
      slug,
      abbreviation: input.abbreviation,
      alternativeName: input.alternativeName,
      kind: input.kind,
      generation: input.generation,
      familyId: input.familyId,
      logoUrl: input.logoUrl,
      summary: input.summary,
    };
    const [row] = await tx
      .insert(platforms)
      .values({ ...values, igdbId: input.igdbId, source: "igdb" })
      .onConflictDoUpdate({
        target: platforms.igdbId,
        set: values,
        setWhere: sql`${platforms.source} <> 'manual'`,
      })
      .returning({ id: platforms.id, inserted: sql<boolean>`(xmax = 0)` });

    if (!row) {
      const existing = await getPlatformByIgdbId(input.igdbId, tx);
      return { kind: "manual_skipped", platformId: existing?.id ?? null };
    }

    const regionIds = input.releaseDates.map((r) => r.regionId);
    await tx
      .delete(platformReleaseDates)
      .where(
        and(
          eq(platformReleaseDates.platformId, row.id),
          eq(platformReleaseDates.source, "igdb"),
          regionIds.length > 0 ? notInArray(platformReleaseDates.regionId, regionIds) : undefined,
        ),
      );
    if (input.releaseDates.length > 0) {
      await tx
        .insert(platformReleaseDates)
        .values(input.releaseDates.map((r) => ({ platformId: row.id, ...r, source: "igdb" })))
        .onConflictDoUpdate({
          target: [platformReleaseDates.platformId, platformReleaseDates.regionId],
          set: { releaseDate: sql`excluded.release_date`, precision: sql`excluded.precision` },
          setWhere: sql`${platformReleaseDates.source} <> 'manual'`,
        });
    }
    return { kind: row.inserted ? "inserted" : "updated", platformId: row.id, slug };
  });
}

/** 遊戲同步用：IGDB 平台 id → 我方 id 與種類（mobile 的上市日不寫入，P35）。 */
export async function listIgdbPlatformRefs(db: DbOrTx = getDb()): Promise<Map<number, { id: number; kind: PlatformKind }>> {
  const rows = await db
    .select({ id: platforms.id, igdbId: platforms.igdbId, kind: platforms.kind })
    .from(platforms)
    .where(isNotNull(platforms.igdbId));
  return new Map(rows.map((r) => [r.igdbId!, { id: r.id, kind: r.kind }]));
}
