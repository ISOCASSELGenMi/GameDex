/**
 * GameDex 第 3 段（X2）：時間軸一週 getTimelineWeek 與 GET /api/v1/timeline/week 的 handler（整合）。
 * slug 前綴 x2w-，日期用 2044-03（週一 2044-03-07～週日 2044-03-13）。重點：週界（前一週日、下一週一不算）、
 * 只含有遊戲的日子、依日期排序、月精度不算、與月曆同一套聚合（同日順序、多平台合併）、篩選、回應形狀與快取標頭。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

import { closeDb, getDb } from "@/kernel/db/client";
import { getTimelineWeek } from "@/modules/catalog";
import { timelineWeekResponse, TIMELINE_WEEK_CACHE_CONTROL } from "@/modules/catalog/ui/timeline/week-api";
import type { TimelineWeekData } from "@/modules/catalog/ui/timeline/week-types";
import { gamePlatforms, games, platforms, regions, releaseEvents } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const MON = "2044-03-07";
const mine = <T extends { slug: string }>(items: readonly T[]) => items.filter((i) => i.slug.startsWith("x2w-"));

describe.skipIf(!enabled)("時間軸一週（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const [ww] = await db.select().from(regions).where(eq(regions.code, "WW"));
    const plat: Record<string, number> = {};
    for (const [slug, kind, igdb] of [["x2w-ps5", "console", 890001], ["x2w-pc", "pc", 890002]] as const) {
      const [p] = await db.insert(platforms).values({ slug, name: slug.toUpperCase(), abbreviation: slug.slice(4).toUpperCase(), kind, igdbId: igdb }).returning({ id: platforms.id });
      plat[slug] = p!.id;
    }
    let igdb = 890100;
    const add = async (slug: string, popularity: number, events: { platform: string; date: string; precision?: "day" | "month" }[]) => {
      const [g] = await db
        .insert(games)
        .values({ igdbId: igdb++, slug, name: slug.toUpperCase(), popularityScore: popularity, gameType: "main_game", firstReleaseDate: events[0]!.date })
        .returning({ id: games.id });
      for (const p of new Set(events.map((e) => e.platform))) await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: plat[p]! });
      for (const e of events) {
        await db.insert(releaseEvents).values({
          gameId: g!.id,
          platformId: plat[e.platform]!,
          regionId: ww!.id,
          releaseDate: e.date,
          periodStart: e.date,
          precision: e.precision ?? "day",
          releaseStage: "full",
          status: "scheduled",
          sourceStatus: "active",
          source: "igdb",
        });
      }
    };
    await add("x2w-sun-before", 100, [{ platform: "x2w-pc", date: "2044-03-06" }]); // 前一週日：不算
    await add("x2w-mon", 300, [{ platform: "x2w-ps5", date: MON }]);
    await add("x2w-thu-a", 500, [{ platform: "x2w-ps5", date: "2044-03-10" }]);
    await add("x2w-thu-b", 400, [{ platform: "x2w-pc", date: "2044-03-10" }]);
    await add("x2w-thu-c", 200, [{ platform: "x2w-ps5", date: "2044-03-10" }, { platform: "x2w-pc", date: "2044-03-10" }]); // 兩平台同日 → 一張卡
    await add("x2w-sun", 150, [{ platform: "x2w-pc", date: "2044-03-13" }]);
    await add("x2w-month", 900, [{ platform: "x2w-pc", date: "2044-03-07", precision: "month" }]); // 月精度：不算
    await add("x2w-mon-after", 100, [{ platform: "x2w-ps5", date: "2044-03-14" }]); // 下一週一：不算
  });

  afterAll(async () => {
    await closeDb();
  });

  it("getTimelineWeek：只含週內有遊戲的日子，依日期排序；同日依熱度、多平台合併；月精度與週界外不算", async () => {
    const week = await getTimelineWeek({ start: MON, end: "2044-03-13", locale: "en" });
    const days = week.days.map((d) => ({ date: d.date, slugs: mine(d.cards).map((c) => c.slug) }));
    expect(days.filter((d) => d.slugs.length > 0)).toEqual([
      { date: MON, slugs: ["x2w-mon"] },
      { date: "2044-03-10", slugs: ["x2w-thu-a", "x2w-thu-b", "x2w-thu-c"] },
      { date: "2044-03-13", slugs: ["x2w-sun"] },
    ]);
    expect(week.days.map((d) => d.date)).toEqual([...week.days.map((d) => d.date)].sort());
    const thu = week.days.find((d) => d.date === "2044-03-10")!;
    expect(thu.cards.find((c) => c.slug === "x2w-thu-c")!.platforms).toHaveLength(2);
  });

  it("篩選：platform 只留 PC", async () => {
    const week = await getTimelineWeek({ start: MON, end: "2044-03-13", locale: "en", filter: { platformSlugs: ["x2w-pc"] } });
    const all = week.days.flatMap((d) => mine(d.cards).map((c) => c.slug));
    expect(all.sort()).toEqual(["x2w-sun", "x2w-thu-b", "x2w-thu-c"]);
  });

  it("handler：200＋每天第一款與總數＋前後週連結＋公開快取標頭；篩選與 week 參數生效", async () => {
    const res = await timelineWeekResponse(new Request("http://x/api/v1/timeline/week?locale=en&week=2044-W10&platform=x2w-pc"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(TIMELINE_WEEK_CACHE_CONTROL);
    const body = (await res.json()) as TimelineWeekData;
    expect(body.week).toBe("2044-W10");
    expect(body.start).toBe(MON);
    expect(body.end).toBe("2044-03-13");
    expect(body.prev!.week).toBe("2044-W09");
    expect(body.next!.href).toBe("/en/timeline?platform=x2w-pc&week=2044-W11");
    expect(body.href).toBe("/en/timeline?platform=x2w-pc&week=2044-W10");
    expect(body.todayHref).toBe("/en/timeline?platform=x2w-pc");
    const thu = body.days.find((d) => d.date === "2044-03-10")!;
    expect(thu.total).toBe(2);
    expect(thu.first.h).toBe("/en/games/x2w-thu-b");
    expect(body.total).toBe(body.days.reduce((n, d) => n + d.total, 0));
    expect(body.announce).toContain(String(body.total));
  });

  it("handler：at 參數取該日所在週；不支援的語系 400", async () => {
    const res = await timelineWeekResponse(new Request("http://x/api/v1/timeline/week?locale=en&at=2044-03-12"));
    expect(((await res.json()) as TimelineWeekData).week).toBe("2044-W10");
    const bad = await timelineWeekResponse(new Request("http://x/api/v1/timeline/week?locale=xx"));
    expect(bad.status).toBe(400);
  });
});
