/**
 * Phase 7 第 7 波：偏好驗證、時區、CSV（跳脫與公式注入）、匯出分段、限流、下載檔名，以及新畫面動態組合的字典 key 三語都存在。
 * 純函式，不連資料庫。
 */
import { describe, expect, it } from "vitest";
import { MESSAGES, flattenMessages, type Locale } from "@sok/i18n";
import { exportCsvPart } from "@/modules/accounts/domain/entities/account-export-csv";
import {
  EXPORT_CSV_PARTS,
  EXPORT_VERSION,
  PREFERRED_PLATFORMS_MAX,
  REAUTH_WINDOW_SECONDS,
  csvCell,
  isExportCsvPart,
  isValidTimeZone,
  parseDeleteBody,
  toCsv,
  validatePreferencesPatch,
  type AccountExport,
} from "@/modules/accounts/domain/entities/account-self";
import { filenameFromDisposition, exportUrl } from "@/modules/accounts/ui/account-self-api";
import { consumeRate, resetRateLimitsForTests } from "@/modules/accounts/use-cases/rate-limit";

const LOCALES: Locale[] = ["zh-Hant", "en", "ja"];
const deps = {
  isSupportedLocale: (v: string) => ["zh-Hant", "en", "ja"].includes(v),
  normalizeRegion: (v: string) => (["WW", "JP", "NA"].includes(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null),
  isKnownScoreProvider: (v: string) => ["igdb", "metacritic_scrape"].includes(v),
};

describe("isValidTimeZone", () => {
  it("接受 IANA 名稱", () => {
    for (const z of ["Asia/Taipei", "UTC", "America/Argentina/Buenos_Aires", "Europe/London", "America/Port-au-Prince"]) expect(isValidTimeZone(z), z).toBe(true);
  });
  it("拒絕位移、空字串、亂字串、過長", () => {
    for (const z of ["", "+08:00", "UTC+8", "Not/AZone", "Asia/", "/Taipei", "Asia Taipei", "a".repeat(65), "Asia/Taipei\n"]) expect(isValidTimeZone(z), z).toBe(false);
  });
});

describe("validatePreferencesPatch", () => {
  it("非物件、空物件 → body 錯誤", () => {
    expect(validatePreferencesPatch(null, deps)).toEqual({ ok: false, fields: { body: "invalid" } });
    expect(validatePreferencesPatch([], deps)).toEqual({ ok: false, fields: { body: "invalid" } });
    expect(validatePreferencesPatch({}, deps)).toEqual({ ok: false, fields: { body: "empty" } });
    expect(validatePreferencesPatch({ unknownField: 1 }, deps)).toEqual({ ok: false, fields: { body: "empty" } });
  });

  it("全部欄位的合法值（trim、去重、地區轉大寫）", () => {
    const v = validatePreferencesPatch(
      {
        displayName: "  Alice  ",
        locale: "ja",
        timezone: "Asia/Tokyo",
        preferredRegion: "jp",
        scoreProviders: ["igdb", "igdb", "metacritic_scrape"],
        preferredPlatformIds: [3, 3, 7],
        defaultListVisibility: "public",
        defaultReviewVisibility: "followers",
      },
      deps,
    );
    expect(v).toEqual({
      ok: true,
      value: {
        displayName: "Alice",
        locale: "ja",
        timezone: "Asia/Tokyo",
        preferredRegion: "JP",
        scoreProviders: ["igdb", "metacritic_scrape"],
        preferredPlatformIds: [3, 7],
        defaultListVisibility: "public",
        defaultReviewVisibility: "followers",
      },
    });
  });

  it("可清除的欄位傳 null；scoreProviders 空陣列合法（什麼都不顯示）", () => {
    expect(validatePreferencesPatch({ locale: null, timezone: null, preferredRegion: null, scoreProviders: null }, deps)).toEqual({
      ok: true,
      value: { locale: null, timezone: null, preferredRegion: null, scoreProviders: null },
    });
    expect(validatePreferencesPatch({ scoreProviders: [], preferredPlatformIds: [] }, deps)).toEqual({ ok: true, value: { scoreProviders: [], preferredPlatformIds: [] } });
  });

  it("每個欄位的錯誤碼", () => {
    const bad = validatePreferencesPatch(
      {
        displayName: "   ",
        locale: "fr",
        timezone: "UTC+8",
        preferredRegion: "ZZ",
        scoreProviders: ["foo"],
        preferredPlatformIds: [0],
        defaultListVisibility: "friends",
        defaultReviewVisibility: "everyone",
      },
      deps,
    );
    expect(bad).toEqual({
      ok: false,
      fields: {
        displayName: "required",
        locale: "invalid",
        timezone: "invalid",
        preferredRegion: "invalid",
        scoreProviders: "invalid",
        preferredPlatformIds: "invalid",
        defaultListVisibility: "invalid",
        defaultReviewVisibility: "invalid",
      },
    });
    expect(validatePreferencesPatch({ displayName: "x".repeat(101) }, deps)).toEqual({ ok: false, fields: { displayName: "too_long" } });
    expect(validatePreferencesPatch({ displayName: null }, deps)).toEqual({ ok: false, fields: { displayName: "required" } });
    expect(validatePreferencesPatch({ preferredPlatformIds: Array.from({ length: PREFERRED_PLATFORMS_MAX + 1 }, (_, i) => i + 1) }, deps)).toEqual({ ok: false, fields: { preferredPlatformIds: "too_many" } });
    expect(validatePreferencesPatch({ preferredPlatformIds: "1" }, deps)).toEqual({ ok: false, fields: { preferredPlatformIds: "invalid" } });
    expect(validatePreferencesPatch({ preferredPlatformIds: [1.5] }, deps)).toEqual({ ok: false, fields: { preferredPlatformIds: "invalid" } });
    expect(validatePreferencesPatch({ preferredPlatformIds: ["1"] }, deps)).toEqual({ ok: false, fields: { preferredPlatformIds: "invalid" } });
    expect(validatePreferencesPatch({ scoreProviders: "igdb" }, deps)).toEqual({ ok: false, fields: { scoreProviders: "invalid" } });
    expect(validatePreferencesPatch({ locale: 5 }, deps)).toEqual({ ok: false, fields: { locale: "invalid" } });
  });
});

describe("parseDeleteBody", () => {
  it("沒有 body、沒有 password → null；有字串 → 原樣（不 trim）", () => {
    expect(parseDeleteBody(undefined)).toEqual({ ok: true, value: { password: null } });
    expect(parseDeleteBody(null)).toEqual({ ok: true, value: { password: null } });
    expect(parseDeleteBody({})).toEqual({ ok: true, value: { password: null } });
    expect(parseDeleteBody({ password: " pw " })).toEqual({ ok: true, value: { password: " pw " } });
  });
  it("型別錯誤", () => {
    expect(parseDeleteBody("x")).toEqual({ ok: false, fields: { body: "invalid" } });
    expect(parseDeleteBody({ password: 123 })).toEqual({ ok: false, fields: { password: "invalid" } });
    expect(parseDeleteBody({ password: "x".repeat(1025) })).toEqual({ ok: false, fields: { password: "invalid" } });
  });
});

describe("CSV 儲存格：跳脫與公式注入", () => {
  it("公式開頭字元（= + - @ Tab CR）前面加單引號", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=1")).toBe("'\t=1");
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
  it("一般字串、空字串、null／undefined 不加引號", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("")).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("含逗號、雙引號、換行的欄位用雙引號包起來，雙引號加倍", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
  it("數字、布林、日期不是使用者輸入的文字，不加單引號（負數照寫）", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(7.5)).toBe("7.5");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(false)).toBe("false");
    expect(csvCell(new Date("2026-10-17T01:02:03Z"))).toBe("2026-10-17T01:02:03.000Z");
  });
  it("toCsv：UTF-8 BOM、CRLF、表頭、結尾換行", () => {
    const text = toCsv(["a", "b"], [{ a: "x", b: 1 }, { a: "=y", b: null }]);
    expect(text).toBe("﻿a,b\r\nx,1\r\n'=y,\r\n");
    expect(toCsv(["a"], [])).toBe("﻿a\r\n");
  });
});

const SAMPLE: AccountExport = {
  exportVersion: EXPORT_VERSION,
  exportedAt: "2026-10-17T00:00:00.000Z",
  profile: { id: 1, displayName: "=Evil", email: "a@example.com", emailIsPlaceholder: false, emailVerified: true, handle: null, avatarUrl: null, role: "member", createdAt: "2026-10-01T00:00:00.000Z" },
  preferences: { locale: "ja", timezone: null, preferredRegion: "JP", scoreProviders: ["igdb"], preferredPlatformIds: [1, 2], defaultListVisibility: "private", defaultReviewVisibility: "public" },
  connections: [{ provider: "credential", connectedAt: "2026-10-01T00:00:00.000Z" }],
  lists: [
    {
      id: 5,
      name: "My, list",
      description: "-cmd",
      visibility: "private",
      sortOrder: 0,
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
      games: [{ gameId: 9, gameSlug: "g9", gameName: "Game 9", position: 0, note: "@x", addedAt: "2026-10-03T00:00:00.000Z" }],
    },
  ],
  playRecords: [
    {
      id: 1, gameId: 9, gameSlug: "g9", gameName: "Game 9", platformId: null, status: "finished", startedOn: null, finishedOn: "2026-10-04", playMinutes: 120, rating: 7.5,
      review: null, reviewHasSpoilers: false, reviewVisibility: "public", privateNote: "+secret", createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z",
    },
  ],
  follows: [{ targetType: "game", targetId: 9, targetSlug: "g9", targetName: "Game 9", followedAt: "2026-10-05T00:00:00.000Z" }],
  ownedGames: [
    { provider: "steam", externalGameId: "10", externalTitle: "Title", status: "matched", matchedGameId: 9, matchedGameSlug: "g9", matchedGameName: "Game 9", matchConfidencePct: 100, matchMethod: "auto", importedAt: "2026-10-06T00:00:00.000Z" },
  ],
  privateCalendar: null,
  unlocks: [],
};

describe("exportCsvPart", () => {
  it("六個分段都有表頭＋資料列，且都帶 BOM", () => {
    for (const part of EXPORT_CSV_PARTS) {
      const text = exportCsvPart(SAMPLE, part);
      expect(text.startsWith("﻿"), part).toBe(true);
      expect(text.split("\r\n").length, part).toBeGreaterThanOrEqual(3); // 表頭、資料、結尾空字串
    }
  });
  it("使用者輸入的文字做公式防護；陣列用分號連接；數字不加引號", () => {
    expect(exportCsvPart(SAMPLE, "profile")).toContain("'=Evil");
    expect(exportCsvPart(SAMPLE, "profile")).toContain("igdb,1;2,private,public");
    expect(exportCsvPart(SAMPLE, "lists")).toContain('"My, list"');
    expect(exportCsvPart(SAMPLE, "lists")).toContain("'-cmd");
    expect(exportCsvPart(SAMPLE, "list_games")).toContain("'@x");
    expect(exportCsvPart(SAMPLE, "plays")).toContain("'+secret");
    expect(exportCsvPart(SAMPLE, "plays")).toContain(",120,7.5,");
  });
  it("isExportCsvPart", () => {
    expect(isExportCsvPart("plays")).toBe(true);
    expect(isExportCsvPart("../etc/passwd")).toBe(false);
    expect(isExportCsvPart("")).toBe(false);
  });
});

describe("下載檔名與網址", () => {
  it("filenameFromDisposition 只接受簡單 ASCII 檔名", () => {
    expect(filenameFromDisposition('attachment; filename="sok-export-2026-10-17.json"', "x")).toBe("sok-export-2026-10-17.json");
    expect(filenameFromDisposition("attachment", "fallback.json")).toBe("fallback.json");
    expect(filenameFromDisposition(null, "fallback.json")).toBe("fallback.json");
    expect(filenameFromDisposition('attachment; filename="../../x.json"', "fallback.json")).not.toContain("/");
  });
  it("exportUrl", () => {
    expect(exportUrl({ format: "json" })).toBe("/api/v1/account/export?format=json");
    expect(exportUrl({ format: "csv", part: "list_games" })).toBe("/api/v1/account/export?format=csv&part=list_games");
  });
});

describe("固定視窗限流", () => {
  it("額度內允許、超過回 retryAfterSeconds、視窗過後重置、使用者之間互不影響", () => {
    resetRateLimitsForTests();
    const rule = { max: 2, windowMs: 1000 };
    expect(consumeRate("t", 1, rule, 0)).toEqual({ ok: true });
    expect(consumeRate("t", 1, rule, 100)).toEqual({ ok: true });
    expect(consumeRate("t", 1, rule, 200)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(consumeRate("t", 2, rule, 200)).toEqual({ ok: true });
    expect(consumeRate("other", 1, rule, 200)).toEqual({ ok: true });
    expect(consumeRate("t", 1, rule, 1001)).toEqual({ ok: true });
    resetRateLimitsForTests();
  });
});

describe("重新驗證視窗", () => {
  it("10 分鐘", () => {
    expect(REAUTH_WINDOW_SECONDS).toBe(600);
  });
});

describe("新畫面動態組合的字典 key 三語都存在", () => {
  const used = new Set<string>();
  for (const k of ["profile", "connections", "lists", "plays", "follows", "owned", "calendar"]) used.add(`privacy.export.includes.${k}`);
  for (const p of EXPORT_CSV_PARTS) used.add(`privacy.export.part.${p}`);
  for (const k of ["account", "lists", "plays", "follows", "owned", "calendar"]) used.add(`privacy.delete.removes.${k}`);
  for (const k of ["igdb", "metacritic_scrape"]) used.add(`settings.scoreProvider.${k}`);
  for (const v of ["public", "unlisted", "private"]) used.add(`list.visibility.${v}`);
  for (const v of ["public", "followers", "private"]) used.add(`play.visibility.${v}`);
  for (const locale of LOCALES) {
    it(`${locale}`, () => {
      const keys = new Set(flattenMessages(MESSAGES[locale].accounts).keys());
      expect([...used].filter((k) => !keys.has(k))).toEqual([]);
    });
  }
  it("隱私權政策有帳號相關段落（三語）", () => {
    for (const locale of LOCALES) {
      const keys = new Set(flattenMessages(MESSAGES[locale].about).keys());
      for (const k of ["accounts", "accountVisibility", "accountRetention"]) {
        expect(keys.has(`privacy.sections.${k}.title`), `${locale} ${k}`).toBe(true);
        expect(keys.has(`privacy.sections.${k}.body`), `${locale} ${k}`).toBe(true);
      }
    }
  });
});
