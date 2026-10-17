/** Phase 7 第 6 波畫面：追蹤／我的遊戲／私人行事曆的純函式、熱度文案，以及 UI 原始碼引用的字典 key 三語都存在。 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGES, createTranslator, flattenMessages, formatReleaseLabel, type Locale } from "@sok/i18n";
import { FOLLOW_TARGETS } from "@/modules/accounts/domain/entities/follows";
import { checkDateRange, followTargetHref, formatMyGameDate, maskFeedUrl, mineValue, type ReleasePrecision } from "@/modules/accounts/ui/follow-format";
import { accountFollowsHref, accountGamesHref, accountPrivateCalendarHref } from "@/modules/accounts/ui/links";
import { accountStrings } from "@/modules/accounts/ui/strings";
import { followerCountLabel } from "@/modules/catalog/ui/heat-badge";

const LOCALES: Locale[] = ["zh-Hant", "en", "ja"];

describe("formatMyGameDate 與 formatReleaseLabel（@sok/i18n）逐一一致", () => {
  const cases: { date: string | null; precision: ReleasePrecision }[] = [
    { date: "2027-05-03", precision: "day" },
    { date: "2027-05-01", precision: "month" },
    { date: "2027-09-30", precision: "quarter" },
    { date: "2027-03-31", precision: "quarter" },
    { date: "2028-12-31", precision: "year" },
    { date: null, precision: "tbd" },
    { date: "2027-05-03", precision: "tbd" },
    { date: null, precision: "day" },
    { date: "2026-02-30", precision: "day" },
  ];
  for (const locale of LOCALES) {
    it(`${locale}：五種精度與不合法日期`, () => {
      const strings = accountStrings(locale, ["mygames."]);
      for (const c of cases) {
        expect(formatMyGameDate(strings, locale, c.date, c.precision), `${c.date} ${c.precision}`).toBe(formatReleaseLabel(c.date, c.precision, locale));
      }
    });
  }
});

describe("followTargetHref", () => {
  it("五種目標；系列的 collection 帶 kind；slug 會編碼", () => {
    expect(followTargetHref("en", { targetType: "game", slug: "elden-ring" })).toBe("/en/games/elden-ring");
    expect(followTargetHref("ja", { targetType: "event", slug: "gamescom-2026" })).toBe("/ja/events/gamescom-2026");
    expect(followTargetHref("zh-Hant", { targetType: "platform", slug: "ps5" })).toBe("/zh-Hant/platforms/ps5");
    expect(followTargetHref("en", { targetType: "company", slug: "a b" })).toBe("/en/companies/a%20b");
    expect(followTargetHref("en", { targetType: "franchise", slug: "zelda", kind: "franchise" })).toBe("/en/franchises/zelda");
    expect(followTargetHref("en", { targetType: "franchise", slug: "zelda", kind: "collection" })).toBe("/en/franchises/zelda?kind=collection");
  });
  it("帳號子頁網址", () => {
    expect(accountFollowsHref("en")).toBe("/en/account/follows");
    expect(accountGamesHref("en")).toBe("/en/account/games");
    expect(accountGamesHref("en", "mine=owned")).toBe("/en/account/games?mine=owned");
    expect(accountPrivateCalendarHref("ja")).toBe("/ja/account/calendar");
  });
});

describe("mineValue／checkDateRange", () => {
  it("mine：三個固定值與 list:<id>", () => {
    expect(mineValue("followed")).toBe("followed");
    expect(mineValue("owned")).toBe("owned");
    expect(mineValue("collected")).toBe("collected");
    expect(mineValue("list:12")).toBe("list:12");
    for (const bad of ["", "list:", "list:0", "list:-1", "list:1a", "all", "followed,owned", "list:12345678901"]) expect(mineValue(bad), bad).toBeNull();
  });
  it("日期範圍：空＝可；格式錯誤；to 早於 from", () => {
    expect(checkDateRange("", "")).toBeNull();
    expect(checkDateRange("2027-01-01", "")).toBeNull();
    expect(checkDateRange("2027-01-01", "2027-01-01")).toBeNull();
    expect(checkDateRange("2027-01-02", "2027-01-01")).toBe("before_from");
    expect(checkDateRange("2027-1-2", "")).toBe("invalid");
    expect(checkDateRange("", "abc")).toBe("invalid");
  });
});

describe("maskFeedUrl", () => {
  it("遮罩後不含 token，只留來源與路徑前綴", () => {
    const token = "A".repeat(43);
    const masked = maskFeedUrl(`https://sok.example/ical/u/${token}.ics`);
    expect(masked).toBe(`https://sok.example/ical/u/${"•".repeat(12)}`);
    expect(masked).not.toContain(token);
    expect(maskFeedUrl("not a url")).not.toContain("not");
  });
});

describe("followerCountLabel（詳情頁熱度）", () => {
  for (const locale of LOCALES) {
    const t = createTranslator(locale, ["ui"]);
    it(`${locale}：null／0／非法不顯示；正整數用 compact`, () => {
      expect(followerCountLabel(t, locale, null)).toBeNull();
      expect(followerCountLabel(t, locale, undefined)).toBeNull();
      expect(followerCountLabel(t, locale, 0)).toBeNull();
      expect(followerCountLabel(t, locale, Number.NaN)).toBeNull();
      expect(followerCountLabel(t, locale, 7)).toContain("7");
      expect(followerCountLabel(t, locale, 12345)).not.toContain("12345");
    });
  }
  it("en 與 zh-Hant 的 compact 格式", () => {
    expect(followerCountLabel(createTranslator("en", ["ui"]), "en", 1234)).toBe("1.2K following");
    expect(followerCountLabel(createTranslator("zh-Hant", ["ui"]), "zh-Hant", 12345)).toBe("1.2萬 人追蹤");
  });
});

describe("UI 原始碼引用的字典 key 三語都存在", () => {
  const uiDir = path.resolve(__dirname, "../../src/modules/accounts/ui");
  const files = readdirSync(uiDir).filter((f) => /\.(tsx?|ts)$/.test(f));
  const used = new Set<string>();
  for (const f of files) {
    const src = readFileSync(path.join(uiDir, f), "utf8");
    for (const m of src.matchAll(/\bstr\(\s*\w+,\s*"([A-Za-z0-9_.]+)"/g)) used.add(m[1]!);
  }
  // 動態 key：由程式組合
  for (const t of FOLLOW_TARGETS) used.add(`follows.type.${t}`);
  for (const s of ["delayed", "released", "cancelled"]) used.add(`mygames.status.${s}`);
  for (const s of ["unspecified", "full", "early_access", "beta", "alpha", "demo", "other"]) used.add(`feedcal.stage.${s}`);
  for (const k of ["console", "handheld", "pc", "arcade", "other"]) used.add(`feedcal.kind.${k}`);
  for (const l of LOCALES) used.add(`feedcal.locale.${l}`);
  for (const k of ["event", "group"]) used.add(`follow.hint.${k}`);
  for (const k of ["quarter", "year", "tbd"]) used.add(`mygames.date.${k}`);
  for (const k of ["followed", "owned", "collected", "list"]) used.add(`mygames.source.${k}`);

  it("有引用到 key（掃描有效）", () => {
    expect(used.size).toBeGreaterThan(100);
  });
  for (const locale of LOCALES) {
    it(`${locale} 全部存在`, () => {
      const keys = new Set(flattenMessages(MESSAGES[locale].accounts).keys());
      const missing = [...used].filter((k) => !keys.has(k));
      expect(missing).toEqual([]);
    });
    it(`${locale}：catalog 的 ui 字典有熱度與依據說明`, () => {
      const keys = new Set(flattenMessages(MESSAGES[locale].ui).keys());
      for (const k of ["heat.followers", "heat.rising", "trending.rankedBy.popularity", "trending.rankedBy.site_follows_7d"]) expect(keys.has(k), k).toBe(true);
    });
  }
});
