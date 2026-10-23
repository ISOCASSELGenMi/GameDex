/**
 * GameDex 第二輪（Z1A）：搜尋候選 GET /api/v1/games/suggest（整合；handler 直接呼叫）。
 * slug 前綴 z1a-。重點：完全符合 → 開頭符合 → 熱度排序、依 locale 的標題、年份與最多 3 個平台（不含 mobile）、
 * 1 個字元（CJK）也能查、筆數上限、公開快取標頭、錯誤參數。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route Handler 在請求範圍外呼叫 connection() 會丟錯；這個檔案直接呼叫 handler，所以換成空操作
vi.mock("next/server", () => ({ connection: async () => {} }));

import { closeDb, getDb } from "@/kernel/db/client";
import { GET as suggest, GAME_SUGGEST_CACHE_CONTROL, type GameSuggestionDto } from "@/modules/catalog/api/game-suggest";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { gamePlatforms, games, platforms } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const call = (qs: string) => suggest(new Request(`${ORIGIN}/api/v1/games/suggest${qs}`));
const items = async (qs: string): Promise<GameSuggestionDto[]> => ((await (await call(qs)).json()) as { items: GameSuggestionDto[] }).items;

describe.skipIf(!enabled)("搜尋候選（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const plat: number[] = [];
    for (const [slug, name, abbr, kind] of [
      ["z1a-ps5", "Z1A PlayStation 5", "PS5", "console"],
      ["z1a-pc", "Z1A PC", "PC", "pc"],
      ["z1a-switch", "Z1A Switch", "NSW", "console"],
      ["z1a-xbox", "Z1A Xbox Series", "XSX", "console"],
      ["z1a-ios", "Z1A iOS", "iOS", "mobile"],
    ] as const) {
      const [p] = await db.insert(platforms).values({ slug, name, abbreviation: abbr, kind }).returning({ id: platforms.id });
      plat.push(p!.id);
    }
    let igdb = 886000;
    const add = async (slug: string, name: string, popularity: number, opts: { display?: Record<string, string>; year?: number; plats?: number[] } = {}) => {
      const [g] = await db
        .insert(games)
        .values({
          igdbId: igdb++,
          slug,
          name,
          displayNames: opts.display ?? null,
          searchText: buildSearchText([name, ...Object.values(opts.display ?? {})]),
          popularityScore: popularity,
          firstReleaseDate: opts.year ? `${opts.year}-05-05` : null,
          coverUrl: null,
        })
        .returning({ id: games.id });
      for (const p of opts.plats ?? []) await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: p });
      return g!.id;
    };
    await add("z1a-exact", "Zqzsug", 1, { year: 2019, plats: [plat[0]!, plat[1]!, plat[2]!, plat[3]!, plat[4]!] });
    await add("z1a-prefix", "Zqzsug Reloaded", 900, { year: 2023, plats: [plat[1]!] });
    await add("z1a-contains", "Another Zqzsug", 5000);
    await add("z1a-zh", "Moonlit Tavern", 50, { display: { "zh-Hant": "月光酒館Z1A" }, year: 2021, plats: [plat[1]!] });
    for (let i = 0; i < 12; i++) await add(`z1a-lim-${String(i).padStart(2, "0")}`, `Zqzlimit ${i}`, 100 - i);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("排序：名稱完全符合 → 開頭符合 → 其餘依熱度（熱度最高的不會壓過完全符合）", async () => {
    const got = await items("?q=zqzsug&locale=en");
    expect(got.map((i) => i.slug)).toEqual(["z1a-exact", "z1a-prefix", "z1a-contains"]);
  });

  it("欄位：名稱、原名、年份、平台縮寫（最多 3 個、不含 mobile、依名稱排序）；沒有封面為 null", async () => {
    const [exact, prefix, contains] = await items("?q=zqzsug");
    expect(exact).toMatchObject({ slug: "z1a-exact", name: "Zqzsug", originalName: "Zqzsug", coverUrl: null, year: 2019 });
    expect(exact!.platforms).toEqual(["PC", "PS5", "NSW"]); // 依平台名稱排序、最多 3 個
    expect(exact!.platforms).not.toContain("iOS");
    expect(prefix).toMatchObject({ year: 2023, platforms: ["PC"] });
    expect(contains).toMatchObject({ year: null, platforms: [] });
  });

  it("標題依介面語言（displayNames），沒有該語言退回原名；英文與日文查詢也找得到中文標題的遊戲", async () => {
    const zh = await items(`?q=${encodeURIComponent("月光酒館")}&locale=zh-Hant`);
    expect(zh).toHaveLength(1);
    expect(zh[0]).toMatchObject({ slug: "z1a-zh", name: "月光酒館Z1A", originalName: "Moonlit Tavern" });
    const en = await items("?q=moonlit+tavern&locale=en");
    expect(en[0]).toMatchObject({ slug: "z1a-zh", name: "Moonlit Tavern" });
    const ja = await items("?q=moonlit&locale=ja");
    expect(ja[0]).toMatchObject({ slug: "z1a-zh", name: "Moonlit Tavern" });
  });

  it("只輸入 1 個中文字也能查（ILIKE）", async () => {
    const got = await items(`?q=${encodeURIComponent("酒")}&locale=zh-Hant`);
    expect(got.map((i) => i.slug)).toContain("z1a-zh");
  });

  it("筆數：預設 8、limit 可調、最多 10", async () => {
    expect(await items("?q=zqzlimit")).toHaveLength(8);
    expect(await items("?q=zqzlimit&limit=3")).toHaveLength(3);
    expect(await items("?q=zqzlimit&limit=50")).toHaveLength(10);
    expect(await items("?q=zqzlimit&limit=0")).toHaveLength(1);
    // 同樣開頭 → 依熱度
    expect((await items("?q=zqzlimit&limit=2")).map((i) => i.slug)).toEqual(["z1a-lim-00", "z1a-lim-01"]);
  });

  it("公開可快取、不送 Set-Cookie；沒帶 q 回 400；空白 q 回空陣列；找不到回空陣列", async () => {
    const res = await call("?q=zqzsug");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(GAME_SUGGEST_CACHE_CONTROL);
    expect(res.headers.get("set-cookie")).toBeNull();
    const bad = await call("");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ code: "q_required" });
    expect(await items("?q=%20%20")).toEqual([]);
    expect(await items("?q=qqqqnotagamezzz")).toEqual([]);
  });

  it("LIKE 特殊字元不會變成萬用字元", async () => {
    expect(await items("?q=%25")).toEqual([]);
    expect(await items("?q=_")).toEqual([]);
  });
});
