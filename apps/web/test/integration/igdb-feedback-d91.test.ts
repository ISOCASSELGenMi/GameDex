/**
 * D91 待回饋 IGDB 清單（12 §待回饋 IGDB 清單）整合測試：
 * - 核可六種回報各自在同一個 transaction 建出正確快照；duplicate／takedown／other／駁回不建；核可失敗不留項目；重複核可不重複建
 * - localized_title：核可後 game_localizations(manual)、display_names、search_text 更新；覆蓋時舊值記在項目；sync 不覆蓋 manual
 * - markAdoptedFeedback：六種欄位的採納／未採納；skipped 不動；submitted 會標；沒有項目時回 0
 * - 同步寫入路徑（syncGames）會順手偵測採納
 * - list／update use case（狀態轉換、adopted 不動、備註上限）
 * igdbId 930xxx、slug 前綴 fbd91-。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import type { GameRecord } from "@/modules/catalog";
import { listIgdbFeedback, resolveReport, updateIgdbFeedback } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { markAdoptedFeedback } from "@/modules/catalog/repository/igdb-feedback";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { tokenizeForSearch } from "@/modules/catalog/domain/search-text";
import {
  dataReports,
  gameLanguageSupports,
  gameLocalizations,
  gamePlatforms,
  games,
  igdbFeedbackItems,
  languages,
  regions,
  releaseEvents,
} from "@/modules/catalog/schema";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

describe.skipIf(!enabled)("待回饋 IGDB 清單（整合）", () => {
  const regionId: Record<string, number> = {};
  let ps5 = 0;
  let gameA = 0; // igdb WW full 2037-05-10、JP beta 2037-06-01
  let releaseWW = 0;
  let releaseJP = 0;
  let langId = 0;

  const db = () => getDb();
  const mkGame = async (igdbId: number, slug: string, extra: Partial<typeof games.$inferInsert> = {}) => {
    const [g] = await db().insert(games).values({ igdbId, slug, name: `Fbd91 ${slug}`, ...extra }).returning({ id: games.id });
    await db().insert(gamePlatforms).values({ gameId: g.id, platformId: ps5 });
    return g.id;
  };
  const mkRelease = async (gameId: number, region: string, over: Partial<typeof releaseEvents.$inferInsert> = {}) => {
    const [r] = await db()
      .insert(releaseEvents)
      .values({
        gameId, platformId: ps5, regionId: regionId[region], releaseStage: "full", releaseDate: "2037-05-10", periodStart: "2037-05-10",
        precision: "day", status: "scheduled", source: "igdb", sequence: 1, ...over,
      })
      .returning({ id: releaseEvents.id });
    return r.id;
  };
  const mkReport = async (over: Partial<typeof dataReports.$inferInsert> = {}) => {
    const [r] = await db()
      .insert(dataReports)
      .values({ targetType: "game", targetId: gameA, reportType: "other", status: "open", sourceUrl: "https://example.com/src", note: "備註", ...over })
      .returning({ id: dataReports.id });
    return r.id;
  };
  const itemOf = async (reportId: number) => (await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.reportId, reportId)))[0];
  const accept = async (over: Partial<typeof dataReports.$inferInsert>) => {
    const id = await mkReport(over);
    const res = await resolveReport(id, "accept");
    expect(res).toMatchObject({ ok: true });
    return { id, item: await itemOf(id) };
  };

  beforeAll(async () => {
    for (const r of await db().select().from(regions)) regionId[r.code] = r.id;
    ps5 = (await upsertPlatform({ igdbId: 930001, slug: "fbd91-ps5", name: "Fbd91 PS5", kind: "console" })).id;
    gameA = await mkGame(930101, "fbd91-a");
    releaseWW = await mkRelease(gameA, "WW");
    releaseJP = await mkRelease(gameA, "JP", { releaseStage: "beta", releaseDate: "2037-06-01", periodStart: "2037-06-01" });
    const [l] = await db().insert(languages).values({ code: "fbd91-zz", name: "Fbd91 Lang" }).returning({ id: languages.id });
    langId = l.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("核可時建立項目（快照）", () => {
    it("wrong_date：舊值＝被取代的 igdb 列，新值＝提案日期與精度", async () => {
      const { id, item } = await accept({
        reportType: "wrong_date", targetType: "release_event", targetId: releaseWW,
        proposed: { date: "2037-08-15", precision: "month" },
      });
      expect(item).toMatchObject({
        reportId: id, gameId: gameA, igdbGameId: 930101, gameSlug: "fbd91-a", field: "release_date",
        platformId: ps5, regionCode: "WW", stage: "full", status: "pending",
        oldValue: { date: "2037-05-10", precision: "day" },
        newValue: { date: "2037-08-01", precision: "month" }, // 月精度的代表日期是當月第一天
        sourceUrl: "https://example.com/src", reporterNote: "備註", handlerNote: null, adoptedAt: null,
      });
    });

    it("missing_region_date：該地區沒有 igdb 列 → 舊值 null；有 igdb 列 → 舊值是它", async () => {
      const tw = await accept({
        reportType: "missing_region_date", proposed: { platformId: ps5, regionCode: "TW", date: "2037-05-12", precision: "day", stage: "full" },
      });
      expect(tw.item).toMatchObject({ field: "region_date", platformId: ps5, regionCode: "TW", stage: "full", oldValue: null, newValue: { date: "2037-05-12", precision: "day" } });
      const jp = await accept({
        reportType: "missing_region_date", proposed: { platformId: ps5, regionCode: "JP", date: "2037-06-20", precision: "day", stage: "beta" },
      });
      expect(jp.item).toMatchObject({ field: "region_date", regionCode: "JP", stage: "beta", oldValue: { date: "2037-06-01", precision: "day" }, newValue: { date: "2037-06-20", precision: "day" } });
    });

    it("已有 manual 列時，舊值仍取 igdb 列（不是被取代的 manual 列）", async () => {
      const first = await accept({ reportType: "wrong_date", targetType: "release_event", targetId: releaseJP, proposed: { date: "2037-07-01", precision: "day" } });
      expect(first.item?.oldValue).toEqual({ date: "2037-06-01", precision: "day" });
      const second = await accept({ reportType: "wrong_date", targetType: "release_event", targetId: releaseJP, proposed: { date: "2037-07-09", precision: "day" } });
      expect(second.item?.oldValue).toEqual({ date: "2037-06-01", precision: "day" });
    });

    it("wrong_stage：舊值＝目前階段，定位到該上市列", async () => {
      const { item } = await accept({ reportType: "wrong_stage", targetType: "release_event", targetId: releaseWW, proposed: { stage: "early_access" } });
      expect(item).toMatchObject({ field: "stage", platformId: ps5, regionCode: "WW", stage: "full", oldValue: { stage: "full" }, newValue: { stage: "early_access" } });
    });

    it("language_support：舊值 null，新值＝語言＋支援類型", async () => {
      const { item } = await accept({ reportType: "language_support", proposed: { language: "fbd91-zz", supportType: "subtitles" } });
      expect(item).toMatchObject({ field: "language_support", platformId: null, regionCode: null, stage: null, oldValue: null, newValue: { language: "fbd91-zz", supportType: "subtitles" } });
    });

    it("cancelled：目標是上市事件 → 該列狀態；目標是遊戲 → 遊戲狀態（無則 null）", async () => {
      const ev = await accept({ reportType: "cancelled", targetType: "release_event", targetId: releaseWW });
      expect(ev.item).toMatchObject({ field: "cancelled", platformId: ps5, regionCode: "WW", stage: "full", oldValue: { status: "scheduled" }, newValue: { status: "cancelled" } });
      const gm = await accept({ reportType: "cancelled", targetType: "game", targetId: gameA });
      expect(gm.item).toMatchObject({ field: "cancelled", platformId: null, regionCode: null, stage: null, oldValue: { status: null }, newValue: { status: "cancelled" } });
    });

    it("duplicate／takedown／other 核可、任何類型駁回：都不建項目", async () => {
      for (const reportType of ["duplicate", "takedown", "other"] as const) {
        const id = await mkReport({ reportType });
        expect(await resolveReport(id, "accept")).toMatchObject({ ok: true, feedbackItemId: null });
        expect(await itemOf(id)).toBeUndefined();
      }
      const rej = await mkReport({ reportType: "language_support", proposed: { language: "fbd91-zz", supportType: "audio" } });
      expect(await resolveReport(rej, "reject")).toMatchObject({ ok: true });
      expect(await itemOf(rej)).toBeUndefined();
    });

    it("核可失敗（cannot_apply）不留項目、回報維持 open；重複核可不重複建", async () => {
      const g = await mkGame(930102, "fbd91-gone");
      const id = await mkReport({
        targetId: g, reportType: "missing_region_date", proposed: { platformId: ps5, regionCode: "TW", date: "2037-05-12", precision: "day" },
      });
      await db().delete(games).where(eq(games.id, g));
      expect(await resolveReport(id, "accept")).toEqual({ ok: false, error: "cannot_apply", detail: "target_missing" });
      expect(await itemOf(id)).toBeUndefined();
      expect((await db().select().from(dataReports).where(eq(dataReports.id, id)))[0].status).toBe("open");

      const ok = await mkReport({ reportType: "language_support", proposed: { language: "fbd91-zz", supportType: "interface" } });
      expect(await resolveReport(ok, "accept")).toMatchObject({ ok: true, feedbackItemId: expect.any(Number) });
      expect(await resolveReport(ok, "accept")).toEqual({ ok: false, error: "already_resolved" });
      expect(await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.reportId, ok))).toHaveLength(1);
    });
  });

  describe("localized_title", () => {
    it("核可：寫 manual zh-Hant、重算 display_names 與 search_text；再次核可覆蓋並記舊值；sync 不覆蓋 manual", async () => {
      const gid = await mkGame(930150, "fbd91-title");
      const first = await accept({ targetId: gid, reportType: "localized_title", sourceUrl: null, proposed: { title: "  測試遊戲一  ", locale: "zh-Hant" } });
      expect(first.item).toMatchObject({ field: "localized_title", gameId: gid, oldValue: { title: null }, newValue: { title: "測試遊戲一" }, sourceUrl: null });
      const [loc] = await db().select().from(gameLocalizations).where(and(eq(gameLocalizations.gameId, gid), eq(gameLocalizations.localeCode, "zh-Hant")));
      expect(loc).toMatchObject({ name: "測試遊戲一", source: "manual" });
      let [g] = await db().select().from(games).where(eq(games.id, gid));
      expect(g.displayNames).toMatchObject({ "zh-Hant": "測試遊戲一" });
      expect(g.searchText).toContain(tokenizeForSearch("測試遊戲一"));

      const second = await accept({ targetId: gid, reportType: "localized_title", proposed: { title: "測試遊戲二", locale: "zh-Hant" } });
      expect(second.item).toMatchObject({ oldValue: { title: "測試遊戲一" }, newValue: { title: "測試遊戲二" } });
      [g] = await db().select().from(games).where(eq(games.id, gid));
      expect(g.displayNames).toMatchObject({ "zh-Hant": "測試遊戲二" });
      expect(g.searchText).toContain(tokenizeForSearch("測試遊戲二"));

      // 同步（IGDB 沒有該名稱）不覆蓋 manual
      const provider: GameDataProvider = {
        sourceName: "fake", fetchPlatforms: async () => [], fetchEvents: async () => [],
        fetchGames: async (q: { afterId?: number; limit: number }) =>
          [toGameRecord({ id: 930150, name: "Fbd91 fbd91-title", slug: "fbd91-title", game_type: 0, updated_at: ts("2037-01-01") })].filter((x: GameRecord) => q.afterId === undefined || x.igdbId > q.afterId).slice(0, q.limit),
      };
      await syncGames(provider, { startedAt: new Date("2037-01-02T00:00:00Z"), log: noLog });
      [g] = await db().select().from(games).where(eq(games.id, gid));
      expect(g.displayNames).toMatchObject({ "zh-Hant": "測試遊戲二" });
      expect((await db().select().from(gameLocalizations).where(and(eq(gameLocalizations.gameId, gid), eq(gameLocalizations.localeCode, "zh-Hant"))))[0]).toMatchObject({ name: "測試遊戲二", source: "manual" });
    });

    it("目標遊戲被刪除 → cannot_apply，沒有寫入", async () => {
      const gid = await mkGame(930151, "fbd91-title-gone");
      const id = await mkReport({ targetId: gid, reportType: "localized_title", proposed: { title: "不存在", locale: "zh-Hant" } });
      await db().delete(games).where(eq(games.id, gid));
      expect(await resolveReport(id, "accept")).toMatchObject({ ok: false, error: "cannot_apply" });
      expect(await itemOf(id)).toBeUndefined();
    });
  });

  describe("markAdoptedFeedback", () => {
    let seq = 0;
    /** 直接建一筆項目（含需要的回報列）。 */
    const mkItem = async (gameId: number, over: Partial<typeof igdbFeedbackItems.$inferInsert>) => {
      seq += 1;
      const reportId = await mkReport({ targetId: gameId });
      const [it] = await db()
        .insert(igdbFeedbackItems)
        .values({ reportId, gameId, igdbGameId: 930000 + seq, gameSlug: `fbd91-m${seq}`, field: "release_date", newValue: {}, ...over })
        .returning();
      return it;
    };
    const run = (gameId: number) => db().transaction((tx) => markAdoptedFeedback(tx, gameId));
    const status = async (id: number) => (await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.id, id)))[0];

    it("沒有項目 → 0；release_date／region_date：同鍵 igdb 列日期與精度相同才採納（removed 的列不算）", async () => {
      const gid = await mkGame(930301, "fbd91-ad-date");
      expect(await run(gid)).toBe(0);
      const base = { platformId: ps5, regionCode: "WW", stage: "full" as const };
      const a = await mkItem(gid, { ...base, field: "release_date", newValue: { date: "2037-08-01", precision: "month" } });
      const b = await mkItem(gid, { ...base, regionCode: "TW", field: "region_date", newValue: { date: "2037-05-12", precision: "day" } });
      const rel = await mkRelease(gid, "WW", { releaseDate: "2037-05-10", periodStart: "2037-05-10" });
      expect(await run(gid)).toBe(0);
      expect((await status(a.id)).status).toBe("pending");
      await db().update(releaseEvents).set({ releaseDate: "2037-08-01", periodStart: "2037-08-01", precision: "month", sourceStatus: "removed" }).where(eq(releaseEvents.id, rel));
      expect(await run(gid)).toBe(0);
      await db().update(releaseEvents).set({ sourceStatus: "active" }).where(eq(releaseEvents.id, rel));
      await mkRelease(gid, "TW", { releaseDate: "2037-05-12", periodStart: "2037-05-12" });
      expect(await run(gid)).toBe(2);
      expect(await status(a.id)).toMatchObject({ status: "adopted" });
      expect((await status(a.id)).adoptedAt).not.toBeNull();
      expect((await status(b.id)).status).toBe("adopted");
    });

    it("stage：同 (平台, 地區) 有 igdb 列且階段等於新階段", async () => {
      const gid = await mkGame(930302, "fbd91-ad-stage");
      const it = await mkItem(gid, { field: "stage", platformId: ps5, regionCode: "WW", stage: "full", oldValue: { stage: "full" }, newValue: { stage: "early_access" } });
      await mkRelease(gid, "WW");
      expect(await run(gid)).toBe(0);
      await mkRelease(gid, "WW", { releaseStage: "early_access" });
      expect(await run(gid)).toBe(1);
      expect((await status(it.id)).status).toBe("adopted");
    });

    it("language_support：igdb 來源含該語言與類型（manual 來源不算）", async () => {
      const gid = await mkGame(930303, "fbd91-ad-lang");
      const it = await mkItem(gid, { field: "language_support", newValue: { language: "fbd91-zz", supportType: "audio" } });
      await db().insert(gameLanguageSupports).values({ gameId: gid, languageId: langId, supportType: "audio", source: "manual" });
      expect(await run(gid)).toBe(0);
      await db().insert(gameLanguageSupports).values({ gameId: gid, languageId: langId, supportType: "subtitles", source: "igdb" });
      expect(await run(gid)).toBe(0);
      await db().insert(gameLanguageSupports).values({ gameId: gid, languageId: langId, supportType: "audio", source: "igdb" }).onConflictDoUpdate({
        target: [gameLanguageSupports.gameId, gameLanguageSupports.languageId, gameLanguageSupports.supportType], set: { source: "igdb" },
      });
      expect(await run(gid)).toBe(1);
      expect((await status(it.id)).status).toBe("adopted");
    });

    it("cancelled：上市事件目標看 igdb 列狀態；遊戲目標看 gameStatus", async () => {
      const gid = await mkGame(930304, "fbd91-ad-cancel");
      const ev = await mkItem(gid, { field: "cancelled", platformId: ps5, regionCode: "WW", stage: "full", oldValue: { status: "scheduled" }, newValue: { status: "cancelled" } });
      const gm = await mkItem(gid, { field: "cancelled", oldValue: { status: null }, newValue: { status: "cancelled" } });
      const rel = await mkRelease(gid, "WW");
      expect(await run(gid)).toBe(0);
      await db().update(releaseEvents).set({ status: "cancelled" }).where(eq(releaseEvents.id, rel));
      expect(await run(gid)).toBe(1);
      expect((await status(ev.id)).status).toBe("adopted");
      expect((await status(gm.id)).status).toBe("pending");
      await db().update(games).set({ gameStatus: "cancelled" }).where(eq(games.id, gid));
      expect(await run(gid)).toBe(1);
      expect((await status(gm.id)).status).toBe("adopted");
    });

    it("localized_title：別名（NFKC、去空白、忽略大小寫）或 igdb 在地化名稱相同；manual 在地化不算", async () => {
      const gid = await mkGame(930305, "fbd91-ad-title");
      const a = await mkItem(gid, { field: "localized_title", newValue: { title: "ＡＢＣ　遊戲" } });
      const b = await mkItem(gid, { field: "localized_title", newValue: { title: "另一個名稱" } });
      await db().insert(gameLocalizations).values({ gameId: gid, localeCode: "zh-Hant", name: "另一個名稱", source: "manual" });
      expect(await run(gid)).toBe(0);
      await db().update(games).set({ alternativeNames: [{ name: " abc 遊戲 ", comment: "Traditional" }] }).where(eq(games.id, gid));
      expect(await run(gid)).toBe(1); // 全形字母與全形空白 NFKC 後與「 abc 遊戲 」trim、小寫後相同
      expect((await status(a.id)).status).toBe("adopted");
      expect((await status(b.id)).status).toBe("pending"); // manual 在地化不是 IGDB 的資料
      await db().insert(gameLocalizations).values({ gameId: gid, localeCode: "ja", name: "另一個名稱", source: "igdb" });
      expect(await run(gid)).toBe(1);
      expect((await status(b.id)).status).toBe("adopted");
    });

    it("已 skipped 的不動；submitted 會被標為 adopted", async () => {
      const gid = await mkGame(930306, "fbd91-ad-skip");
      const skipped = await mkItem(gid, { field: "stage", platformId: ps5, regionCode: "WW", stage: "full", newValue: { stage: "beta" }, status: "skipped" });
      const submitted = await mkItem(gid, { field: "stage", platformId: ps5, regionCode: "JP", stage: "full", newValue: { stage: "beta" }, status: "submitted" });
      await mkRelease(gid, "WW", { releaseStage: "beta" });
      await mkRelease(gid, "JP", { releaseStage: "beta" });
      expect(await run(gid)).toBe(1);
      expect((await status(skipped.id)).status).toBe("skipped");
      expect((await status(submitted.id)).status).toBe("adopted");
    });
  });

  describe("同步寫入路徑", () => {
    it("syncGames 寫入遊戲後，同一個 transaction 內偵測到 IGDB 別名含新標題 → adopted", async () => {
      const gid = await mkGame(930401, "fbd91-sync");
      const reportId = await mkReport({ targetId: gid });
      const [it] = await db()
        .insert(igdbFeedbackItems)
        .values({ reportId, gameId: gid, igdbGameId: 930401, gameSlug: "fbd91-sync", field: "localized_title", oldValue: { title: null }, newValue: { title: "同步測試名稱" } })
        .returning();
      const provider = (alt: Array<{ name: string; comment: string }>): GameDataProvider => ({
        sourceName: "fake", fetchPlatforms: async () => [], fetchEvents: async () => [],
        fetchGames: async (q: { afterId?: number; limit: number }) =>
          [toGameRecord({ id: 930401, name: "Fbd91 sync", slug: "fbd91-sync", game_type: 0, updated_at: ts("2037-01-01"), alternative_names: alt })].filter((x: GameRecord) => q.afterId === undefined || x.igdbId > q.afterId).slice(0, q.limit),
      });
      await syncGames(provider([{ name: "別的名稱", comment: "Traditional" }]), { startedAt: new Date("2037-01-02T00:00:00Z"), log: noLog });
      expect((await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.id, it.id)))[0].status).toBe("pending");
      await syncGames(provider([{ name: " 同步測試名稱 ", comment: "Traditional" }]), { startedAt: new Date("2037-01-03T00:00:00Z"), log: noLog });
      const after = (await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.id, it.id)))[0];
      expect(after.status).toBe("adopted");
      expect(after.adoptedAt).not.toBeNull();
    });
  });

  describe("清單與狀態 use case", () => {
    it("listIgdbFeedback：附遊戲名、欄位標籤、IGDB 連結、整理文字與各狀態數量；updateIgdbFeedback 狀態轉換", async () => {
      const gid = await mkGame(930501, "fbd91-list");
      const reportId = await mkReport({ targetId: gid });
      const [it] = await db()
        .insert(igdbFeedbackItems)
        .values({ reportId, gameId: gid, igdbGameId: 930501, gameSlug: "fbd91-list", field: "stage", platformId: ps5, regionCode: "WW", stage: "full", oldValue: { stage: "full" }, newValue: { stage: "beta" }, sourceUrl: "https://example.com/x", reporterNote: "n" })
        .returning();
      const q = await listIgdbFeedback({ status: "pending", limit: 200 });
      const row = q.items.find((i) => i.id === it.id)!;
      expect(row).toMatchObject({
        gameName: "Fbd91 fbd91-list", platformName: "Fbd91 PS5", fieldLabel: "上市階段", igdbUrl: "https://www.igdb.com/games/fbd91-list",
        locationText: "Fbd91 PS5／WW／正式版", oldText: "正式版", newText: "Beta",
      });
      expect(row.pasteText).toContain("https://www.igdb.com/games/fbd91-list");
      expect(row.pasteText).toContain("建議改為：Beta");
      expect(q.counts.pending).toBeGreaterThanOrEqual(1);

      expect(await updateIgdbFeedback([it.id], "submit", " 已到 IGDB 提交 ")).toEqual({ ok: true, updated: 1 });
      expect(await itemById(it.id)).toMatchObject({ status: "submitted", handlerNote: "已到 IGDB 提交" });
      expect(await updateIgdbFeedback([it.id, it.id], "skip")).toEqual({ ok: true, updated: 1 });
      expect(await itemById(it.id)).toMatchObject({ status: "skipped", handlerNote: null });
      expect(await updateIgdbFeedback([it.id], "reopen")).toEqual({ ok: true, updated: 1 });
      expect((await itemById(it.id)).status).toBe("pending");

      expect(await updateIgdbFeedback([], "submit")).toEqual({ ok: false, error: "no_selection" });
      expect(await updateIgdbFeedback([it.id], "submit", "x".repeat(1001))).toEqual({ ok: false, error: "invalid_note" });

      // adopted 不被手動改動
      await db().update(igdbFeedbackItems).set({ status: "adopted" }).where(eq(igdbFeedbackItems.id, it.id));
      expect(await updateIgdbFeedback([it.id], "skip")).toEqual({ ok: true, updated: 0 });
      expect((await itemById(it.id)).status).toBe("adopted");
    });
  });

  async function itemById(id: number) {
    return (await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.id, id)))[0];
  }
});
