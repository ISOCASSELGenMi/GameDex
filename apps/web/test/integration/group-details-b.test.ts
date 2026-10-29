/**
 * D88 整合：廠商分欄取 IGDB 列出的第一個（game_companies.igdb_position）與 backfill_company_positions。
 * - 同步寫入順序；多開發商取第一個、發行商之間取第一個、角色優先順序不變
 * - igdb_position 為 NULL（舊資料）退回欄位順序平手
 * - backfill_company_positions：用 fake provider（不打 IGDB）補順序並重算 publisher_group；可續跑、完成後不再動、--restart 重跑、冪等
 * igdbId 88xxxx、slug 前綴 gd88-。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import type { FetchGamesQuery, GameRecord } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { PUBLISHER_COLUMN_KEYS } from "@/modules/catalog/domain/publisher-groups";
import { backfillGameGroupsBatch } from "@/modules/catalog/repository/game-groups";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { companies, gameCompanies, games, platforms } from "@/modules/catalog/schema";
import {
  backfillCompanyPositions,
  IGDB_BACKFILL_COMPANY_POSITIONS_STATE,
  parseCompanyPositionsCursor,
} from "@/modules/catalog/use-cases/sync/backfill-company-positions";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const PC = 888001;
const CAPCOM = 37;
const FROM = 1012;
const NINTENDO = 70;
const BANDAI = 248;
const idx = (key: string) => PUBLISHER_COLUMN_KEYS.indexOf(key as never);

type Raw = Parameters<typeof toGameRecord>[0];
const company = (id: number, role: "developer" | "publisher" | "porting") => ({
  company: { id, name: `GD88 Co ${id}`, slug: `gd88-co-${id}` },
  developer: role === "developer",
  publisher: role === "publisher",
  porting: role === "porting",
});
const raw = (id: number, involved: NonNullable<Raw["involved_companies"]>): Raw => ({
  id,
  name: `GD88 ${id}`,
  slug: `gd88-${id}`,
  platforms: [PC],
  involved_companies: involved,
});

const RAWS: Raw[] = [
  raw(880001, [company(CAPCOM, "developer"), company(FROM, "developer")]), // 兩個開發商：Capcom 在前 → capcom
  raw(880002, [company(FROM, "developer"), company(CAPCOM, "developer")]), // FromSoftware 在前 → fromsoftware
  raw(880003, [company(NINTENDO, "publisher"), company(CAPCOM, "developer")]), // 開發商優先（即使發行商排前）→ capcom
  raw(880004, [company(BANDAI, "publisher"), company(NINTENDO, "publisher")]), // 兩個發行商：取第一個 → bandai-namco
];

function fakeSource(): GameDataProvider & { queries: FetchGamesQuery[] } {
  const queries: FetchGamesQuery[] = [];
  const records = (): GameRecord[] => RAWS.map((r) => toGameRecord(r));
  return {
    sourceName: "fake",
    queries,
    fetchPlatforms: async () => [],
    fetchEvents: async () => [],
    fetchGames: async (q) => {
      queries.push(q);
      return records()
        .filter((r) => (q.afterId === undefined || r.igdbId > q.afterId) && (!q.ids || q.ids.includes(r.igdbId)))
        .sort((a, b) => a.igdbId - b.igdbId)
        .slice(0, q.limit);
    },
  };
}

let clock = 0;
const startedAt = () => new Date(Date.UTC(2026, 9, 29, 1, ++clock));
const db = () => getDb();
const groupOf = async (igdbId: number) => (await db().select({ pg: games.publisherGroup }).from(games).where(eq(games.igdbId, igdbId)))[0]!.pg;
const positionsOf = async (igdbId: number): Promise<Record<number, number | null>> => {
  const rows = await db().execute<{ cid: number; pos: number | null }>(sql`
    SELECT c.igdb_id AS cid, gc.igdb_position AS pos FROM game_companies gc
    JOIN games g ON g.id = gc.game_id JOIN companies c ON c.id = gc.company_id WHERE g.igdb_id = ${igdbId}`);
  return Object.fromEntries(rows.rows.map((r) => [r.cid, r.pos]));
};
const clearState = () => db().execute(sql`DELETE FROM sync_state WHERE job_name = ${IGDB_BACKFILL_COMPANY_POSITIONS_STATE}`);
const nullPositions = () =>
  db().execute(sql`UPDATE game_companies SET igdb_position = NULL WHERE game_id IN (SELECT id FROM games WHERE slug LIKE 'gd88-%')`);

describe.skipIf(!enabled)("廠商分欄取 IGDB 第一個（整合，D88）", () => {
  beforeAll(async () => {
    await clearState();
    await upsertPlatform({ igdbId: PC, slug: "gd88-pc", name: "GD88 PC", kind: "pc" });
    await syncGames(fakeSource(), { startedAt: startedAt(), log: noLog });
  });
  afterAll(async () => {
    await clearState();
    await db().delete(games).where(like(games.slug, "gd88-%"));
    await db().delete(companies).where(like(companies.slug, "gd88-co-%"));
    await db().delete(platforms).where(like(platforms.slug, "gd88-%"));
    await closeDb();
  });

  it("同步寫入 IGDB 順序，publisher_group 依順序：多開發商取第一個、開發商優先、發行商之間取第一個", async () => {
    expect(await positionsOf(880001)).toEqual({ [CAPCOM]: 0, [FROM]: 1 });
    expect(await positionsOf(880002)).toEqual({ [FROM]: 0, [CAPCOM]: 1 });
    expect(await positionsOf(880003)).toEqual({ [NINTENDO]: 0, [CAPCOM]: 1 });
    expect(await groupOf(880001)).toBe(idx("capcom"));
    expect(await groupOf(880002)).toBe(idx("fromsoftware"));
    expect(await groupOf(880003)).toBe(idx("capcom"));
    expect(await groupOf(880004)).toBe(idx("bandai-namco"));
  });

  it("igdb_position 為 NULL（舊資料）退回欄位順序平手，不會壞", async () => {
    await nullPositions();
    for (let after = 0; ; ) {
      const r = await backfillGameGroupsBatch(after, 500);
      if (r.lastId === null) break;
      after = r.lastId;
    }
    // 舊規則：欄位順序最後者（fromsoftware 在 capcom 之後）；發行商之間同樣欄位順序最後者
    expect(await groupOf(880001)).toBe(idx("fromsoftware"));
    expect(await groupOf(880002)).toBe(idx("fromsoftware"));
    expect(await groupOf(880003)).toBe(idx("capcom"));
    expect(await groupOf(880004)).toBe(Math.max(idx("bandai-namco"), idx("nintendo")));
  });

  it("backfill_company_positions：補順序並重算 publisher_group；可續跑；完成後不再動；--restart 重跑冪等", async () => {
    await nullPositions();
    const src = fakeSource();
    // 每批 1 款：先只跑一批 → 還沒完成
    const first = await backfillCompanyPositions(src, { startedAt: startedAt(), log: noLog }, { maxBatches: 1, pageSize: 1 });
    expect(first.stoppedEarly).toBe(true);
    expect(first.cursor.done).toBe(false);
    expect(src.queries[0]!.fieldSet).toBe("companies");
    expect(parseCompanyPositionsCursor((await getSyncState(IGDB_BACKFILL_COMPANY_POSITIONS_STATE))?.cursor)).toEqual(first.cursor);

    // 續跑到完成（pageSize 500 一批掃完剩下的全部遊戲）
    const rest = await backfillCompanyPositions(src, { startedAt: startedAt(), log: noLog });
    expect(rest.cursor.done).toBe(true);
    expect(rest.stoppedEarly).toBe(false);
    expect(await positionsOf(880001)).toEqual({ [CAPCOM]: 0, [FROM]: 1 });
    expect(await positionsOf(880002)).toEqual({ [FROM]: 0, [CAPCOM]: 1 });
    expect(await groupOf(880001)).toBe(idx("capcom"));
    expect(await groupOf(880002)).toBe(idx("fromsoftware"));
    expect(await groupOf(880004)).toBe(idx("bandai-namco"));
    const total = first.totals.positionsUpdated + rest.run.positionsUpdated;
    expect(total).toBeGreaterThanOrEqual(8); // 4 款 × 2 家公司（含 porting 以外全部）
    expect((await getSyncState(IGDB_BACKFILL_COMPANY_POSITIONS_STATE))?.meta?.totals).toMatchObject({ positionsUpdated: total });

    // 已完成：再跑不打來源
    const queriesBefore = src.queries.length;
    const again = await backfillCompanyPositions(src, { startedAt: startedAt(), log: noLog });
    expect(again.batches).toBe(0);
    expect(src.queries.length).toBe(queriesBefore);

    // --restart：資料已是對的，沒有任何列要改（冪等）
    const redo = await backfillCompanyPositions(src, { startedAt: startedAt(), log: noLog }, { restart: true });
    expect(redo.cursor.done).toBe(true);
    expect(redo.totals.positionsUpdated).toBe(0);
    expect(redo.totals.groupsUpdated).toBe(0);
    expect(await db().select({ n: sql<number>`count(*)::int` }).from(gameCompanies).where(sql`igdb_position IS NULL AND game_id IN (SELECT id FROM games WHERE slug LIKE 'gd88-%')`)).toEqual([{ n: 0 }]);
  });
});
