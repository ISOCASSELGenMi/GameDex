import { describe, expect, it } from "vitest";
import {
  combineHypeRecords,
  heatLevelOf,
  HYPE_VALUE_SCALE,
  popularityGroupOf,
  popularityScoreOf,
  resolveHeatWeights,
  upcomingCutoff,
} from "@/modules/catalog/domain/heat";
import {
  fetchIgdbHypeRecords,
  fetchIgdbHypeVersion,
  toExternalHypeRecord,
  type IgdbQueryClient,
} from "@/modules/catalog/providers/igdb/popularity";
import {
  FULL_REFRESH_INTERVAL_MS,
  hypeVersionChanged,
  parseRefreshPopularityArgs,
  resolvePopularityGroups,
} from "@/modules/catalog/use-cases/sync/refresh-popularity";

describe("resolveHeatWeights（03 §熱度 步驟 3）", () => {
  it("沒有站內追蹤：IGDB 0.7／結構 0.3", () => {
    const w = resolveHeatWeights({ siteFollowsTotal: 0, coldStartFollows: 5000, hasIgdbSignal: true });
    expect(w.site).toBe(0);
    expect(w.igdb).toBeCloseTo(0.7);
    expect(w.struct).toBeCloseTo(0.3);
  });
  it("無 IGDB 訊號：其餘全給結構", () => {
    expect(resolveHeatWeights({ siteFollowsTotal: 0, coldStartFollows: 5000, hasIgdbSignal: false })).toEqual({
      site: 0,
      igdb: 0,
      struct: 1,
    });
  });
  it("追蹤數一半 → wSite 0.3；達滿封頂 0.6", () => {
    const half = resolveHeatWeights({ siteFollowsTotal: 2500, coldStartFollows: 5000, hasIgdbSignal: true });
    expect(half.site).toBeCloseTo(0.3);
    expect(half.igdb).toBeCloseTo(0.49);
    expect(half.struct).toBeCloseTo(0.21);
    expect(resolveHeatWeights({ siteFollowsTotal: 99999, coldStartFollows: 5000, hasIgdbSignal: true }).site).toBeCloseTo(0.6);
  });
});

describe("popularityScoreOf／heatLevelOf", () => {
  it("round(1000 × Σ w·p)，缺訊號為 0，夾在 0~1000", () => {
    const w = { site: 0, igdb: 0.7, struct: 0.3 };
    expect(popularityScoreOf(w, { igdb: 1, struct: 1 })).toBe(1000);
    expect(popularityScoreOf(w, { igdb: 0.5 })).toBe(350);
    expect(popularityScoreOf(w, {})).toBe(0);
    expect(popularityScoreOf({ site: 2, igdb: 0, struct: 0 }, { site: 1 })).toBe(1000);
  });
  it("前 1% → 5、5% → 4、15% → 3、40% → 2、其餘 → 1；無訊號 → 0", () => {
    expect(heatLevelOf(0, true)).toBe(5);
    expect(heatLevelOf(0.0099, true)).toBe(5);
    expect(heatLevelOf(0.01, true)).toBe(4);
    expect(heatLevelOf(0.049, true)).toBe(4);
    expect(heatLevelOf(0.1, true)).toBe(3);
    expect(heatLevelOf(0.3, true)).toBe(2);
    expect(heatLevelOf(0.4, true)).toBe(1);
    expect(heatLevelOf(1, true)).toBe(1);
    expect(heatLevelOf(0, false)).toBe(0);
  });
});

describe("分群", () => {
  it("無日期或 ≥ 今天 − 30 天 → upcoming", () => {
    expect(upcomingCutoff("2026-10-13")).toBe("2026-09-13");
    expect(upcomingCutoff("2026-03-01")).toBe("2026-01-30");
    expect(popularityGroupOf(null, "2026-10-13")).toBe("upcoming");
    expect(popularityGroupOf("2026-09-13", "2026-10-13")).toBe("upcoming");
    expect(popularityGroupOf("2026-09-12", "2026-10-13")).toBe("released");
    expect(popularityGroupOf("2027-01-01", "2026-10-13")).toBe("upcoming");
  });
});

describe("combineHypeRecords", () => {
  it("種類內累積百分位，取各種類最大值；同值同分；無效值略過", () => {
    const m = combineHypeRecords([
      { igdbGameId: 1, signal: "want_to_play", value: 0.1 },
      { igdbGameId: 2, signal: "want_to_play", value: 0.2 },
      { igdbGameId: 3, signal: "want_to_play", value: 0.2 },
      { igdbGameId: 4, signal: "want_to_play", value: 0.4 },
      { igdbGameId: 1, signal: "most_wishlisted_upcoming", value: 5 },
      { igdbGameId: 9, signal: "most_wishlisted_upcoming", value: 1 },
      { igdbGameId: 8, signal: "most_wishlisted_upcoming", value: Number.NaN },
    ]);
    expect(m.get(4)).toBe(HYPE_VALUE_SCALE);
    expect(m.get(2)).toBe(m.get(3));
    expect(m.get(2)).toBe(0.75 * HYPE_VALUE_SCALE);
    // 1：want_to_play 0.25、wishlist 1.0 → 取 1.0
    expect(m.get(1)).toBe(HYPE_VALUE_SCALE);
    expect(m.get(9)).toBe(0.5 * HYPE_VALUE_SCALE);
    expect(m.has(8)).toBe(false);
  });
  it("同一款同種類重複取最大值", () => {
    const m = combineHypeRecords([
      { igdbGameId: 1, signal: "want_to_play", value: 0.1 },
      { igdbGameId: 1, signal: "want_to_play", value: 0.9 },
      { igdbGameId: 2, signal: "want_to_play", value: 0.5 },
    ]);
    expect(m.get(1)).toBe(HYPE_VALUE_SCALE);
    expect(m.get(2)).toBe(0.5 * HYPE_VALUE_SCALE);
  });
});

describe("IGDB popularity_primitives（Provider）", () => {
  it("類型 2、10 轉成我方種類；其他類型、缺欄位 → null", () => {
    expect(toExternalHypeRecord({ id: 1, game_id: 5, popularity_type: 2, value: 0.001 })).toEqual({
      igdbGameId: 5,
      signal: "want_to_play",
      value: 0.001,
    });
    expect(toExternalHypeRecord({ id: 1, game_id: 5, popularity_type: 10, value: 0.1 })?.signal).toBe("most_wishlisted_upcoming");
    expect(toExternalHypeRecord({ id: 1, game_id: 5, popularity_type: 1, value: 0.1 })).toBeNull();
    expect(toExternalHypeRecord({ id: 1, popularity_type: 2, value: 0.1 })).toBeNull();
    expect(toExternalHypeRecord({ id: 1, game_id: 5, popularity_type: 2 })).toBeNull();
  });

  it("版本查詢與全量抓取的查詢字串", async () => {
    const calls: Array<[string, string, string?]> = [];
    const client: IgdbQueryClient = {
      query: async <T,>(endpoint: string, body: string) => {
        calls.push([endpoint, body]);
        return (body.includes("popularity_type = 2") ? [{ id: 1, calculated_at: 1791854245 }] : []) as T[];
      },
      queryAll: async <T extends { id: number }>(endpoint: string, fields: string, where?: string) => {
        calls.push([endpoint, fields, where]);
        return [
          { id: 1, game_id: 10, popularity_type: 2, value: 0.5 },
          { id: 2, game_id: 11, popularity_type: 10, value: 0.2 },
          { id: 3, game_id: 12, popularity_type: 3, value: 0.2 },
        ] as unknown as T[];
      },
    };
    expect(await fetchIgdbHypeVersion(client)).toEqual({
      want_to_play: new Date(1791854245 * 1000).toISOString(),
      most_wishlisted_upcoming: null,
    });
    const recs = await fetchIgdbHypeRecords(client);
    expect(recs.map((r) => r.igdbGameId)).toEqual([10, 11]);
    expect(calls.at(-1)).toEqual(["popularity_primitives", "game_id,popularity_type,value", "popularity_type = (2,10)"]);
  });
});

describe("refresh_popularity 排程判斷", () => {
  const now = new Date("2026-10-13T10:50:00Z");
  it("auto：從未全量或超過 23 小時 → 兩群；否則只 upcoming", () => {
    expect(resolvePopularityGroups("auto", undefined, now)).toEqual(["upcoming", "released"]);
    expect(resolvePopularityGroups("auto", new Date(now.getTime() - FULL_REFRESH_INTERVAL_MS).toISOString(), now)).toEqual([
      "upcoming",
      "released",
    ]);
    expect(resolvePopularityGroups("auto", new Date(now.getTime() - 3600_000).toISOString(), now)).toEqual(["upcoming"]);
    expect(resolvePopularityGroups("all", new Date().toISOString(), now)).toEqual(["upcoming", "released"]);
    expect(resolvePopularityGroups("upcoming", undefined, now)).toEqual(["upcoming"]);
  });
  it("版本比較", () => {
    const v = { want_to_play: "a", most_wishlisted_upcoming: "b" };
    expect(hypeVersionChanged(undefined, v)).toBe(true);
    expect(hypeVersionChanged(v, { ...v })).toBe(false);
    expect(hypeVersionChanged(v, { ...v, most_wishlisted_upcoming: "c" })).toBe(true);
  });
  it("參數", () => {
    expect(parseRefreshPopularityArgs([])).toEqual({});
    expect(parseRefreshPopularityArgs(["--scope", "all", "--force-hype"])).toEqual({ scope: "all", forceHypeFetch: true });
    expect(() => parseRefreshPopularityArgs(["--scope", "x"])).toThrow();
    expect(() => parseRefreshPopularityArgs(["--nope"])).toThrow();
  });
});
