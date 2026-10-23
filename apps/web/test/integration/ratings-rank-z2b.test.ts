/**
 * GameDex 第 2 輪（Z2B）：評分排名（getRatingsRanking／GET /api/v1/ratings/ranking）、玩家平均寫入 ratings 的排程任務、
 * 詳情頁不顯示 site_players 列、搜尋候選的「名稱完全相同」補進候選（整合）。slug 前綴 z2b-。
 *
 * 資料（igdb 分數／人數；players 分數 0~100／人數）：
 *   A 95/50  B 90/40  C 90/30  D 85/12  E 80/9  F 70/100  G 無  H 99/3     players：D 90/6  A 80/8  F 85/3  E 95/5
 * igdb 預設門檻 10 → A(1) B(2) C(2，同分同名次) D(4) F(5)；players 預設門檻 5（PLAYER_RATING_MIN_COUNT）→ E(1) D(2) A(3)，F 人數不足。
 */
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route Handler 在請求範圍外呼叫 connection() 會丟錯；這個檔案直接呼叫 handler，所以換成空操作
vi.mock("next/server", () => ({ connection: async () => {} }));

import { closeDb, getDb } from "@/kernel/db/client";
import { getGameDetail, getRatingsRanking, setCatalogExtensions } from "@/modules/catalog";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { ratings, gamePlatforms, games, platforms } from "@/modules/catalog/schema";
import { suggestGameCards } from "@/modules/catalog/use-cases/game-suggest";
import { publishSitePlayerRatings } from "@/modules/catalog";
import { ratingsRankingResponse } from "@/modules/catalog/ui/ratings/ranking-api";
import type { RatingsRankingResponse } from "@/modules/catalog/ui/ratings/view-model";
import { playersRatingColumn } from "@/modules/accounts/use-cases/catalog-extensions";
import { runPublishPlayerRatings } from "@/modules/accounts/use-cases/play-records";
import { gamePlayerRatings } from "@/modules/accounts/schema";
import { accountsModule } from "@/modules/accounts";
import { enabledModules } from "@/modules/registry";

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const ids: Record<string, number> = {};
const slugsOf = (rows: ReadonlyArray<{ slug: string }>) => rows.map((r) => r.slug.replace("z2b-", ""));
const api = async (qs: string) => (await ratingsRankingResponse(new Request(`${ORIGIN}/api/v1/ratings/ranking${qs}`))).json() as Promise<RatingsRankingResponse>;

describe.skipIf(!enabled)("評分排名（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    const plat: Record<string, number> = {};
    for (const [slug, name, kind] of [["z2b-p1", "Z2B P1", "console"], ["z2b-p2", "Z2B P2", "pc"]] as const) {
      const [p] = await db.insert(platforms).values({ slug, name, abbreviation: name.slice(4), kind }).returning({ id: platforms.id });
      plat[slug] = p!.id;
    }
    let igdb = 887000;
    // [slug, year, platform, igdb score/count, 熱度]
    const rows: Array<[string, number, string, [number, number] | null, number]> = [
      ["a", 2020, "z2b-p1", [95, 50], 10],
      ["b", 2021, "z2b-p1", [90, 40], 20],
      ["c", 2021, "z2b-p2", [90, 30], 30],
      ["d", 2019, "z2b-p1", [85, 12], 40],
      ["e", 2022, "z2b-p2", [80, 9], 50],
      ["f", 2018, "z2b-p2", [70, 100], 60],
      ["g", 2020, "z2b-p1", null, 70],
      ["h", 2020, "z2b-p1", [99, 3], 80],
    ];
    for (const [s, year, plSlug, rating, pop] of rows) {
      const [g] = await db
        .insert(games)
        .values({
          igdbId: igdb++,
          slug: `z2b-${s}`,
          name: `Z2B Game ${s.toUpperCase()}`,
          displayNames: { "zh-Hant": `Z2B 遊戲${s.toUpperCase()}` },
          searchText: buildSearchText([`Z2B Game ${s}`]),
          popularityScore: pop,
          firstReleaseDate: `${year}-06-01`,
        })
        .returning({ id: games.id });
      ids[s] = g!.id;
      await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: plat[plSlug]! });
      if (rating) {
        await db.insert(ratings).values({
          gameId: g!.id,
          scoreOrigin: "igdb-aggregate",
          scoreProvider: "igdb",
          scoreType: "critic_aggregate",
          score: rating[0],
          scoreMax: 100,
          reviewCount: rating[1],
        });
      }
    }
    // 玩家平均（accounts 的 game_player_ratings：avg 是 0.5 分一格；score ×10 後存進 ratings）
    for (const [s, avgHalfSteps, count] of [["d", 18, 6], ["a", 16, 8], ["f", 17, 3], ["e", 19, 5]] as const) {
      await db.insert(gamePlayerRatings).values({ gameId: ids[s]!, avgHalfSteps: String(avgHalfSteps), ratingCount: count });
    }
    process.env.PLAYER_RATING_MIN_COUNT = "5";
    setCatalogExtensions({ ratingColumns: [playersRatingColumn] });
    const published = await runPublishPlayerRatings();
    expect(published).toMatchObject({ published: 3, upserted: 3 }); // F 只有 3 人 < 5
  });

  afterAll(async () => {
    setCatalogExtensions({});
    delete process.env.PLAYER_RATING_MIN_COUNT;
    await closeDb();
  });

  describe("玩家平均寫入 ratings（accounts 的排程任務）", () => {
    it("達人數門檻的才寫：score＝平均×10、reviewCount＝人數；來源 site_players／user_average、不分平台", async () => {
      const rows = await getDb().select().from(ratings).where(eq(ratings.scoreProvider, "site_players"));
      const mine = rows.filter((r) => Object.values(ids).includes(r.gameId));
      expect(mine.map((r) => ({ id: r.gameId, score: r.score, n: r.reviewCount, type: r.scoreType, plat: r.platformId, max: r.scoreMax })).sort((x, y) => x.id - y.id)).toEqual(
        [
          { id: ids.a, score: 80, n: 8, type: "user_average", plat: null, max: 100 },
          { id: ids.d, score: 90, n: 6, type: "user_average", plat: null, max: 100 },
          { id: ids.e, score: 95, n: 5, type: "user_average", plat: null, max: 100 },
        ].sort((x, y) => x.id! - y.id!),
      );
    });

    it("再跑一次沒有變動就不寫；人數降到門檻以下 → 舊值被刪；人數增加 → 更新", async () => {
      expect(await runPublishPlayerRatings()).toMatchObject({ published: 3, upserted: 0, deleted: 0 });
      const db = getDb();
      await db.update(gamePlayerRatings).set({ ratingCount: 4 }).where(eq(gamePlayerRatings.gameId, ids.e!));
      await db.update(gamePlayerRatings).set({ ratingCount: 9, avgHalfSteps: "20" }).where(eq(gamePlayerRatings.gameId, ids.a!));
      expect(await runPublishPlayerRatings()).toMatchObject({ published: 2, upserted: 1, deleted: 1 });
      const after = await db.select().from(ratings).where(eq(ratings.gameId, ids.a!));
      expect(after.find((r) => r.scoreProvider === "site_players")).toMatchObject({ score: 100, reviewCount: 9 });
      expect((await db.select().from(ratings).where(eq(ratings.gameId, ids.e!))).some((r) => r.scoreProvider === "site_players")).toBe(false);
      // 還原
      await db.update(gamePlayerRatings).set({ ratingCount: 5 }).where(eq(gamePlayerRatings.gameId, ids.e!));
      await db.update(gamePlayerRatings).set({ ratingCount: 8, avgHalfSteps: "16" }).where(eq(gamePlayerRatings.gameId, ids.a!));
      expect(await runPublishPlayerRatings()).toMatchObject({ published: 3 });
    });

    it("publishSitePlayerRatings：不合法的輸入被略過；不存在的遊戲 id 不寫；空輸入＝全刪", async () => {
      const db = getDb();
      const res = await publishSitePlayerRatings([
        { gameId: ids.b!, score: 70, reviewCount: 10 },
        { gameId: ids.b!, score: 71, reviewCount: 10 }, // 同一款重複 → 只收第一筆
        { gameId: ids.c!, score: 101, reviewCount: 10 }, // 超出範圍
        { gameId: ids.c!, score: 50, reviewCount: 0 }, // 沒有人數
        { gameId: 2_000_000_000, score: 50, reviewCount: 9 }, // 不存在的遊戲
      ]);
      expect(res.upserted).toBe(1);
      const row = (await db.select().from(ratings).where(eq(ratings.gameId, ids.b!))).find((r) => r.scoreProvider === "site_players");
      expect(row).toMatchObject({ score: 70, reviewCount: 10 });
      await publishSitePlayerRatings([]);
      expect((await db.select().from(ratings).where(eq(ratings.scoreProvider, "site_players"))).length).toBe(0);
      expect(await runPublishPlayerRatings()).toMatchObject({ published: 3 });
    });

    it("accounts 啟用時才有 publish_player_ratings 排程（session 鎖）與 players 欄；停用時兩者都沒有", () => {
      const on = enabledModules({ MODULES: "accounts" }).flatMap((m) => m.jobs ?? []).find((j) => j.name === "publish_player_ratings");
      expect(on).toMatchObject({ cron: "27 * * * *", lockMode: "session" });
      expect(accountsModule.ratingColumns?.map((c) => c.id)).toEqual(["players"]);
      const off = enabledModules({ MODULES: "none" });
      expect(off.flatMap((m) => m.jobs ?? []).some((j) => j.name === "publish_player_ratings")).toBe(false);
      expect(off.flatMap((m) => m.ratingColumns ?? [])).toEqual([]);
    });

    it("詳情頁的分數列不含 site_players（玩家平均走 accounts 的區塊，不重複顯示）", async () => {
      const detail = await getGameDetail({ slug: "z2b-a", locale: "en" });
      expect(detail).not.toBeNull();
      expect(detail!.ratings.map((r) => r.scoreProvider)).toEqual(["igdb"]);
    });
  });

  // 只看這個檔案建立的遊戲（其他測試檔留在同一個測試資料庫的資料不會混進名次）
  const MINE = { platformSlugs: ["z2b-p1", "z2b-p2"] };
  const rank = (input: Partial<Parameters<typeof getRatingsRanking>[0]> = {}) => getRatingsRanking({ locale: "en", filter: MINE, ...input });
  const MINE_QS = "locale=en&platform=z2b-p1,z2b-p2";

  describe("getRatingsRanking", () => {
    it("預設：IGDB 分數降冪，門檻 10（人數不足的 E、H 不列）；同分同名次；欄位含玩家平均", async () => {
      const r = await rank();
      expect(r).toMatchObject({ sort: "igdb", dir: "desc", minVotes: 10, defaultMinVotes: 10, total: 5, hasMore: false });
      expect(r.columns.map((c) => c.id)).toEqual(["igdb", "players"]);
      expect(slugsOf(r.rows)).toEqual(["a", "b", "c", "d", "f"]);
      expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 2, 4, 5]);
      expect(r.rows[0]!.cells).toEqual({ igdb: { score: 95, count: 50 }, players: { score: 80, count: 8 } });
      expect(r.rows[1]!.cells.players).toEqual({ score: null, count: null }); // B 沒有玩家平均
      expect(r.rows[0]!.prevRank).toBeNull();
      expect(r.rows[0]).toMatchObject({ name: "Z2B Game A", year: 2020, originalName: "Z2B Game A" });
    });

    it("標題依介面語言；asc 是 desc 的精確倒序，名次仍是「分數最高＝1」", async () => {
      const zh = await rank({ locale: "zh-Hant", dir: "asc" });
      expect(slugsOf(zh.rows)).toEqual(["f", "d", "c", "b", "a"]);
      expect(zh.rows.map((x) => x.rank)).toEqual([5, 4, 2, 2, 1]);
      expect(zh.rows[0]!.name).toBe("Z2B 遊戲F");
    });

    it("sort=players：只列玩家平均人數達預設門檻（PLAYER_RATING_MIN_COUNT=5）的，F 不在內", async () => {
      const r = await rank({ sort: "players" });
      expect(r).toMatchObject({ sort: "players", minVotes: 5, defaultMinVotes: 5, total: 3 });
      expect(slugsOf(r.rows)).toEqual(["e", "d", "a"]);
      expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 3]);
      expect(r.rows[0]!.cells.igdb).toEqual({ score: 80, count: 9 }); // 其他欄照樣顯示（不套門檻）
    });

    it("minVotes 可調：調高排除、0 不設門檻（含 E、H）；排序欄的門檻才算", async () => {
      expect(slugsOf((await rank({ minVotes: 40 })).rows)).toEqual(["a", "b", "f"]);
      expect(slugsOf((await rank({ minVotes: 0 })).rows)).toEqual(["h", "a", "b", "c", "d", "e", "f"]);
      // 玩家平均只有人數達 PLAYER_RATING_MIN_COUNT（5）的才寫進 ratings，所以門檻往下調到 3 也看不到 F（3 人）
      expect(slugsOf((await rank({ sort: "players", minVotes: 3 })).rows)).toEqual(["e", "d", "a"]);
      expect(slugsOf((await rank({ sort: "players", minVotes: 7 })).rows)).toEqual(["a"]);
    });

    it("prev：每列帶上一個排序欄的名次（用那一欄自己的預設門檻）；不在那一欄排名內的為 null", async () => {
      const r = await rank({ sort: "players", prev: "igdb" });
      const byRank = Object.fromEntries(r.rows.map((x) => [x.slug.replace("z2b-", ""), [x.rank, x.prevRank]]));
      expect(byRank).toEqual({ e: [1, null], d: [2, 4], a: [3, 1] }); // E 的 IGDB 人數 9 < 10
      // prev 與 sort 相同 → 忽略
      expect((await rank({ prev: "igdb" })).rows.every((x) => x.prevRank === null)).toBe(true);
    });

    it("篩選沿用瀏覽頁的條件：平台、首發年份；未知 slug 忽略並回報", async () => {
      const p1 = await rank({ filter: { platformSlugs: ["z2b-p1"] } });
      expect(slugsOf(p1.rows)).toEqual(["a", "b", "d"]);
      expect(p1.rows.map((x) => x.rank)).toEqual([1, 2, 3]); // 名次是篩選後的名次
      const year = await rank({ yearFrom: 2021, yearTo: 2021 });
      expect(slugsOf(year.rows)).toEqual(["b", "c"]);
      const swapped = await rank({ yearFrom: 2021, yearTo: 2019 });
      expect(slugsOf(swapped.rows)).toEqual(["a", "b", "c", "d"]); // 起訖顛倒會對調：2019~2021（A 是 2020）
      const unknown = await rank({ filter: { platformSlugs: ["z2b-p1", "no-such"] } });
      expect(unknown.ignored).toEqual([{ dimension: "platform", slug: "no-such" }]);
      expect(slugsOf(unknown.rows)).toEqual(["a", "b", "d"]);
    });

    it("分頁：page 累計前 N 頁、chunk（cumulative=false）只回該頁；超出頁數上限被夾住", async () => {
      const p2 = await rank({ minVotes: 0, page: 2, cumulative: false });
      expect(p2.offset).toBe(50);
      expect(p2.rows).toEqual([]);
      const p1 = await rank({ minVotes: 0, page: 1, cumulative: false });
      expect(p1.offset).toBe(0);
      expect(p1.rows).toHaveLength(7);
      expect((await rank({ page: 999 })).hasMore).toBe(false);
    });

    it("players 欄的模組停用（沒有註冊）→ 只有 IGDB 欄，sort=players 退回 IGDB", async () => {
      setCatalogExtensions({});
      try {
        const r = await rank({ sort: "players" });
        expect(r.sort).toBe("igdb");
        expect(r.columns.map((c) => c.id)).toEqual(["igdb"]);
        expect(r.rows.every((x) => !("players" in x.cells))).toBe(true);
      } finally {
        setCatalogExtensions({ ratingColumns: [playersRatingColumn] });
      }
    });
  });

  describe("GET /api/v1/ratings/ranking", () => {
    it("200：欄位、排序、分頁與公開快取標頭；篩選參數與頁面同一組", async () => {
      const res = await ratingsRankingResponse(new Request(`${ORIGIN}/api/v1/ratings/ranking?locale=en&platform=z2b-p1&sort=players&dir=asc`));
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=300");
      const body = (await res.json()) as RatingsRankingResponse;
      expect(body).toMatchObject({ sort: "players", dir: "asc", minVotes: 5, total: 2, page: 1, hasMore: false });
      expect(body.rows.map((r) => r.slug)).toEqual(["z2b-a", "z2b-d"]); // 玩家平均升冪：A 80、D 90
      expect(body.rows[0]).toMatchObject({ rank: 2, prevRank: null, cover: null, year: 2020 });
    });

    it("prev 參數帶名次升降；chunk=1 只回該頁；minVotes 影響排序欄", async () => {
      const b = await api(`?${MINE_QS}&sort=players&prev=igdb`);
      expect(b.rows.map((r) => [r.slug, r.rank, r.prevRank])).toEqual([["z2b-e", 1, null], ["z2b-d", 2, 4], ["z2b-a", 3, 1]]);
      const chunk = await api(`?${MINE_QS}&chunk=1&page=2`);
      expect(chunk.rows).toEqual([]);
      const raised = await api("?locale=en&sort=players&minVotes=6&platform=z2b-p1,z2b-p2");
      expect(raised.rows.map((r) => r.slug)).toEqual(["z2b-d", "z2b-a"]);
    });

    it("錯誤的語系 → 400；未知欄位／方向／門檻退回預設", async () => {
      const bad = await ratingsRankingResponse(new Request(`${ORIGIN}/api/v1/ratings/ranking?locale=xx`));
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ error: "invalid_locale" });
      const nolocale = await ratingsRankingResponse(new Request(`${ORIGIN}/api/v1/ratings/ranking`));
      expect(nolocale.status).toBe(400);
      const odd = await api(`?${MINE_QS}&sort=nope&dir=sideways&minVotes=abc`);
      expect(odd).toMatchObject({ sort: "igdb", dir: "desc", minVotes: 10 });
    });
  });

  describe("搜尋候選：名稱完全相同者不論熱度都進候選", () => {
    it("候選池（熱度前 120 筆）被熱度更高的同系列塞滿時，名稱剛好相同的低熱度遊戲仍排第一", async () => {
      const db = getDb();
      let igdb = 887500;
      const base = "Zqzprobetitle";
      for (let i = 0; i < 125; i++) {
        await db.insert(games).values({
          igdbId: igdb++,
          slug: `z2b-probe-${String(i).padStart(3, "0")}`,
          name: `${base} Saga ${i}`,
          searchText: buildSearchText([`${base} Saga ${i}`]),
          popularityScore: 500 + i,
        });
      }
      await db.insert(games).values({ igdbId: igdb++, slug: "z2b-probe-exact", name: base, searchText: buildSearchText([base]), popularityScore: 1 });
      const got = await suggestGameCards(base, "en", 8);
      expect(got[0]).toMatchObject({ slug: "z2b-probe-exact", name: base });
      expect(got).toHaveLength(8);
      await db.delete(games).where(like(games.slug, "z2b-probe-%"));
    });
  });
});
