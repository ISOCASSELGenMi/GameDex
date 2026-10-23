// 改期歷史文字（releaseHistoryText；舊時間軸的卡片／cursor／分組函式已於 D85 刪除）。
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import { releaseHistoryText } from "@/modules/catalog/ui/release-history";

const tEn = createTranslator("en");

describe("releaseHistoryText", () => {
  it("舊 → 新（更新日）；沒有 changedAt 時只有變化", () => {
    const out = releaseHistoryText(
      [
        { oldDate: "2026-12-31", oldPrecision: "day", newDate: "2027-03-31", newPrecision: "quarter", changedAt: "2026-09-01T00:00:00Z" },
        { oldDate: null, oldPrecision: null, newDate: "2026-05-01", newPrecision: "day", changedAt: null },
      ],
      "en",
      tEn,
    );
    expect(out[0]).toContain("→");
    expect(out[0]).toContain("September 1, 2026");
    expect(out[1]).not.toContain("(");
  });
});
