import { describe, expect, it } from "vitest";
import { addDays, isoWeekOf, parseWeekParam, weekDays, weekStartOf } from "@/modules/catalog/ui/timeline/week";
import { resolveWeekStart } from "@/modules/catalog/ui/timeline/week-server";

describe("時間軸週的純函式（ISO 週，週一起算，UTC）", () => {
  it("weekStartOf：週中、週日、週一都回到該週星期一", () => {
    expect(weekStartOf("2037-03-02")).toBe("2037-03-02"); // 週一
    expect(weekStartOf("2037-03-04")).toBe("2037-03-02");
    expect(weekStartOf("2037-03-08")).toBe("2037-03-02"); // 週日
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19");
    expect(weekStartOf("2026-02-31")).toBeNull();
    expect(weekStartOf("nope")).toBeNull();
  });

  it("isoWeekOf：跨年以星期四所在年為準", () => {
    expect(isoWeekOf("2037-03-02")).toBe("2037-W10");
    expect(isoWeekOf("2026-10-19")).toBe("2026-W43");
    expect(isoWeekOf("2026-12-31")).toBe("2026-W53");
    expect(isoWeekOf("2027-01-03")).toBe("2026-W53");
    expect(isoWeekOf("2027-01-04")).toBe("2027-W01");
    expect(isoWeekOf("2024-12-30")).toBe("2025-W01");
  });

  it("parseWeekParam：往返一致；格式錯、不存在的第 53 週、超出年份範圍 → null", () => {
    expect(parseWeekParam("2037-W10")).toBe("2037-03-02");
    expect(parseWeekParam("2026-W43")).toBe("2026-10-19");
    expect(parseWeekParam("2026-W53")).toBe("2026-12-28");
    expect(parseWeekParam("2027-W53")).toBeNull();
    expect(parseWeekParam("2026-W00")).toBeNull();
    expect(parseWeekParam("2026-W54")).toBeNull();
    expect(parseWeekParam("2026-43")).toBeNull();
    expect(parseWeekParam("1800-W10")).toBeNull();
    for (const d of ["2020-01-01", "2021-01-03", "2026-07-15", "2033-12-31", "2100-06-30"]) {
      const w = isoWeekOf(d)!;
      expect(parseWeekParam(w)).toBe(weekStartOf(d));
    }
  });

  it("addDays／weekDays：跨月、跨年；超出可用年份範圍 → null", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2200-12-31", 1)).toBeNull();
    expect(addDays("1900-01-01", -1)).toBeNull();
    expect(weekDays("2026-10-19")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  });

  it("resolveWeekStart：week 優先，其次 at，最後今天；不合法的值被略過", () => {
    const today = "2026-10-21" as const;
    expect(resolveWeekStart({ week: "2037-W10", at: "2026-01-01" }, today)).toBe("2037-03-02");
    expect(resolveWeekStart({ week: "bad", at: "2037-03-10" }, today)).toBe("2037-03-09");
    expect(resolveWeekStart({ week: null, at: "2037-02-30" }, today)).toBe("2026-10-19");
    expect(resolveWeekStart({}, today)).toBe("2026-10-19");
  });
});
