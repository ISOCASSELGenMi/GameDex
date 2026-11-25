/**
 * 外部遊戲頁的二次驗證（05 §信心評分）：標題、發售日（±3 天、任一平台）、開發／發行商、平台。
 */
import { describe, expect, it } from "vitest";
import { hasForeignSupplementary, normalizeCompany, platformFamily, verifyExternalMatch } from "@/modules/catalog/use-cases/matching";
import type { ExternalFacts, OurGameFacts } from "@/modules/catalog/domain/entities";

const ours = (over: Partial<OurGameFacts> = {}): OurGameFacts => ({
  names: ["Butcher's Creek"],
  dates: ["2025-01-23"],
  companies: ["David Szymanski"],
  platforms: ["PC (Microsoft Windows)"],
  ...over,
});
const theirs = (over: Partial<ExternalFacts> = {}): ExternalFacts => ({
  title: "Butcher's Creek",
  releaseDate: "2025-01-23",
  companies: ["David Szymanski"],
  platforms: ["PC"],
  ...over,
});

describe("verifyExternalMatch", () => {
  it("標題完全相同＋日期相符＋公司相符 → 自動採用，信心 100", () => {
    expect(verifyExternalMatch(ours(), theirs())).toMatchObject({ decision: "adopt", confidencePct: 100 });
  });
  it("發售日容許 ±3 天，第 4 天就不算相符（改進覆核）", () => {
    expect(verifyExternalMatch(ours(), theirs({ releaseDate: "2025-01-26" })).decision).toBe("adopt");
    expect(verifyExternalMatch(ours(), theirs({ releaseDate: "2025-01-20" })).decision).toBe("adopt");
    expect(verifyExternalMatch(ours(), theirs({ releaseDate: "2025-01-27" })).decision).toBe("review");
  });
  it("各平台上架日不同：對方日期與我方任一平台的日期相符即可", () => {
    const multi = ours({ dates: ["2025-01-10", "2025-03-20", "2025-06-01"] });
    expect(verifyExternalMatch(multi, theirs({ releaseDate: "2025-03-22" })).decision).toBe("adopt");
    expect(verifyExternalMatch(multi, theirs({ releaseDate: "2025-06-03" })).decision).toBe("adopt");
    expect(verifyExternalMatch(multi, theirs({ releaseDate: "2025-04-15" })).decision).toBe("review");
  });
  it("標題只差一兩個字母（Golden Knight／Golden Right）→ 放棄，不進覆核", () => {
    const v = verifyExternalMatch(ours({ names: ["Golden Knight"] }), theirs({ title: "Golden Right" }));
    expect(v.decision).toBe("reject");
  });
  it("日期與每個平台都差超過一年：標題相同→覆核（可能是我方日期有誤）；標題不同→放棄", () => {
    expect(verifyExternalMatch(ours(), theirs({ releaseDate: "2018-05-05" })).decision).toBe("review");
    expect(verifyExternalMatch(ours({ names: ["Butchers Creek 2"] }), theirs({ releaseDate: "2018-05-05" })).decision).toBe("reject");
  });
  it("開發／發行商完全不同 → 即使標題與日期相符也只進覆核", () => {
    expect(verifyExternalMatch(ours(), theirs({ companies: ["Someone Else"] })).decision).toBe("review");
  });
  it("公司資料缺：靠平台相符仍可採用；公司與平台都沒有佐證 → 只進覆核", () => {
    expect(verifyExternalMatch(ours({ companies: [] }), theirs()).decision).toBe("adopt");
    expect(verifyExternalMatch(ours({ companies: [], platforms: [] }), theirs()).decision).toBe("review");
  });
  it("我方沒有日精度日期（未定日）→ 不能自動採用", () => {
    expect(verifyExternalMatch(ours({ dates: [] }), theirs()).decision).toBe("review");
  });
  it("非自動採用的信心不超過 89；採用至少 90", () => {
    expect(verifyExternalMatch(ours({ dates: [] }), theirs()).confidencePct).toBeLessThanOrEqual(89);
    expect(verifyExternalMatch(ours(), theirs()).confidencePct).toBeGreaterThanOrEqual(90);
  });
  it("頁面沒有標題 → 放棄（不猜）", () => {
    expect(verifyExternalMatch(ours(), theirs({ title: null })).decision).toBe("reject");
  });
});

describe("verifyExternalMatch：Steam 佐證", () => {
  const hint = (steamSlug: string | null | undefined) => ({ steamSlug, candidateSlug: "butchers-creek" });
  it("Steam 指向同一個 Metacritic 頁＝強證據：沒有公司／平台資料也能採用，信心提高", () => {
    const o = ours({ companies: [], platforms: [] });
    expect(verifyExternalMatch(o, theirs()).decision).toBe("review");
    const v = verifyExternalMatch(o, theirs(), hint("butchers-creek"));
    expect(v.decision).toBe("adopt");
    expect(v.confidencePct).toBeGreaterThanOrEqual(90);
  });
  it("Steam 指向別的頁 → 即使標題、日期、公司都相符也進覆核，信心 ≤ 60", () => {
    const v = verifyExternalMatch(ours(), theirs(), hint("butchers-creek-2"));
    expect(v.decision).toBe("review");
    expect(v.confidencePct).toBeLessThanOrEqual(60);
  });
  it("Steam 沒有記錄（null／undefined）＝未知，不影響原本的判斷", () => {
    for (const s of [null, undefined]) {
      expect(verifyExternalMatch(ours(), theirs(), hint(s))).toEqual(verifyExternalMatch(ours(), theirs()));
    }
  });
  it("我方日期未知時 Steam 相符可採用；日期偏離（off）時 Steam 相符也只進覆核", () => {
    const o = ours({ dates: [], companies: [], platforms: [] });
    expect(verifyExternalMatch(o, theirs(), hint("butchers-creek")).decision).toBe("adopt");
    const off = ours({ dates: ["2025-04-01"], companies: [], platforms: [] });
    expect(verifyExternalMatch(off, theirs(), hint("butchers-creek")).decision).toBe("review");
  });
  it("標題不符仍然放棄（Steam 相符也不能救）", () => {
    expect(verifyExternalMatch(ours({ names: ["Totally Other"] }), theirs(), hint("butchers-creek")).decision).toBe("reject");
  });
});

describe("追加內容頁（Season Pass／Pack／DLC）不是遊戲本體", () => {
  it("hasForeignSupplementary：對方有追加內容字樣而我方沒有 → true；我方也有同樣字樣 → false", () => {
    expect(hasForeignSupplementary(["Sonic Racing: CrossWorlds"], "Sonic Racing: CrossWorlds - TMNT Pack")).toBe(true);
    expect(hasForeignSupplementary(["Fatal Fury: City of the Wolves - Deluxe Edition"], "fatal fury city of the wolves season pass 2")).toBe(true);
    expect(hasForeignSupplementary(["Some Game"], "Some Game Expansion")).toBe(true);
    expect(hasForeignSupplementary(["Some Game Season Pass"], "Some Game - Season Pass")).toBe(false);
    expect(hasForeignSupplementary(["Pack Rat"], "Pack Rat")).toBe(false);
  });
  it("字樣要是整個字：Backpack、Package、Expansive 不算", () => {
    expect(hasForeignSupplementary(["Some Game"], "Backpack Hero")).toBe(false);
    expect(hasForeignSupplementary(["Some Game"], "Package Delivery")).toBe(false);
    expect(hasForeignSupplementary(["Some Game"], "Expansive World")).toBe(false);
  });
  it("verifyExternalMatch：頁面是追加內容頁 → 放棄（即使日期、公司都相符）", () => {
    const v = verifyExternalMatch(
      ours({ names: ["Sonic Racing: CrossWorlds"], companies: ["Sega"], dates: ["2025-09-25"] }),
      theirs({ title: "Sonic Racing: CrossWorlds - TMNT Pack", releaseDate: "2025-09-25", companies: ["Sega"] }),
    );
    expect(v.decision).toBe("reject");
    expect(v.reasons).toContain("supplementary page");
  });
  it("我方就是 DLC／Pack 本身時，同名頁面不受影響", () => {
    const v = verifyExternalMatch(ours({ names: ["Some Game: Expansion Pack"] }), theirs({ title: "Some Game: Expansion Pack" }));
    expect(v.decision).toBe("adopt");
  });
});

describe("normalizeCompany／platformFamily", () => {
  it("去掉公司型態字尾與 Games／Studio 之類的雜詞", () => {
    expect(normalizeCompany("Acme Games, Inc.")).toBe(normalizeCompany("Acme"));
    expect(normalizeCompany("Nintendo Co., Ltd.")).toBe("nintendo");
  });
  it("PC 家族：Metacritic 的 PC 對上我方的 Windows／Mac／Linux", () => {
    expect(platformFamily("PC")).toBe("pc");
    expect(platformFamily("PC (Microsoft Windows)")).toBe("pc");
    expect(platformFamily("Linux")).toBe("pc");
    expect(platformFamily("PlayStation 5")).toBe("ps5");
    expect(platformFamily("Xbox Series X|S")).toBe("xbox-series");
    expect(platformFamily("Nintendo Switch")).toBe("switch");
  });
});
