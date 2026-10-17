/**
 * GameDex 第 3 段（X1）：月曆單日 getCalendarDay 與 GET /api/v1/calendar/day 的 handler（整合）。
 * slug 前綴 x1d-、日期用 2044-03。重點：與整月月曆同一套聚合與篩選（同一天的卡片、順序、篩選結果一致）、
 * 月／季／年精度不算進格子、公開快取標頭、錯誤參數。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route Handler 在請求範圍外呼叫 connection() 會丟錯；這個檔案直接呼叫 handler，所以換成空操作
vi.mock("next/server", () => ({ connection: async () => {} }));

import { closeDb, getDb } from "@/kernel/db/client";
import { getCalendarDay, getCalendarMonth } from "@/modules/catalog";
import { calendarDayResponse } from "@/modules/catalog/ui/calendar/day-api";
import type { CalendarDayResponse } from "@/modules/catalog/ui/calendar/types";
import { gamePlatforms, games, platforms, regions, releaseEvents } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const DAY = "2044-03-10";
const mine = <T extends { slug: string }>(items: readonly T[]) => items.filter((i) => i.slug.startsWith("x1d-"));

describe.skipIf(!enabled)("月曆單日（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const [ww] = await db.select().from(regions).where(eq(regions.code, "WW"));
    const plat: Record<string, number> = {};
    for (const [slug, kind, igdb] of [["x1d-ps5", "console", 880001], ["x1d-pc", "pc", 880002]] as const) {
      const [p] = await db.insert(platforms).values({ slug, name: slug.toUpperCase(), abbreviation: slug.slice(4).toUpperCase(), kind, igdbId: igdb }).returning({ id: platforms.id });
      plat[slug] = p!.id;
    }
    let igdb = 880100;
    const add = async (
      slug: string,
      popularity: number,
      events: { platform: string; date: string; precision?: "day" | "month"; stage?: "full" | "early_access" }[],
    ) => {
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
          releaseStage: e.stage ?? "full",
          status: "scheduled",
          sourceStatus: "active",
          source: "igdb",
        });
      }
    };
    await add("x1d-a", 500, [{ platform: "x1d-ps5", date: DAY }]);
    await add("x1d-b", 400, [{ platform: "x1d-pc", date: DAY }]);
    await add("x1d-c", 300, [{ platform: "x1d-ps5", date: DAY, stage: "early_access" }]);
    // 兩個平台同日 → 一張卡
    await add("x1d-d", 200, [{ platform: "x1d-ps5", date: DAY }, { platform: "x1d-pc", date: DAY }]);
    // 月精度：代表日是當月 1 日，不屬於任何一格
    await add("x1d-m", 900, [{ platform: "x1d-pc", date: "2044-03-01", precision: "month" }]);
    // 隔天
    await add("x1d-next", 100, [{ platform: "x1d-ps5", date: "2044-03-11" }]);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("getCalendarDay：依熱度排序、同遊戲多平台合併成一張、不含月精度與其他日期", async () => {
    const day = await getCalendarDay({ date: DAY, locale: "en" });
    expect(day.date).toBe(DAY);
    expect(mine(day.cards).map((c) => c.slug)).toEqual(["x1d-a", "x1d-b", "x1d-c", "x1d-d"]);
    expect(day.cards.every((c) => c.precision === "day" && c.date === DAY)).toBe(true);
    expect(day.cards.find((c) => c.slug === "x1d-d")!.platforms).toHaveLength(2);
    const first = await getCalendarDay({ date: "2044-03-01", locale: "en" });
    expect(mine(first.cards)).toEqual([]);
  });

  it("與整月月曆一致：同一天的卡片與順序相同；篩選結果相同", async () => {
    for (const filter of [undefined, { platformSlugs: ["x1d-ps5"] }, { platformSlugs: ["x1d-pc"] }, { stages: ["early_access" as const] }]) {
      const month = await getCalendarMonth({ year: 2044, month: 3, locale: "en", filter });
      const day = await getCalendarDay({ date: DAY, locale: "en", filter });
      expect(day.cards.map((c) => c.gameId)).toEqual((month.days[DAY] ?? []).map((c) => c.gameId));
      expect(day.cards.map((c) => c.platforms.map((p) => p.slug))).toEqual((month.days[DAY] ?? []).map((c) => c.platforms.map((p) => p.slug)));
    }
    const ps5 = await getCalendarDay({ date: DAY, locale: "en", filter: { platformSlugs: ["x1d-ps5"] } });
    expect(mine(ps5.cards).map((c) => c.slug)).toEqual(["x1d-a", "x1d-c", "x1d-d"]);
  });

  it("handler：JSON 形狀、公開快取、無 Set-Cookie、篩選與整月一致", async () => {
    const res = await calendarDayResponse(new Request(`http://localhost/api/v1/calendar/day?date=${DAY}&locale=zh-Hant&platform=x1d-ps5`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=\d+/);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = (await res.json()) as CalendarDayResponse;
    expect(body.date).toBe(DAY);
    expect(body.total).toBe(body.cards.length);
    const month = await getCalendarMonth({ year: 2044, month: 3, locale: "zh-Hant", filter: { platformSlugs: ["x1d-ps5"] } });
    expect(body.cards.map((c) => c.id)).toEqual((month.days[DAY] ?? []).map((c) => c.gameId));
    const c = body.cards.find((x) => x.h === "/zh-Hant/games/x1d-c")!;
    expect(c).toMatchObject({ n: "X1D-C", pc: ["PS5"], sk: "early_access" });
    expect(c.tg).toEqual([{ k: "stage", i: "early_access", l: "搶先體驗" }]);
    // 沒有平台篩選：x1d-d 兩個平台合併成一張，兩個縮寫 chip
    const all = (await (await calendarDayResponse(new Request(`http://localhost/api/v1/calendar/day?date=${DAY}&locale=zh-Hant`))).json()) as CalendarDayResponse;
    const d = all.cards.find((x) => x.h === "/zh-Hant/games/x1d-d")!;
    expect([...d.pc].sort()).toEqual(["PC", "PS5"]);
    expect(d.tg).toEqual([]);
  });

  it("handler：show 不含 releases → 0 款；錯誤參數 400（不快取）", async () => {
    const empty = (await (await calendarDayResponse(new Request(`http://localhost/api/v1/calendar/day?date=${DAY}&locale=en&show=events`))).json()) as CalendarDayResponse;
    expect(empty).toEqual({ date: DAY, total: 0, cards: [] });
    for (const q of ["date=nope&locale=en", `date=${DAY}&locale=xx`, `date=${DAY}`, "date=2044-13-01&locale=en", "date=1800-01-01&locale=en", "locale=en"]) {
      const bad = await calendarDayResponse(new Request(`http://localhost/api/v1/calendar/day?${q}`));
      expect(bad.status, q).toBe(400);
      expect(bad.headers.get("cache-control"), q).toBe("no-store");
    }
  });
});
