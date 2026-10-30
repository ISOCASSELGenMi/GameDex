/**
 * 即時篩選的網址運算（ui/filters/live-filter.ts）：位置參數（週、頁碼、分組檢視參數）在篩選時原樣保留，
 * 篩選欄位以表單目前的值取代，結果是正規形式（與 proxy 的 308 一致）。
 */
import { filterRedirectSearch } from "@sok/api-contract";
import { describe, expect, it } from "vitest";
import { clearFilterHref, keepPositionHref, lastPageWithContent, liveFilterHref, sameLocation } from "../../src/modules/catalog/ui/filters/live-filter";

const ACTION = "/zh-Hant/games";

describe("liveFilterHref：篩選時保留位置參數", () => {
  it("時間軸：目前網址的 week 與 at 不會被表單過期的值蓋掉", () => {
    const href = liveFilterHref({
      action: "/zh-Hant/timeline",
      currentSearch: "?week=2026-W20&at=2026-05-14",
      controlled: ["platform", "genre", "minHeat"],
      entries: [["platform", "ps5"], ["platform", "switch"], ["minHeat", "3"]],
    });
    expect(href).toBe("/zh-Hant/timeline?platform=ps5,switch&minHeat=3&at=2026-05-14&week=2026-W20");
  });

  it("/games：分組與 gfrom／gsort／gdir／page 保留", () => {
    const href = liveFilterHref({
      action: ACTION,
      currentSearch: "?by=platform&gdir=asc&gsort=count&page=3&genre=rpg",
      controlled: ["platform", "genre"],
      entries: [["genre", "action"]],
    });
    expect(href).toBe(`${ACTION}?genre=action&by=platform&gdir=asc&gsort=count&page=3`);
    expect(liveFilterHref({ action: ACTION, currentSearch: "?by=date&gfrom=2026-03", controlled: ["genre"], entries: [["genre", "rpg"]] })).toBe(
      `${ACTION}?genre=rpg&by=date&gfrom=2026-03`,
    );
  });

  it("全部取消勾選：該維度的參數被移除，其餘保留", () => {
    const href = liveFilterHref({ action: ACTION, currentSearch: "?genre=rpg&page=2", controlled: ["genre", "platform"], entries: [] });
    expect(href).toBe(`${ACTION}?page=2`);
  });

  it("表單沒有的篩選參數（company、show、q）原樣保留；空值略過", () => {
    const href = liveFilterHref({
      action: ACTION,
      currentSearch: "?company=nintendo&q=zelda&show=releases",
      controlled: ["platform", "yearFrom"],
      entries: [["platform", "switch"], ["yearFrom", ""]],
    });
    expect(href).toBe(`${ACTION}?platform=switch&show=releases&company=nintendo&q=zelda`);
  });

  it("評分排名頁：累計頁數 page 保留，排序欄位取表單的值", () => {
    const href = liveFilterHref({
      action: "/zh-Hant/ratings",
      currentSearch: "?sort=igdb&dir=desc&page=3",
      controlled: ["sort", "dir", "minVotes", "yearFrom", "yearTo", "genre"],
      entries: [["sort", "players"], ["dir", "desc"], ["minVotes", "50"], ["genre", "rpg"]],
    });
    expect(href).toBe("/zh-Hant/ratings?page=3&sort=players&dir=desc&minVotes=50&genre=rpg");
  });

  it("輸出已是正規形式（proxy 不會再轉址）", () => {
    for (const currentSearch of ["?week=2026-W03", "?by=date&page=2&genre=rpg%2Caction", ""]) {
      const href = liveFilterHref({ action: ACTION, currentSearch, controlled: ["platform"], entries: [["platform", "ps5"], ["platform", "pc"]] });
      const search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      expect(filterRedirectSearch(search)).toBeNull();
    }
  });

  it("沒有任何參數時回傳純路徑", () => {
    expect(liveFilterHref({ action: ACTION, currentSearch: "", controlled: ["genre"], entries: [] })).toBe(ACTION);
  });
});

describe("clearFilterHref：全部清除也保留位置", () => {
  it("移除篩選參數與表單欄位，留下 week／by／page", () => {
    expect(clearFilterHref({ action: "/zh-Hant/timeline", currentSearch: "?platform=ps5&genre=rpg&week=2026-W20" })).toBe("/zh-Hant/timeline?week=2026-W20");
    expect(clearFilterHref({ action: ACTION, currentSearch: "?genre=rpg&by=date&gfrom=2026-03&page=2&dir=asc", controlled: ["dir", "genre"] })).toBe(
      `${ACTION}?by=date&gfrom=2026-03&page=2`,
    );
  });
});

describe("keepPositionHref：伺服器算好的篩選連結改用目前位置", () => {
  it("篩選參數取連結的、位置參數取目前網址", () => {
    expect(keepPositionHref("/zh-Hant/timeline?genre=rpg&week=2026-W01", "?genre=rpg&platform=ps5&week=2026-W20&at=2026-05-14")).toBe(
      "/zh-Hant/timeline?genre=rpg&at=2026-05-14&week=2026-W20",
    );
    expect(keepPositionHref("/zh-Hant/games?by=date", "?by=date&gfrom=2026-03&page=4&q=a")).toBe("/zh-Hant/games?by=date&gfrom=2026-03&page=4");
  });
});

describe("sameLocation", () => {
  it("語意相同（只差編碼）視為相同；不同路徑或參數不同則否", () => {
    expect(sameLocation("/a?x=1%2C2", "/a?x=1,2")).toBe(true);
    expect(sameLocation("/a?x=1", "/b?x=1")).toBe(false);
    expect(sameLocation("/a?x=1&y=2", "/a?y=2&x=1")).toBe(false);
  });
});

describe("lastPageWithContent：篩選後頁碼超出範圍退到最後一頁", () => {
  const withPages = (n: number) => async (p: number) => p <= n;
  it("二分搜尋找出最後一個有內容的頁碼", async () => {
    for (const n of [1, 2, 3, 7, 12, 99, 208]) {
      const calls: number[] = [];
      const last = await lastPageWithContent(208, async (p) => (calls.push(p), p <= n));
      expect(last).toBe(n);
      expect(calls.length).toBeLessThanOrEqual(9);
    }
    expect(await lastPageWithContent(1, withPages(1))).toBe(1);
  });
  it("全部都是空頁時退到第 1 頁", async () => {
    expect(await lastPageWithContent(30, withPages(0))).toBe(1);
  });
});
