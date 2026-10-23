/**
 * Z4A 整合：詳情補欄位的同步寫入、backfill_detail_fields（分批、續跑、只動新欄位）、GameDetail.extra 讀取模型。
 * igdbId 86xxxx、slug 前綴 z4a-。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import type { FetchGamesQuery, GameRecord } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import {
  changeFeed,
  gameGameEngines,
  gameGameModes,
  gameLocalizations,
  gamePlayerPerspectives,
  games,
} from "@/modules/catalog/schema";
import { getGameDetail } from "@/modules/catalog/use-cases/read/get-game-detail";
import {
  backfillDetailFields,
  IGDB_BACKFILL_DETAIL_STATE,
  parseDetailCursor,
} from "@/modules/catalog/use-cases/sync/backfill-detail-fields";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const PLATFORM = 886001;

const MODE_SP = { id: 1, name: "Single player", slug: "single-player" };
const MODE_MP = { id: 2, name: "Multiplayer", slug: "multiplayer" };
const PERSP_TP = { id: 2, name: "Third person", slug: "third-person" };
const ENGINE = { id: 26, name: "RAGE", slug: "rage" };

type Raw = Parameters<typeof toGameRecord>[0];
const raw = (id: number, extra: Partial<Raw> = {}): Raw => ({
  id,
  name: `Z4A ${id}`,
  slug: `z4a-${id}`,
  platforms: [PLATFORM],
  ...extra,
});
const rd = (unix: number) => ({ date: unix, date_format: 0, platform: PLATFORM, release_region: 8, status: 6 });

/** 依 afterId／ids 回應的假來源；紀錄每次查詢。 */
function fakeSource(records: () => GameRecord[]): GameDataProvider & { queries: FetchGamesQuery[] } {
  const queries: FetchGamesQuery[] = [];
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
const startedAt = () => new Date(Date.UTC(2026, 9, 20, 1, ++clock));

async function sync(rows: Raw[]) {
  const recs = rows.map((r) => toGameRecord(r));
  return syncGames(fakeSource(() => recs), { startedAt: startedAt(), log: noLog });
}

const idOf = async (igdbId: number) =>
  (await getDb().select({ id: games.id }).from(games).where(eq(games.igdbId, igdbId)))[0].id;

describe.skipIf(!enabled)("詳情補欄位（整合）", () => {
  beforeAll(async () => {
    await upsertPlatform({ igdbId: PLATFORM, slug: "z4a-platform", name: "Z4A Platform", kind: "console" });
  });
  afterAll(async () => {
    await closeDb();
  });

  it("同步寫入新欄位與分類表；再次同步整組取代", async () => {
    await sync([
      raw(860001, {
        storyline: "A tale",
        version_parent: 860999,
        version_title: "Deluxe",
        game_modes: [MODE_SP, MODE_MP],
        player_perspectives: [PERSP_TP],
        game_engines: [ENGINE],
      }),
    ]);
    const db = getDb();
    const [g] = await db.select().from(games).where(eq(games.igdbId, 860001));
    expect(g).toMatchObject({ storyline: "A tale", versionParentId: 860999, versionTitle: "Deluxe" });
    expect(await db.select().from(gameGameModes).where(eq(gameGameModes.gameId, g.id))).toHaveLength(2);
    expect(await db.select().from(gamePlayerPerspectives).where(eq(gamePlayerPerspectives.gameId, g.id))).toHaveLength(1);
    expect(await db.select().from(gameGameEngines).where(eq(gameGameEngines.gameId, g.id))).toHaveLength(1);

    // 第二次：少一個模式、沒有引擎、沒有 storyline
    await sync([raw(860001, { game_modes: [MODE_SP], player_perspectives: [PERSP_TP] })]);
    const [g2] = await db.select().from(games).where(eq(games.igdbId, 860001));
    expect(g2).toMatchObject({ storyline: null, versionParentId: null, versionTitle: null });
    expect(await db.select().from(gameGameModes).where(eq(gameGameModes.gameId, g.id))).toHaveLength(1);
    expect(await db.select().from(gameGameEngines).where(eq(gameGameEngines.gameId, g.id))).toHaveLength(0);
  });

  it("backfill_detail_fields：分批、續跑、只動新欄位、--max-batches、--restart", async () => {
    const ids = [861001, 861002, 861003, 861004, 861005];
    // 先以「舊資料」（沒有新欄位）建立
    await sync(ids.map((id) => raw(id, { summary: "old summary", release_dates: [rd(1_900_000_000)] })));
    const db = getDb();
    const snapshot = async () =>
      (await db.select().from(games).where(inArray(games.igdbId, ids)).orderBy(asc(games.igdbId))).map((g) => ({
        id: g.id,
        name: g.name,
        summary: g.summary,
        slug: g.slug,
        gameType: g.gameType,
        firstReleaseDate: g.firstReleaseDate,
        updatedAt: g.updatedAt?.toISOString(),
        lastFullSyncAt: g.lastFullSyncAt?.toISOString(),
        alt: g.alternativeNames,
      }));
    const before = await snapshot();
    const feedBefore = (await db.select({ n: sql<number>`count(*)::int` }).from(changeFeed))[0].n;

    // 來源給的資料：新欄位有值，其他欄位刻意不同（不可被寫入）；多一款資料庫沒有的 861999
    const source = fakeSource(() =>
      [...ids, 861999].map((id) =>
        toGameRecord(
          raw(id, {
            name: `CHANGED ${id}`,
            summary: "new summary",
            game_type: 1,
            storyline: `Story ${id}`,
            version_title: id === 861003 ? "Collector" : undefined,
            version_parent: id === 861003 ? 861001 : undefined,
            game_modes: [MODE_SP],
            player_perspectives: id % 2 ? [PERSP_TP] : [],
            game_engines: [ENGINE],
          }),
        ),
      ),
    );

    const first = await backfillDetailFields(source, { startedAt: startedAt(), log: noLog }, { pageSize: 2, maxBatches: 1, restart: true });
    expect(first).toMatchObject({ batches: 1, stoppedEarly: true });
    expect(source.queries[0]).toMatchObject({ fieldSet: "detail" });
    expect(source.queries[0].ids!.length).toBe(2);
    const firstIds = source.queries[0].ids!;
    expect(first.run).toMatchObject({ fetched: firstIds.filter((i) => ids.includes(i)).length, failed: 0 });
    expect(first.cursor.done).toBe(false);
    expect(parseDetailCursor((await getSyncState(IGDB_BACKFILL_DETAIL_STATE))?.cursor)).toMatchObject({
      afterId: firstIds[1],
      done: false,
    });
    // 第一批只動了前兩款（以 igdb_id 升冪、含資料庫裡其他測試檔的遊戲）
    const touched = await db.select({ igdbId: games.igdbId }).from(games).where(sql`${games.storyline} like 'Story %'`);
    expect(touched.every((r) => firstIds.includes(r.igdbId))).toBe(true);

    // 續跑到完成：之後每一批都從上次的 id 之後接著做
    source.queries.length = 0;
    const second = await backfillDetailFields(source, { startedAt: startedAt(), log: noLog }, { pageSize: 2 });
    expect(second).toMatchObject({ stoppedEarly: false, cursor: { done: true } });
    expect(source.queries[0].ids![0]).toBeGreaterThan(firstIds[1]);
    expect(second.totals).toMatchObject({ failed: 0, notInDb: 0 });
    // 861999 不在資料庫，從未被請求
    expect(source.queries.flatMap((q) => q.ids!)).not.toContain(861999);

    const after = await db.select().from(games).where(inArray(games.igdbId, ids)).orderBy(asc(games.igdbId));
    expect(after.map((g) => g.storyline)).toEqual(ids.map((i) => `Story ${i}`));
    expect(after[2]).toMatchObject({ versionParentId: 861001, versionTitle: "Collector" });
    const gids = after.map((g) => g.id);
    expect(await db.select().from(gameGameModes).where(inArray(gameGameModes.gameId, gids))).toHaveLength(5);
    expect(await db.select().from(gamePlayerPerspectives).where(inArray(gamePlayerPerspectives.gameId, gids))).toHaveLength(3);

    // 其他欄位、updatedAt、lastFullSyncAt 完全不變；沒有新 change_feed
    expect(await snapshot()).toEqual(before);
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(changeFeed))[0].n).toBe(feedBefore);

    // 已完成：再跑不請求；--restart 從頭來
    source.queries.length = 0;
    expect(await backfillDetailFields(source, { startedAt: startedAt(), log: noLog }, { pageSize: 2 })).toMatchObject({ batches: 0 });
    expect(source.queries).toHaveLength(0);
    const again = await backfillDetailFields(source, { startedAt: startedAt(), log: noLog }, { pageSize: 1000, restart: true });
    expect(again).toMatchObject({ batches: 1, cursor: { done: true } });
    expect(source.queries[0].ids!.length).toBeGreaterThanOrEqual(5);
  });

  it("GameDetail.extra：各分組、版本雙向、上限與 total、localized／alternative 順序", async () => {
    const main = 862000;
    const dlcs = Array.from({ length: 30 }, (_, i) => 862100 + i);
    await sync([
      raw(main, {
        storyline: "Main story",
        game_modes: [MODE_SP, MODE_MP],
        player_perspectives: [PERSP_TP],
        game_engines: [ENGINE],
        alternative_names: [{ name: "Zed", comment: "Acronym" }, { name: "Alpha", comment: "Chinese title - traditional" }, { name: "Mid" }],
        game_localizations: [
          { name: "ゲーム", region: 3 },
          { name: "게임", region: 2 },
        ],
      }),
      // 版本：version_parent 指向本作
      raw(862010, { version_parent: main, version_title: "Deluxe Edition", release_dates: [rd(1_800_000_000)] }),
      raw(862011, { version_parent: main, version_title: "Gold Edition" }),
      // version_parent 與 parent_game 同時指向本作：只算 editions 一次
      raw(862012, { version_parent: main, parent_game: main, game_type: 1 }),
      raw(862020, { parent_game: main, game_type: 8 }), // remake
      raw(862021, { parent_game: main, game_type: 9 }), // remaster
      raw(862022, { parent_game: main, game_type: 11 }), // port
      raw(862023, { parent_game: main, game_type: 11 }),
      raw(862024, { parent_game: main, game_type: 2 }), // expansion
      raw(862025, { parent_game: main, game_type: 13 }), // pack
      raw(862026, { parent_game: main, game_type: 5 }), // mod → packs
      raw(862027, { parent_game: main, game_type: 6 }), // episode
      raw(862028, { parent_game: main, game_type: 7 }), // season → episodes
      raw(862029, { parent_game: main, game_type: 0 }), // main_game 子作：不進任何組
      ...dlcs.map((id, i) => raw(id, { parent_game: main, game_type: 1, release_dates: [rd(1_700_000_000 + i * 86400)] })),
    ]);
    // zh-Hant 人工名稱
    const db = getDb();
    await db.insert(gameLocalizations).values({ gameId: await idOf(main), localeCode: "zh-Hant", name: "主作", source: "manual" });

    const d = (await getGameDetail({ slug: `z4a-${main}`, locale: "en" }))!;
    const x = d.extra;
    expect(x.storyline).toBe("Main story");
    expect(x.gameModes.map((m) => m.slug)).toEqual(["multiplayer", "single-player"]);
    expect(x.playerPerspectives.map((m) => m.slug)).toEqual(["third-person"]);
    expect(x.engines.map((m) => m.slug)).toEqual(["rage"]);
    expect(x.localizedTitles).toEqual([
      { localeCode: "ja", name: "ゲーム" },
      { localeCode: "ko", name: "게임" },
      { localeCode: "zh-Hant", name: "主作" },
    ]);
    expect(x.alternativeTitles).toEqual([
      { name: "Zed", comment: "Acronym" },
      { name: "Alpha", comment: "Chinese title - traditional" },
      { name: "Mid", comment: null },
    ]);
    expect(x.edition).toEqual({ versionTitle: null, versionParent: null });

    expect(x.related.map((g) => [g.key, g.total, g.games.length])).toEqual([
      ["editions", 3, 3],
      ["dlcs", 30, 24],
      ["expansions", 1, 1],
      ["remakes", 1, 1],
      ["remasters", 1, 1],
      ["ports", 2, 2],
      ["episodes", 2, 2],
      ["packs", 2, 2],
    ]);
    expect(x.relatedTotal).toBe(3 + 30 + 1 + 1 + 1 + 2 + 2 + 2);
    // editions：有首發日期者排前面
    expect(x.related[0].games[0].gameId).toBe(await idOf(862010));
    expect(x.related[0].games.map((g) => g.gameId)).toContain(await idOf(862012));
    // dlcs：依首發日期，上限 24；862012 只在 editions
    const dlcGroup = x.related.find((g) => g.key === "dlcs")!;
    expect(dlcGroup.games.map((g) => g.gameId)).toEqual(await Promise.all(dlcs.slice(0, 24).map(idOf)));
    // main_game 子作不在任何組
    expect(x.related.flatMap((g) => g.games.map((s) => s.gameId))).not.toContain(await idOf(862029));
    // 舊欄位 dlcs：同一份查詢，不含 editions
    expect(d.dlcs.map((g) => g.gameId)).not.toContain(await idOf(862010));
    expect(d.dlcs.length).toBe(24 + 1 + 1 + 1 + 2 + 2 + 2); // 每組最多 24

    // 版本雙向：版本頁看得到本體與 version_title
    const ed = (await getGameDetail({ slug: "z4a-862010", locale: "en" }))!.extra;
    expect(ed.edition.versionTitle).toBe("Deluxe Edition");
    expect(ed.edition.versionParent).toMatchObject({ gameId: await idOf(main), slug: `z4a-${main}` });
    expect(ed.related).toEqual([]);
    expect(ed.relatedTotal).toBe(0);

    // 本體尚未同步 → versionParent null，但 versionTitle 仍有
    await sync([raw(862050, { version_parent: 869999, version_title: "Orphan Edition" })]);
    const orphan = (await getGameDetail({ slug: "z4a-862050", locale: "en" }))!.extra;
    expect(orphan.edition).toEqual({ versionTitle: "Orphan Edition", versionParent: null });
  });
});
