/**
 * Phase 1 完成標準：用 Repository 函式寫入並查出一筆測試遊戲。
 * 另驗證：sequence 遞增、改期歷史、change_feed 同交易、EA 與正式版並存、ratings NULLS NOT DISTINCT。
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import {
  getGameBySlug,
  getRatingsByGame,
  getRegionByCode,
  getReleaseEventsByMonth,
  upsertGame,
  upsertRating,
  upsertReleaseEvent,
} from "@/modules/catalog";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("catalog repository（整合）", () => {
  afterAll(async () => {
    await closeDb();
  });

  async function fixtures() {
    const platform = await upsertPlatform({ name: "Nintendo Switch 2", slug: "switch-2", kind: "hybrid", igdbId: 508 });
    const region = await getRegionByCode("WW");
    if (!region) throw new Error("seed regions 缺少 WW");
    const game = await upsertGame({ igdbId: 999001, slug: "test-game", name: "測試遊戲 Test Game" });
    return { platform, region, game };
  }

  it("upsertGame → getGameBySlug 查得到；重複 upsert 不新增列", async () => {
    const { game } = await fixtures();
    const again = await upsertGame({ igdbId: 999001, slug: "test-game", name: "測試遊戲（改名）" });
    expect(again.id).toBe(game.id);
    const found = await getGameBySlug("test-game");
    expect(found?.name).toBe("測試遊戲（改名）");
    expect(await getGameBySlug("does-not-exist")).toBeNull();
  });

  it("upsertReleaseEvent：建立、改期（sequence+1、history、change_feed）、無變動", async () => {
    const { platform, region, game } = await fixtures();
    const key = { gameId: game.id, platformId: platform.id, regionId: region.id, releaseStage: "full" as const };

    const r1 = await upsertReleaseEvent({ ...key, releaseDate: "2026-11-20", periodStart: "2026-11-20", precision: "day", status: "scheduled" });
    expect(r1.kind).toBe("created");
    expect(r1.event.sequence).toBe(0);

    const r2 = await upsertReleaseEvent({ ...key, releaseDate: "2026-12-31", periodStart: "2026-10-01", precision: "quarter", status: "delayed" });
    expect(r2.kind).toBe("updated");
    expect(r2.event.id).toBe(r1.event.id);
    expect(r2.event.sequence).toBe(1); // 日期與狀態同時變動，只 +1

    const r3 = await upsertReleaseEvent({ ...key, releaseDate: "2026-12-31", periodStart: "2026-10-01", precision: "quarter", status: "delayed" });
    expect(r3.kind).toBe("unchanged");
    expect(r3.event.sequence).toBe(1);

    const db = getDb();
    const history = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM release_date_history WHERE release_event_id = ${r1.event.id}`);
    expect(history.rows[0].n).toBe(1);
    const feed = await db.execute<{ change_type: string }>(
      sql`SELECT change_type FROM change_feed WHERE entity_type = 'release_event' AND entity_id = ${r1.event.id} ORDER BY id`,
    );
    expect(feed.rows.map((r) => r.change_type)).toEqual(["created", "date_changed", "status_changed"]);
  });

  it("同一 (平台, 地區) 的搶先體驗與正式版並存；getReleaseEventsByMonth 依代表日期查詢", async () => {
    const { platform, region, game } = await fixtures();
    const ea = await upsertReleaseEvent({
      gameId: game.id, platformId: platform.id, regionId: region.id, releaseStage: "early_access",
      releaseDate: "2026-10-15", periodStart: "2026-10-15", precision: "day", status: "scheduled",
    });
    expect(ea.kind).toBe("created");

    const oct = await getReleaseEventsByMonth(2026, 10);
    expect(oct.map((e) => e.releaseStage)).toContain("early_access");
    const dec = await getReleaseEventsByMonth(2026, 12);
    expect(dec.some((e) => e.releaseStage === "full" && e.precision === "quarter")).toBe(true);
    await expect(getReleaseEventsByMonth(2026, 13)).rejects.toThrow(RangeError);
  });

  it("upsertRating：platformId 為 NULL 也不重複（NULLS NOT DISTINCT）；只有變動才寫 snapshot", async () => {
    const { game } = await fixtures();
    const base = { gameId: game.id, scoreOrigin: "igdb-aggregate", scoreProvider: "igdb" as const, platformId: null };
    const a = await upsertRating({ ...base, score: 88, reviewCount: 40 });
    const b = await upsertRating({ ...base, score: 88, reviewCount: 40 });
    const c = await upsertRating({ ...base, score: 90, reviewCount: 41 });
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);

    const list = await getRatingsByGame(game.id);
    expect(list).toHaveLength(1);
    expect(list[0].score).toBe(90);

    const snaps = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM score_snapshots WHERE rating_id = ${a.id}`);
    expect(snaps.rows[0].n).toBe(2);
  });
});
