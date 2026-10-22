// 平台／公司／系列頁的純函式、連結與共用元件渲染。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import type { GameListItem, PlatformGameItem } from "@/modules/catalog/domain/entities";
import {
  ENTITY_PAGE_MAX,
  ENTITY_PAGE_SIZE,
  buildPager,
  firstParam,
  gameDateText,
  gameStatusBadge,
  pagingForPage,
  parseCompanyRole,
  parseFranchiseKind,
  parsePageParam,
  parsePlatformSection,
  parsePlatformSort,
  rolesWithCounts,
  safeDecode,
} from "@/modules/catalog/ui/entities/view-model";
import { EntityGameList, Pager } from "@/modules/catalog/ui/entities/shared";
import { companyHref, eventHref, eventsHref, franchiseHref, platformHref, platformsHref } from "@/modules/catalog/ui/links";

const tZh = createTranslator("zh-Hant");
const tEn = createTranslator("en");

describe("連結", () => {
  it("平台／公司：預設值與第 1 頁不寫入網址", () => {
    expect(platformsHref("zh-Hant")).toBe("/zh-Hant/platforms");
    expect(platformHref("en", "ps5")).toBe("/en/platforms/ps5");
    expect(platformHref("en", "ps5", 1)).toBe("/en/platforms/ps5");
    expect(platformHref("en", "ps5", 3)).toBe("/en/platforms/ps5?page=3");
    expect(platformHref("en", "ps5", 1, { section: "upcoming", sort: "date" })).toBe("/en/platforms/ps5");
    expect(platformHref("en", "ps5", 2, { section: "recent", sort: "popularity" })).toBe("/en/platforms/ps5?section=recent&sort=popularity&page=2");
    expect(platformHref("en", "ps5", 1, { section: "all" })).toBe("/en/platforms/ps5?section=all");
    expect(platformHref("en", "ps5", 3, { section: "all", sort: "name" })).toBe("/en/platforms/ps5?section=all&sort=name&page=3");
    expect(companyHref("en", "nintendo")).toBe("/en/companies/nintendo");
    expect(companyHref("en", "nintendo", 2, { role: "publisher" })).toBe("/en/companies/nintendo?role=publisher&page=2");
    expect(companyHref("en", "nintendo", 1, { role: null })).toBe("/en/companies/nintendo");
  });

  it("系列：kind 預設 franchise 不寫入、collection 寫入；同 slug 兩者可互相切換", () => {
    expect(franchiseHref("zh-Hant", "mario")).toBe("/zh-Hant/franchises/mario");
    expect(franchiseHref("zh-Hant", "mario", "franchise", 1)).toBe("/zh-Hant/franchises/mario");
    expect(franchiseHref("zh-Hant", "mario", "collection")).toBe("/zh-Hant/franchises/mario?kind=collection");
    expect(franchiseHref("zh-Hant", "mario", "collection", 2)).toBe("/zh-Hant/franchises/mario?kind=collection&page=2");
    expect(franchiseHref("zh-Hant", "mario", "franchise", 2)).toBe("/zh-Hant/franchises/mario?page=2");
  });

  it("活動：類型、時間範圍、頁碼；預設 upcoming 不寫入", () => {
    expect(eventsHref("en")).toBe("/en/events");
    expect(eventsHref("en", { when: "upcoming" })).toBe("/en/events");
    expect(eventsHref("en", { kind: "showcase", when: "past", page: 2 })).toBe("/en/events?kind=showcase&when=past&page=2");
    expect(eventsHref("en", { when: "undated" })).toBe("/en/events?when=undated");
    expect(eventHref("en", "e3-2024")).toBe("/en/events/e3-2024");
  });

  it("slug 特殊字元會被編碼", () => {
    expect(platformHref("en", "a b/c")).toBe("/en/platforms/a%20b%2Fc");
  });
});

describe("網址參數解析", () => {
  it("page：1~上限的整數，其他一律第 1 頁", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-2")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("2.5")).toBe(1);
    expect(parsePageParam(String(ENTITY_PAGE_MAX))).toBe(ENTITY_PAGE_MAX);
    expect(parsePageParam(String(ENTITY_PAGE_MAX + 1))).toBe(1);
  });

  it("頁碼上限對應的 offset 不超過 10000", () => {
    expect(pagingForPage(1)).toEqual({ limit: ENTITY_PAGE_SIZE, offset: 0 });
    expect(pagingForPage(ENTITY_PAGE_MAX).offset).toBeLessThanOrEqual(10_000);
  });

  it("平台頁 section／sort 與公司 role、系列 kind：未知值回預設", () => {
    expect(parsePlatformSection("recent")).toBe("recent");
    expect(parsePlatformSection("nope")).toBe("upcoming");
    expect(parsePlatformSection(undefined)).toBe("upcoming");
    expect(parsePlatformSection("all")).toBe("all");
    expect(parsePlatformSort("name")).toBe("name");
    expect(parsePlatformSort("popularity")).toBe("popularity");
    expect(parsePlatformSort("x")).toBe("date");
    expect(parseCompanyRole("publisher")).toBe("publisher");
    expect(parseCompanyRole("ceo")).toBeNull();
    expect(parseFranchiseKind("collection")).toBe("collection");
    expect(parseFranchiseKind("franchise")).toBe("franchise");
    expect(parseFranchiseKind("series")).toBeNull();
  });

  it("firstParam 與 safeDecode", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam("x")).toBe("x");
    expect(firstParam(undefined)).toBeUndefined();
    expect(safeDecode("a%20b")).toBe("a b");
    expect(safeDecode("%E0%A4%A")).toBe("%E0%A4%A");
    // Next 16.4 對同一個請求會給出「已解碼」與「未解碼」兩種 params（實測）：兩種都要得到同一個 slug
    expect(safeDecode("%E4%BD%A0")).toBe("你");
    expect(safeDecode("你")).toBe("你");
    expect(safeDecode("a-b-1")).toBe("a-b-1");
  });
});

describe("分頁與角色", () => {
  it("上一頁／下一頁", () => {
    const href = (n: number) => `/p?page=${n}`;
    expect(buildPager(1, false, href)).toEqual({ page: 1, prev: null, next: null });
    expect(buildPager(1, true, href)).toEqual({ page: 1, prev: null, next: "/p?page=2" });
    expect(buildPager(3, true, href)).toMatchObject({ prev: "/p?page=2", next: "/p?page=4" });
    expect(buildPager(3, false, href)).toMatchObject({ prev: "/p?page=2", next: null });
    expect(buildPager(ENTITY_PAGE_MAX, true, href).next).toBeNull();
  });

  it("只列有作品的角色，順序固定", () => {
    expect(rolesWithCounts({ developer: 3, publisher: 0, porting: 1, supporting: 0 })).toEqual(["developer", "porting"]);
    expect(rolesWithCounts({ developer: 0, publisher: 0, porting: 0, supporting: 0 })).toEqual([]);
  });
});

function game(over: Partial<GameListItem> = {}): GameListItem {
  return {
    gameId: 1,
    slug: "zelda",
    name: "Zelda",
    originalName: "Zelda",
    cover: null,
    firstReleaseDate: "2026-12-01",
    firstReleasePrecision: "month",
    gameType: "main_game",
    popularityScore: 0,
    gameStatus: null,
    ...over,
  };
}

describe("遊戲列表呈現", () => {
  it("日期文字依精度；未定顯示 TBA／待定", () => {
    expect(gameDateText(game(), "en")).toBe("December 2026");
    expect(gameDateText(game({ firstReleaseDate: null, firstReleasePrecision: null }), "en")).toBe("TBA");
    expect(gameDateText(game({ firstReleaseDate: "2026-01-01", firstReleasePrecision: "year" }), "en")).toBe("2026");
  });

  it("遊戲狀態：一般與 released 不標示，rumored／cancelled 標示", () => {
    expect(gameStatusBadge(tEn, null)).toBeNull();
    expect(gameStatusBadge(tEn, "released")).toBeNull();
    expect(gameStatusBadge(tEn, "rumored")).toBe("Rumored");
    expect(gameStatusBadge(tZh, "cancelled")).toBe("已取消");
    expect(gameStatusBadge(tEn, "unknown_status")).toBeNull();
  });

  it("列表渲染：連到遊戲頁、標示狀態；平台頁的 key 含階段（同遊戲兩筆不撞）", () => {
    const platformItem = (stage: "full" | "early_access"): PlatformGameItem => ({
      ...game(),
      date: "2026-12-01",
      precision: "day",
      stage,
    });
    const html = renderToStaticMarkup(
      createElement(EntityGameList, {
        items: [platformItem("early_access"), platformItem("full"), game({ gameId: 2, slug: "rumor", name: "R", gameStatus: "rumored" })],
        locale: "en",
        t: tEn,
      }),
    );
    expect(html).toContain('href="/en/games/zelda"');
    expect(html).toContain("Rumored");
    expect((html.match(/data-game="zelda"/g) ?? []).length).toBe(2);
    expect(html).toContain("December 1, 2026");
  });

  it("分頁元件：第 1 頁無更多時不渲染；有上下頁時有 rel 與 aria-current", () => {
    const none = renderToStaticMarkup(createElement(Pager, { t: tEn, page: 1, hasMore: false, hrefFor: (n) => `/x?page=${n}`, label: "Pagination" }));
    expect(none).toBe("");
    const both = renderToStaticMarkup(createElement(Pager, { t: tZh, page: 2, hasMore: true, hrefFor: (n) => `/x?page=${n}`, label: "分頁" }));
    expect(both).toContain('rel="prev"');
    expect(both).toContain('rel="next"');
    expect(both).toContain('aria-current="page"');
    expect(both).toContain("上一頁");
    expect(both).toContain("第 2 頁");
  });
});
