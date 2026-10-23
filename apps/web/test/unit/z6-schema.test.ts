/**
 * Z6：schema 與語系清單的一致性、預先計算規則的純函式。
 */
import { describe, expect, it } from "vitest";
import { AVAILABLE_LOCALES } from "@sok/i18n";
import { TBD_RELEASE_GROUP, releaseGroupKey } from "@/modules/catalog/domain/game-group-keys";
import { OTHER_PUBLISHER_INDEX, PUBLISHER_COLUMN_KEYS, groupOfGame, publisherGroupIndexOfGame } from "@/modules/catalog/domain/publisher-groups";
import { DISPLAY_NAME_INDEX_LOCALES } from "@/modules/catalog/schema";

describe("games 顯示名稱 index 的語系", () => {
  it("涵蓋所有有字典的語系（新增語系時要補 index 與 migration）", () => {
    expect([...DISPLAY_NAME_INDEX_LOCALES].sort()).toEqual([...AVAILABLE_LOCALES].sort());
  });
});

describe("releaseGroupKey（games.release_group 的唯一規則）", () => {
  it("日／月精度＝YYYY-MM、季精度＝YYYY-Qn、年精度＝YYYY、沒有日期或 tbd＝tbd", () => {
    expect(releaseGroupKey("2026-10-23", "day")).toBe("2026-10");
    expect(releaseGroupKey("2026-01-01", "month")).toBe("2026-01");
    expect(releaseGroupKey("2026-12-31", "year")).toBe("2026");
    expect(releaseGroupKey("2026-03-31", "quarter")).toBe("2026-Q1");
    expect(releaseGroupKey("2026-04-01", "quarter")).toBe("2026-Q2");
    expect(releaseGroupKey("2026-12-31", "quarter")).toBe("2026-Q4");
    expect(releaseGroupKey(null, "day")).toBe(TBD_RELEASE_GROUP);
    expect(releaseGroupKey("2026-10-23", null)).toBe(TBD_RELEASE_GROUP);
    expect(releaseGroupKey("2026-10-23", "tbd")).toBe(TBD_RELEASE_GROUP);
    expect(releaseGroupKey(undefined, undefined)).toBe(TBD_RELEASE_GROUP);
  });
});

describe("publisherGroupIndexOfGame（games.publisher_group 的唯一規則）", () => {
  const fromsoft = PUBLISHER_COLUMN_KEYS.indexOf("fromsoftware");
  it("開發商優先、發行商次之、都不在名單＝other(-1)；porting／supporting 不參與", () => {
    expect(publisherGroupIndexOfGame([])).toBe(OTHER_PUBLISHER_INDEX);
    expect(publisherGroupIndexOfGame([{ igdbId: 1012, role: "developer" }, { igdbId: 248, role: "publisher" }])).toBe(fromsoft);
    expect(publisherGroupIndexOfGame([{ igdbId: 1012, role: "porting" }])).toBe(OTHER_PUBLISHER_INDEX);
    expect(publisherGroupIndexOfGame([{ igdbId: 580950, role: "developer" }, { igdbId: 70, role: "publisher" }])).toBe(PUBLISHER_COLUMN_KEYS.indexOf("nintendo"));
  });
  it("與 groupOfGame（欄位 key 版）同一份規則", () => {
    const refs = [{ igdbId: 37, role: "developer" }];
    expect(PUBLISHER_COLUMN_KEYS[publisherGroupIndexOfGame(refs)]).toBe(groupOfGame(refs));
  });
});
