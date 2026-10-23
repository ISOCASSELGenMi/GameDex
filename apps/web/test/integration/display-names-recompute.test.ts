/**
 * recompute_display_names（整合）：規則改動後全庫重算 games.display_names。
 * igdbId／slug 前綴 rdn-（igdbId 87xxxx）。其他測試檔的遊戲在同一個 DB：斷言只看自己的列。
 * 驗證：規則前後不同的資料被更新、相同的不動（xmin 不變）、人工 localization 名稱生效、
 * 失去 zh-Hant 的被移除並計數、不動 search_text／updated_at、不寫 change_feed、分批游標跨批正確。
 */
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import { gameLocalizations, games } from "@/modules/catalog/schema";
import { recomputeDisplayNames } from "@/modules/catalog/use-cases/sync/recompute-display-names";
import { recomputeDisplayNamesBatch } from "@/modules/catalog/repository/display-names";

const enabled = !!process.env.TEST_DATABASE_URL;

const ids: Record<string, number> = {};
const SEARCH = "rdn search text";

async function xmin(id: number): Promise<string> {
  const res = await getDb().execute<{ x: string }>(sql`SELECT xmin::text AS x FROM games WHERE id = ${id}`);
  return res.rows[0]!.x;
}
const displayOf = async (key: string) => (await getDb().select({ d: games.displayNames }).from(games).where(eq(games.id, ids[key]!)))[0]!.d;
const feedCount = async () => (await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM change_feed`)).rows[0]!.n;

describe.skipIf(!enabled)("recompute_display_names（整合）", () => {
  let before: Record<string, string> = {};
  beforeAll(async () => {
    const db = getDb();
    const add = async (key: string, igdbId: number, alt: { name: string; comment: string | null }[], stored: Record<string, string>) => {
      const [g] = await db
        .insert(games)
        .values({ igdbId, slug: `rdn-${key}`, name: `RDN ${key}`, alternativeNames: alt, displayNames: stored, searchText: SEARCH })
        .returning({ id: games.id });
      ids[key] = g!.id;
    };
    // 新規則會補上 zh-Hant（存的是空的）
    await add("add", 870001, [{ name: "新增繁體名", comment: "Traditional Chinese title" }], {});
    // 規則收緊：存的 zh-Hant 來自標記不明的別名，重算後應移除
    await add("remove", 870002, [{ name: "不明繁簡", comment: "Chinese title" }], { "zh-Hant": "不明繁簡" });
    // 已經正確：不該被更新
    await add("same", 870003, [{ name: "已正確名", comment: "Traditional Chinese title" }], { "zh-Hant": "已正確名" });
    // localization 的名稱（人工 source=manual）與存的舊值不同 → 更新
    await add("manual", 870004, [], { ja: "舊的 igdb 名" });
    await db.insert(gameLocalizations).values({ gameId: ids.manual!, localeCode: "ja", name: "人工日文名", source: "manual" });
    // 沒有別名也沒有 localization：維持 {}
    await add("empty", 870005, [], {});
    // 保留 ja（igdb），同時補 zh-Hant
    await add("keepja", 870006, [{ name: "台灣繁體名", comment: "Taiwan title" }], { ja: "日本語名" });
    await db.insert(gameLocalizations).values({ gameId: ids.keepja!, localeCode: "ja", name: "日本語名", source: "igdb" });
    before = { same: await xmin(ids.same!), empty: await xmin(ids.empty!) };
  });
  afterAll(async () => {
    await getDb().delete(games).where(inArray(games.id, Object.values(ids)));
    await closeDb();
  });

  it("全庫重算：補上、移除、保持、manual 優先；只動 display_names", async () => {
    const feedBefore = await feedCount();
    const logs: string[] = [];
    // batchSize 2：六款自己的遊戲至少跨三批，驗證游標
    const total = await recomputeDisplayNames((m) => logs.push(m), { batchSize: 2 });
    expect(total.scanned).toBeGreaterThanOrEqual(6);
    expect(total.updated).toBeGreaterThanOrEqual(4);
    expect(total.removedZhHant).toBeGreaterThanOrEqual(1);
    expect(logs.at(-1)).toContain("重算完成");

    expect(await displayOf("add")).toEqual({ "zh-Hant": "新增繁體名" });
    expect(await displayOf("remove")).toEqual({});
    expect(await displayOf("same")).toEqual({ "zh-Hant": "已正確名" });
    expect(await displayOf("manual")).toEqual({ ja: "人工日文名" });
    expect(await displayOf("empty")).toEqual({});
    expect(await displayOf("keepja")).toEqual({ ja: "日本語名", "zh-Hant": "台灣繁體名" });

    // 相同的不動：xmin 不變
    expect(await xmin(ids.same!)).toBe(before.same);
    expect(await xmin(ids.empty!)).toBe(before.empty);
    // 只動 display_names：search_text 不變、沒有 change_feed
    const rows = await getDb().select({ s: games.searchText }).from(games).where(inArray(games.id, Object.values(ids)));
    expect(rows.every((r) => r.s === SEARCH)).toBe(true);
    expect(await feedCount()).toBe(feedBefore);
  });

  it("第二次執行＝冪等：自己的列 0 更新", async () => {
    const mineBefore = await Promise.all(Object.values(ids).map(xmin));
    const again = await recomputeDisplayNames(() => {}, { batchSize: 3 });
    expect(again.removedZhHant).toBe(0);
    expect(await Promise.all(Object.values(ids).map(xmin))).toEqual(mineBefore);
  });

  it("單批：游標之後才掃描；沒有資料回 lastId＝null", async () => {
    const maxId = Math.max(...Object.values(ids)) + 1_000_000;
    expect(await recomputeDisplayNamesBatch(maxId, 10)).toEqual({ scanned: 0, updated: 0, removedZhHant: 0, lastId: null });
    const first = await recomputeDisplayNamesBatch(ids.add! - 1, 1);
    expect(first.scanned).toBe(1);
    expect(first.lastId).toBe(ids.add);
  });
});
