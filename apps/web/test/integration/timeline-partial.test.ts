/**
 * 時間軸稀疏條件（整合）：單次請求有掃描上限，湊不滿一頁回傳部分結果＋邊界 cursor，接著載入能找到更遠的資料，
 * 到盡頭時 cursor 為 null 且不標示 partial。igdbId 用 588xxx；genre `g588-tag` 隔離其他測試檔。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import { getTimeline, type TimelinePage } from "@/modules/catalog";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import { decodeTimelineCursor, TIMELINE_MAX_SCAN_WINDOWS } from "@/modules/catalog/repository/timeline";
import { gameGenres, gamePlatforms, games, genres, platforms, regions, releaseEvents } from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const NOW = new Date("2031-01-01T00:00:00Z");
const SCAN_DAYS = 14 + 56 + 224 + 896; // 與 TIMELINE_MAX_SCAN_WINDOWS＝4、視窗上限 896 對應

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

describe.skipIf(!enabled)("時間軸稀疏條件（整合）", () => {
  const gid: Record<string, number> = {};
  const DATES = { early: "2012-01-10", mid: "2020-03-05", late: "2030-06-10" } as const;

  beforeAll(async () => {
    const db = getDb();
    const ww = (await db.select().from(regions)).find((r) => r.code === "WW")!;
    const [plat] = await db.insert(platforms).values({ slug: "g588-pc", name: "G588 PC", kind: "pc", igdbId: 588900 }).returning({ id: platforms.id });
    const [tag] = await db.insert(genres).values({ igdbId: 588950, slug: "g588-tag", name: "G588" }).returning({ id: genres.id });
    let n = 0;
    for (const [k, date] of Object.entries(DATES)) {
      const name = `G588 ${k}`;
      const [g] = await db
        .insert(games)
        .values({ igdbId: 588001 + n++, slug: `g588-${k}`, name, gameType: "main_game", searchText: buildSearchText([name]), coverUrl: null })
        .returning({ id: games.id });
      gid[k] = g!.id;
      await db.insert(gameGenres).values({ gameId: g!.id, genreId: tag!.id });
      await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: plat!.id });
      await db.insert(releaseEvents).values({ gameId: g!.id, platformId: plat!.id, regionId: ww.id, releaseDate: date, periodStart: date, precision: "day", releaseStage: "full", status: "scheduled" });
    }
  });

  afterAll(async () => {
    await closeDb();
  });

  const tl = (extra: Partial<Parameters<typeof getTimeline>[0]> = {}) => getTimeline({ locale: "en", filter: { genreSlugs: ["g588-tag"] }, now: NOW, limit: 20, ...extra });
  const ids = (p: TimelinePage) => p.groups.flatMap((g) => g.cards.map((c) => c.gameId));

  it("往後：空範圍只掃一個上限（SCAN_DAYS 天）→ 部分結果＋邊界 cursor；一步步繼續能找到更遠的，最後到盡頭", async () => {
    expect(TIMELINE_MAX_SCAN_WINDOWS).toBe(4);
    const start = "2020-04-01"; // mid 已在這之前
    let page = await tl({ at: start });
    expect(page.groups).toEqual([]);
    expect(page.nextPartial).toBe(true);
    const c1 = decodeTimelineCursor(page.nextCursor)!;
    expect(c1.dir).toBe("after");
    expect(c1.key.sk).toBe(addDays(start, SCAN_DAYS)); // 邊界＝已掃描範圍的終點＋1，不是掃到全庫

    // 繼續往後直到找到 late；每一步的邊界都往前推進；最後到盡頭（cursor null、不標 partial）
    const found: number[] = [];
    let steps = 0;
    let prevSk = c1.key.sk;
    while (page.nextCursor && steps++ < 40) {
      page = await tl({ cursor: page.nextCursor });
      found.push(...ids(page));
      if (page.nextCursor && page.nextPartial) {
        const sk = decodeTimelineCursor(page.nextCursor)!.key.sk;
        expect(sk > prevSk).toBe(true);
        prevSk = sk;
      }
    }
    expect(found).toEqual([gid.late]);
    expect(page.nextCursor).toBeNull();
    expect(page.nextPartial).toBeFalsy();
    expect(steps).toBeGreaterThan(1);
  });

  it("往前：同樣有上限；繼續往前能找到更早的，最後 prevCursor＝null", async () => {
    const first = await tl({ at: "2031-06-01" }); // 往後沒資料；prevCursor 給「之前」
    expect(first.groups).toEqual([]);
    expect(first.prevCursor).not.toBeNull();
    let page = await tl({ cursor: first.prevCursor });
    // 2031-06-01 往前 SCAN_DAYS 天內沒有（late 在 2030-06-10 → 偏差 356 天，在範圍內！）
    expect(ids(page)).toEqual([gid.late]);
    page = await tl({ cursor: page.prevCursor });
    expect(page.groups).toEqual([]);
    expect(page.prevPartial).toBe(true);
    const c = decodeTimelineCursor(page.prevCursor)!;
    expect(c.dir).toBe("before");
    const found: number[] = [];
    let steps = 0;
    while (page.prevCursor && steps++ < 40) {
      page = await tl({ cursor: page.prevCursor });
      found.push(...ids(page));
    }
    expect(found.sort()).toEqual([gid.early, gid.mid].sort());
    expect(page.prevCursor).toBeNull();
    expect(page.prevPartial).toBeFalsy();
  });

  it("掃描範圍（to）在上限內掃完時不標 partial、cursor＝null", async () => {
    const page = await tl({ at: "2030-01-01", to: "2030-12-31" });
    expect(ids(page)).toEqual([gid.late]);
    expect(page.nextPartial).toBeFalsy();
    expect(page.nextCursor).toBeNull();
  });
});
