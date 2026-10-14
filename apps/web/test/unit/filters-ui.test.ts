// 篩選 UI 的純函式：頁面適用參數、chip 與移除連結、標籤、proxy 308 判斷。
import { describe, expect, it } from "vitest";
import { parseFilterSpec } from "@sok/api-contract";
import { createTranslator } from "@sok/i18n";
import { appliedChips, filterSpecForPage, makeFilterLabeler, PAGE_FILTER_PARAMS } from "@/modules/catalog/ui/filters/filter-labels";
import { decideFilterRedirect, isFilterCanonicalPath } from "@/modules/catalog/ui/request-routing";
import { timelineHref, trendingHref } from "@/modules/catalog/ui/links";

const tZh = createTranslator("zh-Hant");
const tEn = createTranslator("en");
const options = {
  platforms: [{ slug: "ps5", name: "PlayStation 5" }],
  genres: [{ slug: "rpg", name: "Role-playing (RPG)" }],
  themes: [{ slug: "horror", name: "Horror" }],
} as Parameters<typeof makeFilterLabeler>[1];

const spec = (q: string) => parseFilterSpec(new URLSearchParams(q)).filter;

describe("filterSpecForPage", () => {
  it("熱門榜只留平台、平台類型、類型；其他參數靜默略過", () => {
    const s = spec("platform=ps5&genre=rpg&theme=horror&minHeat=3&from=2026-01-01&region=JP");
    expect(filterSpecForPage(s, "trending")).toEqual({ platform: ["ps5"], genre: ["rpg"] });
  });

  it("時間軸有 from／to 但沒有 show；月曆有 show 但沒有 from／to", () => {
    const s = spec("show=events&from=2026-01-01&to=2026-12-31");
    expect(filterSpecForPage(s, "timeline")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(filterSpecForPage(s, "calendar")).toEqual({ show: ["events"] });
  });

  it("沒有需要略過的參數時回傳同一個物件", () => {
    const s = spec("platform=ps5");
    expect(filterSpecForPage(s, "calendar")).toBe(s);
  });

  it("每個頁面的參數清單都沒有重複", () => {
    for (const params of Object.values(PAGE_FILTER_PARAMS)) expect(new Set(params).size).toBe(params.length);
  });
});

describe("makeFilterLabeler", () => {
  const zh = makeFilterLabeler(tZh, options);
  const en = makeFilterLabeler(tEn, options);

  it("新維度都有標籤（不再原樣回傳值）", () => {
    expect(zh("theme", "horror")).toBe("恐怖");
    expect(zh("type", "dlc_addon")).toBe("DLC／追加內容");
    expect(zh("status", "delayed")).toBe("曾延期");
    expect(en("status", "upcoming")).toBe("Upcoming");
    expect(en("show", "events")).toBe("Events");
    expect(en("region", "JP")).toBe("Japan");
    expect(zh("region", "WW")).toBe("全球");
    expect(en("minHeat", "4")).toBe("Heat 4 or higher");
    expect(zh("minHeat", "4")).toBe("熱度 4 以上");
    expect(en("rumored", "true")).toBe("Including rumored");
    expect(en("sort", "release_date")).toBe("Release date");
  });

  it("日期依語系格式化（UTC）", () => {
    expect(en("from", "2026-10-13")).toBe("October 13, 2026");
    expect(zh("to", "2026-10-13")).toBe("2026年10月13日");
  });

  it("平台名稱查不到就顯示 slug", () => {
    expect(en("platform", "ps5")).toBe("PlayStation 5");
    expect(en("platform", "unknown-x")).toBe("unknown-x");
  });
});

describe("appliedChips", () => {
  const labeler = makeFilterLabeler(tEn, options);

  it("多值維度每個值一個 chip；移除連結只拿掉該值，保留其他條件", () => {
    const s = spec("platform=ps5,switch&genre=rpg&minHeat=3");
    const chips = appliedChips(s, "/en/timeline", labeler);
    expect(chips.map((c) => `${c.param}:${c.value}`)).toEqual(["platform:ps5", "platform:switch", "genre:rpg", "minHeat:3"]);
    const ps5 = chips.find((c) => c.value === "ps5")!;
    expect(ps5.removeHref).toBe("/en/timeline?platform=switch&genre=rpg&minHeat=3");
    const heat = chips.find((c) => c.param === "minHeat")!;
    expect(heat.removeHref).toBe("/en/timeline?platform=ps5,switch&genre=rpg");
  });

  it("移除最後一個條件時連結沒有 query；extraQuery（at、group）一律保留在後面", () => {
    const chips = appliedChips(spec("theme=horror"), "/en/timeline", labeler);
    expect(chips[0]!.removeHref).toBe("/en/timeline");
    const withExtra = appliedChips(spec("genre=rpg&region=JP"), "/en/trending", labeler, "group=released");
    expect(withExtra.map((c) => c.removeHref)).toEqual(["/en/trending?region=JP&group=released", "/en/trending?genre=rpg&group=released"]);
  });

  it("單值參數（region、from、to、rumored）也各有 chip；sort 不列", () => {
    const chips = appliedChips(spec("region=JP&from=2026-01-01&rumored=1&sort=name"), "/en/timeline", labeler);
    expect(chips.map((c) => c.param)).toEqual(["region", "from", "rumored"]);
    expect(chips[0]!.label).toBe("Japan");
  });

  it("沒有條件就沒有 chip", () => {
    expect(appliedChips({}, "/en/timeline", labeler)).toEqual([]);
  });
});

describe("連結產生", () => {
  it("timelineHref：篩選在前、at 在後（與 proxy 正規形式一致）", () => {
    expect(timelineHref("en", spec("platform=ps5,switch"), "2026-12-01")).toBe("/en/timeline?platform=ps5,switch&at=2026-12-01");
    expect(timelineHref("zh-Hant")).toBe("/zh-Hant/timeline");
  });

  it("trendingHref：upcoming 不寫 group；page 1 不寫 page", () => {
    expect(trendingHref("en")).toBe("/en/trending");
    expect(trendingHref("en", spec("genre=rpg"), "released", 3)).toBe("/en/trending?genre=rpg&group=released&page=3");
  });
});

describe("proxy 篩選正規化（decideFilterRedirect）", () => {
  it("適用頁面：月曆月份、時間軸、熱門榜、遊戲列表；不含詳情頁與其他", () => {
    expect(isFilterCanonicalPath(["calendar", "2026-10"])).toBe(true);
    expect(isFilterCanonicalPath(["timeline"])).toBe(true);
    expect(isFilterCanonicalPath(["trending"])).toBe(true);
    expect(isFilterCanonicalPath(["games"])).toBe(true);
    expect(isFilterCanonicalPath(["games", "zelda"])).toBe(false);
    expect(isFilterCanonicalPath(["platforms"])).toBe(false);
    expect(isFilterCanonicalPath([])).toBe(false);
  });

  it("表單送出的重複參數、空值 → 308 到正規網址（保留語系與路徑）", () => {
    expect(decideFilterRedirect("/en/timeline", "?platform=switch&platform=ps5&genre=&region=")).toBe("/en/timeline?platform=ps5,switch");
    expect(decideFilterRedirect("/zh-Hant/calendar/2026-10", "?genre=rpg&genre=action")).toBe("/zh-Hant/calendar/2026-10?genre=action,rpg");
    expect(decideFilterRedirect("/en/trending", "?genre=")).toBe("/en/trending");
  });

  it("其他參數（at、cursor、group、page）保留原值並接在篩選之後", () => {
    expect(decideFilterRedirect("/en/timeline", "?at=2026-12-01&platform=switch&platform=ps5")).toBe("/en/timeline?platform=ps5,switch&at=2026-12-01");
  });

  it("已是正規形式、沒有 query、或有格式問題（交給頁面提示）→ null；冪等", () => {
    expect(decideFilterRedirect("/en/timeline", "?platform=ps5,switch&at=2026-12-01")).toBeNull();
    expect(decideFilterRedirect("/en/timeline", "")).toBeNull();
    expect(decideFilterRedirect("/en/timeline", "?platform=Bad!&platform=ps5")).toBeNull();
    const first = decideFilterRedirect("/en/timeline", "?platform=b&platform=a")!;
    const url = new URL(first, "http://x");
    expect(decideFilterRedirect(url.pathname, url.search)).toBeNull();
  });

  it("逗號被重新編碼成 %2C 不算差異（避免用戶端把逗號編碼而造成無限轉址）", () => {
    expect(decideFilterRedirect("/en/timeline", "?platform=ps5%2Cswitch")).toBeNull();
    expect(decideFilterRedirect("/en/timeline", "?platform=ps5%2Cswitch&at=2026-12-01")).toBeNull();
    // 真的有差異（順序、重複）時照樣轉址
    expect(decideFilterRedirect("/en/timeline", "?platform=switch%2Cps5")).toBe("/en/timeline?platform=ps5,switch");
  });

  it("高-1：只差百分比編碼（' ! * ( ) 與 %27 等）不轉址，不會無限 308", () => {
    const P = "/zh-Hant/games";
    for (const s of [
      "?q=a'b",
      "?q=a%27b",
      "?q=Assassin%27s%20Creed",
      "?q=Assassin's%20Creed",
      "?q=Assassin's Creed",
      "?q=Assassin%27s+Creed",
      "?q=a(b)!*",
      "?q=a%28b%29%21%2A",
      "?platform=ps5%2Cswitch&q=a%27b&at=2026-12-01",
    ]) {
      expect(decideFilterRedirect(P, s), s).toBeNull();
    }
  });

  it("高-1：仍需轉址的情況照舊轉址，且產出的 target 以兩種編碼再判斷都回 null（冪等）", () => {
    const cases = [
      "?q=a'b&platform=switch&platform=ps5",
      "?q=a%27b&genre=&platform=switch,ps5",
      "?at=2026-12-01&q=Assassin%27s%20Creed&platform=switch&platform=ps5",
      "?q=a(b)!*&platform=switch&platform=ps5",
      "?q=a'b&platform=PS5",
    ];
    for (const s of cases) {
      const target = decideFilterRedirect("/en/games", s);
      expect(target, s).not.toBeNull();
      const [path, rawSearch = ""] = target!.split("?");
      const raw = rawSearch ? `?${rawSearch}` : "";
      // 原樣（含未編碼的 '）與經 WHATWG URL 重新編碼（瀏覽器實際送回的）兩種形式
      expect(decideFilterRedirect(path!, raw), `raw ${s}`).toBeNull();
      const u = new URL(target!, "http://x");
      expect(decideFilterRedirect(u.pathname, u.search), `url ${s}`).toBeNull();
    }
  });

  it("不是篩選頁面一律 null（詳情頁、其他路徑）", () => {
    expect(decideFilterRedirect("/en/games/zelda", "?platform=b&platform=a")).toBeNull();
    expect(decideFilterRedirect("/en/platforms", "?platform=b&platform=a")).toBeNull();
  });
});
