/**
 * Phase 2a：sync_platforms 寫入規則（04 §平台同步），用假的 GameDataProvider，不連 IGDB。
 * igdbId 用 99xxxx、slug 用 sp- 開頭，避免與其他整合測試的資料重疊。
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import { getRegionByCode } from "@/modules/catalog";
import type { PlatformRecord } from "@/modules/catalog/domain/entities";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import {
  getPlatformByIgdbId,
  getPlatformBySlug,
  getPlatformReleaseDates,
  upsertPlatform,
} from "@/modules/catalog/repository/platforms";
import { platformReleaseDates } from "@/modules/catalog/schema";
import { syncPlatforms } from "@/modules/catalog/use-cases/sync/sync-platforms";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};

function fakeProvider(records: PlatformRecord[]): GameDataProvider {
  return { sourceName: "fake", fetchPlatforms: async () => records, fetchGames: async () => [] };
}

function platform(over: Partial<PlatformRecord> & Pick<PlatformRecord, "igdbId" | "slug">): PlatformRecord {
  return {
    name: `Platform ${over.igdbId}`,
    abbreviation: null,
    alternativeName: null,
    kind: "console",
    generation: null,
    family: null,
    logoUrl: null,
    summary: null,
    versions: [],
    ...over,
  };
}

const day = (regionCode: string, d: string) => ({ regionCode, releaseDate: d, periodStart: d, precision: "day" as const });

async function regionId(code: string): Promise<number> {
  const r = await getRegionByCode(code);
  if (!r) throw new Error(`seed regions 缺少 ${code}`);
  return r.id;
}

async function datesByRegion(platformId: number) {
  const rows = await getPlatformReleaseDates(platformId);
  const us = await regionId("US");
  const jp = await regionId("JP");
  const eu = await regionId("EU");
  const code = new Map([[us, "US"], [jp, "JP"], [eu, "EU"]]);
  return Object.fromEntries(rows.map((r) => [code.get(r.regionId) ?? r.regionId, { date: r.releaseDate, source: r.source }]));
}

describe.skipIf(!enabled)("sync_platforms（整合）", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("新增平台、家族與原版機每地區最早上市日（改版機 WW 不混入）；重跑冪等", async () => {
    const records = [
      platform({
        igdbId: 990001,
        slug: "sp-ps-test",
        name: "PS Test",
        family: { igdbId: 990001, name: "Test Family", slug: "sp-test-family" },
        versions: [
          { releaseDates: [day("US", "2020-11-12"), day("JP", "2020-11-12"), day("US", "2020-12-01")] },
          { releaseDates: [day("WW", "2024-11-07")] },
        ],
      }),
    ];
    const first = await syncPlatforms(fakeProvider(records), noLog);
    expect(first).toMatchObject({ fetched: 1, inserted: 1, updated: 0, failed: 0, families: 1 });

    const p = await getPlatformByIgdbId(990001);
    expect(p).toMatchObject({ name: "PS Test", slug: "sp-ps-test", kind: "console", source: "igdb" });
    expect(p?.familyId).not.toBeNull();
    expect(await datesByRegion(p!.id)).toEqual({
      US: { date: "2020-11-12", source: "igdb" },
      JP: { date: "2020-11-12", source: "igdb" },
    });

    const second = await syncPlatforms(fakeProvider(records), noLog);
    expect(second).toMatchObject({ inserted: 0, updated: 1 });
    expect((await getPlatformByIgdbId(990001))?.id).toBe(p!.id);
  });

  it("IGDB 不再提供的地區刪除 igdb 列，人工上市日保留且不被覆蓋", async () => {
    const records = [platform({ igdbId: 990002, slug: "sp-dates", versions: [{ releaseDates: [day("US", "2020-01-01"), day("JP", "2020-02-02")] }] })];
    await syncPlatforms(fakeProvider(records), noLog);
    const p = (await getPlatformByIgdbId(990002))!;

    // 人工把 EU 補上、並把 JP 改成人工值
    const db = getDb();
    await db.insert(platformReleaseDates).values({ platformId: p.id, regionId: await regionId("EU"), releaseDate: "2020-03-03", source: "manual" });
    await db
      .insert(platformReleaseDates)
      .values({ platformId: p.id, regionId: await regionId("JP"), releaseDate: "2019-12-31", source: "manual" })
      .onConflictDoUpdate({
        target: [platformReleaseDates.platformId, platformReleaseDates.regionId],
        set: { releaseDate: "2019-12-31", source: "manual" },
      });

    // 這次 IGDB 只剩 JP（日期也變了）
    records[0].versions = [{ releaseDates: [day("JP", "2020-05-05")] }];
    await syncPlatforms(fakeProvider(records), noLog);
    expect(await datesByRegion(p.id)).toEqual({
      JP: { date: "2019-12-31", source: "manual" },
      EU: { date: "2020-03-03", source: "manual" },
    });
  });

  it("source='manual' 的平台不覆蓋", async () => {
    await upsertPlatform({ igdbId: 990003, slug: "sp-manual", name: "人工命名", kind: "handheld", source: "manual" });
    const stats = await syncPlatforms(
      fakeProvider([platform({ igdbId: 990003, slug: "sp-manual", name: "IGDB Name", versions: [{ releaseDates: [day("US", "2020-01-01")] }] })]),
      noLog,
    );
    expect(stats).toMatchObject({ manualSkipped: 1, inserted: 0, updated: 0 });
    const p = await getPlatformByIgdbId(990003);
    expect(p).toMatchObject({ name: "人工命名", kind: "handheld" });
    expect(await getPlatformReleaseDates(p!.id)).toEqual([]);
  });

  it("不寫 status、discontinuedOn（只能人工維護）", async () => {
    const rec = platform({ igdbId: 990004, slug: "sp-status" });
    await syncPlatforms(fakeProvider([rec]), noLog);
    await upsertPlatform({ igdbId: 990004, slug: "sp-status", name: rec.name, status: "discontinued", discontinuedOn: "2021-01-01" });
    await syncPlatforms(fakeProvider([{ ...rec, name: "Renamed" }]), noLog);
    expect(await getPlatformByIgdbId(990004)).toMatchObject({ name: "Renamed", status: "discontinued", discontinuedOn: "2021-01-01" });
  });

  it("slug 被別的平台佔用 → 改用 {slug}-{igdbId}", async () => {
    await upsertPlatform({ slug: "sp-collide", name: "人工主機", kind: "console", source: "manual" });
    const stats = await syncPlatforms(fakeProvider([platform({ igdbId: 990005, slug: "sp-collide" })]), noLog);
    expect(stats).toMatchObject({ inserted: 1, slugAdjusted: 1 });
    expect((await getPlatformByIgdbId(990005))?.slug).toBe("sp-collide-990005");
    expect((await getPlatformBySlug("sp-collide"))?.igdbId).toBeNull();
  });
});
