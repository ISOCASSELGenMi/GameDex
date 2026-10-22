/**
 * Phase 3b（G）純函式：FilterSpec → 讀取條件對應、Domain 正規化（舊時間軸 cursor／組鍵測試已於 D85 刪除）。
 */
import { describe, expect, it } from "vitest";
import { parseFilterSpec } from "@sok/api-contract";
import { collectFilterNotices, filterSpecToReadQuery, filterSpecToReleaseFilter, withoutIgnored } from "@/modules/catalog/ui/filter-mapping";
import { normalizeReleaseFilter, regionPrefIssue } from "@/modules/catalog/domain/release-filter";

const defaults = { gameTypes: ["main_game"], stages: ["full"] };

describe("filter-mapping（3b）", () => {
  it("新維度對應到 ReleaseFilter；status → releaseStates（不是 statuses）", () => {
    const { filter } = parseFilterSpec(
      new URLSearchParams("theme=horror&type=remake&status=upcoming,delayed&minHeat=2&rumored=1&company=capcom&franchise=re"),
    );
    expect(filterSpecToReleaseFilter(filter)).toEqual({
      themeSlugs: ["horror"],
      gameTypes: ["remake"],
      releaseStates: ["delayed", "upcoming"],
      minHeat: 2,
      includeRumored: true,
      companySlugs: ["capcom"],
      franchiseSlugs: ["re"],
    });
  });

  it("filterSpecToReadQuery：year 優先、yearFrom>yearTo 對調、show 預設兩者、sort 預設 popularity", () => {
    const q1 = filterSpecToReadQuery(parseFilterSpec({ year: "2024", yearFrom: "2000", region: "jp", q: "zelda" }).filter);
    expect(q1).toMatchObject({ yearFrom: 2024, yearTo: 2024, regionPref: "JP", q: "zelda", sort: "popularity", show: { releases: true, events: true } });
    const q2 = filterSpecToReadQuery(parseFilterSpec({ yearFrom: "2025", yearTo: "2020", show: "events", sort: "name", from: "2026-01-01" }).filter);
    expect(q2).toMatchObject({ yearFrom: 2020, yearTo: 2025, sort: "name", from: "2026-01-01", show: { releases: false, events: true } });
  });

  it("notices：catalog 回報的未知 theme／region 也轉成提示，withoutIgnored 移除", () => {
    const parsed = parseFilterSpec({ theme: "horror,nope", region: "XX", minHeat: "9" });
    const notices = collectFilterNotices(parsed.issues, [
      { dimension: "theme", slug: "nope" },
      { dimension: "region", slug: "XX" },
    ]);
    expect(notices).toEqual([
      { dimension: "theme", value: "nope", reason: "unknown" },
      { dimension: "region", value: "XX", reason: "unknown" },
      { dimension: "minHeat", value: "9", reason: "invalid" },
    ]);
    expect(withoutIgnored(parsed.filter, notices)).toEqual({ theme: ["horror"] });
  });
});

describe("normalizeReleaseFilter（3b）", () => {
  it("releaseStates、minHeat、theme／company／franchise", () => {
    const n = normalizeReleaseFilter(
      { releaseStates: ["upcoming", "bogus"], minHeat: 7, themeSlugs: ["Horror"], companySlugs: [], franchiseSlugs: ["x"] },
      defaults,
    );
    expect(n.releaseStates).toEqual(["upcoming"]);
    expect(n.minHeat).toBeUndefined();
    expect(n.themeSlugs).toEqual(["horror"]);
    expect(n.companySlugs).toBeUndefined();
    expect(n.franchiseSlugs).toEqual(["x"]);
    expect(n.ignored).toEqual([
      { dimension: "status", slug: "bogus" },
      { dimension: "minHeat", slug: "7" },
    ]);
  });

  it("regionPrefIssue", () => {
    expect(regionPrefIssue(null)).toBeNull();
    expect(regionPrefIssue("jp")).toBeNull();
    expect(regionPrefIssue("XX")).toEqual({ dimension: "region", slug: "XX" });
  });
});
