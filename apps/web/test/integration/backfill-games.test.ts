/**
 * backfill_games 整合測試（15 §Phase 2 完成標準）：回填中途停止後能從 cursor 續傳，期間增量同步正常；回填不標 removed。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import type { FetchGamesQuery, GameRecord } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { games, releaseEvents } from "@/modules/catalog/schema";
import { backfillGames, IGDB_BACKFILL_STATE, parseCursor } from "@/modules/catalog/use-cases/sync/backfill-games";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const PLATFORM = 881001;

const game = (id: number, dates: string[]) =>
  toGameRecord({
    id,
    name: `Backfill ${id}`,
    slug: `bf-${id}`,
    platforms: [PLATFORM],
    release_dates: dates.map((d) => ({ date: ts(d), date_format: 0, platform: PLATFORM, release_region: 8, status: 6 })),
  });

/** 只回一批固定資料的增量來源。 */
const incrementalSource = (records: GameRecord[]): GameDataProvider => ({
  sourceName: "fake",
  fetchPlatforms: async () => [],
  fetchEvents: async () => [],
  fetchGames: async (q) => (q.afterId ? [] : records),
});

/** 依查詢條件回不同清單：有 firstReleaseFrom → recent；firstReleaseMissingWithDates → undated。 */
function fakeBackfillSource(recent: GameRecord[], undated: GameRecord[]): GameDataProvider & { queries: FetchGamesQuery[] } {
  const queries: FetchGamesQuery[] = [];
  return {
    sourceName: "fake",
    queries,
    fetchPlatforms: async () => [],
    fetchEvents: async () => [],
    fetchGames: async (q) => {
      queries.push(q);
      const list = q.firstReleaseFrom ? recent : q.firstReleaseMissingWithDates ? undated : [];
      return list.filter((g) => g.igdbId > (q.afterId ?? 0)).slice(0, q.limit);
    },
  };
}

async function igdbIdsInDb(ids: number[]) {
  const rows = await getDb()
    .select({ igdbId: games.igdbId })
    .from(games)
    .where(inArray(games.igdbId, ids))
    .orderBy(asc(games.igdbId));
  return rows.map((r) => r.igdbId);
}

describe.skipIf(!enabled)("backfill_games（整合）", () => {
  beforeAll(async () => {
    await upsertPlatform({ igdbId: PLATFORM, slug: "bf-platform", name: "BF Platform", kind: "console" });
  });
  afterAll(async () => {
    await closeDb();
  });

  it("中途停止 → 期間增量同步正常 → 從 cursor 續傳到完成；回填不標 removed", async () => {
    // 先由增量同步寫入 990101，它有兩筆上市日（WW 與 US）
    const withUs = game(990101, ["2027-01-01", "2027-06-01"]);
    withUs.releaseDates[1].regionCode = "US";
    await syncGames(incrementalSource([withUs]), {
      startedAt: new Date("2026-10-13T01:00:00Z"),
      log: noLog,
    });

    // 回填來源只給 990101 的一筆（另一筆不可被標 removed）
    const recent = [game(990101, ["2027-01-01"]), game(990102, ["2025-05-05"]), game(990103, ["2026-01-01"])];
    const undated = [
      toGameRecord({
        id: 990201,
        name: "Undated",
        slug: "bf-undated",
        platforms: [PLATFORM],
        release_dates: [{ date_format: 7, platform: PLATFORM, release_region: 8 }],
      }),
    ];
    const source = fakeBackfillSource(recent, undated);
    const startedAt = new Date("2026-10-13T02:00:00Z");

    // 第一次：只跑 1 批（每批 2 款）就停
    const first = await backfillGames(source, { startedAt, log: noLog }, { lookbackYears: 3, maxBatches: 1, pageSize: 2 });
    expect(first).toMatchObject({ batches: 1, stoppedEarly: true, cursor: { phase: "recent", afterId: 990102 } });
    expect(await igdbIdsInDb([990101, 990102, 990103, 990201])).toEqual([990101, 990102]);
    expect(source.queries[0]).toMatchObject({ firstReleaseFrom: new Date("2023-10-13T00:00:00Z"), afterId: 0 });
    expect(source.queries[0].gameTypes).toEqual(["main_game", "standalone_expansion", "remake", "remaster", "port"]);

    // 回填沒有把 990101 的第二筆標 removed
    const [g101] = await getDb().select().from(games).where(eq(games.igdbId, 990101));
    const evs = await getDb().select().from(releaseEvents).where(eq(releaseEvents.gameId, g101.id));
    expect(evs.map((e) => [e.releaseDate, e.sourceStatus]).sort()).toEqual([
      ["2027-01-01", "active"],
      ["2027-06-01", "active"],
    ]);

    // 期間增量同步照常（不同的鎖與 sync_state），回填 cursor 不受影響
    const inc = await syncGames(incrementalSource([game(990150, ["2027-03-03"])]), {
      startedAt: new Date("2026-10-13T03:00:00Z"),
      log: noLog,
    });
    expect(inc).toMatchObject({ inserted: 1, failed: 0 });
    expect(parseCursor((await getSyncState(IGDB_BACKFILL_STATE))?.cursor)).toMatchObject({ phase: "recent", afterId: 990102 });

    // 續傳：從 990102 之後接著做，跑完 recent 換 undated，最後 done；下限沿用第一次
    source.queries.length = 0;
    const second = await backfillGames(source, { startedAt: new Date("2026-10-13T04:00:00Z"), log: noLog }, { lookbackYears: 3, pageSize: 2 });
    expect(source.queries[0]).toMatchObject({ afterId: 990102, firstReleaseFrom: new Date("2023-10-13T00:00:00Z") });
    expect(second.cursor.phase).toBe("done");
    expect(second.totals.fetched).toBe(4);
    expect(await igdbIdsInDb([990101, 990102, 990103, 990201])).toEqual([990101, 990102, 990103, 990201]);
    expect((await getSyncState(IGDB_BACKFILL_STATE))?.lastSyncedAt).not.toBeNull();

    // 已完成：不再查詢；--restart 才重來
    source.queries.length = 0;
    expect((await backfillGames(source, { startedAt, log: noLog }, { lookbackYears: 3, pageSize: 2 })).batches).toBe(0);
    expect(source.queries).toHaveLength(0);
    const again = await backfillGames(source, { startedAt, log: noLog }, { lookbackYears: 3, pageSize: 2, restart: true });
    expect(again.cursor.phase).toBe("done");
    expect(again.totals).toMatchObject({ fetched: 4, updated: 4, inserted: 0 });
  });
});
