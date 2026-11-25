/**
 * GameDex 第 2 輪 Z2A 單元：廠商對照表與歸屬函式、瀏覽頁分組檢視的參數／網址／標題、組查詢的 SQL 組裝。
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  OTHER_PUBLISHER_KEY,
  PUBLISHER_COLUMN_KEYS,
  PUBLISHER_GROUPS,
  groupOfGame,
  isPublisherColumnKey,
  publisherColumnKeyOfIndex,
  publisherColumnName,
  publisherGroupOfCompany,
  publisherGroupSqlMap,
} from "@/modules/catalog/domain/publisher-groups";
import { GAME_GROUP_BYS, GAME_GROUP_MAX_PAGE, GAME_GROUPS_PER_PAGE, GROUP_MONTH_MIN, isGroupMonth, shiftGroupMonth } from "@/modules/catalog/domain/entities";
import { buildGroupCardsQuery, buildGroupListQuery, isDateGroupKey, publisherKeyToIndex, sortGroupRows } from "@/modules/catalog/repository/browse-groups";
import { isGroupKey, normalizeGroupOrder } from "@/modules/catalog/use-cases/read";
import { dateGroupTitle } from "@/modules/catalog/ui/browse/groups/groups-server";
import {
  groupPagination,
  groupQueryParts,
  groupRange,
  isGrouped,
  parseGameGroupBy,
  parseGroupDir,
  parseGroupFrom,
  parseGroupPage,
  parseGroupSort,
} from "@/modules/catalog/ui/browse/groups/params";
import { filterRedirectSearch } from "@sok/api-contract";
import { gamesBrowseHref } from "@/modules/catalog/ui/links";

const dev = (igdbId: number, order?: number) => ({ igdbId, role: "developer", ...(order === undefined ? {} : { order }) });
const pub = (igdbId: number, order?: number) => ({ igdbId, role: "publisher", ...(order === undefined ? {} : { order }) });

describe("廠商對照表", () => {
  it("每個公司 id 只屬於一欄（不重複）", () => {
    const seen = new Map<number, string>();
    for (const g of PUBLISHER_GROUPS) {
      for (const [id] of g.members) {
        expect(seen.has(id), `${id} 同時在 ${seen.get(id)} 與 ${g.key}`).toBe(false);
        seen.set(id, g.key);
      }
    }
  });
  it("欄位 key 唯一、小寫連字號；other 在最後；三語名稱齊全", () => {
    const keys = PUBLISHER_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of PUBLISHER_GROUPS) {
      expect(g.key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      for (const l of ["zh-Hant", "en", "ja"] as const) expect(g.names[l].length).toBeGreaterThan(0);
    }
    expect(PUBLISHER_COLUMN_KEYS.at(-1)).toBe(OTHER_PUBLISHER_KEY);
    expect(PUBLISHER_COLUMN_KEYS).toHaveLength(PUBLISHER_GROUPS.length + 1);
    expect(isPublisherColumnKey("capcom")).toBe(true);
    expect(isPublisherColumnKey("nope")).toBe(false);
  });
  it("使用者 2026-10-23 的疑義決定：Sony／SOE／Bungie→索尼、Xbox Live→Xbox、Codemasters→EA、Intelligent Systems→任天堂、Taito→史克威爾艾尼克斯", () => {
    expect(publisherGroupOfCompany(10282)).toBe("sony");
    expect(publisherGroupOfCompany(243)).toBe("sony");
    expect(publisherGroupOfCompany(620)).toBe("sony");
    expect(publisherGroupOfCompany(17213)).toBe("xbox");
    expect(publisherGroupOfCompany(808)).toBe("xbox");
    expect(publisherGroupOfCompany(115)).toBe("ea");
    expect(publisherGroupOfCompany(25077)).toBe("nintendo");
    expect(publisherGroupOfCompany(817)).toBe("square-enix");
    expect(publisherGroupOfCompany(1440)).toBe("square-enix");
    expect(publisherGroupOfCompany(0)).toBeNull();
  });
  it("2026-10-29 新增三欄：雷亞遊戲 Rayark（12017、14094）、赤燭遊戲 Red Candle Games（11926）、信革數位 SIGONO（15108）；排在名單後段（既有欄位索引不變）", () => {
    expect(publisherGroupOfCompany(12017)).toBe("rayark");
    expect(publisherGroupOfCompany(14094)).toBe("rayark");
    expect(publisherGroupOfCompany(11926)).toBe("red-candle-games");
    expect(publisherGroupOfCompany(15108)).toBe("sigono");
    expect(publisherColumnName("rayark", "zh-Hant")).toBe("雷亞遊戲");
    expect(publisherColumnName("red-candle-games", "zh-Hant")).toBe("赤燭遊戲");
    expect(publisherColumnName("sigono", "zh-Hant")).toBe("信革數位");
    expect(publisherColumnName("rayark", "en")).toBe("Rayark");
    expect(publisherColumnName("red-candle-games", "en")).toBe("Red Candle Games");
    expect(publisherColumnName("sigono", "en")).toBe("SIGONO");
    // 既有欄位的索引（games.publisher_group 已存的值）不能變：paradox 仍是新增前的最後一欄，新欄接在後面
    const keys = PUBLISHER_GROUPS.map((g) => g.key);
    expect(keys.indexOf("paradox")).toBe(keys.length - 4);
    expect(keys.slice(-3)).toEqual(["rayark", "red-candle-games", "sigono"]);
    expect(groupOfGame([{ igdbId: 14094, role: "developer" }, { igdbId: 70, role: "publisher" }])).toBe("rayark");
    // SQL 對照表同步
    const { igdbIds, groupIdx } = publisherGroupSqlMap();
    for (const id of [12017, 14094, 11926, 15108]) expect(groupIdx[igdbIds.indexOf(id)]).toBe(keys.indexOf(publisherGroupOfCompany(id)!));
  });
  it("名稱依語系，未知語系退回英文", () => {
    expect(publisherColumnName("sony", "zh-Hant")).toBe("索尼互動娛樂");
    expect(publisherColumnName("capcom", "en")).toBe("Capcom");
    expect(publisherColumnName("other", "zh-Hant")).toBe("獨立／其他");
    expect(publisherColumnName("other", "fr")).toBe("Indie & Other");
  });
  it("SQL 對照表是兩個等長陣列，欄位索引對得上 key", () => {
    const { igdbIds, groupIdx } = publisherGroupSqlMap();
    expect(igdbIds).toHaveLength(groupIdx.length);
    expect(igdbIds.length).toBeGreaterThan(500);
    igdbIds.forEach((id, i) => expect(publisherColumnKeyOfIndex(groupIdx[i]!)).toBe(publisherGroupOfCompany(id)));
    expect(publisherColumnKeyOfIndex(-1)).toBe("other");
    expect(publisherColumnKeyOfIndex(null)).toBe("other");
    expect(publisherKeyToIndex("other")).toBe(-1);
    expect(publisherKeyToIndex("sony")).toBe(0);
    expect(publisherKeyToIndex("nope")).toBeNull();
  });
});

describe("groupOfGame（歸屬函式）", () => {
  const FROMSOFT = 1012;
  const BANDAI = 248;
  const CAPCOM = 37;
  const NINTENDO = 70;
  it("艾爾登法環：開發 FromSoftware、發行萬代南夢宮 → FromSoftware", () => {
    expect(groupOfGame([pub(BANDAI), dev(FROMSOFT)])).toBe("fromsoftware");
  });
  it("開發商不在名單才看發行商", () => {
    expect(groupOfGame([dev(999999), pub(NINTENDO)])).toBe("nintendo");
  });
  it("都不在名單 → other；沒有公司 → other", () => {
    expect(groupOfGame([dev(999999), pub(888888)])).toBe("other");
    expect(groupOfGame([])).toBe("other");
  });
  it("porting／supporting 不參與", () => {
    expect(groupOfGame([{ igdbId: CAPCOM, role: "porting" }, { igdbId: CAPCOM, role: "supporting" }])).toBe("other");
  });
  it("多個開發商都在名單：有 IGDB 順序取最前面；沒有順序取欄位順序最後者（與 SQL 一致）", () => {
    expect(groupOfGame([dev(CAPCOM, 1), dev(FROMSOFT, 0)])).toBe("fromsoftware");
    expect(groupOfGame([dev(FROMSOFT, 5), dev(CAPCOM, 2)])).toBe("capcom");
    expect(groupOfGame([dev(CAPCOM), dev(FROMSOFT)])).toBe("fromsoftware");
    expect(groupOfGame([dev(FROMSOFT), dev(CAPCOM)])).toBe("fromsoftware");
  });
  it("D88：同角色取 IGDB 第一個（順序 0 勝過 1）；有順序的勝過 NULL 的；角色優先順序不變", () => {
    expect(groupOfGame([dev(FROMSOFT, 0), dev(CAPCOM, 1)])).toBe("fromsoftware");
    expect(groupOfGame([dev(CAPCOM, 0), dev(FROMSOFT, 1)])).toBe("capcom");
    expect(groupOfGame([dev(CAPCOM), dev(FROMSOFT, 3)])).toBe("fromsoftware");
    // 開發商（順序 5）仍勝過發行商（順序 0）
    expect(groupOfGame([pub(NINTENDO, 0), dev(CAPCOM, 5)])).toBe("capcom");
    // 發行商之間同樣取第一個
    expect(groupOfGame([dev(999999, 0), pub(NINTENDO, 2), pub(248, 1)])).toBe("bandai-namco");
  });
});

describe("分組檢視參數", () => {
  it("by：none／date／platform／publisher，其他一律 none", () => {
    expect(GAME_GROUP_BYS).toEqual(["none", "date", "platform", "publisher"]);
    expect(parseGameGroupBy("date")).toBe("date");
    expect(parseGameGroupBy("publisher")).toBe("publisher");
    expect(parseGameGroupBy("DATE")).toBe("none");
    expect(parseGameGroupBy("")).toBe("none");
    expect(parseGameGroupBy(undefined)).toBe("none");
    expect(isGrouped("none")).toBe(false);
    expect(isGrouped("platform")).toBe(true);
  });
  it("組頁碼：1~上限的整數，其他一律第 1 頁", () => {
    expect(parseGroupPage("3")).toBe(3);
    expect(parseGroupPage(String(GAME_GROUP_MAX_PAGE))).toBe(GAME_GROUP_MAX_PAGE);
    for (const bad of ["0", "-1", "abc", "1.5", "", null, undefined, String(GAME_GROUP_MAX_PAGE + 1), "99999"]) expect(parseGroupPage(bad)).toBe(1);
  });
  it("組分頁與範圍", () => {
    expect(groupPagination(1, true)).toEqual({ prev: null, next: 2, limitReached: false });
    expect(groupPagination(3, false)).toEqual({ prev: 2, next: null, limitReached: false });
    expect(groupPagination(GAME_GROUP_MAX_PAGE, true)).toEqual({ prev: GAME_GROUP_MAX_PAGE - 1, next: null, limitReached: true });
    expect(groupRange(1, 6)).toEqual({ from: 1, to: 6 });
    expect(groupRange(2, 2)).toEqual({ from: GAME_GROUPS_PER_PAGE + 1, to: GAME_GROUPS_PER_PAGE + 2 });
    expect(groupRange(1, 0)).toBeNull();
  });
  it("網址：by 不是 none 才寫入，順序為篩選、by、page（與 proxy 正規形式一致）", () => {
    expect(gamesBrowseHref("en", {})).toBe("/en/games");
    expect(gamesBrowseHref("en", {}, 1, "date")).toBe("/en/games?by=date");
    expect(gamesBrowseHref("en", { platform: ["ps5"] }, 2, "publisher")).toBe("/en/games?platform=ps5&by=publisher&page=2");
    expect(gamesBrowseHref("zh-Hant", { q: "zelda" }, 1, "none")).toBe("/zh-Hant/games?q=zelda");
  });
  it("網址：組排序（gsort／gdir，只有平台／廠商）與起算月（gfrom，只有日期）；預設值不寫入；參數依名稱排序（與 proxy 正規形式一致，不會被 308）", () => {
    expect(gamesBrowseHref("en", {}, 1, "platform", { sort: "latest", dir: "desc" })).toBe("/en/games?by=platform");
    expect(gamesBrowseHref("en", {}, 1, "platform", { sort: "count", dir: "desc" })).toBe("/en/games?by=platform&gsort=count");
    expect(gamesBrowseHref("en", {}, 1, "publisher", { sort: "name", dir: "asc" })).toBe("/en/games?by=publisher&gdir=asc&gsort=name");
    expect(gamesBrowseHref("en", { genre: ["rpg"] }, 3, "publisher", { sort: "latest", dir: "asc" })).toBe("/en/games?genre=rpg&by=publisher&gdir=asc&page=3");
    expect(gamesBrowseHref("en", {}, 1, "date", { from: "2024-03" })).toBe("/en/games?by=date&gfrom=2024-03");
    expect(gamesBrowseHref("en", {}, 2, "date", { from: "2024-03" })).toBe("/en/games?by=date&gfrom=2024-03&page=2");
    // 不相關的參數不寫：日期不帶組排序、平台不帶起算月、不分組都不帶
    expect(gamesBrowseHref("en", {}, 1, "date", { sort: "name", dir: "asc" })).toBe("/en/games?by=date");
    expect(gamesBrowseHref("en", {}, 1, "platform", { from: "2024-03" })).toBe("/en/games?by=platform");
    expect(gamesBrowseHref("en", {}, 1, "none", { sort: "name", dir: "asc", from: "2024-03" })).toBe("/en/games");
    expect(groupQueryParts("none", { sort: "name" })).toEqual([]);
    // proxy 的 filterRedirectSearch 對頁面產生的網址不轉址；對順序不同的表單送出會轉成同一種寫法
    for (const href of [
      "/en/games?genre=rpg&by=publisher&gdir=asc&gsort=name&page=2",
      "/en/games?by=date&gfrom=2024-03",
      "/en/games?q=zelda&by=platform&gsort=count",
    ]) expect(filterRedirectSearch(href.slice(href.indexOf("?"))), href).toBeNull();
    expect(filterRedirectSearch("?by=date&gyear=2024&gmonth=3")).toBe("?by=date&gmonth=3&gyear=2024");
  });
  it("gsort／gdir／gfrom 解析：不合法一律預設；沒有 JS 的跳月表單（gyear＋gmonth）組成起算月", () => {
    expect(parseGroupSort("count")).toBe("count");
    expect(parseGroupSort("COUNT")).toBe("latest");
    expect(parseGroupSort(undefined)).toBe("latest");
    expect(parseGroupDir("asc")).toBe("asc");
    expect(parseGroupDir("up")).toBe("desc");
    expect(parseGroupFrom("2024-03")).toBe("2024-03");
    expect(parseGroupFrom("2024-13")).toBeNull();
    expect(parseGroupFrom("2024-3")).toBeNull();
    expect(parseGroupFrom("1949-12")).toBeNull();
    expect(parseGroupFrom(undefined, "2024", "3")).toBe("2024-03");
    expect(parseGroupFrom(undefined, "2024", "12")).toBe("2024-12");
    expect(parseGroupFrom(undefined, "2024", "13")).toBeNull();
    expect(parseGroupFrom(undefined, "24", "3")).toBeNull();
    expect(parseGroupFrom("2020-01", "2024", "3")).toBe("2020-01"); // gfrom 優先
    expect(normalizeGroupOrder("name", "asc")).toEqual({ sort: "name", dir: "asc" });
    expect(normalizeGroupOrder("x", "y")).toEqual({ sort: "latest", dir: "desc" });
  });
  it("起算月：範圍、加減月、年份下拉", () => {
    expect(isGroupMonth(GROUP_MONTH_MIN)).toBe(true);
    expect(isGroupMonth("2200-12")).toBe(true);
    expect(isGroupMonth("2201-01")).toBe(false);
    expect(shiftGroupMonth("2026-10", -6)).toBe("2026-04");
    expect(shiftGroupMonth("2026-03", -6)).toBe("2025-09");
    expect(shiftGroupMonth("2026-10", 3)).toBe("2027-01");
    expect(shiftGroupMonth("1950-02", -6)).toBe(GROUP_MONTH_MIN);
  });
});

describe("組 key 與標題", () => {
  it("日期組 key 的格式", () => {
    for (const ok of ["2026-10", "2026-Q4", "2026", "tbd", "1990-01"]) expect(isDateGroupKey(ok), ok).toBe(true);
    for (const bad of ["2026-13", "2026-Q5", "26", "2026-1", "TBD", "2026-10-01", "", "x"]) expect(isDateGroupKey(bad), bad).toBe(false);
  });
  it("API 驗證組 key：date／publisher／platform 各自的格式", () => {
    expect(isGroupKey("date", "2026-10")).toBe(true);
    expect(isGroupKey("publisher", "fromsoftware")).toBe(true);
    expect(isGroupKey("publisher", "nope")).toBe(false);
    expect(isGroupKey("platform", "ps5")).toBe(true);
    expect(isGroupKey("platform", "Bad Slug")).toBe(false);
    expect(isGroupKey("platform", "a".repeat(101))).toBe(false);
  });
  it("日期組標題依精度與語系", () => {
    expect(dateGroupTitle("2026-10", "zh-Hant")).toBe("2026年10月");
    expect(dateGroupTitle("2026-10", "en")).toBe("October 2026");
    expect(dateGroupTitle("2026-Q4", "en")).toMatch(/Q4|4/);
    expect(dateGroupTitle("2027", "zh-Hant")).toContain("2027");
    expect(dateGroupTitle("tbd", "zh-Hant")).toBe("日期未定");
  });
});

describe("sortGroupRows（平台／廠商的組排序）", () => {
  const rows = [
    { gkey: "ps5", total: 50, gname: "PlayStation 5", latest: "2027-01-01" },
    { gkey: "switch", total: 80, gname: "Nintendo Switch", latest: "2026-06-01" },
    { gkey: "win", total: 80, gname: "PC (Microsoft Windows)", latest: "2027-01-01" },
    { gkey: "gb", total: 5, gname: "Game Boy", latest: null },
  ];
  const keys = (sort: "latest" | "count" | "name", dir: "asc" | "desc") => sortGroupRows(rows, "platform", { sort, dir }, "en").map((r) => r.gkey);
  it("latest：組內最新發售日；沒有日期的永遠最後；同日期依遊戲數多的在前", () => {
    expect(keys("latest", "desc")).toEqual(["win", "ps5", "switch", "gb"]);
    expect(keys("latest", "asc")).toEqual(["switch", "win", "ps5", "gb"]);
  });
  it("count：遊戲數，平手依名稱", () => {
    expect(keys("count", "desc")).toEqual(["switch", "win", "ps5", "gb"]);
    expect(keys("count", "asc")).toEqual(["gb", "ps5", "switch", "win"]);
  });
  it("name：依組名稱（平台用平台名稱）", () => {
    expect(keys("name", "asc")).toEqual(["gb", "switch", "win", "ps5"]);
    expect(keys("name", "desc")).toEqual(["ps5", "win", "switch", "gb"]);
  });
  it("廠商：名稱用介面語系的欄名；獨立／其他（-1）永遠最後，不論排序與方向", () => {
    const pubs = [
      { gkey: "-1", total: 1000, latest: "2030-01-01" },
      { gkey: String(PUBLISHER_COLUMN_KEYS.indexOf("capcom")), total: 3, latest: "2020-01-01" },
      { gkey: String(PUBLISHER_COLUMN_KEYS.indexOf("sony")), total: 9, latest: "2025-01-01" },
    ];
    for (const sort of ["latest", "count", "name"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        expect(sortGroupRows(pubs, "publisher", { sort, dir }, "en").at(-1)!.gkey, `${sort}/${dir}`).toBe("-1");
      }
    }
    expect(sortGroupRows(pubs, "publisher", { sort: "name", dir: "asc" }, "en").map((r) => publisherColumnKeyOfIndex(Number(r.gkey)))).toEqual(["capcom", "sony", "other"]);
    expect(sortGroupRows(pubs, "publisher", { sort: "count", dir: "desc" }, "en").map((r) => publisherColumnKeyOfIndex(Number(r.gkey)))).toEqual(["sony", "capcom", "other"]);
  });
  it("不改動輸入陣列", () => {
    const copy = rows.map((r) => r.gkey);
    sortGroupRows(rows, "platform", { sort: "name", dir: "desc" }, "en");
    expect(rows.map((r) => r.gkey)).toEqual(copy);
  });
});

describe("組查詢的 SQL 組裝", () => {
  const dialect = new PgDialect();
  const base = { filter: { gameTypes: ["main_game"], stages: ["full"], statuses: ["scheduled"], includeRumored: false, includeRemoved: true } as const, locale: "en", today: "2026-10-23" as const };
  const order = { groupOrder: { sort: "latest", dir: "desc" } as const };
  const sqlOf = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(q);
  it("組清單：日期組讀預先計算的 release_group；預設＝當月起往未來、再往過去、tbd 最後（D88）；沒有 sort 參數、沒有依首發日期聚合", () => {
    const pop = sqlOf(buildGroupListQuery({ ...base, ...order, by: "date", groupOffset: 0, groupLimit: 6 }));
    expect(pop.sql).toContain("GROUP BY g.release_group");
    expect(pop.sql).toMatch(/ORDER BY \(g\.release_group = \$\d+\) ASC,/);
    expect(pop.sql).toMatch(/ELSE g\.release_group/);
    expect(pop.sql).not.toContain("min(g.first_release_date)");
    expect(pop.sql).not.toContain("HAVING");
    expect(pop.sql).toMatch(/LIMIT \$?\d+ OFFSET \$?\d+/);
    expect(pop.params).toContain("2026-10"); // 當月來自 today
  });
  it("組清單：指定起算月（gfrom）＝結束月 ≥ 起算月的組由舊到新、tbd 保留且最後；預設值（沒給）不產生 HAVING", () => {
    const from = sqlOf(buildGroupListQuery({ ...base, ...order, by: "date", groupFrom: "2024-03", groupOffset: 12, groupLimit: 6 }));
    expect(from.sql).toContain("GROUP BY g.release_group");
    expect(from.sql).toMatch(/HAVING g\.release_group = \$\d+ OR [\s\S]* >= \$\d+::text/);
    expect(from.sql).toMatch(/ORDER BY \(g\.release_group = \$\d+\) ASC,\s+greatest\(/);
    expect(from.sql).toMatch(/LIMIT \$?\d+ OFFSET \$?\d+/);
    expect(from.params).toContain("2024-03");
    expect(from.params).toContain("tbd");
  });
  it("組清單：平台／廠商取全部的組（含 max 首發日 latest 與總數），不排序、不分頁（由 sortGroupRows 排序後切頁）；廠商讀 publisher_group，不再即時比對公司名單", () => {
    const q = sqlOf(buildGroupListQuery({ ...base, ...order, by: "publisher", groupOffset: 0, groupLimit: 6 }));
    expect(q.sql).toContain("GROUP BY g.publisher_group");
    expect(q.sql).toContain("max(g.first_release_date)::text AS latest");
    expect(q.sql).not.toMatch(/ORDER BY|LIMIT/);
    expect(q.sql).not.toContain("unnest(");
    expect(q.params.some((p) => Array.isArray(p) && p.length > 500)).toBe(false);
    const plat = sqlOf(buildGroupListQuery({ ...base, ...order, by: "platform", groupOffset: 0, groupLimit: 6 }));
    expect(plat.sql).toContain("max(g.first_release_date)::text AS latest");
    expect(plat.sql).toContain("plg.kind <> 'mobile'");
    expect(plat.sql).not.toMatch(/ORDER BY|LIMIT|array_position/);
  });
  it("組內卡片：每組一個 UNION ALL 子查詢依組 index 取 [offset, offset+limit)，不掃其他組", () => {
    const date = sqlOf(buildGroupCardsQuery({ ...base, by: "date", keys: ["2026-10"], offset: 0, limit: 8 }));
    expect(date.sql).toMatch(/g\.release_group = \$\d+/);
    expect(date.sql).toContain("OFFSET");
    expect(date.sql).toContain("LIMIT");
    // 組內順序固定：發售日由新到舊（未定最後）→ 熱度 → id，不論頁面的 sort
    expect(date.sql).toContain("g.first_release_date DESC NULLS LAST, g.popularity_score DESC NULLS LAST, g.id ASC");
    const plat = sqlOf(buildGroupCardsQuery({ ...base, by: "platform", keys: ["ps5"], offset: 0, limit: 8 }));
    expect(plat.sql).toContain("EXISTS (SELECT 1 FROM game_platforms gpg");
    expect(plat.sql).toContain("(SELECT id FROM platforms WHERE slug = ");
    const twoKeys = sqlOf(buildGroupCardsQuery({ ...base, by: "date", keys: ["2026-10", "tbd"], offset: 0, limit: 8 }));
    expect(twoKeys.sql).toContain("UNION ALL");
    const pub = sqlOf(buildGroupCardsQuery({ ...base, by: "publisher", keys: ["0"], offset: 8, limit: 24 }));
    expect(pub.sql).toMatch(/g\.publisher_group = \$\d+/);
  });
  it("offset／limit 夾成非負整數", () => {
    const q = sqlOf(buildGroupCardsQuery({ ...base, by: "date", keys: ["tbd"], offset: -5.7, limit: 24.9 }));
    expect(q.params).toContain(0);
    expect(q.params).toContain(24);
  });
});
