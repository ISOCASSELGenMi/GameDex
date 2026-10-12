import { describe, expect, it } from "vitest";
import { getCoreEnv } from "@/kernel/config/env";
import { lockKeyPair } from "@/kernel/db/locks";
import { isModuleEnabled, parseModules } from "@/kernel/modules/enabled";
import { validateModules } from "@/kernel/modules/startup";
import type { ModuleManifestBase } from "@/kernel/modules/types";

const DB = "postgres://u:p@localhost:5432/x";

describe("getCoreEnv（fail closed）", () => {
  it("缺 DATABASE_URL → 丟 ConfigError", () => {
    expect(() => getCoreEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
  });
  it("空字串視為未設", () => {
    expect(() => getCoreEnv({ DATABASE_URL: "  " })).toThrow(/DATABASE_URL/);
  });
  it("預設值：三語系、zh-Hant、WW、metacritic 關閉", () => {
    const env = getCoreEnv({ DATABASE_URL: DB });
    expect(env.SUPPORTED_LOCALES).toEqual(["zh-Hant", "en", "ja"]);
    expect(env.DEFAULT_LOCALE).toBe("zh-Hant");
    expect(env.DEFAULT_REGION_PREF).toBe("WW");
    expect(env.METACRITIC_SCRAPE_ENABLED).toBe(false);
  });
  it("DEFAULT_LOCALE 不在 SUPPORTED_LOCALES → 拒絕", () => {
    expect(() => getCoreEnv({ DATABASE_URL: DB, DEFAULT_LOCALE: "ko" })).toThrow(/DEFAULT_LOCALE/);
  });
});

describe("模組啟用", () => {
  it("MODULES 未設 → 預設 accounts,discord,admin；none → 空", () => {
    expect([...parseModules(undefined)].sort()).toEqual(["accounts", "admin", "discord"]);
    expect(parseModules("").size).toBe(3);
    expect(parseModules("none").size).toBe(0);
  });
  it("catalog 永遠啟用；metacritic 只認 METACRITIC_SCRAPE_ENABLED", () => {
    expect(isModuleEnabled("catalog", { MODULES: "none" })).toBe(true);
    expect(isModuleEnabled("metacritic", { MODULES: "metacritic" })).toBe(false);
    expect(isModuleEnabled("metacritic", { METACRITIC_SCRAPE_ENABLED: "true", MODULES: "none" })).toBe(true);
    expect(isModuleEnabled("awards", {})).toBe(false); // 需明確列入
    expect(isModuleEnabled("awards", { MODULES: "awards" })).toBe(true);
  });
});

describe("啟動檢查", () => {
  const m = (over: Partial<ModuleManifestBase>): ModuleManifestBase => ({
    name: "x", kind: "optional", requires: [], requiredEnv: [], ownedTables: [], ...over,
  });
  it("requires 未啟用、requiredEnv 缺少、MODULES 打錯字 → 一次列出全部問題", () => {
    const run = () =>
      validateModules(
        [m({ name: "notifications", requires: ["accounts"], requiredEnv: ["EMAIL_API_KEY"] })],
        { MODULES: "notifications,acounts", EMAIL_API_KEY: "" },
      );
    expect(run).toThrow(/需要 accounts/);
    expect(run).toThrow(/EMAIL_API_KEY/);
    expect(run).toThrow(/acounts/);
  });
  it("任務名稱重複 → 拒絕（鎖名必須唯一）", () => {
    const job = { name: "sync_games", cron: "0 * * * *", run: async () => undefined };
    expect(() => validateModules([m({ name: "a", jobs: [job] }), m({ name: "b", jobs: [job] })], { MODULES: "none" })).toThrow(/重複/);
  });
  it("core-only（MODULES=none）時 catalog 單獨通過", () => {
    expect(() => validateModules([m({ name: "catalog", kind: "core", requiredEnv: ["DATABASE_URL"] })], { MODULES: "none", DATABASE_URL: DB })).not.toThrow();
  });
});

describe("advisory lock key", () => {
  it("穩定、落在 int4 範圍、不同名稱不同 key", () => {
    const a = lockKeyPair("sync_games");
    expect(lockKeyPair("sync_games")).toEqual(a);
    for (const k of a) expect(k >= -(2 ** 31) && k < 2 ** 31).toBe(true);
    expect(lockKeyPair("sync_events")).not.toEqual(a);
  });
});
