import { describe, expect, it } from "vitest";
import { buildEventsWhere, toEventRecord } from "@/modules/catalog/providers/igdb";
import {
  findNewDictionaryIds,
  KNOWN_EXTERNAL_GAME_SOURCE_IDS,
  KNOWN_WEBSITE_TYPE_IDS,
} from "@/modules/catalog/providers/igdb/link-map";
import { advanceCursor, parseBackfillArgs, parseCursor } from "@/modules/catalog/use-cases/sync/backfill-games";
import { isRefreshMiss } from "@/modules/catalog/use-cases/sync/rolling-refresh";

describe("回填 Tier 2", () => {
  it("parseBackfillArgs --tier", () => {
    expect(parseBackfillArgs(["--tier", "2", "--max-batches=3"])).toEqual({ tier: 2, maxBatches: 3 });
    expect(parseBackfillArgs(["--tier=1"])).toEqual({ tier: 1 });
    expect(() => parseBackfillArgs(["--tier", "3"])).toThrow();
    expect(() => parseBackfillArgs(["--tier"])).toThrow();
  });

  it("parseCursor 依 tier 驗證；advanceCursor：all 一頁不滿 → done", () => {
    const c2 = { tier: 2 as const, phase: "all" as const, afterId: 10, startedAt: "x" };
    expect(parseCursor(JSON.stringify(c2), 2)).toEqual(c2);
    expect(parseCursor(JSON.stringify(c2), 1)).toBeNull();
    expect(parseCursor(JSON.stringify({ ...c2, phase: "recent" }), 2)).toBeNull();
    expect(advanceCursor(c2, 500, 900, 500)).toMatchObject({ phase: "all", afterId: 900 });
    expect(advanceCursor(c2, 499, 900, 500)).toMatchObject({ phase: "done", afterId: 0 });
  });
});

describe("活動（IGDB events）", () => {
  it("toEventRecord：時間轉 Date、時區只保留字串、logo 網址、遊戲去重、缺 slug 補上", () => {
    expect(
      toEventRecord({
        id: 1196,
        name: "Harvest of Terror 2026",
        slug: "harvest-of-terror-2026",
        description: " ",
        start_time: 1791396000,
        end_time: 1791406800,
        time_zone: "EST",
        event_logo: { image_id: "el173" },
        live_stream_url: "https://www.youtube.com/watch?v=x",
        games: [3, 1, 3],
        updated_at: 1791750970,
      }),
    ).toEqual({
      igdbId: 1196,
      name: "Harvest of Terror 2026",
      slug: "harvest-of-terror-2026",
      description: null,
      startTime: new Date(1791396000 * 1000),
      endTime: new Date(1791406800 * 1000),
      timeZone: "EST",
      kind: "other",
      logoUrl: "https://images.igdb.com/igdb/image/upload/t_logo_med/el173.png",
      streamUrl: "https://www.youtube.com/watch?v=x",
      gameIgdbIds: [3, 1],
      sourceUpdatedAt: new Date(1791750970 * 1000),
    });
    expect(toEventRecord({ id: 5 })).toMatchObject({ name: "Event 5", slug: "event-5", startTime: null, gameIgdbIds: [] });
  });

  it("buildEventsWhere", () => {
    expect(buildEventsWhere({})).toBeUndefined();
    expect(buildEventsWhere({ updatedSince: new Date("2026-10-13T00:00:00Z") })).toBe("updated_at > 1791849600");
  });
});

describe("字典漂移", () => {
  it("只回報不在已知清單的 id", () => {
    expect(findNewDictionaryIds(KNOWN_WEBSITE_TYPE_IDS, [1, 2, 26, 27, 27])).toEqual([27]);
    // 2026-10-13 實測的 external_game_sources 全部已知
    const sources = [1, 3, 5, 10, 11, 13, 14, 15, 20, 22, 23, 26, 28, 29, 30, 31, 32, 36, 37, 54, 55, 121];
    expect(findNewDictionaryIds(KNOWN_EXTERNAL_GAME_SOURCE_IDS, sources)).toEqual([]);
    expect(findNewDictionaryIds(KNOWN_EXTERNAL_GAME_SOURCE_IDS, [...sources, 60])).toEqual([60]);
  });
});

describe("滾動校對 misses", () => {
  it("來源版本不晚於增量進度才算 miss", () => {
    const since = new Date("2026-10-13T05:00:00Z");
    expect(isRefreshMiss(new Date("2026-10-13T04:00:00Z"), since)).toBe(true);
    expect(isRefreshMiss(since, since)).toBe(true);
    expect(isRefreshMiss(new Date("2026-10-13T06:00:00Z"), since)).toBe(false);
    expect(isRefreshMiss(null, since)).toBe(true);
  });
});
