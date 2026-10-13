/**
 * Phase 2b 整合測試（15 §Phase 2 完成標準：相似遊戲有資料、活動同步）：
 * - resolve_relations：相似清單解析、清單改變時刪除舊配對、局部解析只動該批
 * - Tier 2 回填：每批局部解析＋結束全量解析
 * - sync_events：upsert、人工活動不覆蓋、slug 撞名、change_feed、event_games 解析
 * - rolling_refresh：完整 diff、來源查不到 → 未上市列標 removed、rolling_refresh_misses
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import type { EventRecord, GameRecord } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toEventRecord, toGameRecord } from "@/modules/catalog/providers/igdb";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { resolveSimilarGames } from "@/modules/catalog/repository/relations";
import { eventGames, events, games, releaseEvents } from "@/modules/catalog/schema";
import { backfillGames, IGDB_BACKFILL_TIER2_STATE, parseCursor } from "@/modules/catalog/use-cases/sync/backfill-games";
import { ROLLING_REFRESH_STATE, rollingRefresh } from "@/modules/catalog/use-cases/sync/rolling-refresh";
import { syncEvents } from "@/modules/catalog/use-cases/sync/sync-events";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const PLATFORM = 661001;

const game = (id: number, opts: { similar?: number[]; dates?: string[]; updatedAt?: string } = {}) =>
  toGameRecord({
    id,
    name: `P2b ${id}`,
    slug: `p2b-${id}`,
    platforms: [PLATFORM],
    similar_games: opts.similar,
    updated_at: opts.updatedAt ? Date.parse(opts.updatedAt) / 1000 : undefined,
    release_dates: (opts.dates ?? ["2027-01-01"]).map((d) => ({
      date: ts(d),
      date_format: 0,
      platform: PLATFORM,
      release_region: 8,
      status: 6,
    })),
  });

/** 依條件回傳的假來源：ids → 只回清單內有的；其他 → afterId 分頁。 */
function fakeSource(gamesList: () => GameRecord[], eventsList: () => EventRecord[] = () => []): GameDataProvider {
  return {
    sourceName: "fake",
    fetchPlatforms: async () => [],
    fetchEvents: async () => eventsList(),
    fetchGames: async (q) => {
      const all = [...gamesList()].sort((a, b) => a.igdbId - b.igdbId);
      if (q.ids) return all.filter((g) => q.ids!.includes(g.igdbId));
      return all.filter((g) => g.igdbId > (q.afterId ?? 0)).slice(0, q.limit);
    },
  };
}

async function gameIdOf(igdbId: number): Promise<number> {
  const [row] = await getDb().select({ id: games.id }).from(games).where(eq(games.igdbId, igdbId));
  return row.id;
}

async function similarPairs(igdbIds: number[]): Promise<Array<[number, number]>> {
  const res = await getDb().execute<{ a: number; b: number }>(sql`
    SELECT g.igdb_id AS a, s.igdb_id AS b FROM game_similar_games gs
    JOIN games g ON g.id = gs.game_id JOIN games s ON s.id = gs.similar_game_id
    WHERE g.igdb_id = ANY(${`{${igdbIds.join(",")}}`}::int[]) ORDER BY 1, 2
  `);
  return res.rows.map((r) => [r.a, r.b]);
}

describe.skipIf(!enabled)("Phase 2b（整合）", () => {
  beforeAll(async () => {
    await upsertPlatform({ igdbId: PLATFORM, slug: "p2b-platform", name: "P2b Platform", kind: "console" });
  });
  afterAll(async () => {
    await closeDb();
  });

  it("resolve_relations：解析相似清單；清單改變刪舊配對；局部解析只動該批", async () => {
    let list = [game(660101, { similar: [660102, 660103, 669999] }), game(660102, { similar: [660101] }), game(660103)];
    const src = fakeSource(() => list);
    await syncGames(src, { startedAt: new Date("2026-10-13T01:00:00Z"), log: noLog });

    expect(await resolveSimilarGames({ igdbIds: [660102] })).toEqual({ inserted: 1, deleted: 0 });
    expect(await similarPairs([660101, 660102, 660103])).toEqual([[660102, 660101]]);

    await resolveSimilarGames();
    // 669999 還沒同步 → 跳過
    expect(await similarPairs([660101, 660102, 660103])).toEqual([
      [660101, 660102],
      [660101, 660103],
      [660102, 660101],
    ]);

    // 來源把 660103 移出清單 → 刪除舊配對；重跑冪等
    list = [game(660101, { similar: [660102] }), ...list.slice(1)];
    await syncGames(src, { startedAt: new Date("2026-10-13T02:00:00Z"), log: noLog });
    expect(await resolveSimilarGames()).toMatchObject({ deleted: 1 });
    expect(await resolveSimilarGames()).toEqual({ inserted: 0, deleted: 0 });
    expect(await similarPairs([660101])).toEqual([[660101, 660102]]);
  });

  it("Tier 2 回填：只限白名單類型、跑到完成；每批局部解析，結束全量解析補上反向配對", async () => {
    // 660201 指向下一批的 660203；局部解析時 660203 還不存在，要靠結束時的全量解析
    const list = [game(660201, { similar: [660203] }), game(660202), game(660203, { similar: [660201] })];
    const queries: unknown[] = [];
    const src = fakeSource(() => list);
    const fetchGames = src.fetchGames;
    src.fetchGames = async (q) => {
      queries.push(q);
      return fetchGames(q);
    };

    const res = await backfillGames(src, { startedAt: new Date("2026-10-13T03:00:00Z"), log: noLog }, {
      lookbackYears: 3,
      tier: 2,
      pageSize: 2,
      restart: true,
    });
    expect(res.cursor).toMatchObject({ tier: 2, phase: "done" });
    expect(queries[0]).toEqual({ gameTypes: ["main_game", "standalone_expansion", "remake", "remaster", "port"], afterId: 0, limit: 2 });
    expect(parseCursor((await getSyncState(IGDB_BACKFILL_TIER2_STATE))?.cursor, 2)?.phase).toBe("done");
    expect(await similarPairs([660201, 660203])).toEqual([
      [660201, 660203],
      [660203, 660201],
    ]);
  });

  it("sync_events：upsert、人工活動不動、slug 撞名、change_feed、event_games 解析與刪除", async () => {
    // 人工活動：佔用 igdb id 660302 與 slug "p2b-showcase"
    await getDb().insert(events).values([
      { igdbEventId: 660302, name: "人工維護", slug: "p2b-manual", source: "manual", gameIgdbIds: [] },
      { name: "人工同名", slug: "p2b-showcase", source: "manual" },
    ]);
    const ev = (id: number, start: string, gamesIds: number[], slug = `p2b-ev-${id}`) =>
      toEventRecord({ id, name: `P2B Gathering ${id}`, slug, start_time: Date.parse(start) / 1000, time_zone: "PST", games: gamesIds });
    let list = [ev(660301, "2027-06-01T17:00:00Z", [660101, 660102, 669999], "p2b-showcase"), ev(660302, "2027-01-01T00:00:00Z", [660101])];
    const src = fakeSource(() => [], () => list);

    const first = await syncEvents(src, { startedAt: new Date("2026-10-13T04:00:00Z"), log: noLog });
    expect(first).toMatchObject({ fetched: 2, inserted: 1, skippedManual: 1, failed: 0, eventGames: { inserted: 2 } });
    const [e1] = await getDb().select().from(events).where(eq(events.igdbEventId, 660301));
    expect(e1).toMatchObject({ slug: "p2b-showcase-660301", source: "igdb", timezone: "PST", kind: "other" });
    expect(e1.startTime?.toISOString()).toBe("2027-06-01T17:00:00.000Z");
    const [manual] = await getDb().select().from(events).where(eq(events.igdbEventId, 660302));
    expect(manual).toMatchObject({ name: "人工維護", gameIgdbIds: [] });

    // 人工標註的 kind 不被同步覆蓋；開始時間改變 → date_changed；遊戲清單縮小 → 刪 event_games
    await getDb().update(events).set({ kind: "showcase" }).where(eq(events.id, e1.id));
    list = [ev(660301, "2027-06-02T17:00:00Z", [660101], "p2b-showcase")];
    const second = await syncEvents(src, { startedAt: new Date("2026-10-13T10:00:00Z"), log: noLog });
    expect(second).toMatchObject({ updated: 1, startTimeChanged: 1, eventGames: { inserted: 0, deleted: 1 } });
    const [e1b] = await getDb().select().from(events).where(eq(events.id, e1.id));
    expect(e1b.kind).toBe("showcase");
    const linked = await getDb().select({ gameId: eventGames.gameId }).from(eventGames).where(eq(eventGames.eventId, e1.id));
    expect(linked.map((l) => l.gameId)).toEqual([await gameIdOf(660101)]);
    const feed = await getDb().execute<{ change_type: string }>(
      sql`SELECT change_type FROM change_feed WHERE entity_type = 'event' AND entity_id = ${e1.id} ORDER BY id`,
    );
    expect(feed.rows.map((r) => r.change_type)).toEqual(["created", "date_changed"]);
  });

  it("rolling_refresh：完整 diff、來源查不到 → 未上市列標 removed、計算 misses", async () => {
    const T1 = new Date("2026-10-13T05:00:00Z");
    // 660401：之後來源改日期但 updated_at 沒推進（miss）
    // 660402：之後來源改日期且 updated_at 晚於增量進度（增量還沒跑到，不算 miss）
    // 660403：之後來源查不到（一筆已上市、一筆未上市）
    const base = [
      game(660401, { dates: ["2027-01-01"], updatedAt: "2026-10-12T00:00:00Z" }),
      game(660402, { dates: ["2027-01-01"], updatedAt: "2026-10-12T00:00:00Z" }),
      game(660403, { dates: ["2025-01-01", "2027-05-01"], updatedAt: "2026-10-12T00:00:00Z" }),
    ];
    base[2].releaseDates[1].regionCode = "US";
    await syncGames(fakeSource(() => base), { startedAt: T1, log: noLog });

    // 只挑這三款：其他測試的遊戲都標成剛校對過
    await getDb().update(games).set({ lastFullSyncAt: new Date() });
    await getDb()
      .update(games)
      .set({ lastFullSyncAt: null })
      .where(inArray(games.igdbId, [660401, 660402, 660403]));

    const later = [
      game(660401, { dates: ["2027-02-01"], updatedAt: "2026-10-12T00:00:00Z" }),
      game(660402, { dates: ["2027-03-01"], updatedAt: "2026-10-13T06:00:00Z" }),
    ];
    const res = await rollingRefresh(fakeSource(() => later), { startedAt: new Date("2026-10-13T07:00:00Z"), log: noLog }, {
      perNight: 3,
      pageSize: 2,
    });
    expect(res).toMatchObject({
      selected: 3,
      fetched: 2,
      changedGames: 2,
      rolling_refresh_misses: 1,
      missIgdbIds: [660401],
      missingIgdbIds: [660403],
      missingReleasesRemoved: 1,
    });
    expect((await getSyncState(ROLLING_REFRESH_STATE))?.meta).toMatchObject({ rolling_refresh_misses: 1 });

    const rows = await getDb()
      .select({ date: releaseEvents.releaseDate, status: releaseEvents.status, sourceStatus: releaseEvents.sourceStatus })
      .from(releaseEvents)
      .where(eq(releaseEvents.gameId, await gameIdOf(660403)))
      .orderBy(asc(releaseEvents.releaseDate));
    expect(rows).toEqual([
      { date: "2025-01-01", status: "released", sourceStatus: "active" },
      { date: "2027-05-01", status: "scheduled", sourceStatus: "removed" },
    ]);
    // 三款都推進了 lastFullSyncAt，下一輪不會再先挑到
    const stale = await getDb()
      .select({ igdbId: games.igdbId })
      .from(games)
      .where(sql`${games.lastFullSyncAt} IS NULL`);
    expect(stale).toEqual([]);
  });
});
