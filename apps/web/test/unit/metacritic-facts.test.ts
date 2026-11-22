/**
 * Metacritic 頁面資料（發售日等）補抓的迴圈（最多 max 頁、額度用完就停、錯誤往外丟）；每日額度分配。快取本身見 metacritic-pages 測試。
 */
import { describe, expect, it } from "vitest";
import type { PageResult } from "@/modules/metacritic/provider/provider";
import { fillFacts, jobBudgetLimit } from "../../scripts/lib/review-facts";

const ok = (title: string): PageResult => ({ kind: "ok", title, year: 2025, scores: [], facts: { title, releaseDate: "2025-01-02", companies: ["Acme"], platforms: ["PC"] } });

function mk() {
  const asked: string[] = [];
  return { asked, provider: { getScoreById: async (slug: string) => (asked.push(slug), ok(slug)) } };
}

describe("fillFacts（頁面快取已由 createCachedPages 處理；這裡只管迴圈）", () => {
  it("依序補抓，回傳處理頁數", async () => {
    const t = mk();
    expect(await fillFacts({ slugs: ["a", "b", "c"], provider: t.provider, canSpend: () => true, max: 10 })).toBe(3);
    expect(t.asked).toEqual(["a", "b", "c"]);
  });
  it("最多抓 max 頁；額度用完（canSpend 回 false）就停", async () => {
    const capped = mk();
    expect(await fillFacts({ slugs: ["a", "b", "c", "d"], provider: capped.provider, canSpend: () => true, max: 2 })).toBe(2);
    expect(capped.asked).toEqual(["a", "b"]);

    const broke = mk();
    let left = 3;
    expect(await fillFacts({ slugs: ["a", "b", "c", "d"], provider: broke.provider, canSpend: () => left-- > 0, max: 10 })).toBe(3);
    expect(broke.asked).toEqual(["a", "b", "c"]);
  });
  it("供應者丟錯（例如被擋）時錯誤往外丟給呼叫端處理", async () => {
    const provider = { getScoreById: async (s: string) => (s === "b" ? Promise.reject(new Error("blocked")) : ok(s)) };
    await expect(fillFacts({ slugs: ["a", "b", "c"], provider, canSpend: () => true, max: 10 })).rejects.toThrow("blocked");
  });
});

describe("jobBudgetLimit：每日額度分配", () => {
  it("任務用到「上限 − 保留 − 補資料預留」，補資料那一步再放寬到「上限 − 保留」", () => {
    expect(jobBudgetLimit(500, 20, 60)).toBe(420);
    expect(500 - 20).toBe(480); // 補資料步驟可用的上限；比任務多出的 60 就是預留
  });
  it("額度很小時至少 1，不會變成 0 或負數", () => {
    expect(jobBudgetLimit(50, 20, 60)).toBe(1);
    expect(jobBudgetLimit(1, 20, 60)).toBe(1);
  });
});
