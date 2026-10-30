/**
 * 後台設定（B）與擴充頁（C）（整合）：app_settings＋稽核、短 TTL 快取、讀取端覆蓋（評分顯示、月曆預設、Metacritic 第二道開關）、
 * POST /internal/settings 的 Basic auth→同源→CSRF 順序、設定頁／同步監控／回報／使用者頁的渲染與共用導覽。
 * 不碰開發資料庫（TEST_DATABASE_URL）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { resetCoreEnvCache } from "@/kernel/config/env";
import { saveSyncProgress, recordJobFailure, recordJobSuccess } from "@/kernel/db/sync-state";
import {
  SETTINGS_TTL_MS,
  clearSettingsCache,
  getSettings,
  isMetacriticScrapeAllowed,
  listSettingAudit,
  updateSettings,
  SettingsValidationError,
} from "@/kernel/settings";
import { setCatalogExtensions } from "@/modules/catalog/extensions";
import { effectiveReleaseFilterDefaults } from "@/modules/catalog/use-cases/read/resolve-filter";
import { getEffectiveRatingDisplayConfig } from "@/modules/catalog/use-cases/read/rating-config";
import { getEffectiveRatingColumns } from "@/modules/catalog/use-cases/read/get-ratings-ranking";
import { getFilterOptions } from "@/modules/catalog/use-cases/read/get-filter-options";
import { createCsrfToken, isSameOrigin, verifyCsrfToken } from "@/modules/admin/csrf";
import { POST as settingsPost } from "@/modules/admin/api/settings";
import { SettingsAdminPage } from "@/modules/admin/ui/settings-page";
import { SyncAdminPage } from "@/modules/admin/ui/sync-page";
import { ReportsAdminPage } from "@/modules/admin/ui/reports-page";
import { AdminUsersPage } from "@/modules/accounts/ui/admin-users-page";
import { metascoreColumn, userscoreColumn } from "@/modules/metacritic";

vi.mock("next/server", () => ({ connection: async () => {} }));

const enabled = !!process.env.TEST_DATABASE_URL;
const ORIGIN = "http://localhost:3000";
const USER = "setadmin";
const PASS = "settings-admin-pass";
const basic = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;
const KEYS = ["ADMIN_BASIC_AUTH_USER", "ADMIN_BASIC_AUTH_PASS", "VISIBLE_SCORE_PROVIDERS", "RATING_DISPLAY_PRIORITY", "CALENDAR_VISIBLE_GAME_TYPES", "CALENDAR_VISIBLE_RELEASE_STAGES", "METACRITIC_SCRAPE_ENABLED", "MODULES"] as const;
const saved: Record<string, string | undefined> = {};

async function wipe(): Promise<void> {
  await getDb().execute(sql`TRUNCATE app_settings, app_settings_audit RESTART IDENTITY`);
  clearSettingsCache();
}

const post = (form: Record<string, string | string[]>, headers: Record<string, string> = {}) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return settingsPost(new Request(`${ORIGIN}/internal/settings/save`, { method: "POST", headers: { authorization: basic, origin: ORIGIN, host: "localhost:3000", ...headers }, body }));
};
const loc = (r: Response) => new URL(r.headers.get("location") ?? "", ORIGIN);

describe.skipIf(!enabled)("後台設定（整合）", () => {
  beforeAll(async () => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.ADMIN_BASIC_AUTH_USER = USER;
    process.env.ADMIN_BASIC_AUTH_PASS = PASS;
    delete process.env.VISIBLE_SCORE_PROVIDERS;
    delete process.env.RATING_DISPLAY_PRIORITY;
    delete process.env.CALENDAR_VISIBLE_GAME_TYPES;
    delete process.env.CALENDAR_VISIBLE_RELEASE_STAGES;
    delete process.env.METACRITIC_SCRAPE_ENABLED;
    delete process.env.MODULES;
    resetCoreEnvCache();
  });
  afterAll(async () => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetCoreEnvCache();
    setCatalogExtensions({});
    await wipe();
    await closeDb();
  });
  beforeEach(async () => {
    await wipe();
    delete process.env.VISIBLE_SCORE_PROVIDERS;
    delete process.env.METACRITIC_SCRAPE_ENABLED;
    resetCoreEnvCache();
  });

  describe("kernel/settings：儲存、稽核、快取", () => {
    it("寫入設定與稽核（誰、何時、舊值→新值）；相同值不重複寫；還原＝刪除並留紀錄", async () => {
      const a = await updateSettings([{ key: "ratings.priority", value: ["igdb"] }], "alice");
      expect(a).toEqual([{ key: "ratings.priority", oldValue: null, newValue: ["igdb"] }]);
      expect(await updateSettings([{ key: "ratings.priority", value: ["igdb"] }], "alice")).toEqual([]);
      const b = await updateSettings([{ key: "ratings.priority", value: ["metacritic_scrape", "igdb"] }], "bob");
      expect(b[0]).toMatchObject({ oldValue: ["igdb"], newValue: ["metacritic_scrape", "igdb"] });
      const r = await updateSettings([{ key: "ratings.priority", value: null }], "bob");
      expect(r[0]).toMatchObject({ oldValue: ["metacritic_scrape", "igdb"], newValue: null });
      expect(await updateSettings([{ key: "ratings.priority", value: null }], "bob")).toEqual([]);
      const audit = await listSettingAudit(10);
      expect(audit.map((x) => [x.changedBy, x.key])).toEqual([["bob", "ratings.priority"], ["bob", "ratings.priority"], ["alice", "ratings.priority"]]);
      expect(audit[2]!.oldValue).toBeNull();
      expect(audit[0]!.changedAt).toBeInstanceOf(Date);
      expect(Array.from(await getSettings())).toEqual([]);
    });
    it("拒絕未知鍵、錯誤形狀、重複鍵、空操作者；整批原子（有一項不合法就一項都不寫）", async () => {
      await expect(updateSettings([{ key: "nope" as never, value: true }], "a")).rejects.toBeInstanceOf(SettingsValidationError);
      await expect(updateSettings([{ key: "ratings.showMetascore", value: ["x"] }], "a")).rejects.toBeInstanceOf(SettingsValidationError);
      await expect(updateSettings([{ key: "ratings.priority", value: ["igdb"] }, { key: "ratings.priority", value: ["igdb"] }], "a")).rejects.toBeInstanceOf(SettingsValidationError);
      await expect(updateSettings([{ key: "ratings.priority", value: ["igdb"] }], "  ")).rejects.toBeInstanceOf(SettingsValidationError);
      await expect(updateSettings([{ key: "ratings.priority", value: ["igdb"] }, { key: "ratings.showMetascore", value: "no" as never }], "a")).rejects.toBeInstanceOf(SettingsValidationError);
      expect(await listSettingAudit(10)).toEqual([]);
    });
    it("短 TTL 快取：TTL 內讀到舊值，過期後讀到新值；寫入後本行程立刻看到", async () => {
      await updateSettings([{ key: "ratings.showMetascore", value: false }], "a");
      const t0 = performance.now();
      expect((await getSettings(t0)).get("ratings.showMetascore")).toBe(false);
      await getDb().execute(sql`UPDATE app_settings SET value = 'true'::jsonb WHERE key = 'ratings.showMetascore'`); // 繞過 API 直接改
      expect((await getSettings(t0 + SETTINGS_TTL_MS - 1)).get("ratings.showMetascore")).toBe(false); // 仍在快取
      expect((await getSettings(t0 + SETTINGS_TTL_MS + 1)).get("ratings.showMetascore")).toBe(true); // 過期重讀
      await updateSettings([{ key: "ratings.showMetascore", value: false }], "a");
      expect((await getSettings()).get("ratings.showMetascore")).toBe(false); // 寫入後立刻生效
    });
    it("表裡的壞資料（未知鍵、錯誤形狀）讀取時略過，不影響其他設定", async () => {
      await getDb().execute(sql`INSERT INTO app_settings (key, value, updated_by) VALUES ('bogus', 'true', 'x'), ('ratings.priority', '5', 'x'), ('ratings.showUserscore', 'false', 'x')`);
      clearSettingsCache();
      expect(Array.from(await getSettings())).toEqual([["ratings.showUserscore", false]]);
    });
  });

  describe("讀取端：DB 有值就覆蓋環境變數", () => {
    it("評分顯示：env 是預設，DB 覆蓋；Metascore／Userscore 開關", async () => {
      process.env.VISIBLE_SCORE_PROVIDERS = "igdb";
      resetCoreEnvCache();
      expect((await getEffectiveRatingDisplayConfig()).visible).toEqual(["igdb"]);
      await updateSettings([{ key: "ratings.visibleProviders", value: [] }, { key: "ratings.priority", value: ["igdb", "metacritic_scrape"] }, { key: "ratings.showUserscore", value: false }], "a");
      const cfg = await getEffectiveRatingDisplayConfig();
      expect(cfg.visible).toEqual([]); // 空清單＝不過濾，仍覆蓋 env
      expect(cfg.priority).toEqual(["igdb", "metacritic_scrape"]);
      expect(cfg.hiddenScoreTypes).toEqual(["user_score"]);
      await updateSettings([{ key: "ratings.visibleProviders", value: null }, { key: "ratings.priority", value: null }, { key: "ratings.showUserscore", value: null }], "a");
      const back = await getEffectiveRatingDisplayConfig();
      expect(back.visible).toEqual(["igdb"]);
      expect(back.hiddenScoreTypes).toEqual([]);
    });
    it("月曆預設的遊戲類型與上市階段（篩選面板的預設也跟著變）", async () => {
      expect((await effectiveReleaseFilterDefaults()).gameTypes).toContain("remake");
      await updateSettings([{ key: "calendar.defaultGameTypes", value: ["main_game"] }, { key: "calendar.defaultStages", value: ["full"] }], "a");
      expect(await effectiveReleaseFilterDefaults()).toEqual({ gameTypes: ["main_game"], stages: ["full"] });
      const opts = await getFilterOptions({ locale: "en" });
      expect(opts.defaultGameTypes).toEqual(["main_game"]);
      expect(opts.defaultStages).toEqual(["full"]);
      // 空清單視為沒設（否則預設變成什麼都不顯示）
      await updateSettings([{ key: "calendar.defaultGameTypes", value: [] }], "a");
      expect((await effectiveReleaseFilterDefaults()).gameTypes).toContain("remake");
    });
    it("評分排名頁：Metascore／Userscore 欄隨開關消失，igdb 欄永遠在", async () => {
      setCatalogExtensions({ ratingColumns: [metascoreColumn, userscoreColumn] });
      expect((await getEffectiveRatingColumns()).map((c) => c.id)).toEqual(["igdb", "metascore", "userscore"]);
      await updateSettings([{ key: "ratings.showMetascore", value: false }], "a");
      expect((await getEffectiveRatingColumns()).map((c) => c.id)).toEqual(["igdb", "userscore"]);
      await updateSettings([{ key: "ratings.showUserscore", value: false }], "a");
      expect((await getEffectiveRatingColumns()).map((c) => c.id)).toEqual(["igdb"]);
      setCatalogExtensions({});
    });
    it("Metacritic 抓取：環境變數與後台「允許抓取」兩者皆開才算允許", async () => {
      const env = (on: boolean) => ({ METACRITIC_SCRAPE_ENABLED: on ? "true" : "false" });
      expect(await isMetacriticScrapeAllowed(env(true))).toBe(false); // 只開 env：不抓
      await updateSettings([{ key: "metacritic.scrapeAllowed", value: true }], "a");
      expect(await isMetacriticScrapeAllowed(env(true))).toBe(true);
      expect(await isMetacriticScrapeAllowed(env(false))).toBe(false); // 只開 DB：不抓
      await updateSettings([{ key: "metacritic.scrapeAllowed", value: false }], "a");
      expect(await isMetacriticScrapeAllowed(env(true))).toBe(false);
    });
  });

  describe("POST /internal/settings/save", () => {
    const csrf = () => createCsrfToken(PASS);
    const ratingsForm = (extra: Record<string, string | string[]> = {}) => ({ csrf: csrf(), group: "ratings", mode: "save", visible: ["igdb"], priority_1: "igdb", priority_2: "metacritic_scrape", show_metascore: "on", ...extra });

    it("Basic auth → 同源 → CSRF → 動作，依序檢查", async () => {
      expect((await post(ratingsForm(), { authorization: "" })).status).toBe(401);
      expect((await post(ratingsForm(), { authorization: `Basic ${Buffer.from("x:y").toString("base64")}` })).status).toBe(401);
      expect((await post(ratingsForm(), { origin: "https://evil.example" })).status).toBe(403);
      expect((await post(ratingsForm({ csrf: "bad" }))).status).toBe(403);
      expect((await post(ratingsForm({ csrf: createCsrfToken("other-secret") }))).status).toBe(403);
      expect((await post({ csrf: csrf(), group: "nope", mode: "save" })).status).toBe(400);
      expect((await post({ csrf: csrf(), group: "ratings", mode: "boom" })).status).toBe(400);
      expect(await listSettingAudit(5)).toEqual([]); // 被擋的請求都沒有寫入
      process.env.ADMIN_BASIC_AUTH_PASS = "";
      expect((await post(ratingsForm())).status).toBe(404); // 未設帳密＝整個回 404
      process.env.ADMIN_BASIC_AUTH_PASS = PASS;
    });
    it("儲存：303 回設定頁、稽核記下 Basic auth 的使用者名稱；還原；驗證失敗不寫入", async () => {
      const ok = await post(ratingsForm());
      expect(ok.status).toBe(303);
      expect(loc(ok).pathname).toBe("/internal/settings");
      expect(loc(ok).searchParams.get("saved")).toBe("ratings");
      expect(loc(ok).searchParams.get("changed")).toBe("4");
      const audit = await listSettingAudit(10);
      expect(audit).toHaveLength(4);
      expect(audit.every((a) => a.changedBy === USER)).toBe(true);
      const s = await getSettings();
      expect(s.get("ratings.visibleProviders")).toEqual(["igdb"]);
      expect(s.get("ratings.priority")).toEqual(["igdb", "metacritic_scrape"]);
      expect(s.get("ratings.showMetascore")).toBe(true);
      expect(s.get("ratings.showUserscore")).toBe(false);
      expect(ok.headers.get("cache-control")).toBe("no-store");

      const same = await post(ratingsForm());
      expect(loc(same).searchParams.get("changed")).toBe("0"); // 沒變動就不寫稽核
      expect(await listSettingAudit(10)).toHaveLength(4);

      const bad = await post(ratingsForm({ visible: ["bogus"] }));
      expect(loc(bad).searchParams.get("error")).toContain("未知");
      expect(loc(bad).searchParams.get("saved")).toBeNull();

      const reset = await post({ csrf: csrf(), group: "ratings", mode: "reset" });
      expect(loc(reset).searchParams.get("mode")).toBe("reset");
      expect(Array.from(await getSettings())).toEqual([]);
      const last = (await listSettingAudit(10))[0]!;
      expect(last.newValue).toBeNull();
    });
    it("月曆與 Metacritic 兩組", async () => {
      const cal = await post({ csrf: csrf(), group: "calendar", mode: "save", game_types: ["main_game", "remake"], stages: ["full", "early_access"] });
      expect(loc(cal).searchParams.get("saved")).toBe("calendar");
      expect((await getSettings()).get("calendar.defaultGameTypes")).toEqual(["main_game", "remake"]);
      expect(loc(await post({ csrf: csrf(), group: "calendar", mode: "save", game_types: ["main_game"] })).searchParams.get("error")).toContain("至少");
      await post({ csrf: csrf(), group: "metacritic", mode: "save", scrape_allowed: "on" });
      expect((await getSettings()).get("metacritic.scrapeAllowed")).toBe(true);
      await post({ csrf: csrf(), group: "metacritic", mode: "save" });
      expect((await getSettings()).get("metacritic.scrapeAllowed")).toBe(false);
    });
  });

  describe("頁面", () => {
    const html = async (el: Promise<ReactElement>) => renderToStaticMarkup(await el);

    it("設定頁：三組表單、模組啟停（唯讀，註明需改環境變數並重啟）、變更歷史", async () => {
      await updateSettings([{ key: "ratings.priority", value: ["metacritic_scrape", "igdb"] }, { key: "metacritic.scrapeAllowed", value: true }], "carol");
      const page = await html(
        SettingsAdminPage({
          searchParams: { saved: "ratings", changed: "1" },
          modules: [
            { name: "catalog", kind: "core", enabled: true, requires: [] },
            { name: "metacritic", kind: "optional", enabled: false, requires: [] },
          ],
        }),
      );
      for (const g of ["ratings", "calendar", "modules", "metacritic"]) expect(page).toContain(`data-settings-group="${g}"`);
      expect(page).toContain("需修改環境變數並重啟");
      expect(page).toContain('data-module="metacritic" data-enabled="false"');
      expect(page).toContain('data-mc-env="off"');
      expect(page).toContain("兩者皆開");
      expect(page).toContain("carol");
      expect(page).toContain("主分數優先序");
      expect(page).toContain('data-admin-nav=""');
      expect(page).toMatch(/name="csrf" value="\d+\.[0-9a-f]{64}"/);
      expect(page).toContain('data-flash="saved"');
    });
    it("同步監控頁：任務狀態、回填進度、最近失敗；沒資料也能開", async () => {
      await getDb().execute(sql`TRUNCATE sync_state`);
      const empty = await html(SyncAdminPage({ jobs: [{ name: "sync_games", cron: "10 * * * *", module: "catalog" }] }));
      expect(empty).toContain('data-job="sync_games" data-health="never"');
      expect(empty).toContain('data-sync-failures="none"');
      await recordJobSuccess("sync_games");
      await recordJobFailure("sync_platforms", new Error("IGDB 回 500"));
      await saveSyncProgress("igdb_backfill", { cursor: '{"afterId":123}', meta: { totals: { games: 9 } } });
      const page = await html(SyncAdminPage({ jobs: [{ name: "sync_games", cron: "10 * * * *", module: "catalog" }, { name: "backfill_games", module: "catalog" }] }));
      expect(page).toContain('data-job="sync_games" data-health="ok"');
      expect(page).toContain('data-job="sync_platforms" data-health="failing"');
      expect(page).toContain('data-job="backfill_games" data-health="manual"');
      expect(page).toContain("afterId");
      expect(page).toContain("IGDB 回 500");
      expect(page).toContain('data-sync-failures="list"');
      expect(page).toContain('aria-current="page"');
    });
    it("回報頁與使用者頁都有共用導覽（目前頁標 aria-current）", async () => {
      const reports = await html(ReportsAdminPage({ searchParams: {}, publicLocale: "en" }));
      expect(reports).toContain('data-admin-nav=""');
      expect(reports).toMatch(/href="\/internal\/settings"/);
      expect(reports).toMatch(/aria-current="page"[^>]*>資料更正回報|href="\/internal\/reports"[^>]*aria-current="page"/);
      const users = await html(AdminUsersPage({ searchParams: {}, csrf: createCsrfToken(PASS) }));
      expect(users).toContain('data-admin-nav=""');
      expect(users).toMatch(/href="\/internal\/sync"/);
    });
  });
});

describe("共用函式（不需資料庫）", () => {
  it("CSRF 與同源檢查沿用同一份實作", () => {
    expect(verifyCsrfToken(createCsrfToken(PASS), PASS)).toBe(true);
    expect(isSameOrigin(new Headers({ origin: ORIGIN, host: "localhost:3000" }))).toBe(true);
  });
});
