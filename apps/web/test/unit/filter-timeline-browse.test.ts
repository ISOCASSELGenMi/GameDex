/**
 * Phase 3b（G）純函式：FilterSpec → 讀取條件對應、Domain 正規化、時間軸 cursor／組鍵／分組。
 */
import { describe, expect, it } from "vitest";
import { parseFilterSpec } from "@sok/api-contract";
import { collectFilterNotices, filterSpecToReadQuery, filterSpecToReleaseFilter, withoutIgnored } from "@/modules/catalog/ui/filter-mapping";
import { normalizeReleaseFilter, regionPrefIssue } from "@/modules/catalog/domain/release-filter";
import {
  boundaryKey,
  compareTimelineKeys,
  decodeTimelineCursor,
  encodeTimelineCursor,
  groupTimelineRows,
  parseTimelineGroupKey,
  timelineGroupKey,
  timelineKeyOf,
} from "@/modules/catalog/repository/timeline";
import type { ReleaseCard } from "@/modules/catalog";

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

function card(over: Partial<ReleaseCard>): ReleaseCard {
  return {
    gameId: 1,
    slug: "g",
    name: "G",
    originalName: "G",
    cover: null,
    date: "2026-10-13",
    periodStart: "2026-10-13",
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
  };
}

describe("時間軸 cursor 與組", () => {
  it("encode／decode round-trip；壞字串回 null", () => {
    const c = { dir: "before" as const, key: { sk: "2027-04-01", pr: 1, np: -500, gameId: 42, st: 2 } };
    expect(decodeTimelineCursor(encodeTimelineCursor(c))).toEqual(c);
    for (const bad of ["", "!!!", "abc", Buffer.from("[2,\"a\"]").toString("base64url"), Buffer.from('[1,"a","2026-13-45",0,0,0,0]').toString("base64url")]) {
      expect(decodeTimelineCursor(bad)).toBeNull();
    }
    expect(decodeTimelineCursor(undefined)).toBeNull();
  });

  it("排序鍵：同 periodStart 時 year → quarter → month → day；tbd 最後；邊界鍵在該日之前", () => {
    const keys = [
      timelineKeyOf(card({ precision: "day", periodStart: "2027-04-01", date: "2027-04-01" })),
      timelineKeyOf(card({ precision: "quarter", periodStart: "2027-04-01", date: "2027-06-30" })),
      timelineKeyOf(card({ precision: "tbd", periodStart: null, date: null })),
      timelineKeyOf(card({ precision: "month", periodStart: "2027-04-01", date: "2027-04-01" })),
      timelineKeyOf(card({ precision: "day", periodStart: "2027-03-31", date: "2027-03-31", popularityScore: 1 })),
      boundaryKey("2027-04-01"),
    ].sort(compareTimelineKeys);
    expect(keys.map((k) => `${k.sk}/${k.pr}`)).toEqual([
      "2027-03-31/3",
      "2027-04-01/-1",
      "2027-04-01/1",
      "2027-04-01/2",
      "2027-04-01/3",
      "9999-12-31/4",
    ]);
  });

  it("組鍵 round-trip", () => {
    expect(timelineGroupKey("quarter", "2027-04-01")).toBe("quarter:2027-04-01");
    expect(parseTimelineGroupKey("quarter:2027-04-01")).toEqual({ precision: "quarter", periodStart: "2027-04-01" });
    expect(parseTimelineGroupKey("tbd")).toEqual({ precision: "tbd", periodStart: null });
    expect(parseTimelineGroupKey("week:2027-01-01")).toBeNull();
  });

  it("低-1／2：不存在的日期（02-31、0000）在 cursor 與組鍵一律視為無效（不送進 PG 變 500）", () => {
    expect(parseTimelineGroupKey("day:2026-02-31")).toBeNull();
    expect(parseTimelineGroupKey("month:0000-01-01")).toBeNull();
    expect(parseTimelineGroupKey("day:2026-02-28")).toEqual({ precision: "day", periodStart: "2026-02-28" });
    const mk = (sk: string) => Buffer.from(JSON.stringify([1, "a", sk, 0, 0, 1, 1])).toString("base64url");
    expect(decodeTimelineCursor(mk("2026-02-31"))).toBeNull();
    expect(decodeTimelineCursor(mk("2026-02-28"))).not.toBeNull();
    expect(decodeTimelineCursor(mk("9999-12-31"))).not.toBeNull(); // tbd 的排序日期
  });

  it("groupTimelineRows：月份區段、hiddenCount、跨頁延續旗標", () => {
    const row = (c: ReleaseCard, rank: number, groupTotal: number) => ({ card: c, key: timelineKeyOf(c), rank, groupTotal });
    const groups = groupTimelineRows(
      [
        row(card({ gameId: 1, precision: "quarter", periodStart: "2027-04-01", date: "2027-06-30" }), 2, 3),
        row(card({ gameId: 2, precision: "quarter", periodStart: "2027-04-01", date: "2027-06-30" }), 3, 3),
        row(card({ gameId: 3, periodStart: "2027-04-02", date: "2027-04-02" }), 1, 15),
        row(card({ gameId: 4, periodStart: "2027-04-02", date: "2027-04-02" }), 2, 15),
        row(card({ gameId: 5, precision: "tbd", periodStart: null, date: null }), 1, 1),
      ],
      10,
    );
    expect(groups.map((g) => [g.key, g.month, g.cards.length, g.hiddenCount, g.continuesFromPrev, g.continuesToNext])).toEqual([
      ["quarter:2027-04-01", "2027-04", 2, 0, true, false],
      ["day:2027-04-02", "2027-04", 2, 5, false, true],
      ["tbd", null, 1, 0, false, false],
    ]);
  });
});
