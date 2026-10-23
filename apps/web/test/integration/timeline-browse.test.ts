/**
 * Phase 3b（G）整合：瀏覽／搜尋（舊時間軸 API 與其 use case 已於 D85 刪除，時間軸改為週視圖，見 timeline-week-x2.test.ts）。
 * igdbId 用 57xxxx；日期用 2037 年；所有遊戲都掛 genre `g57-tag`，查詢以它隔離其他測試檔的資料。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import {
  browseGames,
} from "@/modules/catalog";
import { buildSearchText } from "@/modules/catalog/domain/search-text";
import {
  companies,
  franchises,
  gameCompanies,
  gameFranchises,
  gameGenres,
  gamePlatforms,
  games,
  gameThemes,
  genres,
  platforms,
  regions,
  releaseDateHistory,
  releaseEvents,
  themes,
} from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;

type Precision = "day" | "month" | "quarter" | "year" | "tbd";
interface Ev {
  platform?: string;
  region?: string;
  date: string | null;
  periodStart?: string | null;
  precision?: Precision;
  stage?: "unspecified" | "full" | "early_access";
  status?: "scheduled" | "delayed" | "released" | "cancelled";
  history?: { oldDate: string | null; oldPrecision: Precision; newDate: string | null; newPrecision: Precision }[];
}

const P: Record<string, number> = {};
const R: Record<string, number> = {};
const gid: Record<number, number> = {};
const evIds: Record<number, number[]> = {};
let tagGenre = 0;
let horrorTheme = 0;
let capcom = 0;
const franchiseIds: number[] = [];

async function addGame(
  igdbId: number,
  o: {
    name?: string;
    alt?: string[];
    popularity?: number;
    heat?: number;
    gameStatus?: string | null;
    firstReleaseDate?: string | null;
    firstReleasePrecision?: Precision | null;
    theme?: boolean;
    company?: boolean;
    franchise?: boolean;
    events?: Ev[];
  } = {},
) {
  const db = getDb();
  const name = o.name ?? `G57 Game ${igdbId}`;
  const [g] = await db
    .insert(games)
    .values({
      igdbId,
      slug: `g57-${igdbId}`,
      name,
      gameType: "main_game",
      gameStatus: o.gameStatus ?? null,
      popularityScore: o.popularity ?? 0,
      heatLevel: o.heat ?? 0,
      firstReleaseDate: o.firstReleaseDate ?? null,
      firstReleasePrecision: o.firstReleasePrecision ?? (o.firstReleaseDate ? "day" : null),
      searchText: buildSearchText([name, ...(o.alt ?? [])]),
      coverUrl: null,
    })
    .returning({ id: games.id });
  gid[igdbId] = g!.id;
  await db.insert(gameGenres).values({ gameId: g!.id, genreId: tagGenre });
  if (o.theme) await db.insert(gameThemes).values({ gameId: g!.id, themeId: horrorTheme });
  if (o.company) await db.insert(gameCompanies).values({ gameId: g!.id, companyId: capcom, role: "developer" });
  if (o.franchise) for (const f of franchiseIds) await db.insert(gameFranchises).values({ gameId: g!.id, franchiseId: f });
  const evs = o.events ?? [];
  for (const p of new Set(evs.map((e) => e.platform ?? "g57-pc"))) await db.insert(gamePlatforms).values({ gameId: g!.id, platformId: P[p]! });
  evIds[igdbId] = [];
  for (const e of evs) {
    const [row] = await db
      .insert(releaseEvents)
      .values({
        gameId: g!.id,
        platformId: P[e.platform ?? "g57-pc"]!,
        regionId: R[e.region ?? "WW"]!,
        releaseDate: e.date,
        periodStart: e.periodStart === undefined ? e.date : e.periodStart,
        precision: e.precision ?? "day",
        releaseStage: e.stage ?? "full",
        status: e.status ?? "scheduled",
      })
      .returning({ id: releaseEvents.id });
    evIds[igdbId]!.push(row!.id);
    for (const h of e.history ?? []) await db.insert(releaseDateHistory).values({ releaseEventId: row!.id, ...h });
  }
  return g!.id;
}

describe.skipIf(!enabled)("瀏覽與搜尋（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    for (const r of await db.select().from(regions)) R[r.code] = r.id;
    for (const [i, p] of [
      { slug: "g57-pc", name: "G57 PC", kind: "pc" as const },
      { slug: "g57-ps", name: "G57 PS", kind: "console" as const },
    ].entries()) {
      const [row] = await db.insert(platforms).values({ ...p, igdbId: 570900 + i }).returning({ id: platforms.id });
      P[p.slug] = row!.id;
    }
    tagGenre = (await db.insert(genres).values({ igdbId: 570950, slug: "g57-tag", name: "G57" }).returning({ id: genres.id }))[0]!.id;
    horrorTheme = (await db.insert(themes).values({ igdbId: 570960, slug: "g57-horror", name: "G57 Horror" }).returning({ id: themes.id }))[0]!.id;
    capcom = (await db.insert(companies).values({ igdbId: 570970, slug: "g57-capcom", name: "G57 Capcom" }).returning({ id: companies.id }))[0]!.id;
    // franchise 與 collection 同 slug
    for (const kind of ["franchise", "collection"] as const) {
      franchiseIds.push(
        (await db.insert(franchises).values({ igdbId: 570980, kind, slug: "g57-series", name: "G57 Series" }).returning({ id: franchises.id }))[0]!.id,
      );
    }

    // 2037-01-01：year、quarter、month、day 同一個 periodStart
    await addGame(570001, { popularity: 10, events: [{ date: "2037-12-31", periodStart: "2037-01-01", precision: "year" }] });
    await addGame(570002, { popularity: 10, events: [{ date: "2037-03-31", periodStart: "2037-01-01", precision: "quarter" }] });
    await addGame(570003, { popularity: 10, events: [{ date: "2037-01-01", periodStart: "2037-01-01", precision: "month" }] });
    await addGame(570004, { popularity: 10, events: [{ date: "2037-01-01" }] });
    // 2037-02-01：12 款（熱度 100..111）→ 前 10 筆＋隱藏 2
    for (let i = 0; i < 12; i++) await addGame(570100 + i, { popularity: 100 + i, events: [{ date: "2037-02-01" }] });
    // 改期＋延期、提前（不算延期）
    await addGame(570200, {
      popularity: 50,
      events: [{ date: "2037-03-10", status: "delayed", history: [{ oldDate: "2037-02-10", oldPrecision: "day", newDate: "2037-03-10", newPrecision: "day" }] }],
    });
    await addGame(570201, {
      popularity: 49,
      events: [{ date: "2037-03-11", history: [{ oldDate: "2037-04-11", oldPrecision: "day", newDate: "2037-03-11", newPrecision: "day" }] }],
    });
    // 已上市（status released）、月精度本月（today＝2037-03-15 時仍是 upcoming）
    await addGame(570202, { popularity: 48, events: [{ date: "2037-03-01", status: "released" }] });
    await addGame(570203, { popularity: 47, events: [{ date: "2037-03-01", periodStart: "2037-03-01", precision: "month" }] });
    // 主題／熱度／公司／系列
    await addGame(570300, { popularity: 30, heat: 4, theme: true, company: true, franchise: true, events: [{ date: "2037-05-05", platform: "g57-ps" }] });
    // 地區偏好：WW 5/20、JP 5/10
    await addGame(570301, {
      popularity: 29,
      events: [
        { date: "2037-05-20", region: "WW" },
        { date: "2037-05-10", region: "JP" },
      ],
    });
    // tbd
    await addGame(570400, { popularity: 5, events: [{ date: null, periodStart: null, precision: "tbd" }] });
    // 傳聞（預設隱藏）
    await addGame(570401, { popularity: 5, gameStatus: "rumored", events: [{ date: "2037-05-05" }] });

    // 瀏覽專用（不需上市列也可）
    await addGame(570500, {
      name: "Zeldovia Chronicles",
      alt: ["薩爾達維亞年代記"],
      popularity: 900,
      firstReleaseDate: "2036-06-01",
      company: true,
    });
    await addGame(570501, { name: "Another Quest", alt: ["龍之傳說"], popularity: 800, firstReleaseDate: "2031-01-01" });
    await addGame(570502, { name: "Beta Saga", popularity: 700, firstReleaseDate: null });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("瀏覽：排序、年份、公司／系列、狀態、分頁", async () => {
    const tag = { genreSlugs: ["g57-tag"] };
    const pop = await browseGames({ locale: "en", filter: tag, limit: 3 });
    expect(pop.games.map((g) => g.slug)).toEqual(["g57-570500", "g57-570501", "g57-570502"]);
    expect(pop.hasMore).toBe(true);
    expect(pop.sort).toBe("popularity");
    const page2 = await browseGames({ locale: "en", filter: tag, limit: 3, offset: 3 });
    expect(page2.games[0]!.popularityScore).toBe(111);

    const byName = await browseGames({ locale: "en", filter: tag, sort: "name", limit: 2 });
    expect(byName.games.map((g) => g.originalName)).toEqual(["Another Quest", "Beta Saga"]);

    const years = await browseGames({ locale: "en", filter: tag, yearFrom: 2031, yearTo: 2036, sort: "release_date" });
    expect(years.games.map((g) => g.slug)).toEqual(["g57-570501", "g57-570500"]);

    const company = await browseGames({ locale: "en", filter: { ...tag, companySlugs: ["g57-capcom"] } });
    expect(company.games.map((g) => g.slug).sort()).toEqual(["g57-570300", "g57-570500"]);
    const series = await browseGames({ locale: "en", filter: { ...tag, franchiseSlugs: ["g57-series"], platformSlugs: ["g57-ps"] } });
    expect(series.games.map((g) => g.slug)).toEqual(["g57-570300"]);
    expect(series.games[0]!.platforms.map((p) => p.slug)).toEqual(["g57-ps"]);

    const upcoming = await browseGames({ locale: "en", filter: { ...tag, releaseStates: ["upcoming"] }, now: new Date("2037-03-15T00:00:00Z") });
    expect(upcoming.games.map((g) => g.slug)).toContain("g57-570502"); // 首發未定
    expect(upcoming.games.map((g) => g.slug)).not.toContain("g57-570500");
    const delayed = await browseGames({ locale: "en", filter: { ...tag, releaseStates: ["delayed"] } });
    expect(delayed.games.map((g) => g.slug)).toEqual(["g57-570200"]);

    expect((await browseGames({ locale: "en", filter: tag, offset: 999_999 })).games).toEqual([]);
  });

  it("搜尋：拉丁、中文 bigram、單一中文字退回 ILIKE", async () => {
    const tag = { genreSlugs: ["g57-tag"] };
    const latin = await browseGames({ locale: "en", filter: tag, q: "Zeldovia" });
    expect(latin.games.map((g) => g.slug)).toEqual(["g57-570500"]);
    expect(latin.searchTokens).toBe("zeldovia");
    const cjk = await browseGames({ locale: "en", filter: tag, q: "薩爾達" });
    expect(cjk.games.map((g) => g.slug)).toEqual(["g57-570500"]);
    const single = await browseGames({ locale: "en", filter: tag, q: "龍" });
    expect(single.games.map((g) => g.slug)).toEqual(["g57-570501"]);
    const none = await browseGames({ locale: "en", filter: tag, q: "qqqqqq" });
    expect(none.games).toEqual([]);
  });
});
