/**
 * sync_games 整合測試（15 §Phase 2 完成標準）：
 * - release_events 依平台／地區／階段拆分；搶先體驗與正式版並存
 * - 刻意讓上市日消失 → 標 removed（不是刪除、也不是仍為 active）
 * - 公司、系列、連結、語言、評分、在地化寫入；人工列不被覆蓋
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import type { GameRecord } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { autoReleasePastEvents } from "@/modules/catalog/repository/release-events";
import {
  changeFeed,
  externalIds,
  gameCompanies,
  gameExternalLinks,
  gameFranchises,
  gameLanguageSupports,
  gameLocalizations,
  gamePlatforms,
  games,
  ratings,
  regions,
  releaseDateHistory,
  releaseEvents,
} from "@/modules/catalog/schema";
import { IGDB_GAMES_STATE, syncGames } from "@/modules/catalog/use-cases/sync/sync-games";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

/** 依 afterId／limit 分頁的假來源。 */
function fakeProvider(records: () => GameRecord[]): GameDataProvider & { calls: number } {
  const p = {
    sourceName: "fake",
    calls: 0,
    fetchPlatforms: async () => [],
    fetchEvents: async () => [],
    fetchGames: async (q: { afterId?: number; limit: number }) => {
      p.calls += 1;
      return records()
        .filter((r) => q.afterId === undefined || r.igdbId > q.afterId)
        .sort((a, b) => a.igdbId - b.igdbId)
        .slice(0, q.limit);
    },
  };
  return p;
}

const PS5 = 880167;
const SWITCH = 880130;
const IOS = 880039;

function gameRaw(releaseDates: Array<{ date?: number; date_format: number; platform: number; release_region: number; status?: number }>) {
  return {
    id: 770001,
    name: "Sync Test Game",
    slug: "sync-test-game",
    game_type: 0,
    updated_at: ts("2026-10-01"),
    aggregated_rating: 88.4,
    aggregated_rating_count: 12,
    platforms: [PS5, SWITCH, IOS],
    release_dates: releaseDates,
    genres: [{ id: 880012, name: "RPG", slug: "sg-rpg" }],
    involved_companies: [
      { company: { id: 880001, name: "Dev Co", slug: "sg-dev-co" }, developer: true, publisher: true },
      { company: { id: 880002, name: "Pub Co", slug: "sg-pub-co" }, publisher: true },
    ],
    franchises: [{ id: 880010, name: "Saga", slug: "sg-saga" }],
    collections: [{ id: 880010, name: "Saga Collection", slug: "sg-saga-col" }],
    alternative_names: [{ name: "測試遊戲", comment: "Chinese title - traditional" }],
    game_localizations: [{ name: "シンクテスト", region: 3 }],
    language_supports: [
      { language: { id: 880003, locale: "zh-TW", name: "Chinese (Traditional)" }, language_support_type: 3 },
      { language: { id: 880007, locale: "en-US", name: "English" }, language_support_type: 1 },
    ],
    websites: [
      { type: 1, url: "https://sync-test.example" },
      { type: 13, url: "https://store.steampowered.com/app/4242/sync" },
    ],
    external_games: [{ external_game_source: 1, uid: "4242", url: "https://store.steampowered.com/app/4242" }],
    similar_games: [770002],
  };
}

const RELEASES_V1 = [
  { date: ts("2026-03-01"), date_format: 0, platform: PS5, release_region: 8, status: 3 }, // EA 已上市
  { date: ts("2027-02-10"), date_format: 0, platform: PS5, release_region: 8, status: 6 }, // 正式版
  { date: ts("2027-02-10"), date_format: 0, platform: SWITCH, release_region: 2 }, // 無狀態 → unspecified
  { date: ts("2027-01-01"), date_format: 0, platform: IOS, release_region: 8, status: 6 }, // 手機：不寫
];

async function eventsOf(gameId: number) {
  const db = getDb();
  return db
    .select({
      id: releaseEvents.id,
      platformId: releaseEvents.platformId,
      region: regions.code,
      stage: releaseEvents.releaseStage,
      date: releaseEvents.releaseDate,
      status: releaseEvents.status,
      sourceStatus: releaseEvents.sourceStatus,
      sequence: releaseEvents.sequence,
    })
    .from(releaseEvents)
    .innerJoin(regions, eq(regions.id, releaseEvents.regionId))
    .where(eq(releaseEvents.gameId, gameId))
    .orderBy(asc(releaseEvents.id));
}

describe.skipIf(!enabled)("sync_games（整合）", () => {
  let ps5Id = 0;
  let switchId = 0;

  beforeAll(async () => {
    ps5Id = (await upsertPlatform({ igdbId: PS5, slug: "sg-ps5", name: "PS5 test", kind: "console" })).id;
    switchId = (await upsertPlatform({ igdbId: SWITCH, slug: "sg-switch", name: "Switch test", kind: "hybrid" })).id;
    await upsertPlatform({ igdbId: IOS, slug: "sg-ios", name: "iOS test", kind: "mobile" });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("第一輪：寫入遊戲與全部關聯；上市日依平台／地區／階段拆分", async () => {
    let raw = gameRaw(RELEASES_V1);
    const mobileOnly = { id: 770003, name: "Mobile Only", slug: "sg-mobile-only", platforms: [IOS] };
    const provider = fakeProvider(() => [toGameRecord(raw), toGameRecord(mobileOnly)]);
    const startedAt = new Date("2026-10-12T05:00:00Z");

    const res = await syncGames(provider, { startedAt, log: noLog }, { pageSize: 1 });
    expect(res).toMatchObject({ fetched: 2, inserted: 1, skippedMobileOnly: 1, failed: 0, releasesCreated: 3 });
    expect(provider.calls).toBe(3); // 分頁：每頁 1 筆，第 3 頁為空 → 停
    expect((await getSyncState(IGDB_GAMES_STATE))?.lastSyncedAt?.toISOString()).toBe(startedAt.toISOString());

    const db = getDb();
    const [g] = await db.select().from(games).where(eq(games.igdbId, 770001));
    expect(g).toMatchObject({
      name: "Sync Test Game",
      gameType: "main_game",
      firstReleaseDate: "2026-03-01",
      firstReleasePrecision: "day",
      similarIgdbIds: [770002],
      // ja 來自 game_localizations；zh-Hant 來自 comment 標「Chinese title - traditional」的別名（06 解析鏈 2）
      displayNames: { ja: "シンクテスト", "zh-Hant": "測試遊戲" },
    });
    expect(g.searchText).toContain("sync test game");
    expect(g.searchText).toContain("測試 試遊 遊戲");
    expect(g.lastFullSyncAt).not.toBeNull();
    expect(await db.select().from(games).where(eq(games.igdbId, 770003))).toEqual([]);

    const plats = await db.select({ p: gamePlatforms.platformId }).from(gamePlatforms).where(eq(gamePlatforms.gameId, g.id));
    expect(plats.map((x) => x.p).sort()).toEqual([ps5Id, switchId].sort());

    const evs = await eventsOf(g.id);
    expect(evs.map((e) => [e.platformId, e.region, e.stage, e.date, e.status])).toEqual(
      expect.arrayContaining([
        [ps5Id, "WW", "early_access", "2026-03-01", "released"],
        [ps5Id, "WW", "full", "2027-02-10", "scheduled"],
        [switchId, "US", "unspecified", "2027-02-10", "scheduled"],
      ]),
    );
    expect(evs).toHaveLength(3);

    const roles = await db.select({ role: gameCompanies.role }).from(gameCompanies).where(eq(gameCompanies.gameId, g.id));
    expect(roles.map((r) => r.role).sort()).toEqual(["developer", "publisher", "publisher"]);
    expect(await db.select().from(gameFranchises).where(eq(gameFranchises.gameId, g.id))).toHaveLength(2);
    const links = await db.select().from(gameExternalLinks).where(eq(gameExternalLinks.gameId, g.id));
    expect(links.map((l) => [l.categoryLabel, l.url]).sort()).toEqual([
      ["official_website", "https://sync-test.example"],
      ["steam", "https://store.steampowered.com/app/4242/sync"],
    ]);
    const [steam] = await db.select().from(externalIds).where(and(eq(externalIds.gameId, g.id), eq(externalIds.source, "steam")));
    expect(steam).toMatchObject({ externalId: "4242", confidencePct: 100 });
    const [rating] = await db.select().from(ratings).where(eq(ratings.gameId, g.id));
    expect(rating).toMatchObject({ score: 88, reviewCount: 12, scoreProvider: "igdb", scoreOrigin: "igdb-aggregate", platformId: null });
    expect(await db.select().from(gameLanguageSupports).where(eq(gameLanguageSupports.gameId, g.id))).toHaveLength(2);

    // 重跑冪等：沒有新的 change_feed
    const before = (await db.select({ n: sql<number>`count(*)::int` }).from(changeFeed))[0].n;
    raw = gameRaw(RELEASES_V1);
    const again = await syncGames(provider, { startedAt: new Date("2026-10-12T06:00:00Z"), log: noLog });
    expect(again).toMatchObject({ inserted: 0, updated: 1, releasesCreated: 0, releasesUpdated: 0, releasesUnchanged: 3 });
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(changeFeed))[0].n).toBe(before);
  });

  it("第二輪：上市日消失 → removed；延期 → delayed＋history＋sequence；人工列保留", async () => {
    const db = getDb();
    const [g] = await db.select().from(games).where(eq(games.igdbId, 770001));

    // 人工補登：連結、在地化（zh-Hant）
    await db.insert(gameExternalLinks).values({
      gameId: g.id, linkType: "store", categoryLabel: "steam", url: "https://manual.example/steam", source: "manual",
    });
    await db.insert(gameLocalizations).values({ gameId: g.id, localeCode: "zh-Hant", name: "同步測試", source: "manual" });

    const v2 = [
      RELEASES_V1[0],
      { ...RELEASES_V1[1], date: ts("2027-05-20") }, // 正式版延期
      // Switch 那筆被來源拿掉
    ];
    const raw = { ...gameRaw(v2), websites: [{ type: 1, url: "https://sync-test.example" }], external_games: [], aggregated_rating_count: 0 };
    const res = await syncGames(fakeProvider(() => [toGameRecord(raw)]), {
      startedAt: new Date("2026-10-12T07:00:00Z"),
      log: noLog,
    });
    expect(res).toMatchObject({ releasesUpdated: 1, releasesRemoved: 1, releasesCreated: 0, failed: 0 });

    const evs = await eventsOf(g.id);
    const full = evs.find((e) => e.stage === "full")!;
    expect(full).toMatchObject({ date: "2027-05-20", status: "delayed", sequence: 1, sourceStatus: "active" });
    const sw = evs.find((e) => e.platformId === switchId)!;
    expect(sw).toMatchObject({ sourceStatus: "removed", status: "scheduled", date: "2027-02-10" });

    const hist = await db.select().from(releaseDateHistory).where(eq(releaseDateHistory.releaseEventId, full.id));
    expect(hist).toEqual([expect.objectContaining({ oldDate: "2027-02-10", newDate: "2027-05-20" })]);
    const feed = await db
      .select({ type: changeFeed.changeType })
      .from(changeFeed)
      .where(and(eq(changeFeed.entityType, "release_event"), eq(changeFeed.entityId, sw.id)));
    expect(feed.map((f) => f.type)).toEqual(["created", "removed"]);

    // igdb 的 steam 連結被拿掉、人工的留著；人工在地化留著且成為 zh-Hant 顯示名稱
    const links = await db.select().from(gameExternalLinks).where(eq(gameExternalLinks.gameId, g.id));
    expect(links.map((l) => [l.categoryLabel, l.source]).sort()).toEqual([
      ["official_website", "igdb"],
      ["steam", "manual"],
    ]);
    const [after] = await db.select().from(games).where(eq(games.id, g.id));
    expect(after.displayNames).toEqual({ ja: "シンクテスト", "zh-Hant": "同步測試" });
    expect(after.searchText).toContain("同步 步測 測試");

    // 分數消失 → score NULL（保留列與 snapshot 歷史），不顯示成 0
    const [rating] = await db.select().from(ratings).where(eq(ratings.gameId, g.id));
    expect(rating.score).toBeNull();

    // 拿掉的上市日回來 → restored
    const back = await syncGames(fakeProvider(() => [toGameRecord(gameRaw([...v2, RELEASES_V1[2]]))]), {
      startedAt: new Date("2026-10-12T08:00:00Z"),
      log: noLog,
    });
    expect(back.releasesRestored).toBe(1);
    expect((await eventsOf(g.id)).find((e) => e.platformId === switchId)?.sourceStatus).toBe("active");
  });

  it("遊戲層級 cancelled：未過期的列標 cancelled，已上市的 EA 不動", async () => {
    const db = getDb();
    const raw = { ...gameRaw(RELEASES_V1), game_status: 6 };
    await syncGames(fakeProvider(() => [toGameRecord(raw)]), { startedAt: new Date("2026-10-12T09:00:00Z"), log: noLog });
    const [g] = await db.select().from(games).where(eq(games.igdbId, 770001));
    expect(g.gameStatus).toBe("cancelled");
    const evs = await eventsOf(g.id);
    expect(evs.find((e) => e.stage === "early_access")?.status).toBe("released");
    expect(evs.find((e) => e.stage === "full")?.status).toBe("cancelled");
    expect(evs.find((e) => e.platformId === switchId)?.status).toBe("cancelled");
  });

  it("autoReleasePastEvents：day 精度已過的 scheduled／delayed 轉 released，寫 change_feed、不加 sequence", async () => {
    const db = getDb();
    const [g] = await db.select().from(games).where(eq(games.igdbId, 770001));
    const [ww] = await db.select().from(regions).where(eq(regions.code, "WW"));
    const [ev] = await db
      .insert(releaseEvents)
      .values({ gameId: g.id, platformId: ps5Id, regionId: ww.id, releaseStage: "demo", releaseDate: "2026-10-01", periodStart: "2026-10-01", precision: "day", status: "delayed", source: "manual", sequence: 3 })
      .returning();
    expect(await autoReleasePastEvents("2026-10-12")).toBeGreaterThanOrEqual(1);
    const [after] = await db.select().from(releaseEvents).where(eq(releaseEvents.id, ev.id));
    expect(after).toMatchObject({ status: "released", sequence: 3 });
    const feed = await db.select().from(changeFeed).where(and(eq(changeFeed.entityType, "release_event"), eq(changeFeed.entityId, ev.id)));
    expect(feed).toEqual([expect.objectContaining({ changeType: "status_changed", payload: { old: "delayed", new: "released" } })]);
  });
});
