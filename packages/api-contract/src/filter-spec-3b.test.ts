import { describe, expect, it } from "vitest";
import {
  FILTER_QUERY_MAX_LENGTH,
  FilterSpecSchema,
  canonicalizeFilterQuery,
  countFilterValues,
  filterRedirectSearch,
  filterSpecToQueryString,
  isEmptyFilter,
  isValidIsoDate,
  parseFilterSpec,
  serializeFilterSpec,
  setFilterParam,
  type FilterSpec,
} from "./index";

describe("parseFilterSpec：3b 多值維度", () => {
  it("theme、type、status、show、company、franchise", () => {
    const { filter, issues } = parseFilterSpec(
      new URLSearchParams("theme=horror,fantasy&type=remake,MAIN_GAME&status=upcoming&show=events&company=nintendo&franchise=zelda"),
    );
    expect(filter).toEqual({
      theme: ["fantasy", "horror"],
      type: ["main_game", "remake"],
      status: ["upcoming"],
      show: ["events"],
      company: ["nintendo"],
      franchise: ["zelda"],
    });
    expect(issues).toEqual([]);
  });

  it("enum 未知值回報 invalid_value", () => {
    const { filter, issues } = parseFilterSpec(new URLSearchParams("type=dlc,remake&status=soon&show=ads"));
    expect(filter).toEqual({ type: ["remake"] });
    expect(issues).toEqual([
      { param: "type", value: "dlc", reason: "invalid_value" },
      { param: "status", value: "soon", reason: "invalid_value" },
      { param: "show", value: "ads", reason: "invalid_value" },
    ]);
  });
});

describe("parseFilterSpec：單值參數", () => {
  it("合法值", () => {
    const { filter, issues } = parseFilterSpec(
      new URLSearchParams("region=jp&from=2026-10-01&to=2026-12-31&year=2024&yearFrom=2020&yearTo=2025&minHeat=3&rumored=1&q=%20Zelda%20%20Tears%20&sort=NAME"),
    );
    expect(filter).toEqual({
      region: "JP",
      from: "2026-10-01",
      to: "2026-12-31",
      year: 2024,
      yearFrom: 2020,
      yearTo: 2025,
      minHeat: 3,
      rumored: true,
      q: "Zelda Tears",
      sort: "name",
    });
    expect(issues).toEqual([]);
  });

  it("非法值忽略並回報，不 throw", () => {
    const { filter, issues } = parseFilterSpec(
      new URLSearchParams("region=j-p&from=2026-02-30&to=26-1-1&year=99999&yearFrom=1800&minHeat=6&rumored=yes&sort=score"),
    );
    expect(filter).toEqual({});
    expect(issues).toEqual([
      { param: "region", value: "j-p", reason: "invalid_format" },
      { param: "from", value: "2026-02-30", reason: "invalid_format" },
      { param: "to", value: "26-1-1", reason: "invalid_format" },
      { param: "year", value: "99999", reason: "invalid_format" },
      { param: "yearFrom", value: "1800", reason: "invalid_value" },
      { param: "minHeat", value: "6", reason: "invalid_value" },
      { param: "rumored", value: "yes", reason: "invalid_value" },
      { param: "sort", value: "score", reason: "invalid_value" },
    ]);
  });

  it("重複的單值參數取第一個非空值，其餘回報 duplicate；rumored=0 與空 q 視同未指定", () => {
    const { filter, issues } = parseFilterSpec(new URLSearchParams("sort=&sort=name&sort=popularity&rumored=0&q=%20%20"));
    expect(filter).toEqual({ sort: "name" });
    expect(issues).toEqual([{ param: "sort", value: "popularity", reason: "duplicate" }]);
  });

  it(`q 超過 ${FILTER_QUERY_MAX_LENGTH} 字被忽略；q 不拆逗號`, () => {
    expect(parseFilterSpec({ q: "a".repeat(FILTER_QUERY_MAX_LENGTH + 1) }).issues).toHaveLength(1);
    expect(parseFilterSpec({ q: "薩爾達,傳說" }).filter).toEqual({ q: "薩爾達,傳說" });
  });

  it("isValidIsoDate：閏年", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
  });
});

describe("serialize：全部參數順序固定", () => {
  const full: FilterSpec = {
    sort: "release_date",
    q: "zelda tears",
    franchise: ["zelda"],
    company: ["nintendo"],
    rumored: true,
    show: ["releases"],
    minHeat: 2,
    yearTo: 2025,
    yearFrom: 2020,
    year: 2024,
    to: "2026-12-31",
    from: "2026-10-01",
    region: "JP",
    status: ["upcoming", "delayed"],
    stage: ["full"],
    type: ["main_game"],
    theme: ["horror"],
    genre: ["rpg"],
    platformKind: ["console"],
    platform: ["ps5"],
  };

  it("filterSpecToQueryString", () => {
    expect(filterSpecToQueryString(full)).toBe(
      "platform=ps5&platformKind=console&genre=rpg&theme=horror&type=main_game&stage=full&status=delayed,upcoming" +
        "&region=JP&from=2026-10-01&to=2026-12-31&year=2024&yearFrom=2020&yearTo=2025&minHeat=2&show=releases&rumored=1" +
        "&company=nintendo&franchise=zelda&q=zelda%20tears&sort=release_date",
    );
  });

  it("round-trip（兩種序列化）", () => {
    const canonical = parseFilterSpec(serializeFilterSpec(full)).filter;
    expect(parseFilterSpec(new URLSearchParams(filterSpecToQueryString(full))).filter).toEqual(canonical);
    expect(canonical.status).toEqual(["delayed", "upcoming"]);
    expect(canonical.q).toBe("zelda tears");
  });

  it("count／isEmpty 計入單值參數（sort 不算）", () => {
    expect(isEmptyFilter({ sort: "name" })).toBe(true);
    expect(countFilterValues({ platform: ["a", "b"], minHeat: 3, q: "x", sort: "name" })).toBe(4);
  });

  it("setFilterParam 設定與清除", () => {
    const f = setFilterParam({}, "minHeat", 3);
    expect(f).toEqual({ minHeat: 3 });
    expect(setFilterParam(f, "minHeat", undefined)).toEqual({});
  });

  it("zod：單值參數", () => {
    expect(FilterSpecSchema.safeParse(full).success).toBe(true);
    expect(FilterSpecSchema.safeParse({ minHeat: 0 }).success).toBe(false);
    expect(FilterSpecSchema.safeParse({ from: "2026-13-01" }).success).toBe(false);
    expect(FilterSpecSchema.safeParse({ region: "jp" }).success).toBe(false);
  });
});

describe("正規化 query（proxy 308 用）", () => {
  it("3a 表單形式 → 正規形式；其他參數保留並排在後面", () => {
    const c = canonicalizeFilterQuery("?genre=&platform=switch&platform=ps5&cursor=abc&month=x");
    expect(c).toEqual({ query: "platform=ps5,switch&cursor=abc&month=x", isCanonical: false, hasIssues: false });
    expect(filterRedirectSearch("?genre=&platform=switch&platform=ps5")).toBe("?platform=ps5,switch");
  });

  it("已是正規形式 → 不轉址；冪等", () => {
    expect(filterRedirectSearch("?platform=ps5,switch&q=a%20b")).toBeNull();
    const once = canonicalizeFilterQuery("q=a+b&sort=name&platform=PS5").query;
    expect(once).toBe("platform=ps5&q=a%20b&sort=name");
    expect(canonicalizeFilterQuery(once).isCanonical).toBe(true);
  });

  it("有 issue 時不轉址（保留頁面的提示）", () => {
    expect(filterRedirectSearch("?platform=bad%20slug&genre=b,a")).toBeNull();
    expect(canonicalizeFilterQuery("?genre=b,a&sort=x").hasIssues).toBe(true);
  });

  it("空 query、只剩空參數", () => {
    expect(filterRedirectSearch("")).toBeNull();
    expect(filterRedirectSearch("?platform=")).toBe("");
  });
});
