/**
 * e2e 測試資料：重建「測試資料庫」（沿用整合測試的 global-setup：DROP → CREATE → migrate → seed regions），
 * 再寫入固定 fixture。只寫 TEST_DATABASE_URL（名稱必須以 _test 結尾），絕不碰開發資料庫。
 *
 * 注意：`npm test`（整合測試）也會重建同一個測試資料庫，兩者不要同時跑。
 *
 * fixture（igdbId 44xxxx，月份固定 2036-05，不依賴「今天」）：
 * - 05-15：一款三平台同日（PS5／Switch／PC）的遊戲 → 月曆只出現一次；也是詳情頁主角
 *   （商店／官網連結、同系列、相似遊戲、DLC、公司、改期紀錄、即將亮相的活動）
 * - 05-08：8 款遊戲 → 桌機格子顯示 3 張＋「＋5」、議程 5 張＋「＋3」
 * - 05-01（月精度）：本月未定日
 * - 05-12：一個活動（showcase）
 * - 05-22：延期一款、來源已移除（removed）一款
 * - 05-20：DLC（月曆預設不顯示，詳情頁 DLC 區塊）
 */
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import {
  companies,
  eventGames,
  events,
  franchises,
  gameCompanies,
  gameExternalLinks,
  gameFranchises,
  gameGenres,
  gamePlatforms,
  games,
  gameSimilarGames,
  genres,
  platforms,
  regions,
  releaseDateHistory,
  releaseEvents,
} from "@/modules/catalog/schema";
import resetTestDatabase from "../../test/integration/global-setup";
import { FIXTURE } from "./fixture-data";


type Precision = "day" | "month" | "quarter" | "year" | "tbd";
interface Ev {
  platform: string;
  date: string | null;
  periodStart?: string | null;
  precision?: Precision;
  stage?: "unspecified" | "full" | "early_access" | "beta";
  status?: "scheduled" | "delayed" | "released" | "cancelled";
  sourceStatus?: "active" | "removed";
}

export async function seedE2eDatabase(): Promise<void> {
  await resetTestDatabase(); // 需要 process.env.TEST_DATABASE_URL；getDb 讀 DATABASE_URL（呼叫端設成測試庫）
  const db = getDb();
  try {
    const region: Record<string, number> = {};
    for (const r of await db.select().from(regions)) region[r.code] = r.id;

    const platform: Record<string, number> = {};
    const plats = [
      { igdbId: 440901, slug: "e2e-ps5", name: "E2E PlayStation 5", abbreviation: "PS5", kind: "console" as const, generation: 9 },
      { igdbId: 440902, slug: "e2e-switch", name: "E2E Nintendo Switch", abbreviation: "Switch", kind: "hybrid" as const, generation: 8 },
      { igdbId: 440903, slug: "e2e-pc", name: "E2E PC (Microsoft Windows)", abbreviation: "PC", kind: "pc" as const, generation: null },
    ];
    for (const p of plats) {
      const [row] = await db.insert(platforms).values(p).returning({ id: platforms.id });
      platform[p.slug] = row!.id;
    }
    const genre: Record<string, number> = {};
    for (const g of [
      { igdbId: 440951, slug: "role-playing-rpg", name: "Role-playing (RPG)" },
      { igdbId: 440952, slug: "shooter", name: "Shooter" },
    ]) {
      const [row] = await db.insert(genres).values(g).returning({ id: genres.id });
      genre[g.slug] = row!.id;
    }

    const gameId: Record<number, number> = {};
    async function addGame(
      igdbId: number,
      opts: {
        slug: string;
        name: string;
        displayNames?: Record<string, string>;
        gameType?: string;
        parentGameId?: number;
        genres?: string[];
        firstReleaseDate?: string;
        summary?: string;
        events?: Ev[];
      },
    ): Promise<number> {
      const [g] = await db
        .insert(games)
        .values({
          igdbId,
          slug: opts.slug,
          name: opts.name,
          displayNames: opts.displayNames ?? {},
          gameType: opts.gameType ?? "main_game",
          parentGameId: opts.parentGameId ?? null,
          firstReleaseDate: opts.firstReleaseDate ?? null,
          firstReleasePrecision: opts.firstReleaseDate ? "day" : null,
          summary: opts.summary ?? null,
          // 封面走 IGDB 網址格式；測試在瀏覽器端攔截 images.igdb.com 與 /_next/image，不連外
          coverUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/e2e${igdbId}.jpg`,
        })
        .returning({ id: games.id });
      gameId[igdbId] = g!.id;
      for (const s of opts.genres ?? []) await db.insert(gameGenres).values({ gameId: g!.id, genreId: genre[s]! });
      const evs = opts.events ?? [];
      for (const p of new Set(evs.map((e) => e.platform))) await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: platform[p]! });
      for (const e of evs) {
        await db.insert(releaseEvents).values({
          gameId: g!.id,
          platformId: platform[e.platform]!,
          regionId: region.WW!,
          releaseDate: e.date,
          periodStart: e.periodStart === undefined ? e.date : e.periodStart,
          precision: e.precision ?? "day",
          releaseStage: e.stage ?? "full",
          status: e.status ?? "scheduled",
          sourceStatus: e.sourceStatus ?? "active",
          source: "igdb",
        });
      }
      return g!.id;
    }

    // 主角：三平台同日 → 一張卡
    await addGame(440001, {
      slug: FIXTURE.hero.slug,
      name: FIXTURE.hero.name,
      displayNames: { "zh-Hant": FIXTURE.hero.zhName },
      genres: ["role-playing-rpg"],
      firstReleaseDate: "2036-05-15",
      summary: "A test adventure across the northern lights.",
      events: [
        { platform: "e2e-ps5", date: "2036-05-15" },
        { platform: "e2e-switch", date: "2036-05-15" },
        { platform: "e2e-pc", date: "2036-05-15" },
      ],
    });
    // 同系列、相似
    await addGame(440002, { slug: "e2e-aurora-prequel", name: "Aurora Prequel", firstReleaseDate: "2033-03-01", events: [{ platform: "e2e-pc", date: "2033-03-01", status: "released" }] });
    await addGame(440003, { slug: "e2e-similar-quest", name: "Similar Quest", firstReleaseDate: "2034-07-07", events: [{ platform: "e2e-ps5", date: "2034-07-07", status: "released" }] });
    // DLC（月曆預設遊戲類型不含 dlc_addon）
    await addGame(440004, {
      slug: "e2e-aurora-dlc",
      name: "Aurora Odyssey: Frost Expansion",
      gameType: "dlc_addon",
      parentGameId: 440001,
      firstReleaseDate: "2036-05-20",
      events: [{ platform: "e2e-pc", date: "2036-05-20" }],
    });

    // 熱門的一天：8 款
    for (let i = 1; i <= FIXTURE.busyCount; i++) {
      const n = String(i).padStart(2, "0");
      await addGame(440100 + i, {
        slug: `e2e-busy-${n}`,
        name: `Busy Day Game ${n}`,
        genres: i % 2 === 0 ? ["shooter"] : ["role-playing-rpg"],
        events: [{ platform: i <= 4 ? "e2e-ps5" : "e2e-pc", date: FIXTURE.busyDay, stage: i === 3 ? "early_access" : "full" }],
      });
    }

    // 月精度 → 本月未定日
    await addGame(440020, {
      slug: FIXTURE.monthPrecision.slug,
      name: FIXTURE.monthPrecision.name,
      events: [{ platform: "e2e-switch", date: "2036-05-01", periodStart: "2036-05-01", precision: "month" }],
    });
    // 延期、來源已移除
    await addGame(440030, { slug: "e2e-delayed", name: "Delayed Dragon", events: [{ platform: "e2e-ps5", date: "2036-05-22", status: "delayed" }] });
    await addGame(440031, { slug: "e2e-removed", name: "Removed Rocket", events: [{ platform: "e2e-pc", date: "2036-05-22", sourceStatus: "removed" }] });

    // 詳情頁：系列、相似、公司、連結、改期紀錄、活動
    await db.insert(gameSimilarGames).values({ gameId: gameId[440001]!, similarGameId: gameId[440003]! });
    const [fr] = await db.insert(franchises).values({ igdbId: 440960, kind: "franchise", name: "Aurora Saga", slug: "e2e-aurora-saga" }).returning();
    await db.insert(gameFranchises).values([440001, 440002].map((i) => ({ gameId: gameId[i]!, franchiseId: fr!.id })));
    const [co] = await db.insert(companies).values({ igdbId: 440970, name: "E2E Northern Studio", slug: "e2e-northern-studio" }).returning();
    await db.insert(gameCompanies).values([
      { gameId: gameId[440001]!, companyId: co!.id, role: "developer" },
      { gameId: gameId[440001]!, companyId: co!.id, role: "publisher" },
    ]);
    await db.insert(gameExternalLinks).values([
      { gameId: gameId[440001]!, linkType: "store", categoryLabel: "steam", url: "https://store.example.test/aurora" },
      { gameId: gameId[440001]!, linkType: "official", categoryLabel: "official_website", url: "https://aurora.example.test" },
    ]);
    const [ev] = await db
      .insert(events)
      .values({ name: FIXTURE.event.name, slug: "e2e-showcase-2036", kind: "showcase", startTime: new Date("2036-05-12T17:00:00Z"), endTime: new Date("2036-05-12T18:30:00Z") })
      .returning({ id: events.id });
    await db.insert(eventGames).values({ eventId: ev!.id, gameId: gameId[440001]! });
    const [ps] = await db
      .select({ id: releaseEvents.id })
      .from(releaseEvents)
      .where(sql`${releaseEvents.gameId} = ${gameId[440001]!} AND ${releaseEvents.platformId} = ${platform["e2e-ps5"]!}`);
    await db.insert(releaseDateHistory).values({ releaseEventId: ps!.id, oldDate: "2035-12-31", oldPrecision: "year", newDate: "2036-05-15", newPrecision: "day" });
  } finally {
    await closeDb();
  }
}
