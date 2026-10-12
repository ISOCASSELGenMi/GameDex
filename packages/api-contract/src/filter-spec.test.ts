import { describe, expect, it } from "vitest";
import {
  FILTER_MAX_VALUES,
  FilterSpecSchema,
  countFilterValues,
  filterSpecToQueryString,
  hasFilterValue,
  isEmptyFilter,
  parseFilterSpec,
  removeFilterValue,
  serializeFilterSpec,
  toggleFilterValue,
  type FilterSpec,
} from "./index";

describe("parseFilterSpec（spec 14：FilterSpec）", () => {
  it("同維度多值 → 同一陣列（OR）；跨維度 → 不同欄位（AND）", () => {
    const { filter, issues } = parseFilterSpec(new URLSearchParams("platform=switch,ps5&genre=indie&stage=full"));
    expect(filter).toEqual({ platform: ["ps5", "switch"], genre: ["indie"], stage: ["full"] });
    expect(issues).toEqual([]);
  });

  it("小寫化、去重、排序、合併重複參數、略過空值與未知參數", () => {
    const { filter, issues } = parseFilterSpec(
      new URLSearchParams("platform=PS5,,ps5, switch&platform=ps4--1&month=2026-10&genre="),
    );
    expect(filter).toEqual({ platform: ["ps4--1", "ps5", "switch"] });
    expect(issues).toEqual([]);
  });

  it("接受 Record 輸入（Next 的 searchParams）", () => {
    const { filter } = parseFilterSpec({ platformKind: ["console", "pc"], stage: "early_access", other: "x" });
    expect(filter).toEqual({ platformKind: ["console", "pc"], stage: ["early_access"] });
  });

  it("格式錯誤的 slug 忽略並記 invalid_format；其餘值保留", () => {
    const { filter, issues } = parseFilterSpec(new URLSearchParams("platform=ps5,bad slug,-x,a_b&genre=" + "a".repeat(101)));
    expect(filter).toEqual({ platform: ["ps5"] });
    expect(issues).toEqual(
      expect.arrayContaining([
        { param: "platform", value: "bad slug", reason: "invalid_format" },
        { param: "platform", value: "-x", reason: "invalid_format" },
        { param: "platform", value: "a_b", reason: "invalid_format" },
        { param: "genre", value: "a".repeat(100), reason: "invalid_format" },
      ]),
    );
    expect(issues).toHaveLength(4);
  });

  it("enum 維度的未知值忽略並記 invalid_value", () => {
    const { filter, issues } = parseFilterSpec(new URLSearchParams("platformKind=console,toaster&stage=FULL,gold"));
    expect(filter).toEqual({ platformKind: ["console"], stage: ["full"] });
    expect(issues).toEqual([
      { param: "platformKind", value: "toaster", reason: "invalid_value" },
      { param: "stage", value: "gold", reason: "invalid_value" },
    ]);
  });

  it(`單一參數超過 ${FILTER_MAX_VALUES} 個值 → 整個參數被拒；其他參數不受影響`, () => {
    const many = Array.from({ length: FILTER_MAX_VALUES + 1 }, (_, i) => `p${i}`).join(",");
    const { filter, issues } = parseFilterSpec(new URLSearchParams(`platform=${many}&genre=indie`));
    expect(filter).toEqual({ genre: ["indie"] });
    expect(issues).toEqual([{ param: "platform", reason: "too_many_values" }]);
  });

  it(`剛好 ${FILTER_MAX_VALUES} 個值可接受；重複值不重複計算`, () => {
    const twenty = Array.from({ length: FILTER_MAX_VALUES }, (_, i) => `p${i}`);
    const { filter, issues } = parseFilterSpec(new URLSearchParams(`platform=${[...twenty, ...twenty].join(",")}`));
    expect(filter.platform).toHaveLength(FILTER_MAX_VALUES);
    expect(issues).toEqual([]);
  });

  it("不 throw：亂七八糟的輸入回傳空條件", () => {
    expect(() => parseFilterSpec(new URLSearchParams("platform=%E4%B8%AD&stage=,,,"))).not.toThrow();
    expect(parseFilterSpec(new URLSearchParams("")).filter).toEqual({});
  });
});

describe("serializeFilterSpec", () => {
  it("固定參數順序、值排序、空維度省略", () => {
    const a: FilterSpec = { stage: ["full"], genre: ["rpg", "indie"], platform: ["switch", "ps5"], platformKind: [] };
    expect(serializeFilterSpec(a).toString()).toBe("platform=ps5%2Cswitch&genre=indie%2Crpg&stage=full");
    expect(filterSpecToQueryString(a)).toBe("platform=ps5,switch&genre=indie,rpg&stage=full");
  });

  it("同一組條件（順序不同）產生同一個 query string", () => {
    const a: FilterSpec = { platform: ["switch", "ps5"], genre: ["indie"] };
    const b: FilterSpec = { genre: ["indie"], platform: ["ps5", "switch", "ps5"] };
    expect(serializeFilterSpec(a).toString()).toBe(serializeFilterSpec(b).toString());
    expect(filterSpecToQueryString(a)).toBe(filterSpecToQueryString(b));
  });

  it("round-trip：parse(serialize(x)) = x，兩種序列化都成立", () => {
    const x: FilterSpec = { platform: ["ps4--1", "ps5"], platformKind: ["console", "hybrid"], genre: ["role-playing-rpg"], stage: ["early_access", "full"] };
    expect(parseFilterSpec(serializeFilterSpec(x)).filter).toEqual(x);
    expect(parseFilterSpec(new URLSearchParams(filterSpecToQueryString(x))).filter).toEqual(x);
  });

  it("空條件 → 空字串", () => {
    expect(serializeFilterSpec({}).toString()).toBe("");
    expect(filterSpecToQueryString({})).toBe("");
  });
});

describe("工具函式", () => {
  it("toggle／remove／count／isEmpty／has", () => {
    let f: FilterSpec = {};
    expect(isEmptyFilter(f)).toBe(true);
    f = toggleFilterValue(f, "platform", "switch");
    f = toggleFilterValue(f, "platform", "ps5");
    f = toggleFilterValue(f, "stage", "full");
    expect(f).toEqual({ platform: ["ps5", "switch"], stage: ["full"] });
    expect(countFilterValues(f)).toBe(3);
    expect(hasFilterValue(f, "platform", "ps5")).toBe(true);
    f = toggleFilterValue(f, "platform", "ps5");
    expect(f).toEqual({ platform: ["switch"], stage: ["full"] });
    f = removeFilterValue(f, "stage", "full");
    expect(f).toEqual({ platform: ["switch"] });
    f = removeFilterValue(f, "platform");
    expect(isEmptyFilter(f)).toBe(true);
    expect(f).toEqual({});
  });

  it("不改原物件", () => {
    const f: FilterSpec = { platform: ["ps5"] };
    toggleFilterValue(f, "platform", "switch");
    expect(f).toEqual({ platform: ["ps5"] });
  });
});

describe("FilterSpecSchema（zod）", () => {
  it("接受合法條件、拒絕超量與未知 enum", () => {
    expect(FilterSpecSchema.safeParse({ platform: ["ps5"], stage: ["full"] }).success).toBe(true);
    expect(FilterSpecSchema.safeParse({ stage: ["gold"] }).success).toBe(false);
    expect(FilterSpecSchema.safeParse({ platform: Array.from({ length: 21 }, (_, i) => `p${i}`) }).success).toBe(false);
    expect(FilterSpecSchema.safeParse({ platform: ["Bad Slug"] }).success).toBe(false);
  });
});
