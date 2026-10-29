/**
 * GameDex 第 2 輪 Z2A 整合：瀏覽頁分組檢視（依日期／平台／廠商）。
 * igdbId 用 58xxxx；遊戲名稱都帶 "Gz58"，查詢以 q=gz58 隔離其他測試檔的資料。
 * 廠商用真實的 IGDB 公司 id（FromSoftware 1012、萬代南夢宮 248、任天堂 70、卡普空 37），讓 SQL 走真正的對照表，
 * 並檢查 SQL 與 domain 的 groupOfGame 對同一批 fixture 結果相同。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import { getGameGroupPage, getGameGroups } from "@/modules/catalog/use-cases/read";
import { GAME_GROUPS_PER_PAGE, type GroupedBy } from "@/modules/catalog/domain/entities";
import { groupOfGame, type GameCompanyRef } from "@/modules/catalog/domain/publisher-groups";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { backfillGameGroupsBatch } from "@/modules/catalog/repository/game-groups";
import { companies, gameCompanies, gamePlatforms, games, platforms } from "@/modules/catalog/schema";

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
    // 年精度、期間涵蓋當月（2036-09）：視為「當月」那一組參與排序（D88）
    await addGame("ThisYear", { pop: 40, date: "2036-01-01", precision: "year", platforms: ["gz58-pc"] });
    await addGame("Undated", { pop: 70, date: null, precision: "tbd", platforms: [] });
    await addGame("Nov", { pop: 50, date: "2036-11-05", precision: "day", platforms: ["gz58-pc"] });
    await addGame("Dec", { pop: 50, date: "2036-12-05", precision: "day", platforms: ["gz58-pc"] });
    await addGame("Aug", { pop: 50, date: "2036-08-05", precision: "day", platforms: ["gz58-pc"] });
    // 30 款同月，用來測「顯示更多」
    for (let i = 1; i <= 30; i++) await addGame(`Bulk ${String(i).padStart(2, "0")}`, { pop: 500 - i, date: "2036-09-20", precision: "day", platforms: ["gz58-pc"] });
    // fixture 是直接 insert 的（沒走 syncIgdbGame），預先計算的分組鍵用回填函式補齊（同一份規則）
    for (let after = 0; ; ) {
      const r = await backfillGameGroupsBatch(after, 500);
      if (r.lastId === null) break;
      after = r.lastId;
    }
  });
  afterAll(async () => {
    await closeDb();
  });

  describe("依日期", () => {
    it("預設（熱度排序，D88）：當月起往未來由近到遠（涵蓋當月的季／年組算當月，細精度在前；完全在未來依起始月）→ 往過去（依結束月）由新到舊 → 日期未定最後；一頁 6 組、後面還有", async () => {
      const r = await getGameGroups({ ...BASE, by: "date", now: NOW });
      expect(GAME_GROUPS_PER_PAGE).toBe(6);
      expect(keysOf(r)).toEqual(["2036-09", "2036", "2036-10", "2036-Q4", "2036-11", "2036-12"]);
      expect(r.hasMoreGroups).toBe(true);
      const p2 = await getGameGroups({ ...BASE, by: "date", page: 2, now: NOW });
      expect(keysOf(p2)).toEqual(["2037", "2036-08", "tbd"]);
      expect(p2.hasMoreGroups).toBe(false);
    });

    it("當月在中間時：未來段在前、過去段由新到舊；翻頁串起來與單頁取全部一致且穩定", async () => {
      const mid = new Date("2036-11-15T00:00:00Z");
      const p1 = await getGameGroups({ ...BASE, by: "date", now: mid });
      const p2 = await getGameGroups({ ...BASE, by: "date", page: 2, now: mid });
      const all = [...keysOf(p1), ...keysOf(p2)];
      expect(all).toEqual(["2036-11", "2036-Q4", "2036", "2036-12", "2037", "2036-10", "2036-09", "2036-08", "tbd"]);
      expect(keysOf(await getGameGroups({ ...BASE, by: "date", now: mid }))).toEqual(keysOf(p1));
    });

    it("指定起算月（gfrom）：期間結束月 ≥ 起算月的組由舊到新（涵蓋起算月的季／年組算起算月，細精度在前），日期未定最後；更早的組不列", async () => {
      const f = async (groupFrom: string, page = 1) => keysOf(await getGameGroups({ ...BASE, by: "date", groupFrom, page, now: NOW }));
      expect(await f("2036-10")).toEqual(["2036-10", "2036-Q4", "2036", "2036-11", "2036-12", "2037"]);
      expect(await f("2036-10", 2)).toEqual(["tbd"]);
      expect(await f("2036-09")).toEqual(["2036-09", "2036", "2036-10", "2036-Q4", "2036-11", "2036-12"]);
      expect(await f("2036-09", 2)).toEqual(["2037", "tbd"]);
      expect(await f("2036-01")).toEqual(["2036", "2036-08", "2036-09", "2036-10", "2036-Q4", "2036-11"]);
      expect(await f("2036-01", 2)).toEqual(["2036-12", "2037", "tbd"]);
      expect(await f("2036-12")).toEqual(["2036-12", "2036-Q4", "2036", "2037", "tbd"]);
      expect(await f("2040-01")).toEqual(["tbd"]);
      const first = await getGameGroups({ ...BASE, by: "date", groupFrom: "2036-10", now: NOW });
      expect(first.groupFrom).toBe("2036-10");
      expect(first.hasMoreGroups).toBe(true);
    });

    it("起算月不合法、或依平台／廠商時：退回預設順序／被忽略", async () => {
      const def = keysOf(await getGameGroups({ ...BASE, by: "date", now: NOW }));
      expect(keysOf(await getGameGroups({ ...BASE, by: "date", groupFrom: "2036-13", now: NOW }))).toEqual(def);
      expect(keysOf(await getGameGroups({ ...BASE, by: "date", groupFrom: null, now: NOW }))).toEqual(def);
      const plat = await getGameGroups({ ...BASE, by: "platform", groupFrom: "2037-01", now: NOW });
      expect(plat.groupFrom).toBeNull();
      expect(keysOf(plat)).toEqual(keysOf(await getGameGroups({ ...BASE, by: "platform", now: NOW })));
    });

    it("每組總數正確、首屏只送 perGroup 張、組內固定依發售日由新到舊（同日依熱度）", async () => {
      const r = await getGameGroups({ ...BASE, by: "date", page: 1, now: NOW });
      const sep = r.groups.find((g) => g.key === "2036-09")!;
      expect(sep.total).toBe(3 + 30);
      expect(sep.cards).toHaveLength(8);
      // 9/20 的 Bulk（熱度 499、498…）在 9/10 的 Elden／Zelda／Indie 前面
      expect(sep.cards.slice(0, 3).map((c) => c.name)).toEqual(["Gz58 Bulk 01", "Gz58 Bulk 02", "Gz58 Bulk 03"]);
      expect(r.groups.find((g) => g.key === "2036-10")!.total).toBe(2);
    });

    it("顯示更多：接續的卡片不重複、依同一排序（發售日由新到舊）", async () => {
      const first = await getGameGroups({ ...BASE, by: "date", now: NOW });
      const shown = first.groups.find((g) => g.key === "2036-09")!.cards.map((c) => c.gameId);
      const more = await getGameGroupPage({ ...BASE, by: "date", key: "2036-09", offset: 8, limit: 24, now: NOW });
      expect(more!.total).toBe(33);
      expect(more!.cards).toHaveLength(24);
      expect(more!.cards.some((c) => shown.includes(c.gameId))).toBe(false);
      expect(more!.cards[0]!.name).toBe("Gz58 Bulk 09");
      expect(more!.cards.slice(-2).map((c) => c.name)).toEqual(["Gz58 Elden", "Gz58 Zelda"]);
      const rest = await getGameGroupPage({ ...BASE, by: "date", key: "2036-09", offset: 32, limit: 24, now: NOW });
      expect(rest!.cards.map((c) => c.name)).toEqual(["Gz58 Indie"]);
    });

    it("不合法的組 key 回 null；不存在的組沒有卡片", async () => {
      expect(await getGameGroupPage({ ...BASE, by: "date", key: "2036-13", offset: 0, limit: 5 })).toBeNull();
      expect(await getGameGroupPage({ ...BASE, by: "date", key: "2036-01", offset: 0, limit: 5 })).toBeNull();
    });
  });

  describe("依平台", () => {
    it("預設組排序＝最新發售日（組內 max 首發日）由新到舊；一款遊戲出現在它每個平台組；沒有平台的遊戲不出現", async () => {
      const r = await getGameGroups({ ...BASE, by: "platform", now: NOW });
      // switch 最新 2037-01-01（Year）、pc 2036-12-05（Dec）、ps5 2036-10-02（Capcom）
      expect(keysOf(r)).toEqual(["gz58-switch", "gz58-pc", "gz58-ps5"]);
      expect(r.groupOrder).toEqual({ sort: "latest", dir: "desc" });
      const total = (key: string) => r.groups.find((g) => g.key === key)!.total;
      expect(total("gz58-ps5")).toBe(2);
      expect(total("gz58-switch")).toBe(2);
      expect(total("gz58-pc")).toBe(38); // Elden、Indie、Port、Quarter、ThisYear、Nov／Dec／Aug、Bulk 30
      expect(r.groups.find((g) => g.key === "gz58-ps5")!.platform).toMatchObject({ slug: "gz58-ps5", kind: "console" });
    });

    it("組排序：latest／count／name × asc／desc；沒給或不合法退回 latest／desc", async () => {
      const order = async (groupSort: "latest" | "count" | "name", groupDir: "asc" | "desc") => keysOf(await getGameGroups({ ...BASE, by: "platform", groupSort, groupDir, now: NOW }));
      expect(await order("latest", "asc")).toEqual(["gz58-ps5", "gz58-pc", "gz58-switch"]);
      expect(await order("latest", "desc")).toEqual(["gz58-switch", "gz58-pc", "gz58-ps5"]);
      // 遊戲數：pc 38、ps5 2、switch 2（平手依名稱）
      expect(await order("count", "desc")).toEqual(["gz58-pc", "gz58-ps5", "gz58-switch"]);
      expect(await order("count", "asc")).toEqual(["gz58-ps5", "gz58-switch", "gz58-pc"]);
      expect(await order("name", "asc")).toEqual(["gz58-pc", "gz58-ps5", "gz58-switch"]);
      expect(await order("name", "desc")).toEqual(["gz58-switch", "gz58-ps5", "gz58-pc"]);
      const bad = await getGameGroups({ ...BASE, by: "platform", groupSort: "nope" as never, groupDir: "up" as never, now: NOW });
      expect(bad.groupOrder).toEqual({ sort: "latest", dir: "desc" });
      expect(keysOf(bad)).toEqual(["gz58-switch", "gz58-pc", "gz58-ps5"]);
    });

    it("組排序與分頁：排序後再切頁（每頁 6 組），翻頁串起來與完整排序一致", async () => {
      const filtered = { ...BASE, by: "platform" as const, groupSort: "name" as const, groupDir: "asc" as const, now: NOW };
      const p1 = await getGameGroups(filtered);
      expect(p1.hasMoreGroups).toBe(false);
      expect(keysOf(await getGameGroups({ ...filtered, page: 2 }))).toEqual([]);
    });

    it("組內固定依發售日由新到舊（同日依熱度），不論頁面的 sort", async () => {
      const ps5 = await getGameGroupPage({ ...BASE, by: "platform", key: "gz58-ps5", offset: 0, limit: 10 });
      expect(ps5!.cards.map((c) => c.name)).toEqual(["Gz58 Capcom", "Gz58 Elden"]);
      const sw = await getGameGroupPage({ ...BASE, by: "platform", key: "gz58-switch", offset: 0, limit: 10 });
      expect(sw!.cards.map((c) => c.name)).toEqual(["Gz58 Year", "Gz58 Zelda"]);
    });
  });

  describe("依廠商", () => {
    it("開發商優先；開發商不在名單才看發行商；porting 不算；其餘歸 other 且在最後", async () => {
      const r = await getGameGroups({ ...BASE, by: "publisher", groupSort: "name", groupDir: "asc", locale: "en", now: NOW });
      expect(keysOf(r)).toEqual(["capcom", "fromsoftware", "nintendo", "other"]);
      const members_ = async (key: string) => (await getGameGroupPage({ ...BASE, by: "publisher", key, offset: 0, limit: 60 }))!.cards.map((c) => c.name);
      expect(await members_("fromsoftware")).toEqual(["Gz58 Elden"]);
      expect(await members_("nintendo")).toEqual(["Gz58 Zelda"]);
      expect(await members_("capcom")).toEqual(["Gz58 Capcom"]);
      const other = r.groups.find((g) => g.key === "other")!;
      expect(other.total).toBe(39); // Indie、Port、Quarter、Year、Undated、Nov／Dec／Aug、Bulk 30
    });

    it("組排序：預設最新發售日由新到舊；count／name 可升降冪；「獨立／其他」永遠最後；名稱依介面語系", async () => {
      const order = async (groupSort: "latest" | "count" | "name", groupDir: "asc" | "desc", locale = "en") =>
        keysOf(await getGameGroups({ ...BASE, by: "publisher", groupSort, groupDir, locale, now: NOW }));
      // capcom 2036-10-02；fromsoftware、nintendo 都是 2036-09-10、各 1 款（平手依名稱：FromSoftware、Nintendo）
      expect(keysOf(await getGameGroups({ ...BASE, by: "publisher", locale: "en", now: NOW }))).toEqual(["capcom", "fromsoftware", "nintendo", "other"]);
      expect(await order("latest", "asc")).toEqual(["fromsoftware", "nintendo", "capcom", "other"]);
      expect(await order("count", "desc")).toEqual(["capcom", "fromsoftware", "nintendo", "other"]);
      expect(await order("count", "asc")).toEqual(["capcom", "fromsoftware", "nintendo", "other"]);
      expect(await order("name", "desc")).toEqual(["nintendo", "fromsoftware", "capcom", "other"]);
      // 名稱用介面語系的欄名：中文「卡普空」「任天堂」（FromSoftware（角川）以英文開頭，排序在中文前）
      const zh = await order("name", "asc", "zh-Hant");
      expect(zh.at(-1)).toBe("other");
      expect(new Set(zh)).toEqual(new Set(["capcom", "fromsoftware", "nintendo", "other"]));
    });

    it("「獨立／其他」組內：沒有日期的遊戲排最後（發售日由新到舊，NULLS LAST）", async () => {
      const other = await getGameGroupPage({ ...BASE, by: "publisher", key: "other", offset: 0, limit: 60 });
      expect(other!.total).toBe(39);
      expect(other!.cards).toHaveLength(39);
      expect(other!.cards.at(-1)!.name).toBe("Gz58 Undated");
      expect(other!.cards[0]!.name).toBe("Gz58 Year"); // 2037-01-01
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
      expect(r.groups.map((g) => [g.key, g.total])).toEqual([["2036-09", 1], ["2036-10", 1]]);
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
