import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMessages } from "./check";
import { CORE_NAMESPACES, LABEL_NAMESPACES, MESSAGES, flattenMessages } from "./messages";
import { buildReport, formatReport, isIncomplete, isLikelyUntranslated, type ReportNamespaceInput } from "./report";
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  createTranslator,
  formatDateTime,
  formatIsoDate,
  formatNumber,
  formatReleaseLabel,
  formatYearMonth,
  isLocale,
  localeSelfName,
  negotiateLocale,
  resolveDefaultLocale,
  resolveSupportedLocales,
  translateLabel,
  weekdayNames,
} from "./index";

describe("formatReleaseLabel（spec 06 表格）", () => {
  it.each([
    ["2027-05-03", "day", "zh-Hant", "2027年5月3日"],
    ["2027-05-03", "day", "en", "May 3, 2027"],
    ["2027-05-31", "month", "zh-Hant", "2027年5月"],
    ["2027-05-31", "month", "en", "May 2027"],
    ["2027-06-30", "quarter", "zh-Hant", "2027 年第 2 季"],
    ["2027-06-30", "quarter", "en", "Q2 2027"],
    ["2026-12-31", "quarter", "zh-Hant", "2026 年第 4 季"],
    ["2027-03-31", "quarter", "en", "Q1 2027"],
    ["2027-12-31", "year", "zh-Hant", "2027 年"],
    ["2027-12-31", "year", "en", "2027"],
    ["2027-12-31", "tbd", "zh-Hant", "日期未定"],
    [null, "tbd", "en", "TBA"],
    ["2027-05-03", "day", "ja", "2027年5月3日"],
    ["2027-05-31", "month", "ja", "2027年5月"],
    ["2027-06-30", "quarter", "ja", "2027年第2四半期"],
    ["2026-12-31", "quarter", "ja", "2026年第4四半期"],
    ["2027-03-31", "quarter", "ja", "2027年第1四半期"],
    ["2027-12-31", "year", "ja", "2027年"],
    ["2027-12-31", "tbd", "ja", "発売日未定"],
    [null, "day", "ja", "発売日未定"],
  ] as const)("%s %s %s → %s", (date, precision, locale, expected) => {
    expect(formatReleaseLabel(date, precision, locale)).toBe(expected);
  });

  it("date 為 null 或不合法 → 未定（不 throw）", () => {
    expect(formatReleaseLabel(null, "day", "zh-Hant")).toBe("日期未定");
    expect(formatReleaseLabel("2026-02-30", "day", "en")).toBe("TBA");
    expect(formatReleaseLabel("garbage", "month", "en")).toBe("TBA");
  });

  it("年份不加千分位", () => {
    expect(formatReleaseLabel("2027-12-31", "year", "en")).not.toContain(",");
  });
});

describe("純日期一律 UTC（不因執行環境時區位移一天）", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it.each(["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Taipei"])("TZ=%s 時 2026-12-31 仍是 12 月 31 日", (tz) => {
    process.env.TZ = tz;
    expect(formatReleaseLabel("2026-12-31", "day", "zh-Hant")).toBe("2026年12月31日");
    expect(formatReleaseLabel("2026-12-31", "day", "en")).toBe("December 31, 2026");
    expect(formatReleaseLabel("2026-12-31", "month", "en")).toBe("December 2026");
    expect(formatReleaseLabel("2027-01-01", "day", "en")).toBe("January 1, 2027");
  });

  it("formatIsoDate 傳入其他 timeZone 也會被覆寫成 UTC", () => {
    expect(formatIsoDate("2026-12-31", "en", { dateStyle: "long", timeZone: "Pacific/Kiritimati" })).toBe("December 31, 2026");
    expect(formatIsoDate("2026-12-31", "en", { dateStyle: "long", timeZone: "Pacific/Pago_Pago" })).toBe("December 31, 2026");
  });
});

describe("其他格式化", () => {
  it("formatYearMonth／weekdayNames", () => {
    expect(formatYearMonth(2026, 10, "zh-Hant")).toBe("2026年10月");
    expect(formatYearMonth(2026, 10, "en")).toBe("October 2026");
    expect(weekdayNames("en")).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayNames("en", "short", 1)[0]).toBe("Mon");
    expect(weekdayNames("zh-Hant", "narrow")).toEqual(["日", "一", "二", "三", "四", "五", "六"]);
    expect(formatYearMonth(2026, 10, "ja")).toBe("2026年10月");
    expect(weekdayNames("ja")).toEqual(["日", "月", "火", "水", "木", "金", "土"]);
    expect(weekdayNames("ja", "short", 1)[0]).toBe("月");
  });

  it("formatNumber", () => {
    expect(formatNumber(12345, "en")).toBe("12,345");
    expect(formatNumber(12345, "en", { notation: "compact" })).toBe("12K");
    expect(formatNumber(12345, "zh-Hant", { notation: "compact" })).toBe("1.2萬");
    expect(formatNumber(12345, "ja", { notation: "compact" })).toBe("1.2万");
    expect(formatNumber(12345, "ja")).toBe("12,345");
  });

  it("formatDateTime 依指定時區顯示時間點", () => {
    const s = formatDateTime("2026-06-08T17:00:00Z", "en", "America/Los_Angeles");
    expect(s).toContain("Jun 8, 2026");
    expect(s).toContain("10:00");
    expect(formatDateTime("2026-06-08T17:00:00Z", "zh-Hant", "Asia/Taipei", { hour: "numeric", minute: "2-digit", hour12: false })).toBe("01:00");
    expect(formatDateTime("not-a-date", "en", "UTC")).toBe("not-a-date");
    expect(formatDateTime("2026-06-08T17:00:00Z", "ja", "Asia/Tokyo", { hour: "numeric", minute: "2-digit", hour12: false })).toBe("2:00");
  });
});

describe("negotiateLocale（spec 14：語系協商）", () => {
  const supported = ["zh-Hant", "en", "ja"] as const;
  it.each([
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["zh-Hant-TW", "zh-Hant"],
    ["en-US", "en"],
    ["en", "en"],
    ["fr", "zh-Hant"],
    ["ja-JP", "ja"],
    ["ja", "ja"],
    ["ja;q=0.4,en;q=0.9", "en"],
    ["fr,ja-JP;q=0.5", "ja"],
    ["zh-CN", "zh-Hant"], // 不對應，退回預設
    ["zh-CN,en;q=0.8", "en"], // zh-CN 不當成繁中，往下找到 en
    ["zh-Hans-CN,zh;q=0.9,en;q=0.5", "en"],
    ["fr;q=0.9,en-GB;q=0.8,zh-TW;q=0.7", "en"],
    ["zh-TW;q=0.5,en;q=0.9", "en"], // 依 q 排序
    ["en;q=0,zh-TW;q=0.1", "zh-Hant"], // q=0 不接受
    ["*", "zh-Hant"],
    ["", "zh-Hant"],
  ])("%s → %s", (header, expected) => {
    expect(negotiateLocale(header, supported)).toBe(expected);
  });

  it("ja* 在 supported 沒有 ja 時 → 退回預設或下一個", () => {
    expect(negotiateLocale("ja-JP", ["zh-Hant", "en"])).toBe("zh-Hant");
    expect(negotiateLocale("ja-JP,en;q=0.5", ["zh-Hant", "en"])).toBe("en");
  });

  it("null／undefined → 預設；預設不在 supported 時用第一個", () => {
    expect(negotiateLocale(null, supported)).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(undefined, ["en"])).toBe("en");
  });
});

describe("locales", () => {
  it("resolveSupportedLocales：與 AVAILABLE 取交集、保留順序、空集合退回預設", () => {
    expect(resolveSupportedLocales(undefined)).toEqual([...AVAILABLE_LOCALES]);
    expect(resolveSupportedLocales("")).toEqual([...AVAILABLE_LOCALES]);
    expect(resolveSupportedLocales("zh-Hant,en,ja")).toEqual(["zh-Hant", "en", "ja"]);
    expect(resolveSupportedLocales("ja,en")).toEqual(["ja", "en"]);
    expect(resolveSupportedLocales(" en , zh-Hant ,en")).toEqual(["en", "zh-Hant"]);
    expect(resolveSupportedLocales("ja,fr")).toEqual(["ja"]);
    expect(resolveSupportedLocales("fr,ko")).toEqual(["zh-Hant"]);
    expect(resolveSupportedLocales("zh-hant")).toEqual(["zh-Hant"]); // 大小寫不符 → 交集為空 → 預設
  });

  it("resolveDefaultLocale／isLocale／localeSelfName", () => {
    expect(resolveDefaultLocale("en", ["zh-Hant", "en"])).toBe("en");
    expect(resolveDefaultLocale("ja", ["zh-Hant", "en"])).toBe("zh-Hant");
    expect(resolveDefaultLocale("ja", ["zh-Hant", "en", "ja"])).toBe("ja");
    expect(resolveDefaultLocale(undefined, ["en"])).toBe("en");
    expect(isLocale("zh-Hant")).toBe(true);
    expect(isLocale("zh-TW")).toBe(false);
    expect(localeSelfName("zh-Hant")).toBe("繁體中文");
    expect(localeSelfName("en")).toBe("English");
    expect(localeSelfName("ja")).toBe("日本語");
    expect(isLocale("ja")).toBe(true);
  });
});

describe("createTranslator", () => {
  it("取值、巢狀 key、插值（數字依語系格式化）", () => {
    const zh = createTranslator("zh-Hant");
    const en = createTranslator("en");
    expect(zh.t("ui.calendar.title")).toBe("上市月曆");
    expect(en.t("enums.releaseStage.early_access")).toBe("Early access");
    expect(zh.t("ui.calendar.moreItems", { count: 3 })).toBe("＋3 更多");
    expect(en.t("filters.resultsCount", { count: 1234 })).toBe("1,234 results");
    expect(en.t("a11y.openPreview", { name: "Hollow Knight" })).toBe("Open preview of “Hollow Knight”");
    expect(en.t("ui.calendar.moreItems")).toBe("+{count} more"); // 缺變數保留原樣
  });

  it("缺 key 回傳 key、開發模式 console.warn、不 throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = createTranslator("en");
    expect(t.t("ui.nope.missing")).toBe("ui.nope.missing");
    expect(t.t("noNamespace")).toBe("noNamespace");
    expect(t.t("ui.calendar")).toBe("ui.calendar"); // 非葉節點
    expect(warn).toHaveBeenCalled();
    expect(t.has("ui.nope.missing")).toBe(false);
    warn.mockRestore();
  });

  it("命名空間未載入 → 視同缺 key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = createTranslator("en", ["ui"]);
    expect(t.t("ui.common.close")).toBe("Close");
    expect(t.t("enums.releaseStage.full")).toBe("enums.releaseStage.full");
    warn.mockRestore();
  });

  it("genres 依語系翻譯；缺翻譯 fallback 英文、再 fallback 原文名稱", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const zh = createTranslator("zh-Hant");
    expect(zh.t("genres.role-playing-rpg")).toBe("角色扮演（RPG）");
    expect(translateLabel(zh, "genres", "indie")).toBe("獨立遊戲");
    expect(translateLabel(zh, "genres", "brand-new-genre", "Brand New")).toBe("Brand New");
    expect(translateLabel(zh, "themes", "brand-new-theme")).toBe("brand-new-theme");
    warn.mockRestore();
  });
});

describe("checkMessages（i18n:check 核心）", () => {
  it("核心命名空間缺 key、插值不一致 → error；標籤缺翻譯 → warning", () => {
    const r = checkMessages(
      ["zh-Hant", "en"],
      [
        { namespace: "ui", byLocale: { "zh-Hant": { a: "甲", b: { c: "{n} 個" } }, en: { a: "A", b: { c: "{count}" } } } },
        { namespace: "errors", byLocale: { "zh-Hant": { x: "錯" }, en: undefined } },
        { namespace: "a11y", byLocale: { "zh-Hant": { y: "" }, en: { y: "Y", z: "Z" } } },
      ],
      [{ namespace: "genres", byLocale: { "zh-Hant": { indie: "獨立" }, en: { indie: "Indie", rpg: "RPG" } } }],
    );
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("插值變數不一致"),
        expect.stringContaining("[errors] en：字典檔不存在"),
        expect.stringContaining("「y」是空字串"),
        expect.stringContaining("缺 key「z」"),
      ]),
    );
    expect(r.warnings).toEqual([expect.stringContaining("[genres] zh-Hant：缺 1 個翻譯")]);
  });

  it("實際字典通過", async () => {
    const { MESSAGES, CORE_NAMESPACES, LABEL_NAMESPACES } = await import("./messages");
    const input = (nss: readonly string[]) =>
      nss.map((namespace) => ({
        namespace,
        byLocale: Object.fromEntries(AVAILABLE_LOCALES.map((l) => [l, MESSAGES[l][namespace as keyof (typeof MESSAGES)[typeof l]]])),
      }));
    const r = checkMessages(AVAILABLE_LOCALES, input(CORE_NAMESPACES), input(LABEL_NAMESPACES));
    expect(r.errors).toEqual([]);
  });
});

describe("字典完整性（三語）", () => {
  it("每個語系的核心命名空間 key 集合與 zh-Hant 完全一致，插值變數相同", () => {
    for (const ns of CORE_NAMESPACES) {
      const base = flattenMessages(MESSAGES["zh-Hant"][ns]);
      for (const locale of AVAILABLE_LOCALES) {
        const m = flattenMessages(MESSAGES[locale][ns]);
        expect([...m.keys()].sort(), `${locale}/${ns}`).toEqual([...base.keys()].sort());
        for (const [k, v] of m) {
          const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
          expect(vars(v), `${locale}/${ns}.${k}`).toBe(vars(base.get(k)!));
        }
      }
    }
  });

  it("genres／themes：ja 與 zh-Hant 都涵蓋 en 的全部 slug", () => {
    for (const ns of LABEL_NAMESPACES) {
      const en = [...flattenMessages(MESSAGES.en[ns]).keys()].sort();
      for (const locale of ["zh-Hant", "ja"] as const) {
        expect([...flattenMessages(MESSAGES[locale][ns]).keys()].sort(), `${locale}/${ns}`).toEqual(en);
      }
    }
  });

  it("ja 的 UI 字串不含簡繁中文專用字（抽查：這些字在日文裡不會出現）", () => {
    const ui = [...flattenMessages(MESSAGES.ja.ui).values()].join("");
    for (const ch of ["這", "麼", "戲", "體", "與", "會", "發", "訊", "點", "來", "說"]) expect(ui.includes(ch), ch).toBe(false);
  });
});

describe("buildReport／isLikelyUntranslated", () => {
  it("缺 key、多餘 key、與 fallback 相同的值", () => {
    const rows = buildReport(
      ["zh-Hant", "en", "ja"],
      [
        {
          namespace: "ui",
          kind: "core",
          byLocale: {
            "zh-Hant": { a: "甲", b: "乙" },
            en: { a: "A", b: "B", c: "C" },
            ja: { a: "A", d: "extra", b: "ビー" },
          },
        },
      ],
      "en",
    );
    const ja = rows.find((r) => r.locale === "ja")!;
    expect(ja.missing).toEqual(["c"]);
    expect(ja.extra).toEqual(["d"]);
    expect(ja.sameAsFallback).toEqual(["a"]);
    expect(rows.find((r) => r.locale === "zh-Hant")!.missing).toEqual(["c", "d"]);
    expect(isIncomplete(rows)).toBe(true);
  });

  it("品牌名、純符號與純插值不算未翻譯", () => {
    expect(isLikelyUntranslated("Steam", "Steam")).toBe(false);
    expect(isLikelyUntranslated("{count}", "{count}")).toBe(false);
    expect(isLikelyUntranslated("…", "…")).toBe(false);
    expect(isLikelyUntranslated("Loading", "Loading")).toBe(true);
    expect(isLikelyUntranslated("読み込み中", "Loading")).toBe(false);
  });

  it("目前的字典：沒有缺／多餘 key", () => {
    const mk = (kind: "core" | "label", ns: (typeof CORE_NAMESPACES)[number] | (typeof LABEL_NAMESPACES)[number]): ReportNamespaceInput => ({
      namespace: ns,
      kind,
      byLocale: Object.fromEntries(AVAILABLE_LOCALES.map((l) => [l, MESSAGES[l][ns]])),
    });
    const rows = buildReport(AVAILABLE_LOCALES, [...CORE_NAMESPACES.map((n) => mk("core", n)), ...LABEL_NAMESPACES.map((n) => mk("label", n))], "en");
    expect(isIncomplete(rows)).toBe(false);
    expect(formatReport(rows)).toContain("## ja");
  });
});
