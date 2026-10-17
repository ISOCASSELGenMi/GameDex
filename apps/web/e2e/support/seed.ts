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
 * - Wave 3（3b）追加，igdbId 441xxx（見 fixture-data.ts 的 FIXTURE_3B）：2037-03 時間軸資料（單日 13 款＋90 款填充）、
 *   同 slug 的 franchise／collection、語言支援三態、另三個活動（expo／已結束 awards／時間未定 expo）
 */
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import {
  companies,
  eventGames,
  events,
  franchises,
  gameCompanies,
  gameExternalLinks,
  gameFranchises,
  gameLanguageSupports,
  gameGenres,
  gamePlatforms,
  games,
  gameSimilarGames,
  genres,
  languages,
  platforms,
  ratings,
  regions,
  releaseDateHistory,
  releaseEvents,
} from "@/modules/catalog/schema";
import resetTestDatabase from "../../test/integration/global-setup";
import { FIXTURE, FIXTURE_3B, FIXTURE_4, FIXTURE_HOME } from "./fixture-data";


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
        popularityScore?: number;
        heatLevel?: number;
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
          // 瀏覽頁搜尋比對 search_text（同步時由 game-sync 寫入；fixture 直接寫入同一個函式的結果）
          searchText: buildSearchText([opts.name, ...Object.values(opts.displayNames ?? {})]),
          gameType: opts.gameType ?? "main_game",
          parentGameId: opts.parentGameId ?? null,
          firstReleaseDate: opts.firstReleaseDate ?? null,
          firstReleasePrecision: opts.firstReleaseDate ? "day" : null,
          summary: opts.summary ?? null,
          ...(opts.popularityScore !== undefined ? { popularityScore: opts.popularityScore } : {}),
          ...(opts.heatLevel !== undefined ? { heatLevel: opts.heatLevel } : {}),
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

    // ── Phase 4 評分：hero 有 IGDB 分數；month-precision 只有 score=NULL 的列（等同無分數）；其餘遊戲沒有列 ──
    await db.insert(ratings).values([
      { gameId: gameId[440001]!, scoreOrigin: "igdb-aggregate", scoreProvider: "igdb", scoreType: "critic_aggregate", score: FIXTURE_4.rated.score, scoreMax: 100, reviewCount: FIXTURE_4.rated.reviewCount },
      { gameId: gameId[440020]!, scoreOrigin: "igdb-aggregate", scoreProvider: "igdb", scoreType: "critic_aggregate", score: null, scoreMax: 100, reviewCount: null },
    ]);

    // ── Wave 3（3b）追加 ──────────────────────────────────────────────
    const tl = FIXTURE_3B.timeline;
    // 單日 13 款（超過時間軸每組預覽 10 款）
    for (let i = 1; i <= tl.bigDayCount; i++) {
      const n = String(i).padStart(2, "0");
      await addGame(441000 + i, { slug: `e2e-big-${n}`, name: `Big Day Game ${n}`, events: [{ platform: "e2e-pc", date: tl.bigDay }] });
    }
    // 填充 90 款：03-03 起每天 4 款，讓第一頁（60 筆）之後還有下一頁
    for (let i = 0; i < tl.fillerCount; i++) {
      const day = 3 + Math.floor(i / 4);
      const date = `2037-03-${String(day).padStart(2, "0")}`;
      await addGame(441100 + i, { slug: `e2e-fill-${String(i).padStart(2, "0")}`, name: `Filler Game ${String(i).padStart(2, "0")}`, events: [{ platform: "e2e-pc", date }] });
    }

    // 稀疏條件（W3C）：status=delayed 往前找時，與 hero（2036-05-15，有延期紀錄）相距超過單次掃描上限
    // （「延期」篩選＝有改期紀錄且往後延；此篩選下只有 hero 2036-05-15 與這款）
    await addGame(442901, { slug: FIXTURE_3B.sparse.slug, name: FIXTURE_3B.sparse.name, events: [{ platform: "e2e-pc", date: FIXTURE_3B.sparse.date }] });
    const [farEv] = await db.select({ id: releaseEvents.id }).from(releaseEvents).where(eq(releaseEvents.gameId, gameId[442901]!));
    await db.insert(releaseDateHistory).values({ releaseEventId: farEv!.id, oldDate: "2032-03-01", oldPrecision: "day", newDate: FIXTURE_3B.sparse.date, newPrecision: "day" });

    // 同 slug 的 franchise 與 collection（igdbId 在各自 kind 內唯一）
    const twin = FIXTURE_3B.twin;
    const [twinFr] = await db.insert(franchises).values({ igdbId: 441201, kind: "franchise", name: twin.name, slug: twin.slug }).returning();
    const [twinCo] = await db.insert(franchises).values({ igdbId: 441202, kind: "collection", name: twin.name, slug: twin.slug }).returning();
    await addGame(441211, { slug: "e2e-twin-franchise-only", name: "Twin Franchise Only", firstReleaseDate: "2036-07-01", events: [{ platform: "e2e-pc", date: "2036-07-01" }] });
    await addGame(441212, { slug: "e2e-twin-both", name: "Twin In Both", firstReleaseDate: "2036-07-02", events: [{ platform: "e2e-pc", date: "2036-07-02" }] });
    await addGame(441213, { slug: "e2e-twin-collection-only", name: "Twin Collection Only", firstReleaseDate: "2036-07-03", events: [{ platform: "e2e-pc", date: "2036-07-03" }] });
    await db.insert(gameFranchises).values([
      { gameId: gameId[441211]!, franchiseId: twinFr!.id },
      { gameId: gameId[441212]!, franchiseId: twinFr!.id },
      { gameId: gameId[441212]!, franchiseId: twinCo!.id },
      { gameId: gameId[441213]!, franchiseId: twinCo!.id },
    ]);

    // 語言支援：hero＝三欄都有資料；partial＝只有介面（字幕、語音兩欄整欄沒資料）；Aurora Prequel（440002）＝整區沒資料
    const lang: Record<string, number> = {};
    for (const l of [
      { igdbId: 441301, code: "en-US", name: "English (United States)", nativeName: "English" },
      { igdbId: 441302, code: "ja-JP", name: "Japanese (Japan)", nativeName: "日本語" },
      { igdbId: 441303, code: "zh-Hant", name: "Chinese (Traditional)", nativeName: "繁體中文" },
    ]) {
      const [row] = await db.insert(languages).values(l).returning({ id: languages.id });
      lang[l.code] = row!.id;
    }
    await db.insert(gameLanguageSupports).values([
      { gameId: gameId[440001]!, languageId: lang["en-US"]!, supportType: "interface" },
      { gameId: gameId[440001]!, languageId: lang["en-US"]!, supportType: "subtitles" },
      { gameId: gameId[440001]!, languageId: lang["en-US"]!, supportType: "audio" },
      { gameId: gameId[440001]!, languageId: lang["ja-JP"]!, supportType: "interface" },
      { gameId: gameId[440001]!, languageId: lang["ja-JP"]!, supportType: "subtitles" },
      { gameId: gameId[440001]!, languageId: lang["zh-Hant"]!, supportType: "interface" },
    ]);
    await addGame(441401, { slug: FIXTURE_3B.langPartial.slug, name: FIXTURE_3B.langPartial.name, firstReleaseDate: "2036-08-01", events: [{ platform: "e2e-pc", date: "2036-08-01" }] });
    await db.insert(gameLanguageSupports).values([
      { gameId: gameId[441401]!, languageId: lang["en-US"]!, supportType: "interface" },
      { gameId: gameId[441401]!, languageId: lang["ja-JP"]!, supportType: "interface" },
    ]);

    // 活動：即將舉行的 expo、已結束的 awards、時間未定的 expo（皆沒有關聯遊戲，除了 expo 掛一款）
    const [expo] = await db
      .insert(events)
      .values({ name: FIXTURE_3B.events.expo.name, slug: FIXTURE_3B.events.expo.slug, kind: "expo", startTime: new Date("2036-06-10T09:00:00Z"), endTime: new Date("2036-06-12T18:00:00Z"), organizer: "E2E Organizer", url: "https://expo.example.test" })
      .returning({ id: events.id });
    await db.insert(eventGames).values({ eventId: expo!.id, gameId: gameId[441401]! });
    await db.insert(events).values([
      { name: FIXTURE_3B.events.past.name, slug: FIXTURE_3B.events.past.slug, kind: "awards", startTime: new Date("2020-12-10T01:00:00Z"), endTime: new Date("2020-12-10T04:00:00Z") },
      { name: FIXTURE_3B.events.undated.name, slug: FIXTURE_3B.events.undated.slug, kind: "expo", startTime: null, endTime: null },
    ]);

    // ── GameDex 第 2 段：首頁儀表板（日期相對於「現在」，seed 時算好；首頁用 UTC 今天）──
    const dayFromToday = (offset: number): string => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const H = FIXTURE_HOME;
    await addGame(445001, { slug: H.upcoming[0].slug, name: H.upcoming[0].name, popularityScore: 900, heatLevel: 4, firstReleaseDate: dayFromToday(H.upcoming[0].offset), events: [{ platform: "e2e-ps5", date: dayFromToday(H.upcoming[0].offset) }, { platform: "e2e-pc", date: dayFromToday(H.upcoming[0].offset) }] });
    await addGame(445002, { slug: H.upcoming[1].slug, name: H.upcoming[1].name, popularityScore: 700, heatLevel: 3, firstReleaseDate: dayFromToday(H.upcoming[1].offset), events: [{ platform: "e2e-pc", date: dayFromToday(H.upcoming[1].offset) }] });
    await addGame(445003, { slug: H.recent[0].slug, name: H.recent[0].name, popularityScore: 800, heatLevel: 4, firstReleaseDate: dayFromToday(H.recent[0].offset), events: [{ platform: "e2e-ps5", date: dayFromToday(H.recent[0].offset), status: "released" }] });
    await addGame(445004, { slug: H.recent[1].slug, name: H.recent[1].name, popularityScore: 300, heatLevel: 2, firstReleaseDate: dayFromToday(H.recent[1].offset), events: [{ platform: "e2e-pc", date: dayFromToday(H.recent[1].offset), status: "released" }] });
  } finally {
    await closeDb();
  }
}
