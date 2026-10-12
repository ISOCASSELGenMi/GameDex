import { describe, expect, it, vi } from "vitest";
import {
  isDelay,
  nextReleaseStatus,
  periodEnd,
  planReleaseEventDiff,
  type DesiredRelease,
  type ExistingReleaseRow,
} from "@/modules/catalog/domain/release-diff";
import { buildSearchText, tokenizeForSearch } from "@/modules/catalog/domain/search-text";
import { buildGamesWhere, toGameRecord } from "@/modules/catalog/providers/igdb";
import {
  mapGameStatus,
  mapGameType,
  mapLanguageCode,
  mapLocalizationRegion,
  mapReleaseStage,
} from "@/modules/catalog/providers/igdb/game-mappings";
import { buildGameLinks, steamAppIdOf } from "@/modules/catalog/providers/igdb/link-map";
import { firstRelease, isMobileOnly, toDesiredReleases } from "@/modules/catalog/use-cases/sync/sync-games";

const TODAY = "2026-10-12";
const day = (d: string) => ({ releaseDate: d, periodStart: d, precision: "day" as const });
const month = (ym: string) => ({ releaseDate: `${ym}-01`, periodStart: `${ym}-01`, precision: "month" as const });
const quarter = (start: string, end: string) => ({ releaseDate: end, periodStart: start, precision: "quarter" as const });
const tbd = { releaseDate: null, periodStart: null, precision: "tbd" as const };

function want(over: Partial<DesiredRelease> = {}): DesiredRelease {
  return { platformId: 1, regionId: 1, releaseStage: "full", ...day("2027-03-01"), cancelled: false, ...over };
}
let nextId = 1;
function have(over: Partial<ExistingReleaseRow> = {}): ExistingReleaseRow {
  return {
    id: nextId++,
    platformId: 1,
    regionId: 1,
    releaseStage: "full",
    ...day("2027-03-01"),
    status: "scheduled",
    sourceStatus: "active",
    sequence: 0,
    ...over,
  };
}
const opts = { today: TODAY, gameCancelled: false };

describe("日期期間與延期判斷", () => {
  it("periodEnd：month 取月底（含閏年）、quarter／year 用代表日期、tbd 為 null", () => {
    expect(periodEnd(month("2028-02"))).toBe("2028-02-29");
    expect(periodEnd(month("2027-11"))).toBe("2027-11-30");
    expect(periodEnd(quarter("2027-10-01", "2027-12-31"))).toBe("2027-12-31");
    expect(periodEnd(day("2027-01-05"))).toBe("2027-01-05");
    expect(periodEnd(tbd)).toBeNull();
  });
  it("isDelay：落在舊期間之後、精度變粗、變 tbd 為延期；期間內精確化與提前不是", () => {
    expect(isDelay(day("2027-03-01"), day("2027-03-02"))).toBe(true);
    expect(isDelay(day("2027-03-01"), day("2027-02-01"))).toBe(false);
    expect(isDelay(month("2027-11"), day("2027-11-20"))).toBe(false); // 期間內精確化
    expect(isDelay(month("2027-11"), day("2027-12-03"))).toBe(true);
    expect(isDelay(day("2027-11-20"), quarter("2027-10-01", "2027-12-31"))).toBe(true); // 精度變粗
    expect(isDelay(day("2027-11-20"), tbd)).toBe(true);
    expect(isDelay(tbd, day("2027-11-20"))).toBe(false);
  });
});

describe("nextReleaseStatus", () => {
  it("新列：未來 scheduled、day 已過 released、取消 cancelled；模糊日期已過不自動轉", () => {
    expect(nextReleaseStatus(null, day("2027-01-01"), false, TODAY)).toBe("scheduled");
    expect(nextReleaseStatus(null, day("2026-10-12"), false, TODAY)).toBe("released");
    expect(nextReleaseStatus(null, month("2026-01"), false, TODAY)).toBe("scheduled");
    expect(nextReleaseStatus(null, day("2027-01-01"), true, TODAY)).toBe("cancelled");
  });
  it("cancelled 復原回 scheduled；延期後提前回 scheduled", () => {
    const prev = { ...day("2027-01-01"), status: "cancelled" as const };
    expect(nextReleaseStatus(prev, day("2027-01-01"), false, TODAY)).toBe("scheduled");
    const delayed = { ...day("2027-05-01"), status: "delayed" as const };
    expect(nextReleaseStatus(delayed, day("2027-04-01"), false, TODAY)).toBe("scheduled");
    expect(nextReleaseStatus(delayed, day("2027-05-01"), false, TODAY)).toBe("delayed");
  });
});

describe("planReleaseEventDiff", () => {
  it("新增、未變、延期（dateChanged＋delayed）", () => {
    const a = have({ platformId: 1 });
    const b = have({ platformId: 2 });
    const plan = planReleaseEventDiff(
      [a, b],
      [want({ platformId: 1 }), want({ platformId: 2, ...day("2027-06-01") }), want({ platformId: 3 })],
      opts,
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.creates).toEqual([expect.objectContaining({ platformId: 3, status: "scheduled" })]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({
      before: { id: b.id },
      after: { releaseDate: "2027-06-01", status: "delayed" },
      dateChanged: true,
      statusChanged: true,
    });
  });

  it("來源拿掉 → removed（不改 status）；再出現 → restored", () => {
    const gone = have();
    const removed = planReleaseEventDiff([gone], [], opts);
    expect(removed.updates[0]).toMatchObject({
      after: { sourceStatus: "removed", status: "scheduled" },
      sourceStatusChanged: true,
      dateChanged: false,
      statusChanged: false,
    });
    const back = planReleaseEventDiff([{ ...gone, sourceStatus: "removed" }], [want()], opts);
    expect(back.updates[0]).toMatchObject({ after: { sourceStatus: "active" }, sourceStatusChanged: true });
    // 已經是 removed 又沒出現 → 不重複標
    expect(planReleaseEventDiff([{ ...gone, sourceStatus: "removed" }], [], opts)).toMatchObject({ updates: [], unchanged: 1 });
  });

  it("同一 (平台, 地區) 的搶先體驗與正式版並存", () => {
    const plan = planReleaseEventDiff(
      [],
      [want({ releaseStage: "early_access", ...day("2026-01-01") }), want({ releaseStage: "full", ...day("2027-01-01") })],
      opts,
    );
    expect(plan.creates.map((c) => [c.releaseStage, c.status])).toEqual(
      expect.arrayContaining([
        ["early_access", "released"],
        ["full", "scheduled"],
      ]),
    );
    expect(plan.creates).toHaveLength(2);
  });

  it("例外：原本只有一筆 unspecified，來源改給具體階段 → 同一筆更新（不是新增＋removed）", () => {
    const only = have({ releaseStage: "unspecified" });
    const plan = planReleaseEventDiff([only], [want({ releaseStage: "full" })], opts);
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([
      expect.objectContaining({ before: only, stageChanged: true, after: expect.objectContaining({ releaseStage: "full" }) }),
    ]);
  });

  it("例外不適用：該處有兩筆既有列，或來源仍有 unspecified", () => {
    const u = have({ releaseStage: "unspecified" });
    const ea = have({ releaseStage: "early_access" });
    const p1 = planReleaseEventDiff([u, ea], [want({ releaseStage: "early_access" }), want({ releaseStage: "full" })], opts);
    expect(p1.creates.map((c) => c.releaseStage)).toEqual(["full"]);
    expect(p1.updates.find((x) => x.before.id === u.id)?.after.sourceStatus).toBe("removed");

    const p2 = planReleaseEventDiff([u], [want({ releaseStage: "unspecified" }), want({ releaseStage: "full" })], opts);
    expect(p2.creates.map((c) => c.releaseStage)).toEqual(["full"]);
    expect(p2.unchanged).toBe(1);
  });

  it("來源同 slot 多筆只採一筆：非取消優先、其次最早", () => {
    const plan = planReleaseEventDiff(
      [],
      [want({ ...day("2027-05-01") }), want({ ...day("2027-04-01"), cancelled: true }), want({ ...day("2027-06-01") })],
      opts,
    );
    expect(plan.duplicatesDropped).toBe(2);
    expect(plan.creates).toEqual([expect.objectContaining({ releaseDate: "2027-05-01", status: "scheduled" })]);
  });

  it("遊戲層級 cancelled：未過期（含 tbd）標 cancelled，已過期的不動", () => {
    const plan = planReleaseEventDiff(
      [],
      [want({ platformId: 1, ...day("2027-01-01") }), want({ platformId: 2, ...day("2020-01-01") }), want({ platformId: 3, ...tbd })],
      { today: TODAY, gameCancelled: true },
    );
    expect(plan.creates.map((c) => [c.platformId, c.status])).toEqual([
      [1, "cancelled"],
      [2, "released"],
      [3, "cancelled"],
    ]);
  });
});

describe("搜尋字串", () => {
  it("NFKC＋小寫；連續 CJK 拆 bigram，拉丁文不變；單一 CJK 字保留", () => {
    expect(tokenizeForSearch("薩爾達傳說 王國之淚")).toBe("薩爾 爾達 達傳 傳說 王國 國之 之淚");
    expect(tokenizeForSearch("ELDEN RING エルデンリング")).toBe("elden ring エル ルデ デン ンリ リン ング");
    expect(tokenizeForSearch("ＦＦ７ 重製")).toBe("ff7 重製");
    expect(tokenizeForSearch("龍")).toBe("龍");
    expect(tokenizeForSearch("Pokémon  Legends")).toBe("pokémon legends");
  });
  it("buildSearchText 去重、略過空值", () => {
    expect(buildSearchText(["Elden Ring", "ELDEN RING", null, "", "艾爾登法環"])).toBe("elden ring 艾爾 爾登 登法 法環");
  });
});

describe("IGDB 遊戲對照", () => {
  it("上市階段：5 Cancelled → unspecified＋cancelled；空值與未知 → unspecified", () => {
    expect(mapReleaseStage(6).value).toEqual({ stage: "full", cancelled: false });
    expect(mapReleaseStage(3).value.stage).toBe("early_access");
    expect(mapReleaseStage(35).value.stage).toBe("other");
    expect(mapReleaseStage(5).value).toEqual({ stage: "unspecified", cancelled: true });
    expect(mapReleaseStage(undefined)).toEqual({ value: { stage: "unspecified", cancelled: false }, unmapped: false });
    expect(mapReleaseStage(99)).toEqual({ value: { stage: "unspecified", cancelled: false }, unmapped: true });
  });
  it("game_type／game_status／語言碼／在地化地區", () => {
    expect(mapGameType(13).value).toBe("pack");
    expect(mapGameType(99)).toEqual({ value: "other", unmapped: true });
    expect(mapGameStatus(7).value).toBe("rumored");
    expect(mapGameStatus(null).value).toBeNull();
    expect(mapLanguageCode("zh-TW", "Chinese (Traditional)", 3)).toBe("zh-Hant");
    expect(mapLanguageCode("zh-CN", "Chinese (Simplified)", 2)).toBe("zh-Hans");
    expect(mapLanguageCode("pt-BR", "Portuguese (Brazil)", 21)).toBe("pt-BR");
    expect(mapLanguageCode(undefined, "Old Norse", 99)).toBe("old-norse");
    expect(mapLocalizationRegion(3).value).toBe("ja");
    expect(mapLocalizationRegion(4)).toEqual({ value: null, unmapped: false });
    expect(mapLocalizationRegion(9).unmapped).toBe(true);
  });

  it("連結：websites 優先、以分類去重、沒網址略過、未收錄 → other 並回報；121 略過", () => {
    const { links, unmapped } = buildGameLinks(
      [
        { type: 13, url: "https://store.steampowered.com/app/1/slug" },
        { type: 1, url: "https://example.com" },
        { type: 99, url: "https://weird.example" },
        { type: 5, url: "" },
      ],
      [
        { external_game_source: 1, url: "https://store.steampowered.com/app/1", uid: "1" },
        { external_game_source: 20, url: "https://amazon.com/dp/X" },
        { external_game_source: 20 },
        { external_game_source: 121, url: "https://igdb.com/x" },
        { external_game_source: 36, url: "https://store.playstation.com/x" },
      ],
    );
    expect(links.map((l) => [l.categoryLabel, l.linkType, l.igdbOrigin])).toEqual([
      ["steam", "store", "website"],
      ["official_website", "official", "website"],
      ["other", "official", "website"],
      ["playstation_store", "store", "external_game"],
    ]);
    expect(links[0].url).toBe("https://store.steampowered.com/app/1/slug");
    expect(unmapped).toEqual([
      { origin: "website", id: 99 },
      { origin: "external_game", id: 20 },
    ]);
    expect(steamAppIdOf([{ external_game_source: 20, uid: "B0" }, { external_game_source: 1, uid: " 1245620 " }])).toBe("1245620");
  });

  it("toGameRecord：核心欄位、公司角色合併、系列兩種、分數 0 不算、截圖前 6 張", () => {
    const warn = vi.fn();
    const ts = (s: string) => Date.parse(s) / 1000;
    const rec = toGameRecord(
      {
        id: 52189,
        name: "Grand Theft Auto VI",
        slug: "grand-theft-auto-vi",
        cover: { image_id: "cocv1v" },
        game_type: 0,
        updated_at: 1791725294,
        aggregated_rating: 0,
        aggregated_rating_count: 0,
        platforms: [169, 167, 167],
        release_dates: [
          { date: ts("2026-11-19T00:00:00Z"), date_format: 0, platform: 169, release_region: 8, status: 6 },
          { date: ts("2026-12-31T00:00:00Z"), date_format: 6, platform: 167, release_region: 2 },
          { date_format: 7, platform: 6, release_region: 99, status: 5 },
        ],
        involved_companies: [
          { company: { id: 29, name: "Rockstar Games", slug: "rockstar-games" }, developer: true, publisher: false },
          { company: { id: 29, name: "Rockstar Games", slug: "rockstar-games" }, publisher: true },
        ],
        franchises: [{ id: 493, name: "Grand Theft Auto", slug: "grand-theft-auto" }],
        collections: [{ id: 847, name: "Grand Theft Auto", slug: "grand-theft-auto" }],
        screenshots: Array.from({ length: 8 }, (_, i) => ({ image_id: `s${i}` })),
        videos: [{}, { video_id: "QdBZY2fkU-0" }],
        alternative_names: [{ name: "GTA 6", comment: "Acronym" }, { name: " " }],
        game_localizations: [{ name: "グランド・セフト・オートVI", region: 3 }, { name: "Europe name", region: 4 }],
        language_supports: [
          { language: { id: 3, locale: "zh-TW", name: "Chinese (Traditional)", native_name: "繁體中文" }, language_support_type: 2 },
          { language: { id: 3, locale: "zh-TW", name: "Chinese (Traditional)" }, language_support_type: 2 },
        ],
      },
      warn,
    );
    expect(rec).toMatchObject({
      igdbId: 52189,
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/cocv1v.jpg",
      gameType: "main_game",
      gameStatus: null,
      criticScore: null,
      platformIgdbIds: [169, 167],
      trailerUrl: "https://www.youtube.com/watch?v=QdBZY2fkU-0",
      alternativeNames: [{ name: "GTA 6", comment: "Acronym" }],
      localizations: [{ localeCode: "ja", name: "グランド・セフト・オートVI", coverUrl: null }],
      languageSupports: [
        { language: { igdbId: 3, code: "zh-Hant", nativeName: "繁體中文" }, supportType: "subtitles" },
      ],
    });
    expect(rec.sourceUpdatedAt?.toISOString()).toBe("2026-10-11T13:28:14.000Z");
    expect(rec.screenshotUrls).toHaveLength(6);
    expect(rec.companies).toEqual([
      { company: { igdbId: 29, name: "Rockstar Games", slug: "rockstar-games" }, roles: ["developer", "publisher"] },
    ]);
    expect(rec.franchises.map((f) => [f.kind, f.igdbId])).toEqual([
      ["franchise", 493],
      ["collection", 847],
    ]);
    expect(rec.releaseDates.map((r) => [r.platformIgdbId, r.regionCode, r.stage, r.cancelled, r.precision, r.releaseDate])).toEqual([
      [169, "WW", "full", false, "day", "2026-11-19"],
      [167, "US", "unspecified", false, "quarter", "2026-12-31"],
      [6, "WW", "unspecified", true, "tbd", null],
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("分數只在 count > 0 時有值；四捨五入", () => {
    expect(toGameRecord({ id: 1, aggregated_rating: 96.9, aggregated_rating_count: 10 }).criticScore).toEqual({
      score: 97,
      reviewCount: 10,
    });
    expect(toGameRecord({ id: 1, aggregated_rating: 80 }).criticScore).toBeNull();
  });

  it("buildGamesWhere 組合條件", () => {
    expect(buildGamesWhere({ limit: 500 })).toBeNull();
    expect(buildGamesWhere({ updatedSince: new Date("2026-10-12T00:00:00Z"), afterId: 42, limit: 500 })).toBe(
      "updated_at > 1791763200 & id > 42",
    );
    expect(buildGamesWhere({ ids: [1, 2], limit: 500 })).toBe("id = (1,2)");
  });
});

describe("sync-games 的轉換", () => {
  const ctx = {
    platforms: new Map([
      [167, { id: 10, kind: "console" }],
      [39, { id: 11, kind: "mobile" }],
    ]),
    regionIds: new Map([
      ["WW", 1],
      ["US", 2],
    ]),
  };
  const base = toGameRecord({ id: 1, platforms: [167, 39] });

  it("手機平台的上市日不寫入；未知平台略過並回報", () => {
    const unknown = new Set<number>();
    const rec = {
      ...base,
      releaseDates: [
        { ...day("2027-01-01"), platformIgdbId: 167, regionCode: "US", stage: "full" as const, cancelled: false },
        { ...day("2027-01-01"), platformIgdbId: 39, regionCode: "WW", stage: "full" as const, cancelled: false },
        { ...day("2027-01-01"), platformIgdbId: 999, regionCode: "WW", stage: "full" as const, cancelled: false },
      ],
    };
    expect(toDesiredReleases(rec, ctx, unknown)).toEqual([
      expect.objectContaining({ platformId: 10, regionId: 2, releaseStage: "full" }),
    ]);
    expect([...unknown]).toEqual([999]);
  });

  it("只上手機的遊戲不收；沒有平台資料照收", () => {
    expect(isMobileOnly({ ...base, platformIgdbIds: [39] }, ctx)).toBe(true);
    expect(isMobileOnly({ ...base, platformIgdbIds: [39, 167] }, ctx)).toBe(false);
    expect(isMobileOnly({ ...base, platformIgdbIds: [] }, ctx)).toBe(false);
  });

  it("firstRelease：最早一筆、不含取消；只有 tbd → (null, tbd)", () => {
    expect(
      firstRelease([
        want({ ...day("2027-02-01") }),
        want({ ...month("2027-01") }),
        want({ ...day("2026-12-01"), cancelled: true }),
      ]),
    ).toEqual({ date: "2027-01-01", precision: "month" });
    expect(firstRelease([want({ ...tbd })])).toEqual({ date: null, precision: "tbd" });
    expect(firstRelease([])).toEqual({ date: null, precision: null });
  });
});
