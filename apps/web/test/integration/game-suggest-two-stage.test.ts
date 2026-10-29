/**
 * 搜尋候選兩段式候選池（整合）：短字先在熱度最高的 hotWindow 筆內找符合者，找滿候選池才用，不足退回全表。
 * slug 前綴 s2s-，查詢字 qzx（3 字元，走第一段）。熱度用 9000 萬等級，確保熱門列一定在窗口內。
 * 直接呼叫 suggestGames(…, tuning)，用小的 pool／hotWindow 讓邊界可驗證。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import { SUGGEST_HOT_MAX_CHARS, SUGGEST_HOT_WINDOW } from "@/modules/catalog/domain/entities";
import { buildSearchText, tokenizeForSearch } from "@/modules/catalog/domain/search-text";
import { suggestGames } from "@/modules/catalog/repository/game-suggest";
import { games } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const Q = { tokens: tokenizeForSearch("qzx"), exact: "qzx", locale: null, limit: 50 };
const resolve = () => null;
const slugs = async (tuning?: { hotWindow?: number; hotMaxChars?: number; pool?: number }) =>
  (await suggestGames({ ...Q, tuning }, resolve as never)).map((s) => s.slug);

describe.skipIf(!enabled)("搜尋候選兩段式（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    let igdb = 887000;
    const add = async (slug: string, name: string, popularity: number) => {
      await db.insert(games).values({ igdbId: igdb++, slug, name, searchText: buildSearchText([name]), popularityScore: popularity, coverUrl: null });
    };
    for (let i = 0; i < 5; i++) await add(`s2s-hot-${i}`, `Qzx Hot ${i}`, 90_000_000 + i); // 熱度最高：一定在窗口內
    for (let i = 0; i < 8; i++) await add(`s2s-cold-${i}`, `Qzx Cold ${i}`, 10 - i); // 冷門：不在窗口內
    await add("s2s-exact", "Qzx", 1); // 名稱完全相同但熱度極低
  });

  afterAll(async () => {
    await closeDb();
  });

  it("常數：窗口 3000、只套用 ≤ 3 字元", () => {
    expect(SUGGEST_HOT_WINDOW).toBe(3000);
    expect(SUGGEST_HOT_MAX_CHARS).toBe(3);
  });

  it("第一段夠（pool=3）：只取窗口內最熱的 3 筆，冷門不出現，但不在窗口內的完全相同者仍排第一", async () => {
    const got = await slugs({ pool: 3, hotWindow: 50 });
    expect(got).toEqual(["s2s-exact", "s2s-hot-4", "s2s-hot-3", "s2s-hot-2"]);
  });

  it("第一段不夠（pool=10，窗口內只有 5 筆）退回全表：冷門符合者出現，結果等於關閉第一段", async () => {
    const got = await slugs({ pool: 10, hotWindow: 50 });
    expect(got).toEqual(await slugs({ pool: 10, hotWindow: 0 }));
    expect(got).toContain("s2s-cold-0");
    expect(got.slice(0, 6)).toEqual(["s2s-exact", "s2s-hot-4", "s2s-hot-3", "s2s-hot-2", "s2s-hot-1", "s2s-hot-0"]);
  });

  it("窗口太小（hotWindow=2、pool=3）找不滿而退回全表，結果等於關閉第一段", async () => {
    const got = await slugs({ pool: 3, hotWindow: 2 });
    expect(got).toEqual(await slugs({ pool: 3, hotWindow: 0 }));
    expect(got).toEqual(["s2s-exact", "s2s-hot-4", "s2s-hot-3", "s2s-hot-2"]);
  });

  it("超過 hotMaxChars 的查詢不走第一段：結果等於關閉第一段", async () => {
    expect(await slugs({ pool: 3, hotWindow: 50, hotMaxChars: 2 })).toEqual(await slugs({ pool: 3, hotWindow: 0 }));
  });

  it("hotWindow=0 與預設結果相同（預設窗口內找不滿 120 筆，退回全表）", async () => {
    expect(await slugs({ hotWindow: 0 })).toEqual(await slugs());
    expect((await slugs()).length).toBe(14);
  });
});
