/**
 * Phase 3b（H）平台／公司／系列頁讀取（整合）。
 * igdbId 用 83xxxx、slug 前綴 h3b-、日期用 2041 年，避免與其他測試檔撞到（同一個測試 DB 依序跑全部檔案）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/kernel/db/client";
import { getCompanyPage } from "@/modules/catalog/use-cases/read/get-company-page";
import { getFranchisePage } from "@/modules/catalog/use-cases/read/get-franchise-page";
import { getPlatformPage } from "@/modules/catalog/use-cases/read/get-platform-page";
import { listPlatforms } from "@/modules/catalog/use-cases/read/list-platforms";
import {
  companies,
  franchises,
  gameCompanies,
  gameFranchises,
  gamePlatforms,
  games,
  platformFamilies,
  platformReleaseDates,
  platforms,
  regions,
  releaseEvents,
} from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const TODAY = new Date("2041-06-15T12:00:00Z");

const ids = { platform: {} as Record<string, number>, region: {} as Record<string, number>, game: {} as Record<number, number> };

type Precision = "day" | "month" | "quarter" | "year" | "tbd";
interface Ev {
  platform: string;
  date: string | null;
  precision?: Precision;
  region?: string;
  stage?: "unspecified" | "full" | "beta";
  status?: "scheduled" | "delayed" | "released" | "cancelled";
}

async function addGame(
  igdbId: number,
  opts: { popularity?: number; gameType?: string; gameStatus?: string | null; first?: string | null; displayNames?: Record<string, string>; events?: Ev[] } = {},
) {
  const db = getDb();
  const [g] = await db
    .insert(games)
    .values({
      igdbId,
      slug: `h3b-${igdbId}`,
      name: `H3B Game ${igdbId}`,
      displayNames: opts.displayNames ?? {},
      gameType: opts.gameType ?? "main_game",
      gameStatus: opts.gameStatus ?? null,
      popularityScore: opts.popularity ?? 0,
      firstReleaseDate: opts.first ?? null,
      coverUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/h3b${igdbId}.jpg`,
    })
    .returning({ id: games.id });
  ids.game[igdbId] = g.id;
  const evs = opts.events ?? [];
  for (const p of new Set(evs.map((e) => e.platform))) await db.insert(gamePlatforms).values({ gameId: g.id, platformId: ids.platform[p] });
  for (const e of evs) {
    await db.insert(releaseEvents).values({
      gameId: g.id,
      platformId: ids.platform[e.platform],
      regionId: ids.region[e.region ?? "WW"],
      releaseDate: e.date,
      periodStart: e.date,
      precision: e.precision ?? "day",
      releaseStage: e.stage ?? "full",
      status: e.status ?? "scheduled",
    });
  }
  return g.id;
}

describe.skipIf(!enabled)("平台／公司／系列頁（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    for (const r of await db.select().from(regions)) ids.region[r.code] = r.id;
    const [fam] = await db.insert(platformFamilies).values({ igdbId: 830990, name: "H3B Family", slug: "h3b-family" }).returning({ id: platformFamilies.id });
    const plats = [
      { slug: "h3b-console", name: "H3B Console", kind: "console" as const, igdbId: 830901, generation: 9, familyId: fam.id, summary: "about", logoUrl: "https://example.com/logo.png" },
      { slug: "h3b-old", name: "H3B Old", kind: "console" as const, igdbId: 830902, generation: 3 },
      { slug: "h3b-other", name: "H3B Other", kind: "other" as const, igdbId: 830903 },
      { slug: "h3b-phone", name: "H3B Phone", kind: "mobile" as const, igdbId: 830904 },
    ];
    for (const p of plats) {
      const [row] = await db.insert(platforms).values(p).returning({ id: platforms.id });
      ids.platform[p.slug] = row.id;
    }
    await db.insert(platformReleaseDates).values([
      { platformId: ids.platform["h3b-console"], regionId: ids.region.JP, releaseDate: "2040-11-01", precision: "day" },
      { platformId: ids.platform["h3b-console"], regionId: ids.region.US, releaseDate: "2040-11-10", precision: "day" },
      { platformId: ids.platform["h3b-console"], regionId: ids.region.EU, releaseDate: null, precision: "tbd" },
    ]);

    const C = "h3b-console";
    // upcoming：日期 ≥ 今天；同遊戲多列取最早
    await addGame(830001, { popularity: 100, events: [{ platform: C, date: "2041-07-01" }, { platform: C, date: "2041-06-20", region: "JP" }] });
    await addGame(830002, { popularity: 900, events: [{ platform: C, date: "2041-08-01" }] });
    await addGame(830003, { popularity: 50, events: [{ platform: C, date: "2041-06-15" }] }); // 今天算 upcoming
    // 月精度、代表日 6/1 但月底 ≥ 今天 → upcoming
    await addGame(830004, { popularity: 10, events: [{ platform: C, date: "2041-06-01", precision: "month" }] });
    // recent：今天前 90 天內
    await addGame(830005, { popularity: 300, events: [{ platform: C, date: "2041-06-10", status: "released" }] });
    await addGame(830006, { popularity: 700, events: [{ platform: C, date: "2041-04-01", status: "released" }] });
    await addGame(830007, { events: [{ platform: C, date: "2040-01-01", status: "released" }] }); // 太舊
    // 排除：rumored、DLC、cancelled、beta、tbd、別的平台
    await addGame(830011, { gameStatus: "rumored", events: [{ platform: C, date: "2041-07-02" }] });
    await addGame(830012, { gameType: "dlc_addon", events: [{ platform: C, date: "2041-07-02" }] });
    await addGame(830013, { events: [{ platform: C, date: "2041-07-02", status: "cancelled" }] });
    await addGame(830014, { events: [{ platform: C, date: "2041-07-02", stage: "beta" }] });
    await addGame(830015, { events: [{ platform: C, date: null, precision: "tbd" }] });
    await addGame(830016, { events: [{ platform: "h3b-old", date: "2041-07-02" }] });

    // 公司
    const [co] = await db
      .insert(companies)
      .values({ igdbId: 830801, name: "H3B Studio", slug: "h3b-studio", websiteUrl: "https://example.com" })
      .returning({ id: companies.id });
    const credit = async (igdbId: number, role: "developer" | "publisher" | "porting") =>
      db.insert(gameCompanies).values({ gameId: ids.game[igdbId], companyId: co.id, role });
    await addGame(830101, { first: "2041-01-01" });
    await addGame(830102, { first: "2039-01-01" });
    await addGame(830103, { first: null });
    await addGame(830104, { first: "2041-02-01", gameType: "dlc_addon" });
    await credit(830101, "developer");
    await credit(830101, "publisher");
    await credit(830102, "publisher");
    await credit(830103, "developer");
    await credit(830104, "developer");

    // 系列：同 slug 的 franchise 與 collection
    const [fr] = await db.insert(franchises).values({ igdbId: 830701, kind: "franchise", name: "H3B Saga", slug: "h3b-saga" }).returning({ id: franchises.id });
    const [col] = await db.insert(franchises).values({ igdbId: 830701, kind: "collection", name: "H3B Saga", slug: "h3b-saga" }).returning({ id: franchises.id });
    await addGame(830201, { first: "2030-05-01", displayNames: { "zh-Hant": "傳說一" } });
    await addGame(830202, { first: "2020-05-01" });
    await addGame(830203, { first: null });
    await addGame(830204, { first: "2025-01-01", gameType: "dlc_addon" });
    for (const g of [830201, 830202, 830203, 830204]) await db.insert(gameFranchises).values({ gameId: ids.game[g], franchiseId: fr.id });
    await db.insert(gameFranchises).values({ gameId: ids.game[830202], franchiseId: col.id });
  });

  afterAll(async () => {
    await closeDb();
  });

  // ── 平台 ──
  it("listPlatforms：依 kind 分組、mobile 不列、other 在最後、帶 family", async () => {
    const groups = await listPlatforms({ locale: "en", today: TODAY });
    const kinds = groups.map((g) => g.kind);
    expect(kinds).not.toContain("mobile");
    expect(kinds.at(-1)).toBe("other");
    const consoles = groups.find((g) => g.kind === "console")!.platforms.filter((p) => p.slug.startsWith("h3b-"));
    expect(consoles.map((p) => p.slug)).toEqual(["h3b-console", "h3b-old"]); // 世代新到舊
    expect(consoles[0].family).toEqual({ slug: "h3b-family", name: "H3B Family" });
    expect(consoles[0].isCommon).toBe(false);
    expect(consoles[0].recentReleaseCount).toBeGreaterThan(5);
    const all = groups.flatMap((g) => g.platforms.map((p) => p.slug));
    expect(all).toContain("h3b-other");
    expect(all).not.toContain("h3b-phone");
  });

  it("getPlatformPage：平台資訊與 platform_release_dates", async () => {
    const page = await getPlatformPage({ slug: "h3b-console", locale: "en", today: TODAY });
    expect(page).not.toBeNull();
    const p = page!.platform;
    expect(p).toMatchObject({ slug: "h3b-console", kind: "console", generation: 9, summary: "about", logoUrl: "https://example.com/logo.png", discontinuedOn: null });
    expect(p.releaseDates).toEqual([
      { regionCode: "JP", date: "2040-11-01", precision: "day" },
      { regionCode: "US", date: "2040-11-10", precision: "day" },
      { regionCode: "EU", date: null, precision: "tbd" },
    ]);
    expect(page!.section).toBe("upcoming");
    expect(page!.sort).toBe("date");
  });

  it("getPlatformPage upcoming：依該平台日期舊到新、每款一次、排除項不列", async () => {
    const page = await getPlatformPage({ slug: "h3b-console", locale: "en", today: TODAY });
    const items = page!.games.items;
    expect(items.map((g) => [g.slug, g.date, g.precision])).toEqual([
      ["h3b-830004", "2041-06-01", "month"],
      ["h3b-830003", "2041-06-15", "day"],
      ["h3b-830001", "2041-07-01", "day"],
      ["h3b-830002", "2041-08-01", "day"],
    ]);
    expect(items[0].cover?.original).toContain("h3b830004");
    expect(page!.games.hasMore).toBe(false);
  });

  it("getPlatformPage popularity 排序與分頁（hasMore）", async () => {
    const p1 = await getPlatformPage({ slug: "h3b-console", locale: "en", today: TODAY, sort: "popularity", limit: 2 });
    expect(p1!.games.items.map((g) => g.slug)).toEqual(["h3b-830002", "h3b-830001"]);
    expect(p1!.games.hasMore).toBe(true);
    const p2 = await getPlatformPage({ slug: "h3b-console", locale: "en", today: TODAY, sort: "popularity", limit: 2, offset: 2 });
    expect(p2!.games.items.map((g) => g.slug)).toEqual(["h3b-830003", "h3b-830004"]);
    expect(p2!.games.hasMore).toBe(false);
  });

  it("getPlatformPage recent：今天前 90 天、新到舊", async () => {
    const page = await getPlatformPage({ slug: "h3b-console", locale: "en", today: TODAY, section: "recent" });
    expect(page!.section).toBe("recent");
    expect(page!.games.items.map((g) => g.slug)).toEqual(["h3b-830005", "h3b-830006"]);
  });

  it("getPlatformPage：不存在／mobile → null；未知 section/sort → 預設", async () => {
    expect(await getPlatformPage({ slug: "h3b-nope", locale: "en", today: TODAY })).toBeNull();
    expect(await getPlatformPage({ slug: "h3b-phone", locale: "en", today: TODAY })).toBeNull();
    const p = await getPlatformPage({ slug: "H3B-Console", locale: "en", today: TODAY, section: "x", sort: "y" });
    expect([p!.section, p!.sort]).toEqual(["upcoming", "date"]);
  });

  // ── 公司 ──
  it("getCompanyPage：作品依首發日新到舊（未定最後）、角色合併、DLC 不列、角色計數", async () => {
    const page = await getCompanyPage({ slug: "h3b-studio", locale: "en" });
    expect(page!.company).toEqual({ slug: "h3b-studio", name: "H3B Studio", logo: null, logoUrl: null, websiteUrl: "https://example.com" });
    expect(page!.role).toBeNull();
    expect(page!.works.items.map((w) => [w.slug, w.roles])).toEqual([
      ["h3b-830101", ["developer", "publisher"]],
      ["h3b-830102", ["publisher"]],
      ["h3b-830103", ["developer"]],
    ]);
    expect(page!.total).toBe(3);
    expect(page!.roleCounts).toEqual({ developer: 2, publisher: 2, porting: 0, supporting: 0 });
  });

  it("getCompanyPage：角色篩選、分頁、不存在 → null、未知角色＝全部", async () => {
    const pub = await getCompanyPage({ slug: "h3b-studio", locale: "en", role: "publisher", limit: 1 });
    expect(pub!.role).toBe("publisher");
    expect(pub!.works.items.map((w) => w.slug)).toEqual(["h3b-830101"]);
    expect(pub!.works.items[0].roles).toEqual(["developer", "publisher"]);
    expect(pub!.works.hasMore).toBe(true);
    expect(await getCompanyPage({ slug: "h3b-none", locale: "en" })).toBeNull();
    const all = await getCompanyPage({ slug: "h3b-studio", locale: "en", role: "boss" });
    expect(all!.role).toBeNull();
  });

  // ── 系列 ──
  it("getFranchisePage：franchise 優先、首發日舊到新（未定最後）、DLC 不列、locale 名稱、otherKinds", async () => {
    const page = await getFranchisePage({ slug: "h3b-saga", locale: "zh-Hant" });
    expect(page!.franchise).toEqual({ slug: "h3b-saga", name: "H3B Saga", kind: "franchise", otherKinds: ["collection"] });
    expect(page!.total).toBe(3);
    expect(page!.games.items.map((g) => g.slug)).toEqual(["h3b-830202", "h3b-830201", "h3b-830203"]);
    expect(page!.games.items[1].name).toBe("傳說一");
    expect(page!.games.items[1].gameStatus).toBeNull();
  });

  it("getFranchisePage：kind=collection、不存在 → null", async () => {
    const col = await getFranchisePage({ slug: "h3b-saga", locale: "en", kind: "collection" });
    expect(col!.franchise).toMatchObject({ kind: "collection", otherKinds: ["franchise"] });
    expect(col!.games.items.map((g) => g.slug)).toEqual(["h3b-830202"]);
    expect(await getFranchisePage({ slug: "h3b-none", locale: "en" })).toBeNull();
  });
});
