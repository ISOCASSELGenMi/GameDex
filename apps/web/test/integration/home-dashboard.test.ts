/**
 * GameDex 第 2 段：首頁儀表板 getHomeDashboard（整合）。slug 前綴 hm2-、日期用 2043 年、以 now 參數固定「今天」＝2043-06-15。
 * 每區筆數上限、排序（即將：近到遠；最新：新到舊）、視窗邊界、一款遊戲只出現一次。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import { getHomeDashboard } from "@/modules/catalog";
import { HOME_EVENT_LIMIT, HOME_SECTION_LIMIT, HOME_TRENDING_LIMIT } from "@/modules/catalog/domain/home-dashboard";
import { events, gamePlatforms, games, platforms, regions, releaseEvents } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const NOW = new Date("2043-06-15T12:00:00Z");

const day = (offset: number): string => {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const mine = <T extends { slug: string }>(items: readonly T[]) => items.filter((i) => i.slug.startsWith("hm2-"));

describe.skipIf(!enabled)("首頁儀表板（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const [ww] = await db.select().from(regions).where(eq(regions.code, "WW"));
    const [p] = await db.insert(platforms).values({ slug: "hm2-pc", name: "HM2 PC", kind: "pc", igdbId: 870001 }).returning({ id: platforms.id });
    let igdb = 870100;
    const add = async (slug: string, popularity: number, dates: { offset: number; precision?: "day" | "month" }[]) => {
      const [g] = await db
        .insert(games)
        .values({ igdbId: igdb++, slug, name: slug.toUpperCase(), popularityScore: popularity, gameType: "main_game", firstReleaseDate: day(dates[0]!.offset) })
        .returning({ id: games.id });
      await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: p!.id });
      for (const d of dates) {
        await db.insert(releaseEvents).values({
          gameId: g!.id,
          platformId: p!.id,
          regionId: ww!.id,
          releaseDate: day(d.offset),
          periodStart: day(d.offset),
          precision: d.precision ?? "day",
          releaseStage: "full",
          status: "scheduled",
          sourceStatus: "active",
          source: "igdb",
        });
      }
    };
    // 即將上市：視窗內 14 款（今天起 30 天），熱度 100..1400；視窗外 1 款（+31）、tbd 精度不算
    for (let i = 0; i < 14; i += 1) await add(`hm2-up-${String(i).padStart(2, "0")}`, 100 * (i + 1), [{ offset: i * 2 }]);
    await add("hm2-up-far", 5000, [{ offset: 31 }]);
    // 同一款遊戲兩個日期（兩個階段以外的兩張卡）：只出現一次，取較近的
    await add("hm2-up-twice", 9000, [{ offset: 20 }, { offset: 5 }]);
    // 月精度不納入首頁（沒有確切日期）
    await add("hm2-up-month", 9500, [{ offset: 10, precision: "month" }]);
    // 最新上市：前 30 天到昨天 14 款，熱度 100..1400；30 天前 1 款、今天 1 款（今天屬於即將上市）
    for (let i = 0; i < 14; i += 1) await add(`hm2-rc-${String(i).padStart(2, "0")}`, 100 * (i + 1), [{ offset: -(i * 2 + 1) }]);
    await add("hm2-rc-old", 5000, [{ offset: -31 }]);
    // 活動：8 個即將舉行、1 個已結束
    for (let i = 0; i < 8; i += 1) {
      await db.insert(events).values({ name: `HM2 EV ${i}`, slug: `hm2-ev-${i}`, kind: "showcase", startTime: new Date(Date.parse("2043-06-20T00:00:00Z") + i * 86_400_000) });
    }
    await db.insert(events).values({ name: "HM2 EV PAST", slug: "hm2-ev-past", kind: "showcase", startTime: new Date("2043-05-01T00:00:00Z"), endTime: new Date("2043-05-02T00:00:00Z") });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("即將上市：最多 12 款、依日期近到遠、取熱度最高者、視窗外與月精度不納入、一款只出現一次", async () => {
    const d = await getHomeDashboard({ locale: "zh-Hant", now: NOW });
    expect(d.today).toBe("2043-06-15");
    const up = mine(d.upcoming);
    expect(d.upcoming.length).toBeLessThanOrEqual(HOME_SECTION_LIMIT);
    expect(up.length).toBe(HOME_SECTION_LIMIT);
    const dates = d.upcoming.map((c) => c.date);
    expect(dates).toEqual([...dates].sort());
    const slugs = up.map((c) => c.slug);
    expect(slugs).not.toContain("hm2-up-far");
    expect(slugs).not.toContain("hm2-up-month");
    expect(new Set(slugs).size).toBe(slugs.length);
    // 熱度最高的 12 款：twice(9000) + up-13..up-03（1400..400）共 11 款
    expect(slugs).toContain("hm2-up-twice");
    expect(d.upcoming.find((c) => c.slug === "hm2-up-twice")!.date).toBe(day(5));
    expect(slugs).toContain("hm2-up-13");
    expect(slugs).not.toContain("hm2-up-00");
    for (const c of d.upcoming) {
      expect(c.platforms.length).toBeLessThanOrEqual(3);
      expect(c.precision).toBe("day");
    }
  });

  it("最新上市：最多 12 款、依日期新到舊、不含 30 天前", async () => {
    const d = await getHomeDashboard({ locale: "en", now: NOW });
    const rc = mine(d.recent);
    expect(rc.length).toBe(HOME_SECTION_LIMIT);
    const dates = d.recent.map((c) => c.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(rc.map((c) => c.slug)).not.toContain("hm2-rc-old");
    expect(d.recent.every((c) => c.date < d.today)).toBe(true);
  });

  it("近期活動：最多 6 筆、開始時間舊到新、不含已結束", async () => {
    const d = await getHomeDashboard({ locale: "zh-Hant", now: NOW });
    expect(d.events.length).toBeLessThanOrEqual(HOME_EVENT_LIMIT);
    const slugs = mine(d.events).map((e) => e.slug);
    expect(slugs).toEqual(["hm2-ev-0", "hm2-ev-1", "hm2-ev-2", "hm2-ev-3", "hm2-ev-4", "hm2-ev-5"]);
    expect(d.events.map((e) => e.slug)).not.toContain("hm2-ev-past");
  });

  it("近期熱門：最多 12 筆；排序依據與 getTrending 預設一致", async () => {
    const d = await getHomeDashboard({ locale: "zh-Hant", now: NOW });
    expect(d.trending.length).toBeLessThanOrEqual(HOME_TRENDING_LIMIT);
    expect(["popularity", "site_follows_7d"]).toContain(d.trendingRankedBy);
  });
});
