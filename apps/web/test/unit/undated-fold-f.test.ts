/**
 * 月曆未定日摺起來的組（方案 A）：「查看全部 N 款」連結的出現條件與參數（純渲染，不碰 DB）。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "@sok/i18n";
import { describe, expect, it } from "vitest";
import type { ReleaseCard } from "@/modules/catalog/domain/entities";
import { UndatedView } from "@/modules/catalog/ui/calendar/month-views";
import { buildCalendarViewModel } from "@/modules/catalog/ui/calendar/view-model";
import { UNDATED_OPEN_MAX } from "@/modules/catalog/ui/month";

const t = createTranslator("en");

function cards(n: number, precision: "month" | "quarter" | "year", date: string): ReleaseCard[] {
  return Array.from({ length: n }, (_, i) => ({
    gameId: 100 + i,
    slug: `g${i}`,
    name: `G${i}`,
    originalName: `G${i}`,
    cover: null,
    date,
    periodStart: date,
    precision,
    stage: "full",
    status: "scheduled",
    sourceStatus: "active",
    gameType: "main_game",
    popularityScore: 1000 - i,
    heatLevel: 0,
    platforms: [{ id: 1, slug: "ps5", name: "PS5", abbreviation: "PS5" }],
  })) as unknown as ReleaseCard[];
}

function render(undated: ReleaseCard[], spec = {}): string {
  const vm = buildCalendarViewModel({ year: 2026, month: 12, days: {}, undated, events: [], ignored: [] }, "en", t);
  return renderToStaticMarkup(createElement(UndatedView, { locale: "en", t, groups: vm.undated, hrefOf: (item) => vm.previews[item.key]!.h, spec }));
}

describe("未定日「查看全部」連結", () => {
  it("超過 24 款：連到 /games?year=<期間年>&by=date，文字含總數", () => {
    const html = render(cards(UNDATED_OPEN_MAX + 6, "year", "2026-12-31"));
    expect(html).toContain('href="/en/games?year=2026&amp;by=date"');
    expect(html).toContain("View all 30 games");
    expect((html.match(/class="fc"/g) ?? []).length).toBe(UNDATED_OPEN_MAX);
  });

  it("保留月曆的篩選（平台、類型、熱度），並丟掉瀏覽頁不適用的參數（show）", () => {
    const html = render(cards(UNDATED_OPEN_MAX + 1, "quarter", "2026-12-31"), { platform: ["ps5"], genre: ["rpg"], minHeat: 3, show: ["releases"] });
    const href = /href="(\/en\/games\?[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&") ?? "";
    expect(href).toContain("platform=ps5");
    expect(href).toContain("genre=rpg");
    expect(href).toContain("minHeat=3");
    expect(href).toContain("year=2026");
    expect(href.endsWith("&by=date")).toBe(true);
    expect(href).not.toContain("show=");
  });

  it("剛好 24 款或更少：沒有連結", () => {
    expect(render(cards(UNDATED_OPEN_MAX, "year", "2026-12-31"))).not.toContain("undated-more");
    expect(render(cards(3, "month", "2026-12-01"))).not.toContain("undated-more");
  });
});
