// Phase 3a 網站 UI 的純函式：月曆格、＋N 折疊、FilterSpec↔ReleaseFilter、語言選單網址、proxy 路由判斷、月曆 view model。
import { describe, expect, it } from "vitest";
import { parseFilterSpec } from "@sok/api-contract";
import { createTranslator } from "@sok/i18n";
import type { CalendarMonth, ReleaseCard } from "@/modules/catalog";
import { getLocaleConfig, needsLocalePrefix, pickRequestLocale, buildLocaleCookie } from "@/kernel/locale";
import {
  collectFilterNotices,
  filterSpecToReleaseFilter,
  releaseFilterToFilterSpecShape,
  withoutIgnored,
} from "@/modules/catalog/ui/filter-mapping";
import { calendarMonthHref, calendarTodayHref, languageMenuLinks, localeHref, searchParamsToQuery } from "@/modules/catalog/ui/links";
import {
  addMonths,
  buildMonthGrid,
  daysInMonth,
  foldItems,
  formatMonthParam,
  parseMonthParam,
  weekStartFor,
} from "@/modules/catalog/ui/month";
import { decideLocalizedRoute, renderNotFoundHtml } from "@/modules/catalog/ui/request-routing";
import { buildCalendarViewModel, eventDayInMonth, joinList } from "@/modules/catalog/ui/calendar/view-model";

describe("月份參數", () => {
  it("只接受 yyyy-mm、1900~2200", () => {
    expect(parseMonthParam("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonthParam("2026-1")).toBeNull();
    expect(parseMonthParam("2026-13")).toBeNull();
    expect(parseMonthParam("2026-00")).toBeNull();
    expect(parseMonthParam("1899-12")).toBeNull();
    expect(parseMonthParam("2201-01")).toBeNull();
    expect(parseMonthParam("abcd-10")).toBeNull();
    expect(formatMonthParam({ year: 2026, month: 3 })).toBe("2026-03");
  });

  it("加減月份可跨年，超出範圍回 null", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 5 }, -17)).toEqual({ year: 2024, month: 12 });
    expect(addMonths({ year: 2200, month: 12 }, 1)).toBeNull();
    expect(addMonths({ year: 1900, month: 1 }, -1)).toBeNull();
  });
});

describe("月曆格", () => {
  it("月首週偏移：2026-10-01 是週四 → 週日起偏移 4、週一起偏移 3", () => {
    const sun = buildMonthGrid({ year: 2026, month: 10 }, 0);
    expect(sun.leading).toBe(4);
    expect(sun.weeks[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(sun.weeks.length).toBe(5);
    const mon = buildMonthGrid({ year: 2026, month: 10 }, 1);
    expect(mon.leading).toBe(3);
    expect(mon.weeks[0]![3]).toBe("2026-10-01");
  });

  it("月首正好是週起始日時沒有偏移（2026-02-01 週日）；每列 7 格、補滿最後一列", () => {
    const g = buildMonthGrid({ year: 2026, month: 2 }, 0);
    expect(g.leading).toBe(0);
    expect(g.weeks.length).toBe(4);
    expect(g.weeks.flat().filter(Boolean)).toHaveLength(28);
    for (const w of g.weeks) expect(w).toHaveLength(7);
  });

  it("閏年 2 月與跨年月份", () => {
    expect(daysInMonth({ year: 2024, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2100, month: 2 })).toBe(28);
    const dec = buildMonthGrid({ year: 2026, month: 12 }, 0); // 2026-12-01 週二
    expect(dec.leading).toBe(2);
    expect(dec.weeks.at(-1)!.filter(Boolean).at(-1)).toBe("2026-12-31");
    const jan = buildMonthGrid({ year: 2027, month: 1 }, 0); // 2027-01-01 週五
    expect(jan.leading).toBe(5);
    expect(jan.weeks.length).toBe(6);
  });

  it("週起始日可依語系設定（目前 zh-Hant、en 週日起；未列出的語系用預設）", () => {
    expect(weekStartFor("zh-Hant")).toBe(0);
    expect(weekStartFor("en")).toBe(0);
    expect(weekStartFor("xx")).toBe(0);
  });
});

describe("＋N 折疊", () => {
  it("超過上限才折疊，筆數正確、不遺漏", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const r = foldItems(items, 3);
    expect(r.visible).toEqual([0, 1, 2]);
    expect(r.hidden).toBe(7);
    expect([...r.visible, ...r.folded]).toEqual(items);
    expect(foldItems([1, 2, 3], 3)).toEqual({ visible: [1, 2, 3], folded: [], hidden: 0 });
    expect(foldItems([], 3).hidden).toBe(0);
  });
});

describe("FilterSpec ↔ ReleaseFilter", () => {
  it("3a 四個維度一對一對應，空維度省略", () => {
    const { filter } = parseFilterSpec(new URLSearchParams("platform=switch,ps5&genre=rpg&stage=full&platformKind=console"));
    expect(filterSpecToReleaseFilter(filter)).toEqual({
      platformSlugs: ["ps5", "switch"],
      platformKinds: ["console"],
      genreSlugs: ["rpg"],
      stages: ["full"],
    });
    expect(filterSpecToReleaseFilter({})).toEqual({});
    const rf = filterSpecToReleaseFilter(filter);
    expect(releaseFilterToFilterSpecShape(rf)).toEqual({ platform: ["ps5", "switch"], platformKind: ["console"], genre: ["rpg"], stage: ["full"] });
  });

  it("status（upcoming／released／delayed）對應 releaseStates，不進上市列 statuses", () => {
    const rf = filterSpecToReleaseFilter(parseFilterSpec(new URLSearchParams("status=upcoming")).filter);
    expect(rf).toEqual({ releaseStates: ["upcoming"] });
    expect(rf.statuses).toBeUndefined();
  });

  it("合併格式錯誤與查無此 slug 的提示，並從連結用的 FilterSpec 移除", () => {
    const parsed = parseFilterSpec(new URLSearchParams("platform=ps5,nope&stage=BAD!"));
    const notices = collectFilterNotices(parsed.issues, [{ dimension: "platform", slug: "nope" }, { dimension: "type", slug: "x" }]);
    expect(notices).toEqual([
      { dimension: "platform", value: "nope", reason: "unknown" },
      { dimension: "type", value: "x", reason: "unknown" },
      { dimension: "stage", value: "bad!", reason: "invalid" },
    ]);
    expect(withoutIgnored(parsed.filter, notices)).toEqual({ platform: ["ps5"] });
  });
});

describe("網址與語言選單", () => {
  it("語言選單：同一路徑與 query，只換語系前綴，以自稱顯示", () => {
    const links = languageMenuLinks("zh-Hant", ["zh-Hant", "en"], "/calendar/2026-10", "platform=ps5,switch");
    expect(links).toEqual([
      { locale: "zh-Hant", href: "/zh-Hant/calendar/2026-10?platform=ps5,switch", label: "繁體中文", current: true },
      { locale: "en", href: "/en/calendar/2026-10?platform=ps5,switch", label: "English", current: false },
    ]);
    expect(languageMenuLinks("en", ["zh-Hant", "en"], "/")[0]!.href).toBe("/zh-Hant");
  });

  it("月份連結保留篩選（逗號不編碼）；今天連結不帶月份", () => {
    const spec = parseFilterSpec(new URLSearchParams("genre=rpg&platform=switch,ps5")).filter;
    expect(calendarMonthHref("en", { year: 2027, month: 1 }, spec)).toBe("/en/calendar/2027-01?platform=ps5,switch&genre=rpg");
    expect(calendarTodayHref("zh-Hant", spec)).toBe("/zh-Hant/calendar?platform=ps5,switch&genre=rpg");
    expect(localeHref("en", "/games/elden-ring")).toBe("/en/games/elden-ring");
    expect(searchParamsToQuery({ platform: ["ps5", "switch"], x: "1", y: undefined })).toBe("platform=ps5&platform=switch&x=1");
  });
});

describe("無前綴入口與 proxy 判斷", () => {
  const config = getLocaleConfig({ SUPPORTED_LOCALES: "zh-Hant,en,ja" });

  it("支援語系來自 env 與字典的交集", () => {
    expect(config.supported).toEqual(["zh-Hant", "en"]);
    expect(config.defaultLocale).toBe("zh-Hant");
  });

  it("哪些路徑要補語系前綴", () => {
    expect(needsLocalePrefix("/", config)).toBe(true);
    expect(needsLocalePrefix("/calendar", config)).toBe(true);
    expect(needsLocalePrefix("/games/elden-ring", config)).toBe(true);
    expect(needsLocalePrefix("/zh-Hant/calendar", config)).toBe(false);
    expect(needsLocalePrefix("/en", config)).toBe(false);
    expect(needsLocalePrefix("/fr/calendar", config)).toBe(false); // 像語系代碼 → 不導向（404）
    expect(needsLocalePrefix("/something-else", config)).toBe(true);
  });

  it("語系決定順序：Cookie → Accept-Language → 預設", () => {
    expect(pickRequestLocale({ cookie: "en", acceptLanguage: "zh-TW" }, config)).toBe("en");
    expect(pickRequestLocale({ cookie: "fr", acceptLanguage: "en-US,en;q=0.9" }, config)).toBe("en");
    expect(pickRequestLocale({ acceptLanguage: "zh-TW,zh;q=0.9" }, config)).toBe("zh-Hant");
    expect(pickRequestLocale({ acceptLanguage: "de-DE" }, config)).toBe("zh-Hant");
    expect(pickRequestLocale({}, config)).toBe("zh-Hant");
  });

  it("語言 Cookie：SameSite=Lax、1 年", () => {
    expect(buildLocaleCookie("en")).toBe("sok_locale=en; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(buildLocaleCookie("en", { secure: true })).toContain("; Secure");
  });

  it("帶前綴路徑：/{locale}、/{locale}/calendar 導到當月（保留 query）；月份格式錯 404", () => {
    const now = new Date("2026-12-31T23:30:00Z");
    expect(decideLocalizedRoute("/en", "en", "?platform=ps5", now)).toEqual({ type: "redirect", location: "/en/calendar/2026-12?platform=ps5" });
    expect(decideLocalizedRoute("/zh-Hant/calendar", "zh-Hant", "", now)).toEqual({ type: "redirect", location: "/zh-Hant/calendar/2026-12" });
    expect(decideLocalizedRoute("/zh-Hant/calendar/2026-13", "zh-Hant", "", now)).toEqual({ type: "notFound", locale: "zh-Hant" });
    expect(decideLocalizedRoute("/zh-Hant/calendar/2026-10/x", "zh-Hant", "", now)).toEqual({ type: "notFound", locale: "zh-Hant" });
    expect(decideLocalizedRoute("/zh-Hant/calendar/2026-10", "zh-Hant", "", now)).toEqual({ type: "next" });
    expect(decideLocalizedRoute("/zh-Hant/games/elden-ring", "zh-Hant", "", now)).toEqual({ type: "next" });
  });

  it("proxy 的 404 文件有 lang、noindex、字典文字", () => {
    const html = renderNotFoundHtml("en");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('content="noindex"');
    expect(html).toContain("Page not found");
    expect(html).toContain('href="/en/calendar"');
  });
});

function card(over: Partial<ReleaseCard>): ReleaseCard {
  return {
    gameId: 1,
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
    platforms: [
      { slug: "ps5", name: "PlayStation 5", abbreviation: "PS5", kind: "console" },
      { slug: "switch", name: "Nintendo Switch", abbreviation: "Switch", kind: "hybrid" },
    ],
    popularityScore: 0,
    heatLevel: 0,
    gameType: "main_game",
    gameStatus: null,
    releaseEventIds: [1],
    ...over,
  };
}

describe("月曆 view model", () => {
  const t = createTranslator("zh-Hant");

  it("活動排在當天卡片之前；開始於上月的活動放本月 1 日；未定日依精度分組", () => {
    const data: CalendarMonth = {
      year: 2026,
      month: 10,
      days: { "2026-10-05": [card({ gameId: 1, slug: "a", name: "A" }), card({ gameId: 2, slug: "b", name: "B", stage: "early_access", status: "delayed", sourceStatus: "removed" })] },
      undated: [
        card({ gameId: 3, slug: "c", date: "2026-10-01", precision: "month" }),
        card({ gameId: 4, slug: "d", date: "2026-12-31", precision: "quarter" }),
      ],
      events: [
        { id: 9, slug: "e", name: "Expo", kind: "expo", startTime: "2026-09-29T10:00:00.000Z", endTime: "2026-10-02T10:00:00.000Z", timezone: null, logoUrl: null },
        { id: 10, slug: "s", name: "Show", kind: "showcase", startTime: "2026-10-05T17:00:00.000Z", endTime: null, timezone: null, logoUrl: null },
      ],
      ignored: [],
    };
    const vm = buildCalendarViewModel(data, "zh-Hant", t);
    expect(vm.releaseCount).toBe(4);
    expect(vm.eventCount).toBe(2);
    expect(vm.days["2026-10-05"]!.map((i) => i.type)).toEqual(["event", "card", "card"]);
    expect(vm.days["2026-10-01"]!.map((i) => i.key)).toEqual(["e9"]);
    expect(vm.undated.map((g) => g.precision)).toEqual(["month", "quarter"]);
    const keys = vm.days["2026-10-05"]!.filter((i) => i.type === "card").map((i) => i.key);
    const a = vm.previews[keys[0]!]!;
    expect(a).toMatchObject({ h: "/zh-Hant/games/a", n: "A", d: "2026年10月5日", p: "PlayStation 5、Nintendo Switch", a: "PS5 · Switch" });
    expect(a.x).toBeUndefined();
    const b = vm.previews[keys[1]!]!;
    expect(b).toMatchObject({ tk: "delayed", t: "已延期", r: 1, x: "（搶先體驗、已延期、資料來源待確認）" });
  });

  it("活動日期與列舉分隔符號", () => {
    expect(eventDayInMonth({ id: 1, slug: "x", name: "x", kind: "other", startTime: null, endTime: null, timezone: null, logoUrl: null }, 2026, 10)).toBeNull();
    expect(joinList("zh-Hant", ["A", "B"])).toBe("A、B");
    expect(joinList("en", ["A", "B"])).toBe("A, B");
  });
});
