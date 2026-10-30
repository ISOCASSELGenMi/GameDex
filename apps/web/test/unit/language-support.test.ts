/** 語言支援（06 §語言支援區塊）三態與排序；平台總覽分組；分頁參數正規化（Phase 3b H）。 */
import { describe, expect, it } from "vitest";
import {
  ENTITY_PAGE_MAX_LIMIT,
  ENTITY_PAGE_MAX_OFFSET,
  buildLanguageSupport,
  languageCardTags,
  languageMatchRank,
  normalizePaging,
  type PlatformListItem,
} from "@/modules/catalog/domain/entities";
import { groupPlatformsByKind } from "@/modules/catalog/repository/platform-page";

const e = (languageCode: string, supportType: string) => ({ languageCode, supportType });

describe("buildLanguageSupport：三態", () => {
  it("完全沒資料 → status no_data，三欄 no_data，沒有任何列", () => {
    expect(buildLanguageSupport([], "zh-Hant")).toEqual({
      status: "no_data",
      columns: { interface: "no_data", subtitles: "no_data", audio: "no_data" },
      rows: [],
    });
  });

  it("只有介面資料 → 字幕、語音欄 no_data（未提供資料），不是「不支援」", () => {
    const s = buildLanguageSupport([e("en-US", "interface"), e("ja-JP", "interface")], "en");
    expect(s.status).toBe("available");
    expect(s.columns).toEqual({ interface: "has_data", subtitles: "no_data", audio: "no_data" });
    expect(s.rows.map((r) => r.types)).toEqual([["interface"], ["interface"]]);
  });

  it("合併同語言多類型、去重、依 interface→subtitles→audio 排；未知類型忽略", () => {
    const s = buildLanguageSupport(
      [e("fr-FR", "audio"), e("fr-FR", "interface"), e("fr-FR", "audio"), e("fr-FR", "subtitles"), e("fr-FR", "bogus")],
      "en",
    );
    expect(s.rows).toEqual([{ languageCode: "fr-FR", types: ["interface", "subtitles", "audio"] }]);
    expect(s.columns).toEqual({ interface: "has_data", subtitles: "has_data", audio: "has_data" });
  });

  it("模型不含任何「不支援」值：列只帶有資料的類型", () => {
    const s = buildLanguageSupport([e("de-DE", "audio")], "en");
    expect(JSON.stringify(s)).not.toMatch(/unsupported|not_supported|false/);
  });
});

describe("buildLanguageSupport：排序（當前網站語言置頂）", () => {
  const entries = [e("ja-JP", "interface"), e("en-US", "interface"), e("zh-Hans", "interface"), e("zh-Hant", "interface"), e("de-DE", "interface")];
  it("zh-Hant 網站：zh-Hant 置頂，zh-Hans 不算相同（文字不同），其餘依代碼", () => {
    expect(buildLanguageSupport(entries, "zh-Hant").rows.map((r) => r.languageCode)).toEqual([
      "zh-Hant", "de-DE", "en-US", "ja-JP", "zh-Hans",
    ]);
  });
  it("ja 網站：ja-JP（主語言相同）置頂", () => {
    expect(buildLanguageSupport(entries, "ja").rows[0].languageCode).toBe("ja-JP");
  });
  it("en 網站：en-GB、en-US 都置頂（依代碼）", () => {
    const s = buildLanguageSupport([...entries, e("en-GB", "audio")], "en");
    expect(s.rows.slice(0, 2).map((r) => r.languageCode)).toEqual(["en-GB", "en-US"]);
  });
  it("languageMatchRank", () => {
    expect(languageMatchRank("zh-Hant", "zh-hant")).toBe(0);
    expect(languageMatchRank("en-US", "en")).toBe(1);
    expect(languageMatchRank("zh-Hans", "zh-Hant")).toBe(2);
    expect(languageMatchRank("zh-TW", "zh-Hant")).toBe(1);
    expect(languageMatchRank("ja-JP", "en")).toBe(2);
  });
});

describe("languageCardTags", () => {
  const codes = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
  const s = buildLanguageSupport(codes.map((c) => e(c, "interface")), "en");
  it("最多 6 個，其餘 +M", () => {
    expect(languageCardTags(s)).toEqual({ codes: codes.slice(0, 6), more: 2 });
  });
  it("沒有資料 → 空、0", () => {
    expect(languageCardTags(buildLanguageSupport([], "en"))).toEqual({ codes: [], more: 0 });
  });
  it("max 可調", () => {
    expect(languageCardTags(s, 3)).toEqual({ codes: codes.slice(0, 3), more: 5 });
  });
});

describe("normalizePaging", () => {
  it("預設、夾範圍、非數字", () => {
    expect(normalizePaging(undefined, undefined)).toEqual({ limit: 24, offset: 0 });
    expect(normalizePaging(0, -5)).toEqual({ limit: 1, offset: 0 });
    expect(normalizePaging(1e9, 1e9)).toEqual({ limit: ENTITY_PAGE_MAX_LIMIT, offset: ENTITY_PAGE_MAX_OFFSET });
    expect(normalizePaging(Number.NaN, 12.7)).toEqual({ limit: 24, offset: 12 });
  });
});

describe("groupPlatformsByKind", () => {
  const p = (slug: string, kind: PlatformListItem["kind"], extra: Partial<PlatformListItem> = {}): PlatformListItem => ({
    id: 1,
    slug,
    name: slug.toUpperCase(),
    abbreviation: null,
    kind,
    generation: null,
    family: null,
    status: "active",
    logo: null,
    logoUrl: null,
    recentReleaseCount: 0,
    isCommon: false,
    firstReleaseDate: null,
    firstReleasePrecision: null,
    ...extra,
  });
  it("kind 依固定順序、other 最後、mobile 不列；組內常用在前、世代新到舊、名稱", () => {
    const groups = groupPlatformsByKind([
      p("web", "other"),
      p("phone", "mobile"),
      p("pc", "pc", { isCommon: true, recentReleaseCount: 5000 }),
      p("ps4", "console", { generation: 8 }),
      p("ps5", "console", { generation: 9, isCommon: true, recentReleaseCount: 900 }),
      p("xsx", "console", { generation: 9, isCommon: true, recentReleaseCount: 1200 }),
      p("ps1", "console", { generation: 5 }),
      p("switch", "hybrid", { isCommon: true, recentReleaseCount: 3000 }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["console", "handheld", "pc", "other"]);
    // hybrid（Switch）同時在主機與掌機兩組：主機組內常用在前
    expect(groups[0].platforms.map((x) => x.slug)).toEqual(["switch", "xsx", "ps5", "ps4", "ps1"]);
    expect(groups[1].platforms.map((x) => x.slug)).toEqual(["switch"]);
  });
  it("平台總覽排序（sort=release）：依平台發售日，預設新到舊；沒有日期的永遠最後；平手依原本順序（2026-10-29）", () => {
    const items = [
      p("ps4", "console", { generation: 8, firstReleaseDate: "2013-11-15" }),
      p("ps5", "console", { generation: 9, isCommon: true, recentReleaseCount: 900, firstReleaseDate: "2020-11-12" }),
      p("ps1", "console", { generation: 5, firstReleaseDate: "1994-12-03" }),
      p("nodate", "console", { generation: 7 }),
      p("xone", "console", { generation: 8, firstReleaseDate: "2013-11-15" }),
    ];
    const desc = groupPlatformsByKind(items, { sort: "release", dir: "desc" })[0]!.platforms.map((x) => x.slug);
    expect(desc).toEqual(["ps5", "ps4", "xone", "ps1", "nodate"]);
    const asc = groupPlatformsByKind(items, { sort: "release", dir: "asc" })[0]!.platforms.map((x) => x.slug);
    expect(asc).toEqual(["ps1", "ps4", "xone", "ps5", "nodate"]);
    // 不給 order＝原本的順序（常用在前，其餘世代新到舊）
    expect(groupPlatformsByKind(items)[0]!.platforms.map((x) => x.slug)).toEqual(["ps5", "ps4", "xone", "nodate", "ps1"]);
  });
});

import { expandPlatformKindFilter, platformGroupsFor, PLATFORM_GROUP_KINDS } from "@/modules/catalog/domain/platform-groups";

describe("平台分組（hybrid 雙掛）", () => {
  it("platformGroupsFor：hybrid 同時屬於主機與掌機，其餘各屬自己", () => {
    expect(platformGroupsFor("hybrid")).toEqual(["console", "handheld"]);
    expect(platformGroupsFor("console")).toEqual(["console"]);
    expect(platformGroupsFor("pc")).toEqual(["pc"]);
    expect(PLATFORM_GROUP_KINDS).not.toContain("hybrid");
  });
  it("expandPlatformKindFilter：選主機或掌機時含 hybrid；單選 hybrid 與其他維持原樣", () => {
    expect(expandPlatformKindFilter(["console"]).sort()).toEqual(["console", "hybrid"]);
    expect(expandPlatformKindFilter(["handheld"]).sort()).toEqual(["handheld", "hybrid"]);
    expect(expandPlatformKindFilter(["pc"])).toEqual(["pc"]);
    expect(expandPlatformKindFilter(["hybrid"])).toEqual(["hybrid"]);
    expect(expandPlatformKindFilter(["console", "handheld"]).sort()).toEqual(["console", "handheld", "hybrid"]);
  });
});
