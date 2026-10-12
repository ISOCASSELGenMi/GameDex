/**
 * 遊戲同步用的查找表批次 upsert（genres、themes、companies、franchises、languages）。
 * 以 igdbId 為自然鍵，回傳 igdbId → 我方 id。slug（languages 是 code）被其他列佔用時改用 `{slug}-{igdbId}`，不讓同步失敗。
 */
import { inArray, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { FranchiseKind, LanguageRecord, TaxonomyRecord } from "../domain/entities";
import { companies, franchises, genres, languages, themes } from "../schema";

function uniqueBy<T>(items: readonly T[], key: (t: T) => string | number): T[] {
  const m = new Map<string | number, T>();
  for (const it of items) if (!m.has(key(it))) m.set(key(it), it);
  return [...m.values()];
}

/** 已被「別的 igdbId」佔用的 slug 改名；批次內互撞也一併處理。 */
function resolveSlugs<T extends { igdbId: number; slug: string }>(
  items: readonly T[],
  taken: ReadonlyArray<{ slug: string; igdbId: number | null }>,
): T[] {
  const owner = new Map(taken.map((t) => [t.slug, t.igdbId]));
  return items.map((it) => {
    const o = owner.get(it.slug);
    if (o !== undefined && o !== it.igdbId) return { ...it, slug: `${it.slug}-${it.igdbId}` };
    owner.set(it.slug, it.igdbId);
    return it;
  });
}

type SlugTable = typeof genres | typeof themes | typeof companies;

async function upsertSlugTable(
  table: SlugTable,
  items: readonly TaxonomyRecord[],
  db: DbOrTx,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const unique = uniqueBy(items, (i) => i.igdbId);
  if (unique.length === 0) return map;
  const taken = await db
    .select({ slug: table.slug, igdbId: table.igdbId })
    .from(table)
    .where(inArray(table.slug, unique.map((i) => i.slug)));
  const rows = await db
    .insert(table)
    .values(resolveSlugs(unique, taken).map((i) => ({ igdbId: i.igdbId, name: i.name, slug: i.slug })))
    .onConflictDoUpdate({ target: table.igdbId, set: { name: sql`excluded.name` } })
    .returning({ id: table.id, igdbId: table.igdbId });
  for (const r of rows) map.set(r.igdbId, r.id);
  return map;
}

export function upsertGenres(items: readonly TaxonomyRecord[], db: DbOrTx = getDb()) {
  return upsertSlugTable(genres, items, db);
}

export function upsertThemes(items: readonly TaxonomyRecord[], db: DbOrTx = getDb()) {
  return upsertSlugTable(themes, items, db);
}

/** 公司的 slug 只在新增時決定，之後同步只更新名稱（避免網址變動）。 */
export function upsertCompanies(items: readonly TaxonomyRecord[], db: DbOrTx = getDb()) {
  return upsertSlugTable(companies, items, db);
}

export const franchiseKey = (kind: FranchiseKind, igdbId: number) => `${kind}:${igdbId}`;

/** franchise 與 collection 是不同 id 空間，鍵為 franchiseKey(kind, igdbId)。 */
export async function upsertFranchises(
  items: ReadonlyArray<TaxonomyRecord & { kind: FranchiseKind }>,
  db: DbOrTx = getDb(),
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = uniqueBy(items, (i) => franchiseKey(i.kind, i.igdbId));
  if (unique.length === 0) return map;
  const rows = await db
    .insert(franchises)
    .values(unique.map((i) => ({ igdbId: i.igdbId, kind: i.kind, name: i.name, slug: i.slug })))
    .onConflictDoUpdate({
      target: [franchises.igdbId, franchises.kind],
      set: { name: sql`excluded.name`, slug: sql`excluded.slug` },
    })
    .returning({ id: franchises.id, igdbId: franchises.igdbId, kind: franchises.kind });
  for (const r of rows) map.set(franchiseKey(r.kind, r.igdbId), r.id);
  return map;
}

/** languages.code 是 unique；被別的語言佔用時改用 `{code}-{igdbId}`。 */
export async function upsertLanguages(items: readonly LanguageRecord[], db: DbOrTx = getDb()): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const unique = uniqueBy(items, (i) => i.igdbId);
  if (unique.length === 0) return map;
  const taken = await db
    .select({ slug: languages.code, igdbId: languages.igdbId })
    .from(languages)
    .where(inArray(languages.code, unique.map((i) => i.code)));
  const resolved = resolveSlugs(
    unique.map((i) => ({ ...i, slug: i.code })),
    taken,
  );
  const rows = await db
    .insert(languages)
    .values(resolved.map((i) => ({ igdbId: i.igdbId, code: i.slug, name: i.name, nativeName: i.nativeName })))
    .onConflictDoUpdate({
      target: languages.igdbId,
      set: { name: sql`excluded.name`, nativeName: sql`excluded.native_name` },
    })
    .returning({ id: languages.id, igdbId: languages.igdbId });
  for (const r of rows) if (r.igdbId != null) map.set(r.igdbId, r.id);
  return map;
}
