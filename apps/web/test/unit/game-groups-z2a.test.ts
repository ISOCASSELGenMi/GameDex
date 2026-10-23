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
import { GAME_GROUP_BYS, GAME_GROUP_MAX_PAGE, GAME_GROUPS_PER_PAGE } from "@/modules/catalog/domain/entities";
import { buildGroupCardsQuery, buildGroupListQuery, isDateGroupKey, publisherKeyToIndex } from "@/modules/catalog/repository/browse-groups";
import { isGroupKey, platformColumnRanks } from "@/modules/catalog/use-cases/read";
import { dateGroupTitle } from "@/modules/catalog/ui/browse/groups/groups-server";
import { groupPagination, groupRange, isGrouped, parseGameGroupBy, parseGroupPage } from "@/modules/catalog/ui/browse/groups/params";
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
  it("平台組順序＝平台總覽順序，hybrid 只取第一次出現", () => {
    const ranks = platformColumnRanks([
      { kind: "console", platforms: [{ slug: "ps5" }, { slug: "switch" }] },
      { kind: "handheld", platforms: [{ slug: "switch" }, { slug: "deck" }] },
      { kind: "pc", platforms: [{ slug: "win" }] },
    ] as never);
    expect([...ranks.entries()]).toEqual([
      ["ps5", 0],
      ["switch", 1],
      ["deck", 2],
      ["win", 3],
    ]);
  });
});

describe("組查詢的 SQL 組裝", () => {
  const dialect = new PgDialect();
  const base = { filter: { gameTypes: ["main_game"], stages: ["full"], statuses: ["scheduled"], includeRumored: false, includeRemoved: true } as const, sort: "popularity" as const, locale: "en", today: "2026-10-23" as const };
  const sqlOf = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(q);
  it("組清單：日期組讀預先計算的 release_group，日期未定排最後、sort=release_date 由舊到新", () => {
    const desc = sqlOf(buildGroupListQuery({ ...base, by: "date", groupOffset: 0, groupLimit: 6 })).sql;
    expect(desc).toContain("GROUP BY g.release_group");
    expect(desc).toMatch(/FILTER \(WHERE g\.release_group <> \$\d+\) DESC NULLS LAST/);
    expect(desc).not.toContain("to_char");
    const asc = sqlOf(buildGroupListQuery({ ...base, by: "date", sort: "release_date", groupOffset: 12, groupLimit: 6 }));
    expect(asc.sql).toMatch(/FILTER \(WHERE g\.release_group <> \$\d+\) ASC NULLS LAST/);
    expect(asc.sql).toMatch(/LIMIT \$?\d+ OFFSET \$?\d+/);
  });
  it("組清單：多取 1 組判斷後面還有；廠商組讀 publisher_group、other(-1) 最後，不再即時比對公司名單", () => {
    const q = sqlOf(buildGroupListQuery({ ...base, by: "publisher", groupOffset: 0, groupLimit: 6 }));
    expect(q.sql).toContain("GROUP BY g.publisher_group");
    expect(q.sql).toContain("(g.publisher_group = -1) ASC");
    expect(q.sql).not.toContain("unnest(");
    expect(q.params.some((p) => Array.isArray(p) && p.length > 500)).toBe(false);
    expect(q.sql).toMatch(/LIMIT 7|LIMIT \$\d+/);
  });
  it("組內卡片：每組一個 LATERAL 依組 index 取 [offset, offset+limit)，不掃其他組", () => {
    const date = sqlOf(buildGroupCardsQuery({ ...base, by: "date", keys: ["2026-10"], offset: 0, limit: 8 }));
    expect(date.sql).toContain("g.release_group = k.gkey");
    expect(date.sql).toContain("CROSS JOIN LATERAL");
    expect(date.sql).toContain("g.popularity_score DESC NULLS LAST, g.name ASC, g.id ASC");
    const plat = sqlOf(buildGroupCardsQuery({ ...base, by: "platform", keys: ["ps5"], offset: 0, limit: 8 }));
    expect(plat.sql).toContain("plg.slug = k.gkey");
    expect(plat.sql).toContain("plg.kind <> 'mobile'");
    const pub = sqlOf(buildGroupCardsQuery({ ...base, by: "publisher", keys: ["0"], offset: 8, limit: 24 }));
    expect(pub.sql).toContain("g.publisher_group = (k.gkey)::int");
  });
  it("offset／limit 夾成非負整數", () => {
    const q = sqlOf(buildGroupCardsQuery({ ...base, by: "date", keys: ["tbd"], offset: -5.7, limit: 24.9 }));
    expect(q.params).toContain(0);
    expect(q.params).toContain(24);
  });
});
