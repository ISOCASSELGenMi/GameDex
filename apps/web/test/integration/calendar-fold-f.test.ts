/**
 * 月曆未定日摺起來的組（方案 A）：getCalendarMonth 的 undated 依精度 → 熱度 → 名稱排序，
 * view-model 對超過 24 款的組只取熱度最高的前 24 款、count 仍是總數（整合）。slug 前綴 ff-，日期 2045-12。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import { closeDb, getDb } from "@/kernel/db/client";
import { getCalendarMonth } from "@/modules/catalog";
import { gamePlatforms, games, platforms, regions, releaseEvents } from "@/modules/catalog/schema";
import { buildCalendarViewModel } from "@/modules/catalog/ui/calendar/view-model";
import { UNDATED_OPEN_MAX } from "@/modules/catalog/ui/month";

const enabled = !!process.env.TEST_DATABASE_URL;
const TOTAL = UNDATED_OPEN_MAX + 7;

describe.skipIf(!enabled)("月曆未定日前 24 款（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const [ww] = await db.select().from(regions).where(eq(regions.code, "WW"));
    const [p] = await db.insert(platforms).values({ slug: "ff-pc", name: "FF PC", abbreviation: "FFPC", kind: "pc", igdbId: 970001 }).returning({ id: platforms.id });
    for (let i = 0; i < TOTAL; i++) {
      const n = String(i).padStart(2, "0");
      // 熱度刻意與編號反向交錯（偶數高、奇數低），確認取的是熱度而不是插入順序
      const popularity = i % 2 === 0 ? 900 - i : 100 - i;
      const [g] = await db
        .insert(games)
        .values({ igdbId: 970100 + i, slug: `ff-${n}`, name: `FF ${n}`, popularityScore: popularity, gameType: "main_game", firstReleaseDate: "2045-12-31", firstReleasePrecision: "year" })
        .returning({ id: games.id });
      await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: p!.id });
      await db.insert(releaseEvents).values({
        gameId: g!.id,
        platformId: p!.id,
        regionId: ww!.id,
        releaseDate: "2045-12-31",
        periodStart: "2045-01-01",
        precision: "year",
        releaseStage: "full",
        status: "scheduled",
        sourceStatus: "active",
        source: "igdb",
      });
    }
  });
  afterAll(async () => {
    await closeDb();
  });

  it("view-model：count＝總數，rows 只有熱度最高的前 24 款（同分依名稱）", async () => {
    const data = await getCalendarMonth({ year: 2045, month: 12, locale: "en", includeEvents: false });
    const mine = data.undated.filter((c) => c.slug.startsWith("ff-"));
    expect(mine).toHaveLength(TOTAL);
    const vm = buildCalendarViewModel({ ...data, undated: mine }, "en", createTranslator("en"));
    const group = vm.undated.find((g) => g.precision === "year")!;
    expect(group).toMatchObject({ count: TOTAL, more: true, year: 2045, items: [] });
    expect(group.rows).toHaveLength(UNDATED_OPEN_MAX);
    const expected = [...mine].sort((a, b) => b.popularityScore - a.popularityScore || a.name.localeCompare(b.name)).slice(0, UNDATED_OPEN_MAX);
    expect(group.rows.map((r) => r[1])).toEqual(expected.map((c) => c.name));
    expect(vm.releaseCount).toBe(TOTAL);
    expect(Object.keys(vm.previews)).toHaveLength(0);
  });
});
