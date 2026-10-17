/**
 * 追蹤目標的唯讀查詢（Phase 7 第 6 波）。accounts 的 follows 以 (targetType, targetId) 多型參照這些表（沒有 FK）；
 * accounts 不碰 catalog 的表，存在檢查與顯示資訊都經這裡。
 *
 * 平台：mobile 不提供（P35，與平台頁、平台 feed 相同），視為不存在。
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type { FollowTargetRef, FollowTargetType, FollowTargetView, ImageResolver, IsoDate } from "../domain/entities";
import { followTargetKey } from "../domain/entities";
import { pgArray } from "./read-tx";

const TABLE: Record<FollowTargetType, { table: string; extra?: SQL }> = {
  game: { table: "games" },
  event: { table: "events" },
  platform: { table: "platforms", extra: sql`t.kind <> 'mobile'` },
  franchise: { table: "franchises" },
  company: { table: "companies" },
};

/** 這些 id 之中，目標仍存在的（其餘＝不存在或不可追蹤）。 */
export async function findExistingTargetIds(type: FollowTargetType, ids: readonly number[], db: DbOrTx = getDb()): Promise<Set<number>> {
  const unique = [...new Set(ids.filter((i) => Number.isSafeInteger(i) && i > 0 && i <= 2_147_483_647))];
  if (unique.length === 0) return new Set();
  const { table, extra } = TABLE[type];
  const res = await db.execute<{ id: number }>(sql`
    SELECT t.id FROM ${sql.raw(table)} t
    WHERE t.id = ANY(${pgArray(unique)}::int[]) ${extra ? sql`AND ${extra}` : sql``}
  `);
  return new Set(res.rows.map((r) => Number(r.id)));
}

interface ViewRow extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  original_name: string;
  cover_url: string | null;
  first_release_date: string | null;
  start_time: Date | string | null;
  abbreviation: string | null;
  kind: string | null;
}

/** 依 (種類, id) 批次取顯示資訊；不存在的不在 Map（key＝`type:id`）。 */
export async function getFollowTargetViews(
  refs: readonly FollowTargetRef[],
  locale: string | null,
  resolveImage: ImageResolver,
  db: DbOrTx = getDb(),
): Promise<Map<string, FollowTargetView>> {
  const out = new Map<string, FollowTargetView>();
  const byType = new Map<FollowTargetType, number[]>();
  for (const r of refs) {
    const list = byType.get(r.targetType) ?? [];
    list.push(r.targetId);
    byType.set(r.targetType, list);
  }
  const base = (type: FollowTargetType, r: ViewRow): FollowTargetView => ({
    targetType: type,
    targetId: Number(r.id),
    slug: r.slug,
    name: r.name,
    originalName: r.original_name,
    cover: null,
    firstReleaseDate: null,
    startTime: null,
    abbreviation: null,
    kind: null,
  });
  for (const [type, ids] of byType) {
    const idArr = pgArray([...new Set(ids)]);
    let res: { rows: ViewRow[] };
    switch (type) {
      case "game":
        res = await db.execute<ViewRow>(sql`
          SELECT g.id, g.slug, COALESCE(NULLIF(g.display_names ->> ${locale ?? ""}, ''), g.name) AS name, g.name AS original_name,
            g.cover_url, g.first_release_date::text AS first_release_date, NULL::timestamptz AS start_time, NULL::text AS abbreviation, NULL::text AS kind
          FROM games g WHERE g.id = ANY(${idArr}::int[])`);
        break;
      case "event":
        res = await db.execute<ViewRow>(sql`
          SELECT e.id, e.slug, e.name, e.name AS original_name, NULL::text AS cover_url, NULL::text AS first_release_date,
            e.start_time, NULL::text AS abbreviation, e.kind::text AS kind
          FROM events e WHERE e.id = ANY(${idArr}::int[])`);
        break;
      case "platform":
        res = await db.execute<ViewRow>(sql`
          SELECT p.id, p.slug, p.name, p.name AS original_name, NULL::text AS cover_url, NULL::text AS first_release_date,
            NULL::timestamptz AS start_time, p.abbreviation, p.kind::text AS kind
          FROM platforms p WHERE p.id = ANY(${idArr}::int[]) AND p.kind <> 'mobile'`);
        break;
      case "franchise":
        res = await db.execute<ViewRow>(sql`
          SELECT f.id, f.slug, f.name, f.name AS original_name, NULL::text AS cover_url, NULL::text AS first_release_date,
            NULL::timestamptz AS start_time, NULL::text AS abbreviation, f.kind::text AS kind
          FROM franchises f WHERE f.id = ANY(${idArr}::int[])`);
        break;
      case "company":
        res = await db.execute<ViewRow>(sql`
          SELECT c.id, c.slug, c.name, c.name AS original_name, NULL::text AS cover_url, NULL::text AS first_release_date,
            NULL::timestamptz AS start_time, NULL::text AS abbreviation, NULL::text AS kind
          FROM companies c WHERE c.id = ANY(${idArr}::int[])`);
        break;
    }
    for (const r of res.rows) {
      const v = base(type, r);
      if (type === "game") {
        v.cover = resolveImage(r.cover_url, "cover");
        v.firstReleaseDate = (r.first_release_date as IsoDate | null) ?? null;
      } else if (type === "event") {
        v.startTime = r.start_time ? new Date(r.start_time).toISOString() : null;
        v.kind = r.kind;
      } else if (type === "platform") {
        v.abbreviation = r.abbreviation;
        v.kind = r.kind;
      } else if (type === "franchise") {
        v.kind = r.kind;
      }
      out.set(followTargetKey(type, v.targetId), v);
    }
  }
  return out;
}
