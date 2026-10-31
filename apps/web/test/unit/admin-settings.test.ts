/**
 * 後台設定與擴充（單元）：設定值的驗證與覆蓋、評分顯示的類型開關、導覽、同步監控的合併邏輯、品牌拉霸機的時間計算。
 */
import { describe, expect, it } from "vitest";
import { adminNavItems } from "@/kernel/ui/admin-nav";
import { isSettingKey, isValidSettingShape, SETTING_KEYS } from "@/kernel/settings";
import { applyRatingSettings, DEFAULT_RATING_DISPLAY_CONFIG } from "@/modules/catalog/domain/rating-config";
import { selectRatings } from "@/modules/catalog/domain/rating-display";
import { formatSettingValue } from "@/modules/admin/ui/settings-page";
import { parseSettingsForm } from "@/modules/admin/use-cases/settings";
import { buildSyncMonitorView, healthOf, summarizeProgress } from "@/modules/admin/use-cases/sync-monitor";
import { middleLetters, rollDirection, shiftLetter, slotDuration } from "@/modules/catalog/ui/layout/brand-roll";

const form = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("kernel/settings 的形狀檢查", () => {
  it("只認登記過的鍵；布林鍵只收布林、清單鍵只收字串陣列", () => {
    expect(isSettingKey("ratings.priority")).toBe(true);
    expect(isSettingKey("nope")).toBe(false);
    expect(isValidSettingShape("ratings.showMetascore", true)).toBe(true);
    expect(isValidSettingShape("ratings.showMetascore", "true")).toBe(false);
    expect(isValidSettingShape("ratings.priority", ["igdb"])).toBe(true);
    expect(isValidSettingShape("ratings.priority", [1])).toBe(false);
    expect(isValidSettingShape("ratings.priority", [""])).toBe(false);
    expect(SETTING_KEYS).toContain("metacritic.scrapeAllowed");
  });
});

describe("評分來源設定覆蓋環境變數", () => {
  it("DB 有值才覆蓋；空清單＝不過濾；未知來源丟掉；優先序為空退回環境變數", () => {
    const base = { ...DEFAULT_RATING_DISPLAY_CONFIG, visible: ["igdb"], priority: ["igdb", "metacritic_scrape"] };
    expect(applyRatingSettings(base, {})).toEqual({ ...base, hiddenScoreTypes: [] });
    expect(applyRatingSettings(base, { visibleProviders: [] }).visible).toEqual([]);
    expect(applyRatingSettings(base, { visibleProviders: ["metacritic_scrape", "bogus"] }).visible).toEqual(["metacritic_scrape"]);
    expect(applyRatingSettings(base, { priority: ["bogus"] }).priority).toEqual(["igdb", "metacritic_scrape"]);
    expect(applyRatingSettings(base, { priority: ["metacritic_scrape", "igdb"] }).priority).toEqual(["metacritic_scrape", "igdb"]);
  });
  it("Metascore／Userscore 開關變成 hiddenScoreTypes，selectRatings 不顯示也不選為主分數", () => {
    const cfg = applyRatingSettings(DEFAULT_RATING_DISPLAY_CONFIG, { showMetascore: false, showUserscore: false });
    expect([...cfg.hiddenScoreTypes].sort()).toEqual(["metascore", "user_score"]);
    const rows = [
      { scoreProvider: "igdb", scoreType: "critic_aggregate", score: 80 },
      { scoreProvider: "metacritic_scrape", scoreType: "metascore", score: 90 },
      { scoreProvider: "metacritic_scrape", scoreType: "user_score", score: 85 },
    ];
    const hidden = selectRatings(rows, { visible: cfg.visible, hiddenScoreTypes: cfg.hiddenScoreTypes, priority: cfg.priority });
    expect(hidden.shown.map((r) => r.scoreType)).toEqual(["critic_aggregate"]);
    expect(hidden.primary?.scoreProvider).toBe("igdb");
    const shown = selectRatings(rows, { visible: [], priority: cfg.priority });
    expect(shown.primary?.scoreType).toBe("metascore");
    const back = applyRatingSettings(cfg, { showMetascore: true });
    expect(back.hiddenScoreTypes).toEqual(["user_score"]);
  });
});

describe("設定表單驗證（parseSettingsForm）", () => {
  it("評分：可見來源與優先序驗證；優先序至少一個；未勾選的顯示開關＝關", () => {
    const ok = parseSettingsForm("ratings", "save", form([["visible", "igdb"], ["priority_1", "metacritic_scrape"], ["priority_2", "igdb"], ["show_metascore", "on"]]));
    expect(ok).toEqual({
      ok: true,
      changes: [
        { key: "ratings.visibleProviders", value: ["igdb"] },
        { key: "ratings.priority", value: ["metacritic_scrape", "igdb"] },
        { key: "ratings.showMetascore", value: true },
        { key: "ratings.showUserscore", value: false },
      ],
    });
    expect(parseSettingsForm("ratings", "save", form([["visible", "bogus"], ["priority_1", "igdb"]])).ok).toBe(false);
    expect(parseSettingsForm("ratings", "save", form([["priority_1", "bogus"]])).ok).toBe(false);
    expect(parseSettingsForm("ratings", "save", form([])).ok).toBe(false);
  });
  it("月曆：類型與階段必須是已知值且各至少一個", () => {
    const ok = parseSettingsForm("calendar", "save", form([["game_types", "main_game"], ["game_types", "remake"], ["stages", "full"]]));
    expect(ok).toMatchObject({ ok: true });
    expect(parseSettingsForm("calendar", "save", form([["game_types", "main_game"]])).ok).toBe(false);
    expect(parseSettingsForm("calendar", "save", form([["game_types", "evil"], ["stages", "full"]])).ok).toBe(false);
    expect(parseSettingsForm("calendar", "save", form([["game_types", "main_game"], ["stages", "evil"]])).ok).toBe(false);
  });
  it("Metacritic 允許抓取：未勾＝關；reset 對任何組都是刪除該組全部鍵", () => {
    expect(parseSettingsForm("metacritic", "save", form([]))).toEqual({ ok: true, changes: [{ key: "metacritic.scrapeAllowed", value: false }] });
    const reset = parseSettingsForm("ratings", "reset", form([]));
    expect(reset.ok && reset.changes.every((c) => c.value === null)).toBe(true);
    expect(reset.ok && reset.changes).toHaveLength(4);
  });
});

describe("設定值的顯示", () => {
  it("布林、清單、預設", () => {
    expect(formatSettingValue("ratings.showMetascore", true)).toBe("開");
    expect(formatSettingValue("ratings.visibleProviders", [])).toBe("（不過濾）");
    expect(formatSettingValue("ratings.priority", ["metacritic_scrape", "igdb"])).toBe("Metacritic（抓取）、IGDB");
    expect(formatSettingValue("calendar.defaultGameTypes", ["main_game"])).toBe("主遊戲");
    expect(formatSettingValue("ratings.priority", null)).toBe("（預設）");
  });
});

describe("共用導覽", () => {
  it("accounts 啟用才有「使用者」；metacritic 啟用才有「比對覆核」；設定與同步監控一直在", () => {
    const keys = (env: Record<string, string | undefined>) => adminNavItems(env).map((i) => i.key);
    expect(keys({ MODULES: "admin" })).toEqual(["reports", "settings", "sync"]);
    expect(keys({ MODULES: "admin,accounts" })).toEqual(["reports", "users", "settings", "sync"]);
    expect(keys({ MODULES: "admin,accounts", METACRITIC_SCRAPE_ENABLED: "true" })).toEqual(["reports", "users", "settings", "sync", "matches"]);
  });
});

describe("同步監控的合併", () => {
  const T = (s: string) => new Date(s);
  const state = (over: Partial<Parameters<typeof buildSyncMonitorView>[0][number]>) => ({
    jobName: "x", lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, lastError: null, lastSyncedAt: null, cursor: null, meta: null, ...over,
  });
  it("健康狀態：成功晚於失敗＝正常；失敗較新＝失敗中；沒跑過；手動任務", () => {
    const def = { name: "x", cron: "0 * * * *", module: "catalog" };
    expect(healthOf(def, T("2026-10-02"), T("2026-10-01"))).toBe("ok");
    expect(healthOf(def, T("2026-10-01"), T("2026-10-02"))).toBe("failing");
    expect(healthOf(def, null, null)).toBe("never");
    expect(healthOf({ name: "b", module: "catalog" }, null, null)).toBe("manual");
  });
  it("合併狀態列與任務定義；沒跑過的任務也列出；最近失敗新到舊最多 10 筆", () => {
    const jobs = [
      { name: "sync_games", cron: "10 * * * *", module: "catalog" },
      { name: "never_ran", cron: "0 0 * * *", module: "catalog" },
    ];
    const rows = Array.from({ length: 12 }, (_, i) => state({ jobName: `f${i}`, lastFailureAt: T(`2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`), lastError: "boom", consecutiveFailures: 1 }));
    const v = buildSyncMonitorView([state({ jobName: "sync_games", lastSuccessAt: T("2026-10-28"), cursor: "abc", meta: { totals: 5 } }), ...rows], jobs);
    expect(v.rows.find((r) => r.name === "never_ran")?.health).toBe("never");
    expect(v.rows.find((r) => r.name === "sync_games")?.progress).toContain("cursor abc");
    expect(v.recentFailures).toHaveLength(10);
    expect(v.recentFailures[0]!.name).toBe("f11");
    expect(summarizeProgress(null, null)).toBeNull();
  });
});

describe("品牌拉霸機的時間與捲軸", () => {
  it("由左到右依序停下；最長品牌（後綴 8 字）約 0.9 秒內結束", () => {
    for (let i = 1; i < 12; i++) expect(slotDuration(i)).toBeGreaterThan(slotDuration(i - 1));
    expect(slotDuration(7)).toBeLessThanOrEqual(1000);
  });
  it("轉動方向看新舊標題在導覽下拉裡的先後：往後＝往上（1），往前＝往下（-1），不在清單裡＝往上", () => {
    expect(rollDirection("GameDex", "GameCalendar")).toBe(1);
    expect(rollDirection("GameCalendar", "GameDex")).toBe(-1);
    expect(rollDirection("GameRanking", "GameBase")).toBe(-1);
    expect(rollDirection("Nope", "GameBase")).toBe(1);
  });
  it("舊字到新字之間最多經過 2 個字母，沿字母表走；相同字母不轉", () => {
    expect(middleLetters("D", "T", 1)).toEqual(["I", "O"]); // D→T 17 步，平均分布
    expect(middleLetters("a", "c", 1)).toEqual(["b"]);
    expect(middleLetters("a", "b", 1)).toEqual([]);
    expect(middleLetters("e", "e", 1)).toEqual([]);
    expect(middleLetters("t", "d", -1)).toEqual(["o", "i"]); // 往下轉：沿字母表倒著走
    expect(middleLetters(undefined, "k", 1)).toEqual(["i", "j"]); // 舊字沒有字：新字前面連續的字母
    for (const [f, t2] of [["x", "b"], ["B", "Y"], ["m", "n"]] as const) expect(middleLetters(f, t2, 1).length).toBeLessThanOrEqual(2);
  });
  it("字母位移：同大小寫、Z 後接 A、非字母不動", () => {
    expect(shiftLetter("z", 1)).toBe("a");
    expect(shiftLetter("a", -1)).toBe("z");
    expect(shiftLetter("7", 1)).toBe("7");
  });
});
