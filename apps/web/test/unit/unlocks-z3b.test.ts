/** Z3B 單元測試：合約與 domain 常數一致、key 驗證、伺服器合併規則（純函式）、manifest、客戶端同步器。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UNLOCK_ACHIEVEMENT_KEYS,
  UNLOCK_TYPES as CONTRACT_TYPES,
  getUnlockSync,
  isValidUnlock,
  mergeUnlocks,
  registerUnlockSync,
  type UnlockRecord,
} from "@/kernel/ui/unlocks";
import { accountsModule } from "@/modules/accounts/module";
import { ACCOUNT_DERIVED_ACHIEVEMENTS, ALL_ACHIEVEMENT_PREREQUISITES, UNLOCK_POST_MAX, UNLOCK_TYPES } from "@/modules/accounts/domain/entities/unlocks";
import { UNLOCK_FUTURE_SKEW_MS, filterAllAchievements, normalizeIncomingUnlocks } from "@/modules/accounts/use-cases/unlocks";
import { accountUnlockSync } from "@/modules/accounts/ui/unlocks-api";

const NOW = new Date("2026-10-23T00:00:00.000Z");
const rec = (type: UnlockRecord["type"], key: string, at: string): UnlockRecord => ({ type, key, at });

describe("domain 常數與合約一致", () => {
  it("UNLOCK_TYPES 與 kernel 合約相同", () => {
    expect([...UNLOCK_TYPES]).toEqual([...CONTRACT_TYPES]);
  });
  it("帳號判定的成就與 all-achievements 前置都是合約裡的成就 key", () => {
    for (const k of [...ACCOUNT_DERIVED_ACHIEVEMENTS, ...ALL_ACHIEVEMENT_PREREQUISITES]) expect(UNLOCK_ACHIEVEMENT_KEYS as readonly string[]).toContain(k);
    expect(ALL_ACHIEVEMENT_PREREQUISITES.length).toBe(UNLOCK_ACHIEVEMENT_KEYS.length - 1);
    expect(UNLOCK_POST_MAX).toBe(100);
  });
});

describe("key 驗證", () => {
  it("認得的通過、未知 type／key／壞時間丟掉", () => {
    expect(isValidUnlock(rec("theme", "gold", "2026-01-01T00:00:00Z"))).toBe(true);
    expect(isValidUnlock(rec("theme", "cd", "2026-01-01T00:00:00Z"))).toBe(false);
    expect(isValidUnlock({ type: "x", key: "gold", at: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(isValidUnlock(rec("theme", "gold", "nope"))).toBe(false);
    expect(isValidUnlock(null)).toBe(false);
  });
});

describe("伺服器合併規則", () => {
  it("去重取較早、丟棄未知、輸出排序且為 ISO", () => {
    const out = normalizeIncomingUnlocks(
      [rec("theme", "gold", "2026-03-02T00:00:00Z"), rec("theme", "gold", "2026-03-01T00:00:00Z"), rec("theme", "nope", "2026-03-01T00:00:00Z"), "x", rec("collectible", "cd", "2026-01-01T00:00:00Z")],
      NOW,
    );
    expect(out).toEqual([rec("collectible", "cd", "2026-01-01T00:00:00.000Z"), rec("theme", "gold", "2026-03-01T00:00:00.000Z")]);
  });
  it("未來時間夾到 now，容忍時鐘誤差內不動", () => {
    const within = new Date(NOW.getTime() + UNLOCK_FUTURE_SKEW_MS - 1000).toISOString();
    const out = normalizeIncomingUnlocks([rec("theme", "gold", "2999-01-01T00:00:00Z"), rec("theme", "coding", within)], NOW);
    expect(out.find((r) => r.key === "gold")!.at).toBe(NOW.toISOString());
    expect(out.find((r) => r.key === "coding")!.at).toBe(within);
  });
  it("mergeUnlocks 本身冪等", () => {
    const a = [rec("theme", "gold", "2026-03-01T00:00:00.000Z")];
    expect(mergeUnlocks(a, a)).toEqual(a);
  });
  it("all-achievements 只在其他成就齊全時保留", () => {
    const all = rec("achievement", "all-achievements", "2026-04-01T00:00:00.000Z");
    expect(filterAllAchievements([all], new Set(["first-follow"]))).toEqual([]);
    expect(filterAllAchievements([all], new Set(ALL_ACHIEVEMENT_PREREQUISITES))).toEqual([all]);
    const other = rec("theme", "gold", "2026-04-01T00:00:00.000Z");
    expect(filterAllAchievements([other, all], new Set())).toEqual([other]);
  });
});

describe("manifest", () => {
  it("user_unlocks 列在 ownedTables", () => {
    expect(accountsModule.ownedTables).toContain("user_unlocks");
  });
});

describe("客戶端同步器 push", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    registerUnlockSync(null);
  });
  const local = [rec("theme", "gold", "2026-03-01T00:00:00.000Z")];

  it("成功時回傳伺服器合併後的清單，POST 到 /api/v1/me/unlocks", async () => {
    const merged = [...local, rec("collectible", "cd", "2026-03-02T00:00:00.000Z")];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ unlocks: merged }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await accountUnlockSync.push(local)).toEqual(merged);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/me/unlocks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ unlocks: local });
  });
  it("超過 100 筆分批送", async () => {
    const many = Array.from({ length: 150 }, () => local[0]!);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ unlocks: local }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await accountUnlockSync.push(many);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("失敗（403／網路錯誤）時退回本機清單、不丟例外", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "account_suspended" }), { status: 403 })));
    expect(await accountUnlockSync.push(local)).toEqual(local);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await accountUnlockSync.push(local)).toEqual(local);
  });
  it("registerUnlockSync 掛上與移除", () => {
    registerUnlockSync(accountUnlockSync);
    expect(getUnlockSync()).toBe(accountUnlockSync);
    registerUnlockSync(null);
    expect(getUnlockSync()).toBeNull();
  });
});
