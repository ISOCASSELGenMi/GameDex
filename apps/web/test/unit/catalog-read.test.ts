import { describe, expect, it } from "vitest";
import { CatalogQueryTimeoutError, isCatalogQueryTimeoutError, type GameLink } from "@/modules/catalog/domain/entities";
import { resolveImageRef } from "@/modules/catalog/providers/image-ref";
import { parseIgdbImageId } from "@/modules/catalog/providers/igdb/images";
import { monthBounds, normalizeRegionPref, normalizeReleaseFilter } from "@/modules/catalog/domain/release-filter";
import { groupCompanies, groupReleases, sortLinks } from "@/modules/catalog/repository/game-detail";
import { isStatementTimeout } from "@/modules/catalog/repository/read-tx";
import { COMMON_PLATFORM_MIN_RECENT_RELEASES, isCommonPlatform } from "@/modules/catalog/repository/filter-options";

const defaults = { gameTypes: ["main_game", "port"], stages: ["unspecified", "full"] };

describe("normalizeReleaseFilter", () => {
  it("未給 → 套預設；cancelled 預設不在 statuses", () => {
    expect(normalizeReleaseFilter({}, defaults)).toEqual({
      stages: ["unspecified", "full"],
      gameTypes: ["main_game", "port"],
      statuses: ["scheduled", "delayed", "released"],
      includeRumored: false,
      ignored: [],
    });
  });

  it("去重、轉小寫、未知 enum 值回報；全部無效 → 預設／不限制", () => {
    const n = normalizeReleaseFilter(
      { platformSlugs: ["PS5", "ps5", " "], platformKinds: ["mobile", "pc", "x"], stages: ["nope"], gameTypes: ["remake"] },
      defaults,
    );
    expect(n.platformSlugs).toEqual(["ps5"]);
    expect(n.platformKinds).toEqual(["pc"]);
    expect(n.stages).toEqual(["unspecified", "full"]);
    expect(n.gameTypes).toEqual(["remake"]);
    expect(n.ignored).toEqual([
      { dimension: "platformKind", slug: "mobile" },
      { dimension: "platformKind", slug: "x" },
      { dimension: "stage", slug: "nope" },
    ]);
    expect(normalizeReleaseFilter({ platformKinds: ["mobile"] }, defaults).platformKinds).toBeUndefined();
  });

  it("單一維度最多 20 個值，超過的回報", () => {
    const n = normalizeReleaseFilter({ genreSlugs: Array.from({ length: 22 }, (_, i) => `g${i}`) }, defaults);
    expect(n.genreSlugs).toHaveLength(20);
    expect(n.ignored).toEqual([
      { dimension: "genre", slug: "g20" },
      { dimension: "genre", slug: "g21" },
    ]);
  });

  it("環境變數預設值有錯字 → 過濾；全部無效 → 規格預設", () => {
    const n = normalizeReleaseFilter({}, { gameTypes: ["main_gme"], stages: ["full", "oops"] });
    expect(n.gameTypes).toEqual(["main_game", "standalone_expansion", "remake", "remaster", "port"]);
    expect(n.stages).toEqual(["full"]);
  });
});

describe("normalizeRegionPref／monthBounds", () => {
  it("地區偏好：已知 code → fallback → WW", () => {
    expect(normalizeRegionPref("jp", "WW")).toBe("JP");
    expect(normalizeRegionPref("XX", "eu")).toBe("EU");
    expect(normalizeRegionPref(null, "nope")).toBe("WW");
  });
  it("月份邊界（閏年）；無效年月丟 RangeError", () => {
    expect(monthBounds(2028, 2)).toEqual({ first: "2028-02-01", last: "2028-02-29" });
    expect(monthBounds(2026, 12)).toEqual({ first: "2026-12-01", last: "2026-12-31" });
    expect(() => monthBounds(2026, 13)).toThrow(RangeError);
  });
});

describe("圖片網址 → ImageRef（Provider）", () => {
  const base = "https://images.igdb.com/igdb/image/upload";
  it("IGDB 圖片網址：取 id、依用途換尺寸 token", () => {
    expect(parseIgdbImageId(`${base}/t_cover_big/co6fyp.jpg`)).toBe("co6fyp");
    expect(parseIgdbImageId(`${base}/t_screenshot_big/bzj0uj2svnwlqxwtbjgc.jpg`)).toBe("bzj0uj2svnwlqxwtbjgc");
    expect(parseIgdbImageId("https://example.com/t_cover_big/x.jpg")).toBeNull();
    expect(resolveImageRef(`${base}/t_cover_big/co6fyp.jpg`, "cover")).toEqual({
      original: `${base}/t_cover_big/co6fyp.jpg`,
      small: `${base}/t_cover_small/co6fyp.jpg`,
      medium: `${base}/t_cover_big/co6fyp.jpg`,
      large: `${base}/t_1080p/co6fyp.jpg`,
      resized: true,
    });
    expect(resolveImageRef(`${base}/t_screenshot_big/sc1.jpg`, "screenshot")).toMatchObject({
      small: `${base}/t_screenshot_med/sc1.jpg`,
      medium: `${base}/t_screenshot_big/sc1.jpg`,
      resized: true,
    });
  });
  it("非 IGDB 格式的 http(s) 網址原樣使用（不變成沒封面）", () => {
    const url = "https://cdn.example.com/covers/abc.webp";
    expect(resolveImageRef(url, "cover")).toEqual({ original: url, small: url, medium: url, large: url, resized: false });
  });
  it("空值與非 http(s) → null", () => {
    expect(resolveImageRef(null, "cover")).toBeNull();
    expect(resolveImageRef("  ", "cover")).toBeNull();
    expect(resolveImageRef("javascript:alert(1)", "cover")).toBeNull();
  });
});

describe("詳情的排序與分組（純函式）", () => {
  it("sortLinks：商店 → 官網 → 社群 → 媒體；同類型失效的排後面；other 最後", () => {
    const l = (linkType: GameLink["linkType"], categoryLabel: string, isBroken = false): GameLink => ({
      linkType,
      categoryLabel,
      url: `https://${categoryLabel}.example`,
      isBroken,
    });
    const sorted = sortLinks([
      l("media", "youtube"),
      l("store", "other"),
      l("social", "twitter"),
      l("store", "gog"),
      l("store", "steam", true),
      l("official", "official_website"),
      l("store", "playstation_store"),
    ]);
    expect(sorted.map((x) => x.categoryLabel)).toEqual([
      "playstation_store", "gog", "other", "steam", "official_website", "twitter", "youtube",
    ]);
  });

  it("groupCompanies：同公司多角色合併並依角色順序", () => {
    expect(
      groupCompanies([
        { slug: "a", name: "A", role: "publisher" },
        { slug: "a", name: "A", role: "developer" },
        { slug: "b", name: "B", role: "porting" },
      ]),
    ).toEqual([
      { slug: "a", name: "A", roles: ["developer", "publisher"] },
      { slug: "b", name: "B", roles: ["porting"] },
    ]);
  });

  it("groupReleases：依平台分組；偏好地區 → WW → 其他（日期早到晚，tbd 最後）", () => {
    const base = {
      release_stage: "full" as const,
      period_start: null,
      precision: "day" as const,
      status: "scheduled" as const,
      source_status: "active" as const,
      source: "igdb",
      platform_abbreviation: null,
      platform_kind: "console" as const,
    };
    const rows = [
      { ...base, id: 1, region_code: "US", release_date: "2030-01-05", platform_slug: "ps", platform_name: "PS" },
      { ...base, id: 2, region_code: "WW", release_date: "2030-02-01", platform_slug: "ps", platform_name: "PS" },
      { ...base, id: 3, region_code: "EU", release_date: null, platform_slug: "ps", platform_name: "PS" },
      { ...base, id: 4, region_code: "JP", release_date: "2030-03-01", platform_slug: "ps", platform_name: "PS" },
      { ...base, id: 5, region_code: "WW", release_date: "2030-01-01", platform_slug: "al", platform_name: "Alpha" },
    ];
    const history = [
      { release_event_id: 2, old_date: "2029-12-31", old_precision: "year" as const, new_date: "2030-02-01", new_precision: "day" as const, changed_at: new Date("2029-06-01T00:00:00Z") },
    ];
    const g = groupReleases(rows, history, "JP");
    expect(g.map((x) => x.platform.slug)).toEqual(["al", "ps"]);
    expect(g[1].releases.map((r) => r.regionCode)).toEqual(["JP", "WW", "US", "EU"]);
    expect(g[1].releases[1].history).toEqual([
      { oldDate: "2029-12-31", oldPrecision: "year", newDate: "2030-02-01", newPrecision: "day", changedAt: "2029-06-01T00:00:00.000Z" },
    ]);
  });
});

describe("逾時錯誤", () => {
  it("isStatementTimeout 看穿 drizzle 的包裝；錯誤型別可辨識", () => {
    const pgErr = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    expect(isStatementTimeout(pgErr)).toBe(true);
    expect(isStatementTimeout(new Error("wrapped", { cause: pgErr }))).toBe(true);
    expect(isStatementTimeout(new Error("other"))).toBe(false);
    const e = new CatalogQueryTimeoutError(3000);
    expect(isCatalogQueryTimeoutError(e)).toBe(true);
    expect(e.timeoutMs).toBe(3000);
  });
});

describe("常用平台", () => {
  it("達門檻且非 other／mobile", () => {
    const n = COMMON_PLATFORM_MIN_RECENT_RELEASES;
    expect(isCommonPlatform("console", n)).toBe(true);
    expect(isCommonPlatform("pc", n - 1)).toBe(false);
    expect(isCommonPlatform("other", n * 100)).toBe(false);
    expect(isCommonPlatform("mobile", n * 100)).toBe(false);
  });
});
