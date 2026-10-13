// 熱度徽章與熱門榜 UI 的純函式／渲染。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import { HEAT_LEVEL_MAX, HeatBadge, hasHeatBadge, heatBadgeLabel } from "@/modules/catalog/ui/heat-badge";
import { TRENDING_PAGE_MAX, TRENDING_PAGE_SIZE, parseTrendingGroup, parseTrendingPage } from "@/modules/catalog/ui/trending/params";

const tZh = createTranslator("zh-Hant");
const tEn = createTranslator("en");

describe("熱度徽章文字", () => {
  it("1~5 顯示「熱度 n/5」，0 與非法值不顯示", () => {
    expect(heatBadgeLabel(tZh, 4)).toBe("熱度 4/5");
    expect(heatBadgeLabel(tEn, 1)).toBe("Heat 1/5");
    expect(heatBadgeLabel(tEn, 0)).toBeNull();
    expect(heatBadgeLabel(tEn, -1)).toBeNull();
    expect(heatBadgeLabel(tEn, null)).toBeNull();
    expect(heatBadgeLabel(tEn, undefined)).toBeNull();
    expect(heatBadgeLabel(tEn, Number.NaN)).toBeNull();
  });

  it("超過上限夾在 5、小數無條件捨去", () => {
    expect(HEAT_LEVEL_MAX).toBe(5);
    expect(heatBadgeLabel(tEn, 9)).toBe("Heat 5/5");
    expect(heatBadgeLabel(tEn, 3.9)).toBe("Heat 3/5");
    expect(hasHeatBadge(0)).toBe(false);
    expect(hasHeatBadge(1)).toBe(true);
  });
});

describe("HeatBadge 元件", () => {
  it("等級 0 不輸出任何東西", () => {
    expect(renderToStaticMarkup(createElement(HeatBadge, { level: 0, label: "x" }))).toBe("");
    expect(renderToStaticMarkup(createElement(HeatBadge, { level: 3, label: null }))).toBe("");
  });

  it("完整模式：圖示（aria-hidden）＋可見文字，不只靠顏色", () => {
    const html = renderToStaticMarkup(createElement(HeatBadge, { level: 4, label: "熱度 4/5" }));
    expect(html).toContain("熱度 4/5");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-heat="4"');
    expect(html).not.toContain('role="img"');
  });

  it("精簡模式：role=img＋aria-label（完整文字），可見內容只有數字；數字本身對報讀器隱藏", () => {
    const html = renderToStaticMarkup(createElement(HeatBadge, { level: 5, label: "Heat 5/5", compact: true }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Heat 5/5"');
    expect(html).toContain('<span aria-hidden="true">5</span>');
  });
});

describe("熱門榜參數", () => {
  it("group：只有 released 是已上市，其餘一律 upcoming", () => {
    expect(parseTrendingGroup("released")).toBe("released");
    expect(parseTrendingGroup("upcoming")).toBe("upcoming");
    expect(parseTrendingGroup("RELEASED")).toBe("upcoming");
    expect(parseTrendingGroup(undefined)).toBe("upcoming");
    expect(parseTrendingGroup(null)).toBe("upcoming");
  });

  it("page：1~上限的整數，其餘回第 1 頁", () => {
    expect(parseTrendingPage("3")).toBe(3);
    expect(parseTrendingPage(String(TRENDING_PAGE_MAX))).toBe(TRENDING_PAGE_MAX);
    expect(parseTrendingPage(String(TRENDING_PAGE_MAX + 1))).toBe(1);
    expect(parseTrendingPage("0")).toBe(1);
    expect(parseTrendingPage("-2")).toBe(1);
    expect(parseTrendingPage("2.5")).toBe(1);
    expect(parseTrendingPage("abc")).toBe(1);
    expect(parseTrendingPage("")).toBe(1);
    expect(parseTrendingPage(undefined)).toBe(1);
  });

  it("每頁筆數不超過 getTrending 的上限（100）", () => {
    expect(TRENDING_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
