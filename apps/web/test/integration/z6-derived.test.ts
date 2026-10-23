/**
 * Z6 整合：預先計算的欄位與表（games.release_group、games.publisher_group、release_picks）。
 * - 寫入路徑（syncGames → syncIgdbGame、upsertReleaseEvent）之後與「全庫即時重算」一致
 * - backfill_game_groups：分批、可續跑、冪等、能把被清掉的欄位補回來
 * - 平台頁「全部遊戲」：用 release_picks 決定頁面（預設）與即時聚合（usePicks=false）的結果完全一致（三種排序、多頁、日期未定排最後）
 * igdbId 87xxxx、slug 前綴 z6-；平台 slug z6-pc／z6-console。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import type { FetchGamesQuery, GameRecord } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { releaseGroupKey } from "@/modules/catalog/domain/game-group-keys";
import { PUBLISHER_COLUMN_KEYS, groupOfGame } from "@/modules/catalog/domain/publisher-groups";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { GAME_GROUPS_BACKFILL_STATE, isGameGroupsBackfillDone } from "@/modules/catalog/repository/game-groups";
import { getPlatformPageBySlug } from "@/modules/catalog/repository/platform-page";
import { upsertReleaseEvent } from "@/modules/catalog/repository/release-events";
import { buildReleasePicksQuery } from "@/modules/catalog/repository/release-aggregate";
import { resolveFilterSlugs } from "@/modules/catalog/use-cases/read/resolve-filter";
import { resolveImageRef } from "@/modules/catalog/providers/image-ref";
import { companies, gameCompanies, games, platforms, regions, releaseEvents, releasePicks } from "@/modules/catalog/schema";
import {
  backfillGameGroups,
  parseGameGroupsCursor,
} from "@/modules/catalog/use-cases/sync/backfill-game-groups";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";
import { getGameGroups } from "@/modules/catalog/use-cases/read";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const PC = 887001;
const CONSOLE = 887002;

type Raw = Parameters<typeof toGameRecord>[0];
const unix = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
/** IGDB date_format：0＝日、2＝季（Q1）、6＝年、7＝未定。status 6＝正式版、4＝搶先體驗。 */
const rd = (platform: number, iso: string | null, format: number, status = 6, region = 8) => ({
  ...(iso ? { date: unix(iso) } : {}),
  date_format: format,
  platform,
  release_region: region,
  status,
});
const company = (id: number, role: "developer" | "publisher" | "porting") => ({
  company: { id, name: `Z6 Co ${id}`, slug: `z6-co-${id}` },
  developer: role === "developer",
  publisher: role === "publisher",
  porting: role === "porting",
});

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
const startedAt = () => new Date(Date.UTC(2026, 9, 21, 1, ++clock));
async function sync(rows: Raw[]) {
  const recs = rows.map((r) => toGameRecord(r));
  return syncGames(fakeSource(() => recs), { startedAt: startedAt(), log: noLog });
}

const db = () => getDb();
const idOf = async (igdbId: number) => (await db().select({ id: games.id }).from(games).where(eq(games.igdbId, igdbId)))[0]!.id;
const groupsOf = async (igdbId: number) =>
  (await db().select({ rg: games.releaseGroup, pg: games.publisherGroup }).from(games).where(eq(games.igdbId, igdbId)))[0]!;

/** release_picks 與「從上市列即時重算」是否完全一致（兩個方向的差集都為空）。 */
async function picksDiff(gameIds: number[]): Promise<{ missing: number; extra: number }> {
  const live = buildReleasePicksQuery(gameIds);
  const arr = sql`${sql.param(gameIds)}::int[]`;
  const missing = await db().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT game_id, platform_id, release_stage, release_event_id, release_date, precision FROM (${live}) l
      EXCEPT SELECT game_id, platform_id, release_stage, release_event_id, release_date, precision FROM release_picks WHERE game_id = ANY(${arr})
    ) x`);
  const extra = await db().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT game_id, platform_id, release_stage, release_event_id, release_date, precision FROM release_picks WHERE game_id = ANY(${arr})
      EXCEPT SELECT game_id, platform_id, release_stage, release_event_id, release_date, precision FROM (${live}) l
    ) x`);
  return { missing: missing.rows[0]!.n, extra: extra.rows[0]!.n };
}

const FROM = 1012; // FromSoftware
const BANDAI = 248; // 萬代南夢宮
const NINTENDO = 70;
const INDIE = 870900; // 名單外

describe.skipIf(!enabled)("Z6 預先計算（整合）", () => {
  beforeAll(async () => {
    // 回填進度是全庫共用的旗標（平台頁據此決定要不要用 release_picks）：測試前後都清掉，避免影響其他測試檔
    await db().execute(sql`DELETE FROM sync_state WHERE job_name = ${GAME_GROUPS_BACKFILL_STATE}`);
    await upsertPlatform({ igdbId: PC, slug: "z6-pc", name: "Z6 PC", kind: "pc" });
    await upsertPlatform({ igdbId: CONSOLE, slug: "z6-console", name: "Z6 Console", kind: "console" });
  });
  afterAll(async () => {
    await db().execute(sql`DELETE FROM sync_state WHERE job_name = ${GAME_GROUPS_BACKFILL_STATE}`);
    await closeDb();
  });

  it("syncGames：日期組與廠商欄在寫入當下就算好（同一份規則），release_picks 跟著上市列", async () => {
    await sync([
      // 開發 FromSoftware、發行萬代南夢宮 → fromsoftware；日精度
      { id: 870001, name: "Z6 Elden", slug: "z6-elden", platforms: [PC, CONSOLE], involved_companies: [company(BANDAI, "publisher"), company(FROM, "developer")], release_dates: [rd(PC, "2036-09-10", 0), rd(CONSOLE, "2036-09-12", 0)] },
      // 開發商不在名單、發行任天堂 → nintendo；年精度
      { id: 870002, name: "Z6 Zelda", slug: "z6-zelda", platforms: [CONSOLE], involved_companies: [company(INDIE, "developer"), company(NINTENDO, "publisher")], release_dates: [rd(CONSOLE, "2037-01-01", 6)] },
      // porting 不參與 → other；日期未定
      { id: 870003, name: "Z6 Port", slug: "z6-port", platforms: [PC], involved_companies: [company(FROM, "porting")], release_dates: [rd(PC, null, 7)] },
      // 沒有公司、沒有上市日
      { id: 870004, name: "Z6 Bare", slug: "z6-bare", platforms: [PC] },
    ]);
    expect(await groupsOf(870001)).toEqual({ rg: "2036-09", pg: PUBLISHER_COLUMN_KEYS.indexOf("fromsoftware") });
    expect(await groupsOf(870002)).toEqual({ rg: "2037", pg: PUBLISHER_COLUMN_KEYS.indexOf("nintendo") });
    expect(await groupsOf(870003)).toEqual({ rg: "tbd", pg: -1 });
    expect(await groupsOf(870004)).toEqual({ rg: "tbd", pg: -1 });
    // 與純函式規則一致
    expect(groupOfGame([{ igdbId: FROM, role: "developer" }, { igdbId: BANDAI, role: "publisher" }])).toBe("fromsoftware");
    expect(releaseGroupKey("2036-09-10", "day")).toBe("2036-09");

    const ids = await Promise.all([870001, 870002, 870003, 870004].map(idOf));
    expect(await picksDiff(ids)).toEqual({ missing: 0, extra: 0 });
    const picks = await db().select().from(releasePicks).where(inArray(releasePicks.gameId, ids));
    expect(picks).toHaveLength(4); // 870001 兩個平台各一、870002、870003（870004 沒有上市列）
  });

  it("再次同步：日期改變 → release_group 與 release_picks 同步更新；移除上市日 → picks 仍與即時重算一致", async () => {
    await sync([
      { id: 870001, name: "Z6 Elden", slug: "z6-elden", platforms: [PC, CONSOLE], involved_companies: [company(BANDAI, "publisher"), company(FROM, "developer")], release_dates: [rd(PC, "2036-11-03", 0), rd(CONSOLE, "2036-09-12", 0)] },
      // 兩個平台上市日都拿掉
      { id: 870002, name: "Z6 Zelda", slug: "z6-zelda", platforms: [CONSOLE], involved_companies: [company(INDIE, "developer"), company(NINTENDO, "publisher")] },
    ]);
    // 首發日取最早一筆：PC 改到 11 月後，最早變成 CONSOLE 的 9/12，仍是 2036-09
    expect((await groupsOf(870001)).rg).toBe("2036-09");
    expect((await groupsOf(870002)).rg).toBe("tbd");
    const ids = await Promise.all([870001, 870002, 870003, 870004].map(idOf));
    expect(await picksDiff(ids)).toEqual({ missing: 0, extra: 0 });
    const pcPick = await db().select().from(releasePicks).where(eq(releasePicks.gameId, ids[0]!));
    expect(pcPick.map((p) => p.releaseDate).sort()).toEqual(["2036-09-12", "2036-11-03"]);
  });

  it("人工更正（upsertReleaseEvent manual）：代表列改為 manual、picks 與即時重算一致", async () => {
    const gameId = await idOf(870001);
    const [pc] = await db().select({ id: platforms.id }).from(platforms).where(eq(platforms.slug, "z6-pc"));
    const [ww] = await db().select({ id: regions.id }).from(regions).where(eq(regions.code, "WW"));
    await upsertReleaseEvent({
      gameId,
      platformId: pc!.id,
      regionId: ww!.id,
      releaseDate: "2036-12-25",
      periodStart: "2036-12-25",
      precision: "day",
      status: "scheduled",
      releaseStage: "full",
      source: "manual",
    } as never);
    expect(await picksDiff([gameId])).toEqual({ missing: 0, extra: 0 });
    const [pick] = await db().select().from(releasePicks).where(sql`${releasePicks.gameId} = ${gameId} AND ${releasePicks.platformId} = ${pc!.id}`);
    expect(pick!.releaseDate).toBe("2036-12-25");
  });

  it("backfill_game_groups：清掉欄位與 picks 後補回、分批可續跑、冪等", async () => {
    const ids = await Promise.all([870001, 870002, 870003, 870004].map(idOf));
    const before = await db().select({ id: games.id, rg: games.releaseGroup, pg: games.publisherGroup }).from(games).where(inArray(games.id, ids)).orderBy(games.id);
    const picksBefore = await db().select().from(releasePicks).where(inArray(releasePicks.gameId, ids));
    await db().update(games).set({ releaseGroup: "tbd", publisherGroup: -1 }).where(inArray(games.id, ids));
    await db().delete(releasePicks).where(inArray(releasePicks.gameId, ids));

    // 資料庫裡還有其他測試檔的遊戲，所以只看自己的三種結果：先跑一批（--max-batches）再續跑到完成
    const first = await backfillGameGroups({ startedAt: startedAt(), log: noLog }, { batchSize: 2, maxBatches: 1, restart: true });
    expect(first).toMatchObject({ batches: 1, stoppedEarly: true });
    expect(first.cursor.done).toBe(false);
    expect(parseGameGroupsCursor((await getSyncState(GAME_GROUPS_BACKFILL_STATE))?.cursor)).toMatchObject({ done: false, afterId: first.cursor.afterId });
    const second = await backfillGameGroups({ startedAt: startedAt(), log: noLog }, { batchSize: 500 });
    expect(second).toMatchObject({ stoppedEarly: false, cursor: { done: true } });

    const after = await db().select({ id: games.id, rg: games.releaseGroup, pg: games.publisherGroup }).from(games).where(inArray(games.id, ids)).orderBy(games.id);
    expect(after).toEqual(before);
    const picksAfter = await db().select().from(releasePicks).where(inArray(releasePicks.gameId, ids));
    expect(picksAfter.sort((a, b) => a.releaseEventId - b.releaseEventId)).toEqual(picksBefore.sort((a, b) => a.releaseEventId - b.releaseEventId));

    // 已完成後再跑＝不做事；--restart 重做結果相同（冪等）
    expect(await backfillGameGroups({ startedAt: startedAt(), log: noLog })).toMatchObject({ batches: 0, cursor: { done: true } });
    const again = await backfillGameGroups({ startedAt: startedAt(), log: noLog }, { batchSize: 500, restart: true });
    expect(again.totals.updated).toBe(0);
    expect(await picksDiff(ids)).toEqual({ missing: 0, extra: 0 });
    // 回填完成的旗標：平台頁據此改用 release_picks（見「平台頁」那組測試）；其他測試檔不需要，結束時清掉
    expect(await isGameGroupsBackfillDone(db())).toBe(true);
    await db().execute(sql`DELETE FROM sync_state WHERE job_name = ${GAME_GROUPS_BACKFILL_STATE}`);
    expect(await isGameGroupsBackfillDone(db())).toBe(false);
  });

  it("/games 分組檢視讀預先計算的欄位：廠商欄與日期組", async () => {
    const byPub = await getGameGroups({ by: "publisher", q: "z6", locale: "zh-Hant", perGroup: 6, now: new Date("2026-10-21T00:00:00Z") });
    const keys = byPub.groups.map((g) => g.key);
    expect(keys).toEqual(["fromsoftware", "nintendo", "other"].filter((k) => keys.includes(k)));
    expect(byPub.groups.find((g) => g.key === "fromsoftware")!.cards.map((c) => c.slug)).toEqual(["z6-elden"]);
    expect(byPub.groups.find((g) => g.key === "other")!.cards.map((c) => c.slug).sort()).toEqual(["z6-bare", "z6-port", "z6-zelda"].sort());
    const byDate = await getGameGroups({ by: "date", q: "z6", locale: "zh-Hant", perGroup: 6, now: new Date("2026-10-21T00:00:00Z") });
    expect(byDate.groups.map((g) => g.key)).toEqual(["2036-09", "tbd"]);
  });
});

/** 平台頁「全部遊戲」：preset 資料另開一組平台，避免被其他測試檔的資料影響排序。 */
describe.skipIf(!enabled)("Z6 平台頁 全部遊戲：release_picks 與即時聚合結果一致（整合）", () => {
  const PLAT = 887101;
  const N = 40;
  beforeAll(async () => {
    await upsertPlatform({ igdbId: PLAT, slug: "z6-all", name: "Z6 All", kind: "console" });
    const rows: Raw[] = [];
    for (let i = 1; i <= N; i++) {
      // 日期：每 3 款同一天（日期平手由熱度／名稱決定）；每 7 款一個年精度、每 11 款日期未定；每 9 款多一個搶先體驗階段
      const day = `2036-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (Math.floor(i / 3) % 27)).padStart(2, "0")}`;
      const dates = [i % 11 === 0 ? rd(PLAT, null, 7) : i % 7 === 0 ? rd(PLAT, `${2036 + (i % 3)}-01-01`, 6) : rd(PLAT, day, 0)];
      if (i % 9 === 0) dates.push(rd(PLAT, day, 0, 4));
      rows.push({ id: 871000 + i, name: `Z6 All ${String(((i * 7) % N) + 1).padStart(2, "0")}${i % 5 === 0 ? " Ä" : ""}`, slug: `z6-all-${i}`, platforms: [PLAT], release_dates: dates });
    }
    await sync(rows);
    // 熱度：同分很多（0 與少數幾個值），確認平手由日期／名稱／id 決定
    await db()
      .update(games)
      .set({ popularityScore: sql`CASE WHEN id % 4 = 0 THEN 500 WHEN id % 4 = 1 THEN 500 WHEN id % 4 = 2 THEN 120 ELSE 0 END` })
      .where(like(games.slug, "z6-all-%"));
    // 日文顯示名稱：名稱排序依介面語言
    await db()
      .update(games)
      .set({ displayNames: sql`jsonb_build_object('ja', 'ja-' || lpad(((id * 13) % 97)::text, 3, '0'))` })
      .where(sql`${games.slug} LIKE 'z6-all-%' AND id % 3 = 0`);
  });

  async function page(sort: "date" | "popularity" | "name", offset: number, usePicks: boolean, locale = "zh-Hant", limit = 7) {
    const { filter } = await resolveFilterSlugs({});
    const res = await getPlatformPageBySlug({
      slug: "z6-all",
      locale,
      today: "2026-10-21",
      section: "all",
      sort,
      limit,
      offset,
      filter,
      regionPref: "WW",
      resolveImage: resolveImageRef,
      usePicks,
    });
    return res!.games;
  }

  for (const sort of ["date", "popularity", "name"] as const) {
    it(`sort=${sort}：每一頁的項目、順序、hasMore 與即時聚合完全相同`, async () => {
      for (const locale of sort === "name" ? ["zh-Hant", "ja"] : ["zh-Hant"]) {
        for (let offset = 0; offset < N + 14; offset += 7) {
          const fast = await page(sort, offset, true, locale);
          const live = await page(sort, offset, false, locale);
          expect(fast.items.map((i) => [i.slug, i.stage, i.date, i.precision]), `${sort}/${locale}@${offset}`).toEqual(
            live.items.map((i) => [i.slug, i.stage, i.date, i.precision]),
          );
          expect(fast.hasMore).toBe(live.hasMore);
        }
      }
    });
  }

  it("日期排序：日期未定排最後；全部頁串起來沒有重複也沒有遺漏", async () => {
    const seen: string[] = [];
    let dates: Array<string | null> = [];
    for (let offset = 0; offset < 200; offset += 7) {
      const p = await page("date", offset, true);
      for (const i of p.items) {
        seen.push(`${i.slug}/${i.stage}`);
        dates.push(i.date);
      }
      if (!p.hasMore) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    const total = N + Math.floor(N / 9); // 每 9 款多一個階段
    expect(seen).toHaveLength(total);
    const firstNull = dates.indexOf(null);
    expect(firstNull).toBeGreaterThan(0);
    expect(dates.slice(firstNull).every((d) => d === null)).toBe(true);
    const dated = dates.slice(0, firstNull) as string[];
    expect([...dated].sort().reverse()).toEqual(dated);
  });

  it("預設篩選以外（例如多算 cancelled 狀態）自動退回即時聚合，不會用 release_picks", async () => {
    const { filter } = await resolveFilterSlugs({});
    const res = await getPlatformPageBySlug({
      slug: "z6-all",
      locale: "zh-Hant",
      today: "2026-10-21",
      section: "all",
      sort: "date",
      limit: 5,
      offset: 0,
      filter: { ...filter, statuses: [...filter.statuses, "cancelled"] },
      regionPref: "WW",
      resolveImage: resolveImageRef,
    });
    expect(res!.games.items.length).toBe(5);
  });
});

describe.skipIf(!enabled)("Z6 資料表外鍵", () => {
  it("刪除遊戲會連帶刪除 release_picks（ON DELETE CASCADE）", async () => {
    await upsertPlatform({ igdbId: 887201, slug: "z6-cascade", name: "Z6 Cascade", kind: "console" });
    await sync([{ id: 872001, name: "Z6 Cascade", slug: "z6-cascade-game", platforms: [887201], release_dates: [rd(887201, "2036-05-05", 0)] }]);
    const id = await idOf(872001);
    expect(await db().select().from(releasePicks).where(eq(releasePicks.gameId, id))).toHaveLength(1);
    await db().delete(gameCompanies).where(eq(gameCompanies.gameId, id));
    await db().delete(releaseEvents).where(eq(releaseEvents.gameId, id));
    await db().delete(games).where(eq(games.id, id));
    expect(await db().select().from(releasePicks).where(eq(releasePicks.gameId, id))).toHaveLength(0);
    void companies;
  });
});
