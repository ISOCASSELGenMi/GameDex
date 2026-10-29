// HTML 預算（06 §瀏覽與搜尋）：伺服器元件輸出同時在 HTML 與 RSC payload 出現，這裡鎖住「大量重複元素」的單位成本。
// 真實資料下的整頁大小由 e2e/html-budget-a.spec.ts（fixture）與 scripts/html-size.mjs（連真實資料的伺服器）量。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@sok/i18n";
import type { FilterOptions } from "@/modules/catalog/domain/entities";
import { FilterPanel, type FilterField } from "@/modules/catalog/ui/filters/filter-panel";
import { TrendingList, type TrendingRow } from "@/modules/catalog/ui/trending/trending-list";

vi.mock("next/form", () => ({
  default: (props: Record<string, unknown>) => createElement("form", { className: props.className as string, action: props.action as string }, props.children as never),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", { className: props.className as string, src: props.src as string, alt: "" }),
}));

const t = createTranslator("zh-Hant");
const FIELDS: readonly FilterField[] = ["platform", "platformKind", "genre", "theme", "type", "status"];

function options(platformCount: number): FilterOptions {
  return {
    platforms: Array.from({ length: platformCount }, (_, i) => ({
      slug: `platform-number-${i}`,
      name: `Platform Number ${i}`,
      abbreviation: null,
      kind: "console",
      generation: null,
      isCommon: i < 20,
      recentReleaseCount: 0,
    })),
    platformKinds: ["console", "pc"],
    genres: Array.from({ length: 23 }, (_, i) => ({ slug: `genre-${i}`, name: `Genre ${i}` })),
    stages: ["full"],
    defaultStages: ["full"],
    defaultGameTypes: ["main_game"],
    themes: Array.from({ length: 22 }, (_, i) => ({ slug: `theme-${i}`, name: `Theme ${i}` })),
    gameTypes: ["main_game"],
    releaseStates: ["upcoming"],
    regions: ["WW"],
    sorts: [],
  } as unknown as FilterOptions;
}

describe("篩選面板的 HTML 成本", () => {
  const render = (n: number) =>
    renderToStaticMarkup(
      createElement(FilterPanel, { locale: "zh-Hant", t, options: options(n), spec: {}, action: "/zh-Hant/ratings", fields: FIELDS }),
    );

  it("平台清單全部列出（不再有「只列常用」），每個核取方塊（含 slug 與名稱）< 120 bytes", () => {
    const html = render(215);
    expect((html.match(/name=platform /g) ?? []).length).toBe(215);
    const grid = /<div class="check-grid">(?:(?!<\/div>)[\s\S])*platform-number-100(?:(?!<\/div>)[\s\S])*<\/div>/.exec(html)?.[0] ?? "";
    expect(grid.length).toBeGreaterThan(0);
    const perItem = grid.length / (grid.match(/<label>/g) ?? []).length;
    expect(perItem).toBeLessThan(120);
  });

  it("核取方塊是 dangerouslySetInnerHTML 的字串，不是 React 元素（元素在 RSC payload 每個約 200 bytes）", () => {
    const html = render(215);
    // 單一 <div class="check-grid"> 內的 <input> 沒有 React 序列化的屬性（type="checkbox" 帶引號、尾端 /）
    expect(html).not.toContain('type="checkbox"');
  });

  it("215 個平台＋23 類型＋22 主題的整個表單 < 40 KB", () => {
    expect(Buffer.byteLength(render(215), "utf8")).toBeLessThan(40_000);
  });
});

describe("熱門榜榜單的單位成本", () => {
  const row = (i: number): TrendingRow => [`some-game-slug-${i}`, `/zh-Hant/games/some-game-slug-${i}`, "https://images.igdb.com/igdb/image/upload/t_cover_small/co1abc.jpg", `Some Game Title ${i}`, "en", "上市日：2026 年 10 月", 4, `第 ${i} 名`];
  const rows = Array.from({ length: 50 }, (_, i) => row(i + 1));
  const labels = [null, "熱度 1/5", "熱度 2/5", "熱度 3/5", "熱度 4/5", "熱度 5/5"];

  it("RSC payload 的列（陣列）每筆 < 300 bytes", () => {
    expect(JSON.stringify(rows[0]).length).toBeLessThan(300);
  });

  it("火焰圖示用 <use> 參照共用 sprite，不是每列一份 path", () => {
    const html = renderToStaticMarkup(createElement(TrendingList, { rows, heatLabels: labels, spriteId: "s" }));
    expect(html).toContain('<use href="#s"');
    expect(html).not.toContain("M8.6 1c");
    expect((html.match(/data-trending-item=/g) ?? []).length).toBe(50);
  });

  it("50 列的伺服器 HTML < 50 KB", () => {
    const html = renderToStaticMarkup(createElement(TrendingList, { rows, heatLabels: labels, spriteId: "s" }));
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(50_000);
  });
});
