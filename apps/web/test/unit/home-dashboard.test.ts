import { describe, expect, it } from "vitest";
import type { ReleaseCard } from "@/modules/catalog/domain/entities";
import { HOME_CARD_PLATFORM_LIMIT, addDaysIso, pickHomeCards } from "@/modules/catalog/domain/home-dashboard";
import { decideLocalizedRoute } from "@/modules/catalog/ui/request-routing";

function card(over: Partial<ReleaseCard> & { gameId: number }): ReleaseCard {
  return {
    slug: `g${over.gameId}`,
    name: `G${over.gameId}`,
    originalName: `G${over.gameId}`,
    cover: null,
    date: "2043-06-20",
    periodStart: "2043-06-20",
    precision: "day",
    stage: "full",
    status: "scheduled",
    sourceStatus: "active",
    platforms: [],
    popularityScore: 0,
    heatLevel: 0,
    gameType: "main_game",
    gameStatus: null,
    releaseEventIds: [1],
    hasDateHistory: false,
    ...over,
  } as ReleaseCard;
}

describe("首頁挑選規則 pickHomeCards", () => {
  it("取熱度最高的 limit 款，再依日期排序（asc：近到遠；desc：新到舊）", () => {
    const cards = [
      card({ gameId: 1, date: "2043-06-30", popularityScore: 900 }),
      card({ gameId: 2, date: "2043-06-16", popularityScore: 100 }),
      card({ gameId: 3, date: "2043-06-20", popularityScore: 500 }),
      card({ gameId: 4, date: "2043-06-17", popularityScore: 300 }),
    ];
    expect(pickHomeCards(cards, 3, "asc").map((c) => c.gameId)).toEqual([4, 3, 1]);
    expect(pickHomeCards(cards, 3, "desc").map((c) => c.gameId)).toEqual([1, 3, 4]);
  });

  it("同一款遊戲只出現一次：asc 取最早、desc 取最晚", () => {
    const cards = [card({ gameId: 1, date: "2043-06-25" }), card({ gameId: 1, date: "2043-06-18" }), card({ gameId: 1, date: "2043-06-22" })];
    expect(pickHomeCards(cards, 12, "asc").map((c) => c.date)).toEqual(["2043-06-18"]);
    expect(pickHomeCards(cards, 12, "desc").map((c) => c.date)).toEqual(["2043-06-25"]);
  });

  it("同日依熱度高到低；沒有日期的卡略過；limit ≤ 0 回空", () => {
    const cards = [
      card({ gameId: 1, date: "2043-06-20", popularityScore: 10 }),
      card({ gameId: 2, date: "2043-06-20", popularityScore: 20 }),
      card({ gameId: 3, date: null, precision: "tbd", popularityScore: 999 }),
    ];
    expect(pickHomeCards(cards, 12, "asc").map((c) => c.gameId)).toEqual([2, 1]);
    expect(pickHomeCards(cards, 0, "asc")).toEqual([]);
  });

  it("平台 chip 最多 3 個，其餘數量放 platformMore", () => {
    const chips = Array.from({ length: 5 }, (_, i) => ({ slug: `p${i}`, name: `P${i}`, abbreviation: null, kind: "console" as const }));
    const [c] = pickHomeCards([card({ gameId: 1, platforms: chips })], 12, "asc");
    expect(c!.platforms).toHaveLength(HOME_CARD_PLATFORM_LIMIT);
    expect(c!.platformMore).toBe(2);
  });

  it("addDaysIso：跨月、跨年、閏日", () => {
    expect(addDaysIso("2043-06-15", 30)).toBe("2043-07-15");
    expect(addDaysIso("2043-01-05", -10)).toBe("2042-12-26");
    expect(addDaysIso("2044-02-28", 1)).toBe("2044-02-29");
  });
});

describe("首頁路由：/{locale} 不再導向月曆", () => {
  const now = new Date("2043-06-15T00:00:00Z");
  it("/{locale}（無 query 或只有非篩選參數）→ 首頁", () => {
    expect(decideLocalizedRoute("/en", "en", "", now)).toEqual({ type: "next" });
    expect(decideLocalizedRoute("/zh-Hant", "zh-Hant", "?utm_source=x", now)).toEqual({ type: "next" });
  });
  it("舊書籤 /{locale}?<篩選參數> → 當月月曆（保留 query）", () => {
    expect(decideLocalizedRoute("/en", "en", "?platform=ps5", now)).toEqual({ type: "redirect", location: "/en/calendar/2043-06?platform=ps5" });
    expect(decideLocalizedRoute("/ja", "ja", "?genre=rpg&region=JP", now)).toEqual({ type: "redirect", location: "/ja/calendar/2043-06?genre=rpg&region=JP" });
  });
  it("/{locale}/calendar 仍導向當月", () => {
    expect(decideLocalizedRoute("/en/calendar", "en", "", now)).toEqual({ type: "redirect", location: "/en/calendar/2043-06" });
  });
});
