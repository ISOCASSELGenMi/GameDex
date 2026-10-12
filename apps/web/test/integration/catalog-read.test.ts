/**
 * Phase 3a 讀取層（整合）：聚合規則（06 §聚合規則）、月曆、篩選、詳情。
 * igdbId 用 55xxxx；日期用 2035 年避免與其他測試檔撞到。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import {
  CatalogQueryTimeoutError,
  getCalendarMonth,
  getGameDetail,
  getFilterOptions,
  listReleaseCards,
  resolveFilterSlugs,
  type CalendarMonth,
  type ReleaseCard,
} from "@/modules/catalog";
import { withReadTimeout } from "@/modules/catalog/repository/read-tx";
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

const enabled = !!process.env.TEST_DATABASE_URL;

type Precision = "day" | "month" | "quarter" | "year" | "tbd";
interface Ev {
  platform: number;
  region?: string;
  date: string | null;
  periodStart?: string | null;
  precision?: Precision;
  stage?: "unspecified" | "full" | "early_access" | "beta";
  status?: "scheduled" | "delayed" | "released" | "cancelled";
  sourceStatus?: "active" | "removed";
  source?: "igdb" | "manual";
}

const ids = { platform: {} as Record<string, number>, region: {} as Record<string, number>, genre: {} as Record<string, number> };
const gameId: Record<number, number> = {};

async function addGame(
  igdbId: number,
  opts: {
    name?: string;
    displayNames?: Record<string, string>;
    gameType?: string;
    gameStatus?: string | null;
    popularity?: number;
    parentGameId?: number;
    genres?: string[];
    firstReleaseDate?: string;
    events?: Ev[];
  } = {},
) {
  const db = getDb();
  const [g] = await db
    .insert(games)
    .values({
      igdbId,
      slug: `b55-${igdbId}`,
      name: opts.name ?? `B55 Game ${igdbId}`,
      displayNames: opts.displayNames ?? {},
      gameType: opts.gameType ?? "main_game",
      gameStatus: opts.gameStatus ?? null,
      popularityScore: opts.popularity ?? 0,
      parentGameId: opts.parentGameId ?? null,
      firstReleaseDate: opts.firstReleaseDate ?? null,
      coverUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/cob${igdbId}.jpg`,
    })
    .returning({ id: games.id });
  gameId[igdbId] = g.id;
  for (const s of opts.genres ?? []) await db.insert(gameGenres).values({ gameId: g.id, genreId: ids.genre[s] });
  const evs = opts.events ?? [];
  const plats = [...new Set(evs.map((e) => e.platform))];
  for (const p of plats) await db.insert(gamePlatforms).values({ gameId: g.id, platformId: p });
  for (const e of evs) {
    const precision = e.precision ?? "day";
    await db.insert(releaseEvents).values({
      gameId: g.id,
      platformId: e.platform,
      regionId: ids.region[e.region ?? "WW"],
      releaseDate: e.date,
      periodStart: e.periodStart === undefined ? e.date : e.periodStart,
      precision,
      releaseStage: e.stage ?? "full",
      status: e.status ?? "scheduled",
      sourceStatus: e.sourceStatus ?? "active",
      source: e.source ?? "igdb",
    });
  }
  return g.id;
}

const cardsOf = (m: CalendarMonth): ReleaseCard[] => [...Object.values(m.days).flat(), ...m.undated];
const b55 = (cards: ReleaseCard[]) => cards.filter((c) => c.slug.startsWith("b55-"));
const find = (cards: ReleaseCard[], igdbId: number) => cards.filter((c) => c.gameId === gameId[igdbId]);
const march = (extra: Partial<Parameters<typeof getCalendarMonth>[0]> = {}) =>
  getCalendarMonth({ year: 2035, month: 3, locale: "zh-Hant", ...extra });

describe.skipIf(!enabled)("catalog 讀取層（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    for (const r of await db.select().from(regions)) ids.region[r.code] = r.id;
    const plats = [
      { slug: "b55-ps", name: "B55 PlayStation", kind: "console" as const, igdbId: 550901 },
      { slug: "b55-xb", name: "B55 Xbox", kind: "console" as const, igdbId: 550902 },
      { slug: "b55-pc", name: "B55 PC", kind: "pc" as const, igdbId: 550903 },
      { slug: "b55-phone", name: "B55 Phone", kind: "mobile" as const, igdbId: 550904 },
    ];
    for (const p of plats) {
      const [row] = await db.insert(platforms).values(p).returning({ id: platforms.id });
      ids.platform[p.slug] = row.id;
    }
    for (const [i, s] of ["b55-rpg", "b55-shooter"].entries()) {
      const [row] = await db.insert(genres).values({ igdbId: 550950 + i, slug: s, name: s.toUpperCase() }).returning({ id: genres.id });
      ids.genre[s] = row.id;
    }
    const P = ids.platform;

    // 聚合：三平台同一天 → 一張卡；不同天 → 兩張
    await addGame(550001, {
      displayNames: { "zh-Hant": "測試甲" },
      popularity: 500,
      genres: ["b55-rpg"],
      firstReleaseDate: "2035-03-10",
      events: [
        { platform: P["b55-ps"], date: "2035-03-10" },
        { platform: P["b55-xb"], date: "2035-03-10" },
        { platform: P["b55-pc"], date: "2035-03-10" },
        { platform: P["b55-pc"], date: "2035-03-10", region: "JP" }, // 同鍵另一地區，不應多出卡片
      ],
    });
    await addGame(550002, {
      popularity: 100,
      genres: ["b55-shooter"],
      events: [
        { platform: P["b55-ps"], date: "2035-03-10" },
        { platform: P["b55-pc"], date: "2035-03-12" },
      ],
    });
    // manual 優先於 igdb（同平台同地區同階段）
    await addGame(550003, {
      events: [
        { platform: P["b55-ps"], date: "2035-03-05", source: "igdb" },
        { platform: P["b55-ps"], date: "2035-03-20", source: "manual" },
      ],
    });
    // 地區優先序：偏好 > WW > 最早
    await addGame(550004, {
      events: [
        { platform: P["b55-ps"], region: "JP", date: "2035-03-07" },
        { platform: P["b55-ps"], region: "WW", date: "2035-03-15" },
        { platform: P["b55-ps"], region: "US", date: "2035-03-01" },
      ],
    });
    await addGame(550005, {
      events: [
        { platform: P["b55-ps"], region: "EU", date: "2035-03-04" },
        { platform: P["b55-ps"], region: "US", date: "2035-03-02" },
      ],
    });
    // 偏好地區的日期在區間外 → 不能拿 WW 的日期補進本月
    await addGame(550006, {
      events: [
        { platform: P["b55-ps"], region: "JP", date: "2035-04-02" },
        { platform: P["b55-ps"], region: "WW", date: "2035-03-25" },
      ],
    });
    // 精度：月 → 該月；季 → 期間最後一個月；年 → 12 月；tbd 不出現
    await addGame(550007, { events: [{ platform: P["b55-pc"], date: "2035-03-01", periodStart: "2035-03-01", precision: "month" }] });
    await addGame(550008, { events: [{ platform: P["b55-pc"], date: "2035-03-31", periodStart: "2035-01-01", precision: "quarter" }] });
    await addGame(550009, { events: [{ platform: P["b55-pc"], date: "2035-12-31", periodStart: "2035-01-01", precision: "year" }] });
    await addGame(550010, { events: [{ platform: P["b55-pc"], date: null, periodStart: null, precision: "tbd" }] });
    // 傳聞、removed、cancelled、DLC 類型、非預設階段、手機
    await addGame(550011, { gameStatus: "rumored", events: [{ platform: P["b55-pc"], date: "2035-03-18" }] });
    await addGame(550012, { events: [{ platform: P["b55-pc"], date: "2035-03-18", sourceStatus: "removed" }] });
    await addGame(550013, { events: [{ platform: P["b55-pc"], date: "2035-03-18", status: "cancelled" }] });
    await addGame(550014, { gameType: "dlc_addon", parentGameId: 550001, events: [{ platform: P["b55-pc"], date: "2035-03-18" }] });
    await addGame(550015, { events: [{ platform: P["b55-pc"], date: "2035-03-18", stage: "beta" }] });
    await addGame(550016, { events: [{ platform: P["b55-phone"], date: "2035-03-18" }] });
    // 同鍵有 active 列時不拿 removed 列（即使 removed 是 WW）
    await addGame(550017, {
      events: [
        { platform: P["b55-xb"], region: "WW", date: "2035-03-08", sourceStatus: "removed" },
        { platform: P["b55-xb"], region: "US", date: "2035-03-22" },
      ],
    });

    // 詳情用：相似、同系列、連結、公司、活動、改期紀錄
    await addGame(550020, { popularity: 10, firstReleaseDate: "2030-01-01" });
    await addGame(550021, { popularity: 50, firstReleaseDate: "2031-01-01" });
    await db.insert(gameSimilarGames).values([
      { gameId: gameId[550001], similarGameId: gameId[550020] },
      { gameId: gameId[550001], similarGameId: gameId[550021] },
    ]);
    const [fr] = await db.insert(franchises).values({ igdbId: 550960, kind: "franchise", name: "B55 Saga", slug: "b55-saga" }).returning();
    await db.insert(gameFranchises).values(
      [550001, 550020, 550021, 550014].map((i) => ({ gameId: gameId[i], franchiseId: fr.id })),
    );
    const [co] = await db.insert(companies).values({ igdbId: 550970, name: "B55 Studio", slug: "b55-studio" }).returning();
    const [co2] = await db.insert(companies).values({ igdbId: 550971, name: "B55 Pub", slug: "b55-pub" }).returning();
    await db.insert(gameCompanies).values([
      { gameId: gameId[550001], companyId: co.id, role: "publisher" },
      { gameId: gameId[550001], companyId: co.id, role: "developer" },
      { gameId: gameId[550001], companyId: co2.id, role: "publisher" },
    ]);
    await db.insert(gameExternalLinks).values([
      { gameId: gameId[550001], linkType: "social", categoryLabel: "twitter", url: "https://x.example/b55" },
      { gameId: gameId[550001], linkType: "official", categoryLabel: "official_website", url: "https://b55.example" },
      { gameId: gameId[550001], linkType: "store", categoryLabel: "xbox_store", url: "https://xbox.example/b55", isBroken: true },
      { gameId: gameId[550001], linkType: "store", categoryLabel: "steam", url: "https://steam.example/b55" },
      { gameId: gameId[550001], linkType: "store", categoryLabel: "playstation_store", url: "https://ps.example/b55" },
    ]);
    const evRows = await db
      .insert(events)
      .values([
        { name: "B55 Future Show", slug: "b55-future", startTime: new Date("2035-06-01T17:00:00Z"), kind: "showcase" },
        { name: "B55 Past Show", slug: "b55-past", startTime: new Date("2020-06-01T17:00:00Z") },
        { name: "B55 March Expo", slug: "b55-march", startTime: new Date("2035-02-28T10:00:00Z"), endTime: new Date("2035-03-02T10:00:00Z") },
      ])
      .returning({ id: events.id, slug: events.slug });
    await db.insert(eventGames).values(evRows.map((e) => ({ eventId: e.id, gameId: gameId[550001] })));
    const [psRow] = await db
      .select({ id: releaseEvents.id })
      .from(releaseEvents)
      .where(sql`${releaseEvents.gameId} = ${gameId[550001]} AND ${releaseEvents.platformId} = ${P["b55-ps"]}`);
    await db.insert(releaseDateHistory).values({
      releaseEventId: psRow.id,
      oldDate: "2034-12-31",
      oldPrecision: "year",
      newDate: "2035-03-10",
      newPrecision: "day",
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("三平台同一天合併成一張卡（平台 chip 三個）；不同天分開", async () => {
    const m = await march();
    const a = find(cardsOf(m), 550001);
    expect(a).toHaveLength(1);
    expect(a[0].platforms.map((p) => p.slug)).toEqual(["b55-pc", "b55-ps", "b55-xb"]);
    expect(a[0].releaseEventIds).toHaveLength(3);
    expect(a[0].name).toBe("測試甲");
    expect(a[0].originalName).toBe("B55 Game 550001");
    expect(a[0].coverImageId).toBe("cob550001");

    const b = find(cardsOf(m), 550002);
    expect(b.map((c) => [c.date, c.platforms.map((p) => p.slug)])).toEqual([
      ["2035-03-10", ["b55-ps"]],
      ["2035-03-12", ["b55-pc"]],
    ]);
    // 同一天依熱度高到低
    expect(m.days["2035-03-10"].map((c) => c.gameId).slice(0, 2)).toEqual([gameId[550001], gameId[550002]]);
    // en 沒有 displayNames → 原名
    const en = await march({ locale: "en" });
    expect(find(cardsOf(en), 550001)[0].name).toBe("B55 Game 550001");
  });

  it("manual 優先於 igdb；地區偏好 > WW > 最早日期；偏好地區在區間外不拿 WW 補", async () => {
    const ww = cardsOf(await march({ regionPref: "WW" }));
    expect(find(ww, 550003).map((c) => c.date)).toEqual(["2035-03-20"]);
    expect(find(ww, 550004).map((c) => c.date)).toEqual(["2035-03-15"]);
    expect(find(ww, 550005).map((c) => c.date)).toEqual(["2035-03-02"]);
    expect(find(ww, 550006).map((c) => c.date)).toEqual(["2035-03-25"]);

    const jp = cardsOf(await march({ regionPref: "jp" }));
    expect(find(jp, 550004).map((c) => c.date)).toEqual(["2035-03-07"]);
    expect(find(jp, 550006)).toEqual([]);
    const april = cardsOf(await getCalendarMonth({ year: 2035, month: 4, locale: "en", regionPref: "JP" }));
    expect(find(april, 550006).map((c) => c.date)).toEqual(["2035-04-02"]);

    // 不存在的地區 → DEFAULT_REGION_PREF（WW）
    const bogus = cardsOf(await march({ regionPref: "XX" }));
    expect(find(bogus, 550004).map((c) => c.date)).toEqual(["2035-03-15"]);
  });

  it("月精度歸該月、季精度在期間最後一個月的 undated、年精度在 12 月、tbd 不出現", async () => {
    const m = await march();
    expect(find(m.undated, 550007).map((c) => c.precision)).toEqual(["month"]);
    expect(find(m.undated, 550008).map((c) => [c.precision, c.date, c.periodStart])).toEqual([["quarter", "2035-03-31", "2035-01-01"]]);
    expect(Object.values(m.days).flat().some((c) => c.precision !== "day")).toBe(false);
    // 月 → 季 排序
    expect(b55(m.undated).map((c) => c.precision)).toEqual(["month", "quarter"]);

    const jan = await getCalendarMonth({ year: 2035, month: 1, locale: "en" });
    expect(b55(cardsOf(jan))).toEqual([]);
    const dec = await getCalendarMonth({ year: 2035, month: 12, locale: "en" });
    expect(find(dec.undated, 550009).map((c) => c.precision)).toEqual(["year"]);

    const all = await listReleaseCards({ locale: "en", from: "2035-01-01", to: "2035-12-31" });
    expect(find(all.cards, 550010)).toEqual([]);
    const withTbd = await listReleaseCards({ locale: "en", precisions: ["tbd"], filter: { platformSlugs: ["b55-pc"] } });
    expect(find(withTbd.cards, 550010).map((c) => [c.precision, c.date])).toEqual([["tbd", null]]);
  });

  it("篩選：同維度 OR、跨維度 AND；未知 slug 忽略並回報", async () => {
    const or = b55(cardsOf(await march({ filter: { platformSlugs: ["b55-xb", "b55-pc"] } })));
    expect(new Set(or.map((c) => c.gameId))).toEqual(new Set([gameId[550001], gameId[550002], gameId[550007], gameId[550008], gameId[550012], gameId[550017]]));
    // 平台篩選後的卡片只含符合的平台 chip
    expect(find(or, 550001)[0].platforms.map((p) => p.slug)).toEqual(["b55-pc", "b55-xb"]);

    const and = b55(cardsOf(await march({ filter: { platformSlugs: ["b55-ps"], genreSlugs: ["b55-rpg"] } })));
    expect(and.map((c) => c.gameId)).toEqual([gameId[550001]]);

    const genresOr = b55(cardsOf(await march({ filter: { genreSlugs: ["b55-rpg", "b55-shooter"] } })));
    expect(new Set(genresOr.map((c) => c.gameId))).toEqual(new Set([gameId[550001], gameId[550002]]));

    const kind = b55(cardsOf(await march({ filter: { platformKinds: ["pc"], genreSlugs: ["b55-shooter"] } })));
    expect(kind.map((c) => [c.gameId, c.date])).toEqual([[gameId[550002], "2035-03-12"]]);

    const unknown = await march({ filter: { platformSlugs: ["nope-console", "b55-xb"], genreSlugs: ["nope-genre"], platformKinds: ["mobile", "toaster"], stages: ["bogus"] } });
    expect(unknown.ignored).toEqual(
      expect.arrayContaining([
        { dimension: "platform", slug: "nope-console" },
        { dimension: "genre", slug: "nope-genre" },
        { dimension: "platformKind", slug: "mobile" },
        { dimension: "platformKind", slug: "toaster" },
        { dimension: "stage", slug: "bogus" },
      ]),
    );
    // genre 全部未知 → 不限制；platform 留下 b55-xb
    expect(b55(cardsOf(unknown)).map((c) => c.gameId)).toEqual([gameId[550001], gameId[550017]]);

    const r = await resolveFilterSlugs({ platformSlugs: Array.from({ length: 25 }, (_, i) => `b55-x${i}`) });
    expect(r.ignored).toHaveLength(25); // 20 個未知＋5 個超過上限
    expect(r.filter.platformIds).toBeUndefined();
  });

  it("removed 照常顯示並帶 sourceStatus（D7）；rumored 預設隱藏、cancelled 不出現、非預設類型與階段隱藏、手機平台不出現", async () => {
    const day18 = (m: CalendarMonth) => b55(m.days["2035-03-18"] ?? []).map((c) => c.gameId);
    const m = await march();
    expect(day18(m)).toEqual([gameId[550012]]);
    expect(m.days["2035-03-18"].find((c) => c.gameId === gameId[550012])?.sourceStatus).toBe("removed");
    expect(find(cardsOf(m), 550001)[0].sourceStatus).toBe("active");
    // 同鍵有 active 列 → 不拿 removed 的 WW 列
    expect(find(cardsOf(m), 550017).map((c) => [c.date, c.sourceStatus])).toEqual([["2035-03-22", "active"]]);
    expect(day18(await march({ filter: { includeRumored: true } }))).toEqual([gameId[550011], gameId[550012]]);
    expect(day18(await march({ filter: { stages: ["beta"] } }))).toEqual([gameId[550015]]);
    expect(day18(await march({ filter: { gameTypes: ["dlc_addon"] } }))).toEqual([gameId[550014]]);
    expect(day18(await march({ filter: { statuses: ["cancelled"] } }))).toEqual([gameId[550013]]);
  });

  it("月曆活動：與本月有交集者", async () => {
    const m = await march();
    expect(m.events.filter((e) => e.slug.startsWith("b55-")).map((e) => e.slug)).toEqual(["b55-march"]);
    expect(m.events.find((e) => e.slug === "b55-march")?.startTime).toBe("2035-02-28T10:00:00.000Z");
    const noEvents = await march({ includeEvents: false });
    expect(noEvents.events).toEqual([]);
  });

  it("詳情：DLC 反查、相似遊戲、同系列、連結排序、公司角色、上市日分組與改期紀錄、活動", async () => {
    const d = await getGameDetail({ slug: "B55-550001", locale: "zh-Hant", regionPref: "JP" });
    expect(d).not.toBeNull();
    if (!d) return;
    expect(d.name).toBe("測試甲");
    expect(d.originalName).toBe("B55 Game 550001");
    expect(d.platforms.map((p) => p.slug)).toEqual(["b55-pc", "b55-ps", "b55-xb"]);
    expect(d.genres).toEqual([{ slug: "b55-rpg", name: "B55-RPG" }]);

    expect(d.dlcs.map((g) => g.gameId)).toEqual([gameId[550014]]);
    expect(d.similarGames.map((g) => g.gameId)).toEqual([gameId[550021], gameId[550020]]);
    // 同系列：不含本作、不含 DLC 類型、依首發日期
    expect(d.franchises).toHaveLength(1);
    expect(d.franchises[0].games.map((g) => g.gameId)).toEqual([gameId[550020], gameId[550021]]);

    expect(d.links.map((l) => l.categoryLabel)).toEqual(["steam", "playstation_store", "xbox_store", "official_website", "twitter"]);
    expect(d.links[2].isBroken).toBe(true);

    expect(d.companies).toEqual([
      { slug: "b55-pub", name: "B55 Pub", roles: ["publisher"] },
      { slug: "b55-studio", name: "B55 Studio", roles: ["developer", "publisher"] },
    ]);
    expect(d.developers.map((c) => c.slug)).toEqual(["b55-studio"]);
    expect(d.publishers.map((c) => c.slug)).toEqual(["b55-pub", "b55-studio"]);

    const pc = d.releaseGroups.find((g) => g.platform.slug === "b55-pc");
    expect(pc?.releases.map((r) => r.regionCode)).toEqual(["JP", "WW"]); // 偏好地區在前
    const ps = d.releaseGroups.find((g) => g.platform.slug === "b55-ps");
    expect(ps?.releases[0].history).toEqual([
      expect.objectContaining({ oldDate: "2034-12-31", oldPrecision: "year", newDate: "2035-03-10", newPrecision: "day" }),
    ]);

    // COALESCE(end_time, start_time) >= now()：未來的兩個，過去的不列
    expect(d.upcomingEvents.map((e) => e.slug)).toEqual(["b55-march", "b55-future"]);

    // DLC 的本體反查；rumored 詳情可進入
    const dlc = await getGameDetail({ slug: "b55-550014", locale: "en" });
    expect(dlc?.parent?.gameId).toBe(gameId[550001]);
    const rumored = await getGameDetail({ slug: "b55-550011", locale: "en" });
    expect(rumored?.gameStatus).toBe("rumored");

    expect(await getGameDetail({ slug: "b55-does-not-exist", locale: "en" })).toBeNull();
  });

  it("篩選選項：不含 mobile；平台種類不含 mobile", async () => {
    const o = await getFilterOptions({ locale: "en", today: new Date("2035-03-15T00:00:00Z") });
    const slugs = o.platforms.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["b55-ps", "b55-xb", "b55-pc"]));
    expect(slugs).not.toContain("b55-phone");
    expect(o.platformKinds).not.toContain("mobile");
    expect(o.genres.map((g) => g.slug)).toEqual(expect.arrayContaining(["b55-rpg", "b55-shooter"]));
    expect(o.defaultStages).toEqual(["unspecified", "full", "early_access"]);
  });

  it("statement_timeout 逾時 → CatalogQueryTimeoutError", async () => {
    await expect(withReadTimeout((tx) => tx.execute(sql`SELECT pg_sleep(0.5)`), { timeoutMs: 50 })).rejects.toBeInstanceOf(
      CatalogQueryTimeoutError,
    );
    // 唯讀交易：寫入被拒
    await expect(withReadTimeout((tx) => tx.execute(sql`CREATE TEMP TABLE b55_x (id int)`))).rejects.toThrow();
  });
});
