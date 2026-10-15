/**
 * Phase 4：IGDB 分數列的寫入規則（05 §IGDB 分數）與詳情頁讀取（整合）。igdbId 861xxx、slug 前綴 r4-。
 * - aggregated_rating_count 為 0 或缺少 → 不寫列（不顯示成 0 分）
 * - 先前有分數、之後消失 → 同一列改 score=NULL（保留列與 snapshot 歷史）；詳情頁讀不到
 * - 詳情頁只讀 score 非 NULL 的列，且帶出各來源
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import type { GameRecord } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { upsertRating } from "@/modules/catalog/repository/ratings";
import { games, ratings, scoreSnapshots } from "@/modules/catalog/schema";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";
import { getGameDetail } from "@/modules/catalog/use-cases/read/get-game-detail";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const PC = 861900;

function provider(records: () => GameRecord[]): GameDataProvider {
  return {
    sourceName: "fake",
    fetchPlatforms: async () => [],
    fetchEvents: async () => [],
    fetchGames: async (q: { afterId?: number; limit: number }) =>
      records()
        .filter((r) => q.afterId === undefined || r.igdbId > q.afterId)
        .sort((a, b) => a.igdbId - b.igdbId)
        .slice(0, q.limit),
  };
}

function raw(id: number, extra: Record<string, unknown> = {}) {
  return { id, name: `R4 Game ${id}`, slug: `r4-${id}`, game_type: 0, updated_at: 1790000000, platforms: [PC], ...extra };
}

async function run(rows: Array<ReturnType<typeof raw>>, at: string) {
  const res = await syncGames(provider(() => rows.map((r) => toGameRecord(r))), { startedAt: new Date(at), log: noLog });
  expect(res.failed).toBe(0);
}

async function ratingRows(slug: string) {
  const db = getDb();
  const [g] = await db.select({ id: games.id }).from(games).where(eq(games.slug, slug));
  return g ? db.select().from(ratings).where(eq(ratings.gameId, g.id)) : [];
}

describe.skipIf(!enabled)("IGDB 分數列與詳情頁評分（整合）", () => {
  beforeAll(async () => {
    await upsertPlatform({ igdbId: PC, slug: "r4-pc", name: "R4 PC", kind: "pc" });
  });
  afterAll(async () => {
    await closeDb();
  });

  it("count 為 0、count 缺少 → 不寫分數列（即使 aggregated_rating 有值或為 0）", async () => {
    await run(
      [
        raw(861001, { aggregated_rating: 0, aggregated_rating_count: 0 }),
        raw(861002, { aggregated_rating: 77.4 }), // count 缺少
        raw(861003, { aggregated_rating: 77.4, aggregated_rating_count: 0 }),
        raw(861004), // 完全沒有
      ],
      "2026-10-14T01:00:00Z",
    );
    for (const id of [861001, 861002, 861003, 861004]) expect(await ratingRows(`r4-${id}`), `r4-${id}`).toEqual([]);
    for (const id of [861001, 861002]) {
      const d = await getGameDetail({ slug: `r4-${id}`, locale: "en" });
      expect(d).not.toBeNull();
      expect(d!.ratings).toEqual([]);
    }
  });

  it("有分數 → 寫 igdb 列，詳情頁讀到分數與樣本數", async () => {
    await run([raw(861010, { aggregated_rating: 82.4, aggregated_rating_count: 12 })], "2026-10-14T02:00:00Z");
    const rows = await ratingRows("r4-861010");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scoreProvider: "igdb", scoreType: "critic_aggregate", score: 82, scoreMax: 100, reviewCount: 12, platformId: null, nextRefreshAt: null });
    const d = await getGameDetail({ slug: "r4-861010", locale: "zh-Hant" });
    expect(d!.ratings).toEqual([
      { scoreProvider: "igdb", scoreType: "critic_aggregate", score: 82, scoreMax: 100, reviewCount: 12, platformId: null, sourceUrl: null },
    ]);
  });

  it("分數消失 → 同一列改 score=NULL（不刪列、保留 snapshot），詳情頁不再回傳；沒分數的遊戲重跑也不新增列", async () => {
    await run([raw(861010, { aggregated_rating: 82.4, aggregated_rating_count: 0 }), raw(861001, { aggregated_rating_count: 0 })], "2026-10-14T03:00:00Z");
    const rows = await ratingRows("r4-861010");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBeNull();
    expect(rows[0]!.reviewCount).toBeNull();
    const snaps = await getDb().select().from(scoreSnapshots).where(eq(scoreSnapshots.ratingId, rows[0]!.id));
    expect(snaps.map((s) => s.score)).toEqual([82, null]);
    expect((await getGameDetail({ slug: "r4-861010", locale: "en" }))!.ratings).toEqual([]);
    expect(await ratingRows("r4-861001")).toEqual([]);
  });

  it("分數又回來 → 更新同一列", async () => {
    await run([raw(861010, { aggregated_rating: 90, aggregated_rating_count: 3 })], "2026-10-14T04:00:00Z");
    const rows = await ratingRows("r4-861010");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: 90, reviewCount: 3 });
  });

  it("詳情頁帶出多個來源，並略過 score=NULL 的負向快取列", async () => {
    const [g] = await getDb().select({ id: games.id }).from(games).where(eq(games.slug, "r4-861010"));
    await upsertRating({ gameId: g!.id, scoreOrigin: "metacritic", scoreProvider: "metacritic_scrape", scoreType: "metascore", score: 88, reviewCount: 40 });
    await upsertRating({ gameId: g!.id, scoreOrigin: "metacritic", scoreProvider: "metacritic_scrape", scoreType: "user_score", score: null });
    const d = await getGameDetail({ slug: "r4-861010", locale: "en" });
    expect(d!.ratings.map((r) => [r.scoreProvider, r.scoreType, r.score, r.reviewCount])).toEqual([
      ["igdb", "critic_aggregate", 90, 3],
      ["metacritic_scrape", "metascore", 88, 40],
    ]);
  });
});
