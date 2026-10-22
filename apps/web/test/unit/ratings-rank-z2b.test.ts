// GameDex 第 2 輪（Z2B）：評分排名頁與月曆「遊戲／活動」開關的純邏輯。
import { describe, expect, it } from "vitest";
import { parseFilterSpec } from "@sok/api-contract";
import type { RatingColumn } from "@/modules/catalog";
import {
  DEFAULT_RATING_SORT,
  IGDB_RATING_COLUMN,
  effectiveMinVotes,
  mergeRatingColumns,
  parseRatingsParams,
  rankDelta,
  rankDeltaKind,
  shouldAnimateRow,
} from "@/modules/catalog/domain/ratings-ranking";
import { DEFAULT_SHOW, filterSpecToReadQuery, showFromSpec } from "@/modules/catalog/ui/filter-mapping";
import { filterSpecForPage, PAGE_FILTER_PARAMS } from "@/modules/catalog/ui/filters/filter-labels";
import { specWithShow, showSwitchModels, toggledShow } from "@/modules/catalog/ui/calendar/show-toggle";
import { ariaSortValue, nextSort, rankMark, ratingsQuery } from "@/modules/catalog/ui/ratings/view-model";
import { navItems } from "@/modules/catalog/ui/layout/nav-items";
import { collectCatalogExtensions } from "@/modules/registry";
import { catalogModule } from "@/modules/catalog";
import { accountsModule } from "@/modules/accounts";
import { playersRatingColumn } from "@/modules/accounts/use-cases/catalog-extensions";
import { playerAverageToRatingScore } from "@/modules/accounts/use-cases/play-records";
import { createTranslator } from "@sok/i18n";

const players: RatingColumn = {
  id: "players",
  scoreProvider: "site_players",
  scoreType: "user_average",
  labelKey: "ui.ratings.col.players",
  countLabelKey: "ui.ratings.count.players",
  scale: "ten",
  defaultMinVotes: () => 5,
};
const columns = mergeRatingColumns([players]);

describe("parseRatingsParams（排序、方向、門檻、頁數）", () => {
  it("沒有參數＝IGDB 分數、降冪、預設門檻、第 1 頁", () => {
    expect(parseRatingsParams({}, columns)).toEqual({ sort: "igdb", dir: "desc", page: 1 });
  });

  it("sort=players&dir=asc 與 minVotes、page、prev", () => {
    expect(parseRatingsParams({ sort: "players", dir: "asc", minVotes: "3", page: "2", prev: "igdb" }, columns)).toEqual({
      sort: "players",
      dir: "asc",
      minVotes: 3,
      page: 2,
      prev: "igdb",
    });
  });

  it("未知或已停用的欄位退回預設欄（模組停用時 sort=players 不會壞）", () => {
    expect(parseRatingsParams({ sort: "players" }, mergeRatingColumns([])).sort).toBe(DEFAULT_RATING_SORT);
    expect(parseRatingsParams({ sort: "nope" }, columns).sort).toBe("igdb");
  });

  it("dir 只認 asc／desc；大小寫不拘", () => {
    expect(parseRatingsParams({ dir: "ASC" }, columns).dir).toBe("asc");
    expect(parseRatingsParams({ dir: "up" }, columns).dir).toBe("desc");
  });

  it("minVotes 要是 0~100000 的整數，否則忽略；0 是合法值（不設門檻）", () => {
    expect(parseRatingsParams({ minVotes: "0" }, columns).minVotes).toBe(0);
    for (const bad of ["-1", "1.5", "abc", "100001", "", "1e3"]) expect(parseRatingsParams({ minVotes: bad }, columns).minVotes).toBeUndefined();
  });

  it("page 夾在 1~20；prev 不能等於 sort 也不能是未知欄", () => {
    expect(parseRatingsParams({ page: "0" }, columns).page).toBe(1);
    expect(parseRatingsParams({ page: "999" }, columns).page).toBe(20);
    expect(parseRatingsParams({ page: "x" }, columns).page).toBe(1);
    expect(parseRatingsParams({ sort: "players", prev: "players" }, columns).prev).toBeUndefined();
    expect(parseRatingsParams({ prev: "zzz" }, columns).prev).toBeUndefined();
  });

  it("陣列參數取第一個", () => {
    expect(parseRatingsParams({ sort: ["players", "igdb"] }, columns).sort).toBe("players");
  });
});

describe("欄位註冊與票數門檻", () => {
  it("內建 igdb 永遠第一欄；重複 id 與非法 id 被丟掉", () => {
    const dup = { ...players, id: "igdb" };
    const bad = { ...players, id: "Bad Id" };
    expect(mergeRatingColumns([dup, bad, players]).map((c) => c.id)).toEqual(["igdb", "players"]);
  });

  it("排序依哪一欄就用哪一欄的預設門檻；使用者給的優先", () => {
    expect(effectiveMinVotes(IGDB_RATING_COLUMN)).toBe(10);
    expect(effectiveMinVotes(players)).toBe(5);
    expect(effectiveMinVotes(players, 0)).toBe(0);
    expect(effectiveMinVotes(IGDB_RATING_COLUMN, 25)).toBe(25);
  });

  it("accounts 的 players 欄：預設門檻沿用 PLAYER_RATING_MIN_COUNT（未設＝5）", () => {
    const saved = process.env.PLAYER_RATING_MIN_COUNT;
    try {
      delete process.env.PLAYER_RATING_MIN_COUNT;
      expect(playersRatingColumn.defaultMinVotes()).toBe(5);
      process.env.PLAYER_RATING_MIN_COUNT = "12";
      expect(playersRatingColumn.defaultMinVotes()).toBe(12);
    } finally {
      if (saved === undefined) delete process.env.PLAYER_RATING_MIN_COUNT;
      else process.env.PLAYER_RATING_MIN_COUNT = saved;
    }
    expect(playersRatingColumn).toMatchObject({ id: "players", scoreProvider: "site_players", scoreType: "user_average", scale: "ten" });
  });

  it("registry 收集已啟用模組的 ratingColumns；accounts 提供 players，catalog 不提供", () => {
    expect(collectCatalogExtensions([catalogModule, accountsModule]).ratingColumns.map((c) => c.id)).toEqual(["players"]);
    expect(collectCatalogExtensions([catalogModule]).ratingColumns).toEqual([]);
  });

  it("玩家平均 → ratings 的 0~100 整數：8.5／10 → 85（avg 是 0.5 分一格的平均）", () => {
    expect(playerAverageToRatingScore(17)).toBe(85);
    expect(playerAverageToRatingScore(20)).toBe(100);
    expect(playerAverageToRatingScore(1)).toBe(5);
    expect(playerAverageToRatingScore(16.33)).toBe(82); // 8.165 → 8.2 → 82
  });
});

describe("名次差", () => {
  it("正＝上升、負＝下降、0＝不變、沒有前一個名次＝none", () => {
    expect(rankDelta(5, 2)).toBe(3);
    expect(rankDelta(2, 4)).toBe(-2);
    expect(rankDelta(3, 3)).toBe(0);
    expect(rankDelta(null, 3)).toBeNull();
    expect(rankDelta(undefined, 3)).toBeNull();
    expect(rankDeltaKind(3)).toBe("up");
    expect(rankDeltaKind(-2)).toBe("down");
    expect(rankDeltaKind(0)).toBe("same");
    expect(rankDeltaKind(null)).toBe("none");
  });

  it("rankMark：標示的方向與絕對值", () => {
    expect(rankMark({ rank: 2, prevRank: 5 })).toEqual({ kind: "up", amount: 3 });
    expect(rankMark({ rank: 4, prevRank: 2 })).toEqual({ kind: "down", amount: 2 });
    expect(rankMark({ rank: 4, prevRank: 4 })).toEqual({ kind: "same", amount: 0 });
    expect(rankMark({ rank: 4, prevRank: null })).toEqual({ kind: "none", amount: 0 });
  });
});

describe("排序切換與網址", () => {
  it("同一欄切換升降冪；換欄先降冪", () => {
    expect(nextSort({ sort: "igdb", dir: "desc" }, "igdb")).toEqual({ sort: "igdb", dir: "asc" });
    expect(nextSort({ sort: "igdb", dir: "asc" }, "igdb")).toEqual({ sort: "igdb", dir: "desc" });
    expect(nextSort({ sort: "igdb", dir: "asc" }, "players")).toEqual({ sort: "players", dir: "desc" });
  });

  it("aria-sort 只出現在排序欄", () => {
    expect(ariaSortValue("igdb", "igdb", "desc")).toBe("descending");
    expect(ariaSortValue("igdb", "igdb", "asc")).toBe("ascending");
    expect(ariaSortValue("players", "igdb", "desc")).toBeUndefined();
  });

  it("ratingsQuery：篩選在前，之後 sort、dir、minVotes、page；第 1 頁與未給的不寫", () => {
    expect(ratingsQuery({ filterQuery: "platform=ps5", sort: "players", dir: "desc", minVotes: 3, page: 2 })).toBe(
      "platform=ps5&sort=players&dir=desc&minVotes=3&page=2",
    );
    expect(ratingsQuery({ filterQuery: "", page: 1 })).toBe("");
    expect(ratingsQuery({ filterQuery: "", minVotes: 0 })).toBe("minVotes=0");
  });

  it("評分排名頁的篩選參數不含 sort（那一頁的 sort 是欄位 id）", () => {
    expect(PAGE_FILTER_PARAMS.ratings).not.toContain("sort");
    const s = parseFilterSpec(new URLSearchParams("platform=ps5&sort=players&minHeat=3")).filter;
    expect(filterSpecForPage(s, "ratings")).toEqual({ platform: ["ps5"] });
  });

  it("導覽下拉有「評分排名」", () => {
    const t = createTranslator("zh-Hant");
    const item = navItems("zh-Hant", t).find((i) => i.path === "/ratings");
    expect(item).toMatchObject({ href: "/zh-Hant/ratings", label: "評分排名" });
  });
});

describe("FLIP：哪些列要做位移動畫", () => {
  const vh = 800;
  it("舊或新位置有一個在視窗內就做", () => {
    expect(shouldAnimateRow(100, 150, 400, 450, vh)).toBe(true);
    expect(shouldAnimateRow(2000, 2050, 100, 150, vh)).toBe(true);
    expect(shouldAnimateRow(100, 150, 2000, 2050, vh)).toBe(true);
  });
  it("兩邊都在視窗外直接就位", () => {
    expect(shouldAnimateRow(2000, 2050, 3000, 3050, vh)).toBe(false);
    expect(shouldAnimateRow(-500, -450, 1200, 1250, vh)).toBe(false);
  });
  it("margin 讓視窗上下各放寬一段", () => {
    expect(shouldAnimateRow(900, 950, 1000, 1050, vh)).toBe(false);
    expect(shouldAnimateRow(900, 950, 1000, 1050, vh, 200)).toBe(true);
  });
});

describe("月曆「遊戲／活動」開關", () => {
  const spec = (q: string) => parseFilterSpec(new URLSearchParams(q)).filter;

  it("沒有 show＝只顯示遊戲（預設不顯示活動）", () => {
    expect(showFromSpec({})).toEqual(DEFAULT_SHOW);
    expect(DEFAULT_SHOW).toEqual({ releases: true, events: false });
    expect(filterSpecToReadQuery({}).show).toEqual({ releases: true, events: false });
  });

  it("show=events 只看活動；show=events,releases 兩者", () => {
    expect(filterSpecToReadQuery(spec("show=events")).show).toEqual({ releases: false, events: true });
    expect(filterSpecToReadQuery(spec("show=releases,events")).show).toEqual({ releases: true, events: true });
    expect(filterSpecToReadQuery(spec("show=releases")).show).toEqual({ releases: true, events: false });
    // 全是無效值 → parse 丟掉 → 預設
    expect(filterSpecToReadQuery(spec("show=bogus")).show).toEqual({ releases: true, events: false });
  });

  it("按下開關後的網址：預設狀態不寫 show；兩者開＝events,releases", () => {
    const [games, events] = showSwitchModels({});
    expect(games).toMatchObject({ kind: "releases", checked: true, nextSpec: null }); // 最後一個開著的不能關
    expect(events).toMatchObject({ kind: "events", checked: false });
    expect(events!.nextSpec).toEqual({ show: ["events", "releases"] });
    const both = showSwitchModels(spec("show=events,releases"));
    expect(both[0]!.nextSpec).toEqual({ show: ["events"] }); // 關遊戲＝只看活動
    expect(both[1]!.nextSpec).toEqual({}); // 關活動＝回預設，網址不帶 show
    const onlyEvents = showSwitchModels(spec("show=events"));
    expect(onlyEvents[1]).toMatchObject({ checked: true, nextSpec: null });
    expect(onlyEvents[0]!.nextSpec).toEqual({ show: ["events", "releases"] });
  });

  it("開關切換保留其他篩選；toggledShow 不允許全關", () => {
    expect(specWithShow(spec("platform=ps5&show=events"), { releases: true, events: false })).toEqual({ platform: ["ps5"] });
    expect(specWithShow({ platform: ["ps5"] }, { releases: true, events: true })).toEqual({ platform: ["ps5"], show: ["events", "releases"] });
    expect(toggledShow({ releases: true, events: false }, "releases")).toBeNull();
    expect(toggledShow({ releases: false, events: true }, "events")).toBeNull();
    expect(toggledShow({ releases: true, events: true }, "events")).toEqual({ releases: true, events: false });
  });
});
