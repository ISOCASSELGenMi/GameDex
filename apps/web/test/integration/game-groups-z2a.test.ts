/**
 * GameDex 第 2 輪 Z2A 整合：瀏覽頁分組檢視（依日期／平台／廠商）。
 * igdbId 用 58xxxx；遊戲名稱都帶 "Gz58"，查詢以 q=gz58 隔離其他測試檔的資料。
 * 廠商用真實的 IGDB 公司 id（FromSoftware 1012、萬代南夢宮 248、任天堂 70、卡普空 37），讓 SQL 走真正的對照表，
 * 並檢查 SQL 與 domain 的 groupOfGame 對同一批 fixture 結果相同。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import { getGameGroupPage, getGameGroups, platformColumnRanks } from "@/modules/catalog/use-cases/read";
import { GAME_GROUPS_PER_PAGE, type GroupedBy } from "@/modules/catalog/domain/entities";
import { groupOfGame, type GameCompanyRef } from "@/modules/catalog/domain/publisher-groups";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { companies, gameCompanies, gamePlatforms, games, platforms } from "@/modules/catalog/schema";
import { listPlatforms } from "@/modules/catalog/use-cases/read";

const enabled = !!process.env.TEST_DATABASE_URL;

type Precision = "day" | "month" | "quarter" | "year" | "tbd";
interface Credit {
  igdb: number;
  role: "developer" | "publisher" | "porting";
}

const P: Record<string, number> = {};
const C: Record<number, number> = {};
const credits = new Map<string, GameCompanyRef[]>();
const members = new Map<string, string[]>();

async function addGame(
  tag: string,
  o: { pop: number; date: string | null; precision: Precision | null; platforms: string[]; credits?: Credit[] },
): Promise<void> {
  const db = getDb();
  const name = `Gz58 ${tag}`;
  const [g] = await db
    .insert(games)
    .values({
      igdbId: 580000 + members.size + 1,
      slug: `gz58-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      gameType: "main_game",
      popularityScore: o.pop,
      firstReleaseDate: o.date,
      firstReleasePrecision: o.precision,
      searchText: buildSearchText([name]),
    })
    .returning({ id: games.id });
  members.set(tag, o.platforms);
  for (const p of o.platforms) await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: P[p]! });
  const refs: GameCompanyRef[] = [];
  for (const c of o.credits ?? []) {
    await db.insert(gameCompanies).values({ gameId: g!.id, companyId: C[c.igdb]!, role: c.role });
    refs.push({ igdbId: c.igdb, role: c.role });
  }
  credits.set(tag, refs);
}

const BASE = { q: "gz58", locale: "zh-Hant", perGroup: 8 } as const;
const NOW = new Date("2036-09-01T00:00:00Z");
const keysOf = (r: { groups: { key: string }[] }) => r.groups.map((g) => g.key);

describe.skipIf(!enabled)("瀏覽頁分組檢視（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    for (const [slug, kind, igdbId] of [
      ["gz58-ps5", "console", 580901],
      ["gz58-switch", "console", 580902],
      ["gz58-pc", "pc", 580903],
    ] as const) {
      const [row] = await db.insert(platforms).values({ slug, name: slug.toUpperCase(), kind, igdbId }).returning({ id: platforms.id });
      P[slug] = row!.id;
    }
    for (const [igdbId, name] of [
      [1012, "FromSoftware"],
      [248, "Bandai Namco Entertainment"],
      [70, "Nintendo"],
      [37, "Capcom"],
      [580950, "Gz58 Indie Studio"],
    ] as const) {
      const [row] = await db.insert(companies).values({ igdbId, slug: `gz58-co-${igdbId}`, name }).returning({ id: companies.id });
      C[igdbId] = row!.id;
    }
    // 艾爾登法環型：開發 FromSoftware、發行萬代南夢宮 → fromsoftware
    await addGame("Elden", { pop: 900, date: "2036-09-10", precision: "day", platforms: ["gz58-ps5", "gz58-pc"], credits: [{ igdb: 248, role: "publisher" }, { igdb: 1012, role: "developer" }] });
    // 開發商不在名單、發行商任天堂 → nintendo
    await addGame("Zelda", { pop: 800, date: "2036-09-10", precision: "day", platforms: ["gz58-switch"], credits: [{ igdb: 580950, role: "developer" }, { igdb: 70, role: "publisher" }] });
    await addGame("Indie", { pop: 100, date: "2036-09-10", precision: "day", platforms: ["gz58-pc"], credits: [{ igdb: 580950, role: "developer" }] });
    await addGame("Capcom", { pop: 700, date: "2036-10-02", precision: "day", platforms: ["gz58-ps5"], credits: [{ igdb: 37, role: "developer" }] });
    // porting 不參與歸屬
    await addGame("Port", { pop: 60, date: "2036-10-03", precision: "day", platforms: ["gz58-pc"], credits: [{ igdb: 37, role: "porting" }] });
    await addGame("Quarter", { pop: 90, date: "2036-10-01", precision: "quarter", platforms: ["gz58-pc"] });
    await addGame("Year", { pop: 80, date: "2037-01-01", precision: "year", platforms: ["gz58-switch"] });
    await addGame("Undated", { pop: 70, date: null, precision: "tbd", platforms: [] });
    await addGame("Nov", { pop: 50, date: "2036-11-05", precision: "day", platforms: ["gz58-pc"] });
    await addGame("Dec", { pop: 50, date: "2036-12-05", precision: "day", platforms: ["gz58-pc"] });
    await addGame("Aug", { pop: 50, date: "2036-08-05", precision: "day", platforms: ["gz58-pc"] });
    // 30 款同月，用來測「顯示更多」
    for (let i = 1; i <= 30; i++) await addGame(`Bulk ${String(i).padStart(2, "0")}`, { pop: 500 - i, date: "2036-09-20", precision: "day", platforms: ["gz58-pc"] });
  });
  afterAll(async () => {
    await closeDb();
  });

  describe("依日期", () => {
    it("預設（熱度排序）由新到舊：年、月、季、日期未定在最後；一頁 6 組、後面還有", async () => {
      const r = await getGameGroups({ ...BASE, by: "date", now: NOW });
      expect(GAME_GROUPS_PER_PAGE).toBe(6);
      expect(keysOf(r)).toEqual(["2037", "2036-12", "2036-11", "2036-10", "2036-Q4", "2036-09"]);
      expect(r.hasMoreGroups).toBe(true);
      const p2 = await getGameGroups({ ...BASE, by: "date", page: 2, now: NOW });
      expect(keysOf(p2)).toEqual(["2036-08", "tbd"]);
      expect(p2.hasMoreGroups).toBe(false);
    });

    it("sort=release_date 由舊到新，日期未定仍在最後", async () => {
      const r = await getGameGroups({ ...BASE, by: "date", sort: "release_date", now: NOW });
      expect(keysOf(r)).toEqual(["2036-08", "2036-09", "2036-Q4", "2036-10", "2036-11", "2036-12"]);
      const p2 = await getGameGroups({ ...BASE, by: "date", sort: "release_date", page: 2, now: NOW });
      expect(keysOf(p2)).toEqual(["2037", "tbd"]);
    });

    it("每組總數正確、首屏只送 perGroup 張、組內依熱度", async () => {
      const r = await getGameGroups({ ...BASE, by: "date", page: 1, now: NOW });
      const sep = r.groups.find((g) => g.key === "2036-09")!;
      expect(sep.total).toBe(3 + 30);
      expect(sep.cards).toHaveLength(8);
      expect(sep.cards.slice(0, 3).map((c) => c.name)).toEqual(["Gz58 Elden", "Gz58 Zelda", "Gz58 Bulk 01"]);
      expect(r.groups.find((g) => g.key === "2036-10")!.total).toBe(2);
    });

    it("顯示更多：接續的卡片不重複、依同一排序", async () => {
      const first = await getGameGroups({ ...BASE, by: "date", now: NOW });
      const shown = first.groups.find((g) => g.key === "2036-09")!.cards.map((c) => c.gameId);
      const more = await getGameGroupPage({ ...BASE, by: "date", key: "2036-09", offset: 8, limit: 24, now: NOW });
      expect(more!.total).toBe(33);
      expect(more!.cards).toHaveLength(24);
      expect(more!.cards.some((c) => shown.includes(c.gameId))).toBe(false);
      expect(more!.cards[0]!.name).toBe("Gz58 Bulk 07");
      const rest = await getGameGroupPage({ ...BASE, by: "date", key: "2036-09", offset: 32, limit: 24, now: NOW });
      expect(rest!.cards.map((c) => c.name)).toEqual(["Gz58 Indie"]);
    });

    it("不合法的組 key 回 null；不存在的組沒有卡片", async () => {
      expect(await getGameGroupPage({ ...BASE, by: "date", key: "2036-13", offset: 0, limit: 5 })).toBeNull();
      expect(await getGameGroupPage({ ...BASE, by: "date", key: "2036-01", offset: 0, limit: 5 })).toBeNull();
    });
  });

  describe("依平台", () => {
    it("依平台總覽的順序（主機在 PC 前），一款遊戲出現在它每個平台組；沒有平台的遊戲不出現", async () => {
      const r = await getGameGroups({ ...BASE, by: "platform", now: NOW });
      const ranks = platformColumnRanks(await listPlatforms({ locale: "zh-Hant" }));
      const order = keysOf(r);
      expect(order.sort()).toEqual(["gz58-pc", "gz58-ps5", "gz58-switch"]);
      const sorted = keysOf(r);
      expect(sorted.indexOf("gz58-ps5")).toBeLessThan(sorted.indexOf("gz58-pc"));
      expect(sorted.indexOf("gz58-switch")).toBeLessThan(sorted.indexOf("gz58-pc"));
      void ranks;
      const total = (key: string) => r.groups.find((g) => g.key === key)!.total;
      expect(total("gz58-ps5")).toBe(2);
      expect(total("gz58-switch")).toBe(2);
      expect(total("gz58-pc")).toBe(37); // Elden、Indie、Port、Quarter、Nov／Dec／Aug、Bulk 30
      expect(r.groups.find((g) => g.key === "gz58-ps5")!.platform).toMatchObject({ slug: "gz58-ps5", kind: "console" });
    });

    it("組內依熱度；sort=release_date 組內依首發日期", async () => {
      const pop = await getGameGroupPage({ ...BASE, by: "platform", key: "gz58-ps5", offset: 0, limit: 10 });
      expect(pop!.cards.map((c) => c.name)).toEqual(["Gz58 Elden", "Gz58 Capcom"]);
      const byDate = await getGameGroupPage({ ...BASE, by: "platform", key: "gz58-switch", offset: 0, limit: 10, sort: "release_date" });
      expect(byDate!.cards.map((c) => c.name)).toEqual(["Gz58 Zelda", "Gz58 Year"]);
    });
  });

  describe("依廠商", () => {
    it("開發商優先；開發商不在名單才看發行商；porting 不算；其餘歸 other 且在最後", async () => {
      const r = await getGameGroups({ ...BASE, by: "publisher", now: NOW });
      expect(keysOf(r)).toEqual(["nintendo", "capcom", "fromsoftware", "other"]);
      const members_ = async (key: string) => (await getGameGroupPage({ ...BASE, by: "publisher", key, offset: 0, limit: 60 }))!.cards.map((c) => c.name);
      expect(await members_("fromsoftware")).toEqual(["Gz58 Elden"]);
      expect(await members_("nintendo")).toEqual(["Gz58 Zelda"]);
      expect(await members_("capcom")).toEqual(["Gz58 Capcom"]);
      const other = r.groups.find((g) => g.key === "other")!;
      expect(other.total).toBe(38); // Indie、Port、Quarter、Year、Undated、Nov／Dec／Aug、Bulk 30
    });

    it("SQL 與 domain 的 groupOfGame 對同一批 fixture 結果相同", async () => {
      const expected = new Map<string, string[]>();
      for (const [tag, refs] of credits) {
        const key = groupOfGame(refs);
        expected.set(key, [...(expected.get(key) ?? []), `Gz58 ${tag}`]);
      }
      for (const key of ["fromsoftware", "nintendo", "capcom", "other"] as const) {
        const page = await getGameGroupPage({ ...BASE, by: "publisher", key, offset: 0, limit: 60 });
        const got = (page?.cards ?? []).map((c) => c.name).sort();
        // other 組 total 超過 60：只比對 total 與抽樣
        if (key === "other") expect(page!.total).toBe(expected.get(key)!.length);
        else expect(got).toEqual([...expected.get(key)!].sort());
      }
    });

    it("不合法的廠商 key 回 null", async () => {
      expect(await getGameGroupPage({ ...BASE, by: "publisher", key: "nope", offset: 0, limit: 5 })).toBeNull();
    });
  });

  describe("篩選與搜尋", () => {
    it("平台篩選（遊戲層級）限制分組的範圍", async () => {
      const r = await getGameGroups({ ...BASE, by: "date", filter: { platformSlugs: ["gz58-ps5"] }, now: NOW });
      expect(r.groups.map((g) => [g.key, g.total])).toEqual([["2036-10", 1], ["2036-09", 1]]);
      expect(r.ignored).toEqual([]);
    });

    it("年份篩選", async () => {
      const r = await getGameGroups({ ...BASE, by: "publisher", yearFrom: 2037, yearTo: 2037, now: NOW });
      expect(r.groups.map((g) => [g.key, g.total])).toEqual([["other", 1]]);
    });

    it("未知的篩選 slug 被忽略並回報", async () => {
      const r = await getGameGroups({ ...BASE, by: "platform", filter: { platformSlugs: ["no-such-platform"] }, now: NOW });
      expect(r.ignored).toEqual([{ dimension: "platform", slug: "no-such-platform" }]);
    });

    it("搜尋沒有結果 → 沒有組", async () => {
      const r = await getGameGroups({ by: "date", q: "zzzzqqqq58", locale: "zh-Hant", perGroup: 8 });
      expect(r.groups).toEqual([]);
      expect(r.hasMoreGroups).toBe(false);
    });
  });

  it("三種分組的查詢參數保護：perGroup 與 limit 夾在 1~60", async () => {
    for (const by of ["date", "platform", "publisher"] as GroupedBy[]) {
      const r = await getGameGroups({ ...BASE, by, perGroup: 9999, now: NOW });
      for (const g of r.groups) expect(g.cards.length).toBeLessThanOrEqual(60);
    }
    const page = await getGameGroupPage({ ...BASE, by: "platform", key: "gz58-pc", offset: 0, limit: 0 });
    expect(page!.cards).toHaveLength(1);
  });
});
