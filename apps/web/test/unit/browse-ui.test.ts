// 瀏覽頁 /games 的純邏輯：分頁、表單欄位、連結（view-model、links）。
import { describe, expect, it } from "vitest";
import { parseFilterSpec } from "@sok/api-contract";
import { BROWSE_OFFSET_MAX, BROWSE_PAGE_SIZE } from "@/modules/catalog/domain/entities";
import {
  BROWSE_FILTER_FIELDS,
  BROWSE_MAX_PAGE,
  BROWSE_SORT_OPTIONS,
  browseOffset,
  browsePagination,
  browseRange,
  hiddenFilterFields,
  parseBrowsePage,
  yearFieldValues,
} from "@/modules/catalog/ui/browse/view-model";
import { filterSpecForPage, PAGE_FILTER_PARAMS } from "@/modules/catalog/ui/filters/filter-labels";
import { decideFilterRedirect } from "@/modules/catalog/ui/request-routing";
import { gamesBrowseHref } from "@/modules/catalog/ui/links";

describe("頁碼與 offset", () => {
  it("最後一頁的 offset 不超過上限、再下一頁超過", () => {
    expect(BROWSE_MAX_PAGE).toBe(Math.floor(BROWSE_OFFSET_MAX / BROWSE_PAGE_SIZE) + 1);
    expect(browseOffset(BROWSE_MAX_PAGE)).toBeLessThanOrEqual(BROWSE_OFFSET_MAX);
    expect(browseOffset(BROWSE_MAX_PAGE + 1)).toBeGreaterThan(BROWSE_OFFSET_MAX);
  });

  it("parseBrowsePage：非法值回第 1 頁", () => {
    expect(parseBrowsePage(undefined)).toBe(1);
    expect(parseBrowsePage("")).toBe(1);
    expect(parseBrowsePage("abc")).toBe(1);
    expect(parseBrowsePage("0")).toBe(1);
    expect(parseBrowsePage("-2")).toBe(1);
    expect(parseBrowsePage("2.5")).toBe(1);
    expect(parseBrowsePage("3")).toBe(3);
    expect(parseBrowsePage(String(BROWSE_MAX_PAGE))).toBe(BROWSE_MAX_PAGE);
    expect(parseBrowsePage(String(BROWSE_MAX_PAGE + 1))).toBe(1);
  });

  it("browseOffset", () => {
    expect(browseOffset(1)).toBe(0);
    expect(browseOffset(2)).toBe(BROWSE_PAGE_SIZE);
    expect(browseOffset(0)).toBe(0);
  });
});

describe("browsePagination", () => {
  it("第 1 頁沒有上一頁；有更多才有下一頁", () => {
    expect(browsePagination(1, true)).toEqual({ prev: null, next: 2, limitReached: false });
    expect(browsePagination(1, false)).toEqual({ prev: null, next: null, limitReached: false });
  });
  it("中間頁兩邊都有", () => {
    expect(browsePagination(5, true)).toEqual({ prev: 4, next: 6, limitReached: false });
  });
  it("到達 offset 上限：沒有下一頁，標記 limitReached", () => {
    expect(browsePagination(BROWSE_MAX_PAGE, true)).toEqual({ prev: BROWSE_MAX_PAGE - 1, next: null, limitReached: true });
    expect(browsePagination(BROWSE_MAX_PAGE, false).limitReached).toBe(false);
  });
});

describe("browseRange", () => {
  it("1 起算；沒有結果回 null", () => {
    expect(browseRange(0, 24)).toEqual({ from: 1, to: 24 });
    expect(browseRange(24, 7)).toEqual({ from: 25, to: 31 });
    expect(browseRange(0, 0)).toBeNull();
  });
});

describe("排序與篩選欄位", () => {
  it("只開放 popularity／release_date／name", () => {
    expect([...BROWSE_SORT_OPTIONS]).toEqual(["popularity", "release_date", "name"]);
  });
  it("篩選面板欄位不含瀏覽無作用的維度（stage／region／show／日期範圍）", () => {
    for (const bad of ["stage", "region", "show", "dateRange"]) expect(BROWSE_FILTER_FIELDS).not.toContain(bad);
    expect(PAGE_FILTER_PARAMS.browse).not.toContain("stage");
  });
  it("filterSpecForPage 對 browse 略過 stage／region", () => {
    const spec = filterSpecForPage(parseFilterSpec({ genre: "rpg", stage: "demo", region: "JP", q: "zelda" }).filter, "browse");
    expect(spec).toEqual({ genre: ["rpg"], q: "zelda" });
  });
});

describe("hiddenFilterFields", () => {
  it("多值維度一值一欄、rumored 為 1；exclude 不帶", () => {
    const { filter } = parseFilterSpec({ platform: "ps5,switch", genre: "rpg", q: "zelda", sort: "name", yearFrom: "2020", rumored: "1" });
    const fields = hiddenFilterFields(filter, ["q", "sort", "year", "yearFrom", "yearTo"]);
    expect(fields).toEqual([
      { name: "platform", value: "ps5" },
      { name: "platform", value: "switch" },
      { name: "genre", value: "rpg" },
      { name: "rumored", value: "1" },
    ]);
  });
  it("空 spec 沒有欄位", () => {
    expect(hiddenFilterFields({}, [])).toEqual([]);
  });
});

describe("yearFieldValues", () => {
  it("year 視為起訖相同；沒有則空字串", () => {
    expect(yearFieldValues({ year: 2024 })).toEqual({ from: "2024", to: "2024" });
    expect(yearFieldValues({ yearFrom: 2020 })).toEqual({ from: "2020", to: "" });
    expect(yearFieldValues({})).toEqual({ from: "", to: "" });
  });
});

describe("gamesBrowseHref", () => {
  it("沒有條件：/games；第 1 頁不寫 page", () => {
    expect(gamesBrowseHref("zh-Hant")).toBe("/zh-Hant/games");
    expect(gamesBrowseHref("en", {}, 1)).toBe("/en/games");
  });
  it("篩選在前、page 在後", () => {
    const { filter } = parseFilterSpec({ genre: "rpg", q: "zelda", sort: "name" });
    expect(gamesBrowseHref("en", filter, 3)).toBe("/en/games?genre=rpg&q=zelda&sort=name&page=3");
    expect(gamesBrowseHref("en", {}, 2)).toBe("/en/games?page=2");
  });
  it("產生的網址已是正規形式（proxy 不會再 308）", () => {
    const { filter } = parseFilterSpec({ platform: "ps5,switch", genre: "rpg", yearFrom: "2020", q: "a b", sort: "release_date" });
    const href = gamesBrowseHref("en", filter, 4);
    const [path, search] = href.split("?");
    expect(decideFilterRedirect(path!, `?${search}`)).toBeNull();
  });
});
