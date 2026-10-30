/**
 * D92 field_correction 整合測試（12 §待回饋 IGDB 清單、§field_correction）：
 * - submitReport：驗證錯誤（欄位路徑）、目標必須是存在的遊戲、合法提案寫入
 * - 核可：每個欄位各一筆都建出項目（舊值＝核可當下我方資料快照、新值帶 op）；各形狀的快照內容；cannot_apply 不留項目；
 *   核可前後 games 與所有關聯表完全不變（只建項目，不改我方資料）
 * - markAdoptedFeedback：各形狀的採納／未採納／remove 已消失；封面、截圖、影片不自動採納
 * igdbId 931xxx、slug 前綴 fbd92-。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, between, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { coreEnvSchema, type CoreEnv } from "@/kernel/config/env";
import { FIELD_CORRECTION_KEYS, type FieldCorrectionKey, type ReportProposed } from "@/modules/catalog/domain/entities";
import { FIELD_CORRECTION_SPECS } from "@/modules/catalog/domain/field-corrections";
import { resolveReport, submitReport } from "@/modules/catalog";
import { loadGameFacts, markAdoptedFeedback } from "@/modules/catalog/repository/igdb-feedback";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import {
  changeFeed,
  companies,
  dataReports,
  franchises,
  gameCompanies,
  gameEngines,
  gameExternalLinks,
  gameFranchises,
  gameGameEngines,
  gameGameModes,
  gameGenres,
  gameLocalizations,
  gameModes,
  gamePlatforms,
  gamePlayerPerspectives,
  gameThemes,
  games,
  genres,
  igdbFeedbackItems,
  playerPerspectives,
  releaseEvents,
  themes,
} from "@/modules/catalog/schema";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};

function envWith(): CoreEnv {
  return coreEnvSchema.parse({ DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: "test", REPORT_MAX_PER_IP_PER_DAY: "500", TURNSTILE_SECRET_KEY: "test-secret" });
}
let ip = 0;
const submit = (body: unknown) => submitReport({ body, turnstileToken: "tok", clientIp: `203.0.113.${(ip += 1) % 250}` }, { env: envWith(), verifyTurnstile: async () => ({ ok: true }), warn: noLog });

describe.skipIf(!enabled)("field_correction（整合）", () => {
  let ps5 = 0;
  let gameA = 0; // 有完整的關聯資料
  const db = () => getDb();

  const mkReport = async (proposed: ReportProposed | null, over: Partial<typeof dataReports.$inferInsert> = {}) => {
    const [r] = await db()
      .insert(dataReports)
      .values({ targetType: "game", targetId: gameA, reportType: "field_correction", status: "open", sourceUrl: null, note: "備註", proposed, ...over })
      .returning({ id: dataReports.id });
    return r.id;
  };
  const itemOf = async (reportId: number) => (await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.reportId, reportId)))[0];
  const accept = async (proposed: ReportProposed, over: Partial<typeof dataReports.$inferInsert> = {}) => {
    const id = await mkReport(proposed, over);
    const res = await resolveReport(id, "accept");
    expect(res, JSON.stringify(proposed)).toMatchObject({ ok: true });
    return { id, item: await itemOf(id) };
  };

  /** 我方資料全貌（核可前後比對用）。 */
  const dataFingerprint = async (gameId: number) => {
    const [g] = await db().select().from(games).where(eq(games.id, gameId));
    const f = await loadGameFacts(gameId);
    const locs = await db().select().from(gameLocalizations).where(eq(gameLocalizations.gameId, gameId));
    return JSON.stringify({ g, f, locs });
  };

  beforeAll(async () => {
    ps5 = (await upsertPlatform({ igdbId: 931001, slug: "fbd92-ps5", name: "Fbd92 PS5", kind: "console" })).id;
    await db().insert(games).values({ igdbId: 931100, slug: "fbd92-parent", name: "Fbd92 Parent Game" });
    const [a] = await db()
      .insert(games)
      .values({
        igdbId: 931101, slug: "fbd92-a", name: "Fbd92 Game A", summary: "Old summary", storyline: "Old story", gameType: "main_game", gameStatus: "released",
        coverUrl: "https://img.example/cover.jpg", trailerUrl: "https://v.example/t", screenshotUrls: ["https://img.example/s1.jpg"],
        ageRatingLabel: "ESRB: T", alternativeNames: [{ name: "Alt One", comment: "Working title" }], parentGameId: 931100,
      })
      .returning({ id: games.id });
    gameA = a.id;
    await db().insert(gamePlatforms).values({ gameId: gameA, platformId: ps5 });
    const [genre] = await db().insert(genres).values({ igdbId: 931201, name: "Fbd92 RPG", slug: "fbd92-rpg" }).returning({ id: genres.id });
    await db().insert(gameGenres).values({ gameId: gameA, genreId: genre.id });
    const [theme] = await db().insert(themes).values({ igdbId: 931202, name: "Fbd92 Fantasy", slug: "fbd92-fantasy" }).returning({ id: themes.id });
    await db().insert(gameThemes).values({ gameId: gameA, themeId: theme.id });
    const [mode] = await db().insert(gameModes).values({ igdbId: 931203, name: "Fbd92 Co-op", slug: "fbd92-co-op" }).returning({ id: gameModes.id });
    await db().insert(gameGameModes).values({ gameId: gameA, gameModeId: mode.id });
    const [persp] = await db().insert(playerPerspectives).values({ igdbId: 931204, name: "Fbd92 Third", slug: "fbd92-third" }).returning({ id: playerPerspectives.id });
    await db().insert(gamePlayerPerspectives).values({ gameId: gameA, playerPerspectiveId: persp.id });
    const [engine] = await db().insert(gameEngines).values({ igdbId: 931205, name: "Fbd92 Engine", slug: "fbd92-engine" }).returning({ id: gameEngines.id });
    await db().insert(gameGameEngines).values({ gameId: gameA, gameEngineId: engine.id });
    const [fr] = await db().insert(franchises).values({ igdbId: 931206, kind: "franchise", name: "Fbd92 Saga", slug: "fbd92-saga" }).returning({ id: franchises.id });
    await db().insert(gameFranchises).values({ gameId: gameA, franchiseId: fr.id });
    const [co] = await db().insert(companies).values({ igdbId: 931207, name: "Fbd92 Studio", slug: "fbd92-studio" }).returning({ id: companies.id });
    await db().insert(gameCompanies).values([
      { gameId: gameA, companyId: co.id, role: "developer" },
      { gameId: gameA, companyId: co.id, role: "porting" },
    ]);
    await db().insert(gameExternalLinks).values({ gameId: gameA, linkType: "official", categoryLabel: "Official", url: "https://www.fbd92.example/game/", source: "igdb" });
    await db().insert(gameLocalizations).values({ gameId: gameA, localeCode: "ja", name: "Fbd92 日本語", source: "igdb" });
  });

  afterAll(async () => {
    // 本檔若建了 release_events 的 change_feed 紀錄（沒有，保險起見）一併清掉，避免 id 重置後與別的測試撞 entity_id
    const mine = await db().select({ id: releaseEvents.id }).from(releaseEvents).innerJoin(games, eq(games.id, releaseEvents.gameId)).where(between(games.igdbId, 931000, 931999));
    if (mine.length > 0) {
      await db().delete(changeFeed).where(and(eq(changeFeed.entityType, "release_event"), inArray(changeFeed.entityId, mine.map((m) => m.id))));
    }
    await closeDb();
  });

  describe("submitReport", () => {
    const good = (over: Record<string, unknown> = {}) => ({
      reportType: "field_correction", targetType: "game", targetId: gameA, proposed: { field: "genre", op: "add", value: { name: "Strategy" } }, ...over,
    });

    it("合法提案寫入（proposed 為正規化後的內容）；驗證錯誤以欄位路徑回報、不寫入", async () => {
      const ok = await submit(good({ proposed: { field: "genre", op: "add", value: { name: "  Strategy  " } } }));
      expect(ok).toMatchObject({ ok: true, status: "open" });
      if (ok.ok) {
        const [row] = await db().select().from(dataReports).where(eq(dataReports.id, ok.id));
        expect(row).toMatchObject({ reportType: "field_correction", targetType: "game", targetId: gameA, proposed: { field: "genre", op: "add", value: { name: "Strategy" } } });
      }
      const before = (await db().select().from(dataReports)).length;
      expect(await submit(good({ proposed: { field: "genre", op: "change" } }))).toEqual({ ok: false, error: "validation_failed", fields: { "proposed.value": "required" } });
      expect(await submit(good({ proposed: { field: "summary", op: "add", value: { text: "x" } } }))).toEqual({ ok: false, error: "validation_failed", fields: { "proposed.op": "invalid" } });
      expect(await submit(good({ proposed: { field: "cover", op: "add", value: { url: "javascript:alert(1)" } } }))).toEqual({
        ok: false, error: "validation_failed", fields: { "proposed.value.url": "invalid" },
      });
      expect(await submit(good({ targetType: "platform", targetId: ps5 }))).toMatchObject({ ok: false, error: "validation_failed", fields: { targetType: "invalid" } });
      expect(await submit(good({ targetId: 2147480000 }))).toEqual({ ok: false, error: "validation_failed", fields: { targetId: "invalid" } });
      expect((await db().select().from(dataReports)).length).toBe(before);
    });
  });

  describe("核可：只建項目、不改我方資料", () => {
    const sampleValue = (key: FieldCorrectionKey) => {
      const spec = FIELD_CORRECTION_SPECS[key];
      switch (spec.shape) {
        case "text": return { text: spec.choices ? spec.choices[1] : "新的文字" };
        case "name": return { name: "Fbd92 New" };
        case "altName": return { name: "Alt Two", comment: "c" };
        case "localizedTitle": return { locale: "ko", name: "한국어" };
        case "company": return { name: "Fbd92 New Co", role: spec.roles![spec.roles!.length - 1] };
        case "link": return { url: "https://new.example/x", label: "Steam" };
        case "ageRating": return { organization: "PEGI", rating: "16" };
        case "relation": return { relation: "dlc" as const, gameName: "Fbd92 DLC", gameSlug: "fbd92-dlc" };
        case "media": return { url: "https://img.example/new.png" };
      }
    };

    it("24 個欄位 × 每個允許的動作：全部建出項目，遊戲與關聯資料前後完全相同", async () => {
      const before = await dataFingerprint(gameA);
      for (const key of FIELD_CORRECTION_KEYS) {
        for (const op of FIELD_CORRECTION_SPECS[key].ops) {
          const { id, item } = await accept({ field: key, op, value: sampleValue(key) as never });
          expect(item, `${key}/${op}`).toMatchObject({
            reportId: id, gameId: gameA, igdbGameId: 931101, gameSlug: "fbd92-a", field: key, status: "pending",
            platformId: null, regionCode: null, stage: null, newValue: { op }, reporterNote: "備註",
          });
        }
      }
      expect(await dataFingerprint(gameA)).toBe(before);
    });

    it("舊值是核可當下我方資料的快照", async () => {
      const snap = async (p: ReportProposed) => (await accept(p)).item?.oldValue;
      expect(await snap({ field: "summary", op: "change", value: { text: "New" } })).toEqual({ text: "Old summary" });
      expect(await snap({ field: "game_type", op: "change", value: { text: "remake" } })).toEqual({ text: "main_game" });
      expect(await snap({ field: "game_status", op: "change", value: { text: "cancelled" } })).toEqual({ text: "released" });
      expect(await snap({ field: "alternative_name", op: "add", value: { name: "X" } })).toEqual({ list: ["Alt One（Working title）"] });
      expect(await snap({ field: "localized_title_other", op: "add", value: { locale: "ko", name: "X" } })).toEqual({ list: ["Fbd92 日本語"] });
      expect(await snap({ field: "cover", op: "change", value: { url: "https://img.example/n.png" } })).toEqual({ text: "https://img.example/cover.jpg" });
      expect(await snap({ field: "screenshot", op: "add", value: { url: "https://img.example/n.png" } })).toEqual({ list: ["https://img.example/s1.jpg"] });
      expect(await snap({ field: "video", op: "add", value: { url: "https://v.example/n" } })).toEqual({ text: "https://v.example/t" });
      expect(await snap({ field: "genre", op: "add", value: { name: "X" } })).toEqual({ list: ["Fbd92 RPG"] });
      expect(await snap({ field: "theme", op: "add", value: { name: "X" } })).toEqual({ list: ["Fbd92 Fantasy"] });
      expect(await snap({ field: "game_mode", op: "add", value: { name: "X" } })).toEqual({ list: ["Fbd92 Co-op"] });
      expect(await snap({ field: "player_perspective", op: "add", value: { name: "X" } })).toEqual({ list: ["Fbd92 Third"] });
      expect(await snap({ field: "engine", op: "add", value: { name: "X" } })).toEqual({ list: ["Fbd92 Engine"] });
      expect(await snap({ field: "platform", op: "add", value: { name: "X" } })).toEqual({ list: ["Fbd92 PS5"] });
      expect(await snap({ field: "franchise", op: "add", value: { name: "X" } })).toEqual({ list: ["Fbd92 Saga"] });
      expect(await snap({ field: "collection", op: "add", value: { name: "X" } })).toEqual({ list: [] });
      expect(await snap({ field: "company_developer", op: "add", value: { name: "X", role: "developer" } })).toEqual({ list: ["Fbd92 Studio"] });
      expect(await snap({ field: "company_publisher", op: "add", value: { name: "X", role: "publisher" } })).toEqual({ list: [] });
      expect(await snap({ field: "company_supporting", op: "add", value: { name: "X", role: "porting" } })).toEqual({ list: ["Fbd92 Studio（移植）"] });
      expect(await snap({ field: "external_link", op: "add", value: { url: "https://x.example" } })).toEqual({ list: ["https://www.fbd92.example/game/"] });
      expect(await snap({ field: "age_rating", op: "add", value: { organization: "PEGI", rating: "16" } })).toEqual({ text: "ESRB: T" });
      expect(await snap({ field: "relation_parent", op: "change", value: { relation: "parent", gameName: "Y" } })).toEqual({ list: ["Fbd92 Parent Game"] });
      expect(await snap({ field: "relation_parent", op: "add", value: { relation: "version_parent", gameName: "Y" } })).toEqual({ list: [] });
    });

    it("change 帶舊值 → 存在 newValue.replaces；媒體欄位沒填來源時，項目的佐證連結＝值的網址", async () => {
      const { item } = await accept({ field: "genre", op: "change", value: { name: "A" }, oldValue: { name: "B" } });
      expect(item?.newValue).toEqual({ name: "A", op: "change", replaces: { name: "B" } });
      expect((await accept({ field: "cover", op: "add", value: { url: "https://img.example/zzz.png" } })).item?.sourceUrl).toBe("https://img.example/zzz.png");
      expect((await accept({ field: "cover", op: "add", value: { url: "https://img.example/zzz.png" } }, { sourceUrl: "https://src.example/p" })).item?.sourceUrl).toBe("https://src.example/p");
      expect((await accept({ field: "genre", op: "add", value: { name: "A" } })).item?.sourceUrl).toBeNull();
    });

    it("目標遊戲不存在、或提案不完整 → cannot_apply，不留項目、回報維持 open", async () => {
      const [g] = await db().insert(games).values({ igdbId: 931190, slug: "fbd92-gone", name: "Gone" }).returning({ id: games.id });
      const gone = await mkReport({ field: "genre", op: "add", value: { name: "X" } }, { targetId: g.id });
      await db().delete(games).where(eq(games.id, g.id));
      expect(await resolveReport(gone, "accept")).toEqual({ ok: false, error: "cannot_apply", detail: "target_missing" });
      expect(await itemOf(gone)).toBeUndefined();
      expect((await db().select().from(dataReports).where(eq(dataReports.id, gone)))[0].status).toBe("open");

      const broken = await mkReport({ field: "genre", op: "add" });
      expect(await resolveReport(broken, "accept")).toEqual({ ok: false, error: "cannot_apply", detail: "invalid_proposal" });
      expect(await itemOf(broken)).toBeUndefined();
    });

    it("駁回不建項目；重複核可不重複建", async () => {
      const rej = await mkReport({ field: "genre", op: "add", value: { name: "X" } });
      expect(await resolveReport(rej, "reject")).toMatchObject({ ok: true, feedbackItemId: null });
      expect(await itemOf(rej)).toBeUndefined();
      const ok = await mkReport({ field: "genre", op: "add", value: { name: "X" } });
      expect(await resolveReport(ok, "accept")).toMatchObject({ ok: true, feedbackItemId: expect.any(Number) });
      expect(await resolveReport(ok, "accept")).toEqual({ ok: false, error: "already_resolved" });
      expect(await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.reportId, ok))).toHaveLength(1);
    });
  });

  describe("markAdoptedFeedback", () => {
    let seq = 0;
    const mkItem = async (gameId: number, field: FieldCorrectionKey, newValue: object, status: "pending" | "submitted" | "skipped" = "pending") => {
      seq += 1;
      const reportId = await mkReport(null, { targetId: gameId });
      const [it] = await db()
        .insert(igdbFeedbackItems)
        .values({ reportId, gameId, igdbGameId: 931500 + seq, gameSlug: `fbd92-m${seq}`, field, newValue, status })
        .returning();
      return it;
    };
    const run = (gameId: number) => db().transaction((tx) => markAdoptedFeedback(tx, gameId));
    const status = async (id: number) => (await db().select().from(igdbFeedbackItems).where(eq(igdbFeedbackItems.id, id)))[0].status;

    it("各形狀：已含新值→採納、尚未→維持；remove 已消失→採納；封面／截圖／影片永不自動採納", async () => {
      const [g] = await db().insert(games).values({ igdbId: 931301, slug: "fbd92-ad", name: "Fbd92 Adopt", summary: "Fresh summary", gameType: "remake" }).returning({ id: games.id });
      const gid = g.id;
      const [genre] = await db().insert(genres).values({ igdbId: 931301, name: "Fbd92 Puzzle", slug: "fbd92-puzzle" }).returning({ id: genres.id });
      const [co] = await db().insert(companies).values({ igdbId: 931301, name: "Fbd92 Pub", slug: "fbd92-pub" }).returning({ id: companies.id });
      await db().insert(gameCompanies).values({ gameId: gid, companyId: co.id, role: "publisher" });
      await db().insert(gameExternalLinks).values({ gameId: gid, linkType: "official", categoryLabel: "Official", url: "https://www.fbd92-ad.example/page/", source: "igdb" });
      await db().insert(gameLocalizations).values({ gameId: gid, localeCode: "ko", name: "한국어 제목", source: "igdb" });
      await db().update(games).set({ parentGameId: 931100, ageRatingLabel: "PEGI: 16", alternativeNames: [{ name: "Alt Nine", comment: "x" }] }).where(eq(games.id, gid));

      const yes = [
        await mkItem(gid, "summary", { text: "  fresh SUMMARY ", op: "change" }),
        await mkItem(gid, "game_type", { text: "remake", op: "change" }),
        await mkItem(gid, "company_publisher", { name: "FBD92-PUB", role: "publisher", op: "add" }),
        await mkItem(gid, "external_link", { url: "https://fbd92-ad.example/page#x", op: "add" }),
        await mkItem(gid, "localized_title_other", { locale: "ko", name: "한국어 제목", op: "add" }),
        await mkItem(gid, "alternative_name", { name: "alt nine", comment: "X", op: "add" }),
        await mkItem(gid, "age_rating", { organization: "pegi", rating: "16", op: "add" }),
        await mkItem(gid, "relation_parent", { relation: "parent", gameName: "Fbd92 Parent Game", op: "add" }),
        await mkItem(gid, "genre", { name: "Fbd92 Puzzle", op: "remove" }, "submitted"), // 此遊戲沒有這個類型 → remove 已成立
      ];
      const no = [
        await mkItem(gid, "summary", { text: "Different", op: "change" }),
        await mkItem(gid, "company_publisher", { name: "Fbd92 Pub", role: "developer", op: "add" }),
        await mkItem(gid, "external_link", { url: "https://fbd92-ad.example/page?x=1", op: "add" }),
        await mkItem(gid, "genre", { name: "Fbd92 Puzzle", op: "add" }),
        await mkItem(gid, "relation_parent", { relation: "dlc", gameName: "Fbd92 Parent Game", op: "add" }),
        await mkItem(gid, "cover", { url: "https://img.example/a.png", op: "add" }),
        await mkItem(gid, "screenshot", { url: "https://img.example/b.png", op: "remove" }),
        await mkItem(gid, "video", { url: "https://v.example/c", op: "add" }),
        await mkItem(gid, "summary", { text: "Fresh summary", op: "change" }, "skipped"), // skipped 不動
      ];
      expect(await run(gid)).toBe(yes.length);
      for (const it of yes) expect(await status(it.id)).toBe("adopted");
      for (const it of no) expect(await status(it.id), `${it.field} ${JSON.stringify(it.newValue)}`).not.toBe("adopted");

      // 補上類型：add 變成立、remove 不成立（已 adopted 的不會被回退）
      await db().insert(gameGenres).values({ gameId: gid, genreId: genre.id });
      expect(await run(gid)).toBe(1);
      expect(await status(no[3].id)).toBe("adopted");
      expect(await run(gid)).toBe(0);
    });

    it("沒有項目 → 0；只有第 1 波欄位的項目 → 照舊比對（不需要 field_correction 的資料）", async () => {
      const [g] = await db().insert(games).values({ igdbId: 931302, slug: "fbd92-none", name: "Fbd92 None" }).returning({ id: games.id });
      expect(await run(g.id)).toBe(0);
    });

    it("change 帶舊值：新值含、舊值仍在 → 未採納；舊值消失 → 採納", async () => {
      const [g] = await db().insert(games).values({ igdbId: 931303, slug: "fbd92-change", name: "Fbd92 Change" }).returning({ id: games.id });
      const [t1] = await db().insert(themes).values({ igdbId: 931303, name: "Fbd92 Old Theme", slug: "fbd92-old-theme" }).returning({ id: themes.id });
      const [t2] = await db().insert(themes).values({ igdbId: 931304, name: "Fbd92 New Theme", slug: "fbd92-new-theme" }).returning({ id: themes.id });
      await db().insert(gameThemes).values([{ gameId: g.id, themeId: t1.id }, { gameId: g.id, themeId: t2.id }]);
      const it = await mkItem(g.id, "theme", { name: "Fbd92 New Theme", op: "change", replaces: { name: "Fbd92 Old Theme" } });
      expect(await run(g.id)).toBe(0);
      await db().delete(gameThemes).where(and(eq(gameThemes.gameId, g.id), eq(gameThemes.themeId, t1.id)));
      expect(await run(g.id)).toBe(1);
      expect(await status(it.id)).toBe("adopted");
    });
  });
});
