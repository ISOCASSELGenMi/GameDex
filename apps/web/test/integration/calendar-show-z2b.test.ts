/**
 * GameDex 第 2 輪（Z2B）：月曆「遊戲／活動」開關在伺服器端的行為（整合）。slug／活動 slug 前綴 z2b-cal-，月份 2045-02。
 * 重點：預設（沒有 show）不查活動、活動不會出現在結果；show=events 不查遊戲上市；day API 同一套 show 語意。
 * 以 vi.mock 包住 repository 函式只為了計算呼叫次數（行為仍是真的查資料庫）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route Handler 在請求範圍外呼叫 connection() 會丟錯；這個檔案直接呼叫 handler，所以換成空操作
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/modules/catalog/repository/calendar-events", async (orig) => {
  const m = await orig<typeof import("@/modules/catalog/repository/calendar-events")>();
  return { ...m, listEventsInRange: vi.fn(m.listEventsInRange) };
});
vi.mock("@/modules/catalog/repository/release-aggregate", async (orig) => {
  const m = await orig<typeof import("@/modules/catalog/repository/release-aggregate")>();
  return { ...m, aggregateReleases: vi.fn(m.aggregateReleases) };
});

import { eq } from "drizzle-orm";
import { parseFilterSpec } from "@sok/api-contract";
import { closeDb, getDb } from "@/kernel/db/client";
import { getCalendarMonth } from "@/modules/catalog";
import { listEventsInRange } from "@/modules/catalog/repository/calendar-events";
import { aggregateReleases } from "@/modules/catalog/repository/release-aggregate";
import { calendarDayResponse } from "@/modules/catalog/ui/calendar/day-api";
import type { CalendarDayResponse } from "@/modules/catalog/ui/calendar/types";
import { filterSpecToReadQuery } from "@/modules/catalog/ui/filter-mapping";
import { filterSpecForPage } from "@/modules/catalog/ui/filters/filter-labels";
import { events, gamePlatforms, games, platforms, regions, releaseEvents } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const DAY = "2045-02-10";
const eventsSpy = vi.mocked(listEventsInRange);
const releasesSpy = vi.mocked(aggregateReleases);
const showOf = (qs: string) => filterSpecToReadQuery(filterSpecForPage(parseFilterSpec(new URLSearchParams(qs)).filter, "calendar")).show;

describe.skipIf(!enabled)("月曆「遊戲／活動」開關（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const [ww] = await db.select().from(regions).where(eq(regions.code, "WW"));
    const [p] = await db.insert(platforms).values({ slug: "z2b-cal-pc", name: "Z2B Cal PC", abbreviation: "PC", kind: "pc", igdbId: 889001 }).returning({ id: platforms.id });
    const [g] = await db
      .insert(games)
      .values({ igdbId: 889100, slug: "z2b-cal-game", name: "Z2B Cal Game", popularityScore: 100, gameType: "main_game", firstReleaseDate: DAY })
      .returning({ id: games.id });
    await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: p!.id });
    await db.insert(releaseEvents).values({
      gameId: g!.id,
      platformId: p!.id,
      regionId: ww!.id,
      releaseDate: DAY,
      periodStart: DAY,
      precision: "day",
      releaseStage: "full",
      status: "scheduled",
      sourceStatus: "active",
      source: "igdb",
    });
    await db.insert(events).values({ name: "Z2B Cal Showcase", slug: "z2b-cal-showcase", kind: "showcase", startTime: new Date(`${DAY}T18:00:00Z`) });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("沒有 show 參數＝只顯示遊戲（預設不顯示活動）；show=events 只看活動；show=events,releases 兩者", () => {
    expect(showOf("")).toEqual({ releases: true, events: false });
    expect(showOf("show=events")).toEqual({ releases: false, events: true });
    expect(showOf("show=events,releases")).toEqual({ releases: true, events: true });
    expect(showOf("show=releases")).toEqual({ releases: true, events: false });
  });

  it("includeEvents=false：完全不查活動（repository 沒被呼叫）、結果沒有活動", async () => {
    eventsSpy.mockClear();
    const m = await getCalendarMonth({ year: 2045, month: 2, locale: "en", includeEvents: false });
    expect(eventsSpy).not.toHaveBeenCalled();
    expect(m.events).toEqual([]);
    expect(Object.keys(m.days)).toContain(DAY);
  });

  it("includeEvents=true：查活動並回傳", async () => {
    eventsSpy.mockClear();
    const m = await getCalendarMonth({ year: 2045, month: 2, locale: "en", includeEvents: true });
    expect(eventsSpy).toHaveBeenCalledTimes(1);
    expect(m.events.map((e) => e.slug)).toEqual(["z2b-cal-showcase"]);
  });

  it("includeReleases=false（只看活動）：不查遊戲上市；活動照常", async () => {
    releasesSpy.mockClear();
    const m = await getCalendarMonth({ year: 2045, month: 2, locale: "en", includeReleases: false, includeEvents: true });
    expect(releasesSpy).not.toHaveBeenCalled();
    expect(m.days).toEqual({});
    expect(m.undated).toEqual([]);
    expect(m.events).toHaveLength(1);
  });

  it("day API：預設與 show=events,releases 都回遊戲卡片；show=events 回空且不查資料庫", async () => {
    const call = async (qs: string) => (await calendarDayResponse(new Request(`${ORIGIN}/api/v1/calendar/day?date=${DAY}&locale=en${qs}`))).json() as Promise<CalendarDayResponse>;
    const def = await call("");
    expect(def.cards.map((c) => c.h)).toEqual(["/en/games/z2b-cal-game"]);
    const both = await call("&show=events,releases");
    expect(both.cards.map((c) => c.h)).toEqual(["/en/games/z2b-cal-game"]);
    releasesSpy.mockClear();
    const onlyEvents = await call("&show=events");
    expect(onlyEvents).toEqual({ date: DAY, total: 0, cards: [] });
    expect(releasesSpy).not.toHaveBeenCalled();
  });
});
