import { createTranslator, type Locale } from "@sok/i18n";
import { describe, expect, it } from "vitest";
import type { ReleaseCard } from "@/modules/catalog/domain/entities";
import { DAY_CARD_MAX_CHIPS, DAY_CARD_MAX_TAGS, buildPreview, cardTags, toDayCard, toFoldRow } from "@/modules/catalog/ui/calendar/day-card";
import { buildCalendarViewModel } from "@/modules/catalog/ui/calendar/view-model";
import { UNDATED_OPEN_MAX } from "@/modules/catalog/ui/month";
import { DAY_DOTS_MAX } from "@/modules/catalog/ui/calendar/day-cell";

function card(over: Partial<ReleaseCard> = {}): ReleaseCard {
  return {
    gameId: 7,
    slug: "game",
    name: "Game",
    originalName: "Game",
    cover: null,
    date: "2026-10-05",
    periodStart: "2026-10-05",
    precision: "day",
    stage: "full",
    status: "scheduled",
    sourceStatus: "active",
    platforms: [{ slug: "ps5", name: "PlayStation 5", abbreviation: "PS5", kind: "console" }],
    popularityScore: 0,
    heatLevel: 0,
    gameType: "main_game",
    gameStatus: null,
    releaseEventIds: [1],
    ...over,
  };
}

describe("月曆格卡片資料（toDayCard／cardTags）", () => {
  const t = createTranslator("en");
  const p = (n: number) => ({ slug: `p${n}`, name: `Platform ${n}`, abbreviation: n % 2 ? `P${n}` : null, kind: "pc" as const });

  it("一般正式版：沒有標籤；平台縮寫、gameId、預覽欄位自帶", () => {
    const d = toDayCard(card(), "en", t);
    expect(d).toMatchObject({ id: 7, h: "/en/games/game", n: "Game", pc: ["PS5"], tg: [], sk: "full" });
    expect(d.pn).toBeUndefined();
    expect(d.nl).toBeUndefined(); // 顯示名＝原名且與頁面語系相同 → 不標 lang
    expect(buildPreview(card(), "en", t)).toEqual(expect.objectContaining({ h: d.h, n: d.n, d: d.d, p: d.p }));
  });

  it("標籤：階段（非正式版）、延期／取消、非本篇的遊戲類型（DLC）、來源待確認；最多 3 個，依這個順序", () => {
    const tags = cardTags(card({ stage: "early_access", status: "delayed", gameType: "dlc_addon", sourceStatus: "removed" }), t);
    expect(tags.map((x) => x.k)).toEqual(["stage", "status", "type"]);
    expect(tags.length).toBeLessThanOrEqual(DAY_CARD_MAX_TAGS);
    expect(tags[0]).toEqual({ k: "stage", i: "early_access", l: "Early access" });
    expect(tags[2]).toEqual({ k: "type", l: "DLC / Add-on" });
    expect(cardTags(card({ gameType: "dlc_addon" }), t)).toEqual([{ k: "type", l: "DLC / Add-on" }]);
    expect(cardTags(card({ sourceStatus: "removed" }), t).map((x) => x.k)).toEqual(["warn"]);
    expect(cardTags(card({ status: "cancelled" }), t)).toEqual([{ k: "status", i: "cancelled", l: expect.any(String) }]);
    expect(cardTags(card({ gameType: "no_such_type" }), t)).toEqual([]); // 字典沒有的類型不顯示
  });

  it("平台 chip 最多 3 個，其餘以數量表示；熱度與封面", () => {
    const platforms = [1, 2, 3, 4, 5].map(p);
    const d = toDayCard(
      card({ platforms, heatLevel: 4, cover: { small: "s", medium: "m", large: "l" } as ReleaseCard["cover"] }),
      "en",
      t,
    );
    expect(d.pc).toEqual(["P1", "Platform 2", "P3"]);
    expect(d.pc).toHaveLength(DAY_CARD_MAX_CHIPS);
    expect(d.pn).toBe(2);
    expect(d).toMatchObject({ hv: 4, c: "m" });
    expect(d.hl).toMatch(/4/);
  });

  it("外文原名標 lang（日文頁顯示英文原名）；有在地化名稱不標", () => {
    const ja = createTranslator("ja" as Locale);
    expect(toDayCard(card({ name: "Elden Ring", originalName: "Elden Ring" }), "ja", ja).nl).toBe("en");
    expect(toDayCard(card({ name: "艾爾登法環", originalName: "Elden Ring" }), "zh-Hant", createTranslator("zh-Hant")).nl).toBeUndefined();
  });

  it("每天只帶第一款與總數（RSC／HTML 大小）；格內資料不含折疊清單專用欄位", () => {
    const cards = [1, 2, 3].map((i) => card({ gameId: i, slug: `g${i}`, name: `G${i}` }));
    const vm = buildCalendarViewModel({ year: 2026, month: 10, days: { "2026-10-05": cards }, undated: [], events: [], ignored: [] }, "en", t);
    expect(vm.days["2026-10-05"]).toMatchObject({ total: 3 });
    expect(vm.days["2026-10-05"]!.first).toMatchObject({ id: 1, n: "G1" });
    expect(vm.days["2026-10-05"]!.first).not.toHaveProperty("a");
    expect(vm.days["2026-10-05"]!.first).not.toHaveProperty("x");
    expect(vm.releaseCount).toBe(3);
    expect(Object.keys(vm.previews)).toEqual([]);
  });

  it("未定日：數量少帶完整卡片與預覽資料；超過 UNDATED_OPEN_MAX 只帶精簡列（陣列），沒有預覽資料", () => {
    const mk = (n: number, precision: "month" | "quarter") =>
      Array.from({ length: n }, (_, i) => card({ gameId: 1000 * n + i, slug: `u${n}-${i}`, name: `U${n}-${i}`, date: "2026-10-01", precision }));
    const small = mk(2, "quarter");
    const big = mk(UNDATED_OPEN_MAX + 1, "month");
    const vm = buildCalendarViewModel({ year: 2026, month: 10, days: {}, undated: [...big, ...small], events: [], ignored: [] }, "en", t);
    const [month, quarter] = vm.undated;
    expect(month).toMatchObject({ precision: "month", count: UNDATED_OPEN_MAX + 1, firstDate: "2026-10-01", items: [] });
    expect(month!.rows).toHaveLength(UNDATED_OPEN_MAX + 1);
    expect(month!.rows[0]).toEqual(["/en/games/u25-0", "U25-0", "PS5", ""]);
    expect(quarter).toMatchObject({ precision: "quarter", count: 2, rows: [] });
    expect(quarter!.items).toHaveLength(2);
    expect(Object.keys(vm.previews)).toHaveLength(2); // 只有數量少的那組
    expect(vm.releaseCount).toBe(UNDATED_OPEN_MAX + 3);
    expect(toFoldRow(card({ stage: "early_access" }), "en", t)[3]).toBe("(Early access)");
  });

  it("切換鈕與計數的字典樣板含 {index}／{total}（三語）", () => {
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      const tr = createTranslator(locale);
      for (const key of ["a11y.calendarPrevGame", "a11y.calendarNextGame"]) {
        const s = tr.t(key);
        expect(s, `${locale}:${key}`).toContain("{index}");
        expect(s, `${locale}:${key}`).toContain("{total}");
      }
      const cur = tr.t("a11y.calendarCurrentGame");
      expect(cur).toContain("{name}");
      expect(cur).toContain("{index}");
    }
    expect(DAY_DOTS_MAX).toBe(6);
  });
});
