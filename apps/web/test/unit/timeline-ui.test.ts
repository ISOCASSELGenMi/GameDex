// 時間軸 UI 的純函式：卡片／組標題轉換、跨頁合併、展開、月份分組、「今天」線位置。
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import type { ReleaseCard, TimelineGroup, TimelinePage } from "@/modules/catalog";
import type { TimelineCardData, TimelineChunk, TimelineGroupData } from "@/modules/catalog/ui/timeline/types";
import {
  appendGroupCards,
  buildTimelineChunk,
  groupByMonth,
  mergeTimelineChunk,
  remainingInGroup,
  timelineGroupTitle,
  timelineMonthTitle,
  todayMarkerIndex,
  toTimelineCard,
} from "@/modules/catalog/ui/timeline/view-model";
import { releaseHistoryText } from "@/modules/catalog/ui/release-history";

const tZh = createTranslator("zh-Hant");
const tEn = createTranslator("en");

function releaseCard(over: Partial<ReleaseCard> = {}): ReleaseCard {
  return {
    gameId: 1,
    slug: "game-1",
    name: "遊戲一",
    originalName: "Game One",
    cover: null,
    date: "2026-10-13",
    periodStart: "2026-10-13",
    precision: "day",
    stage: "full",
    status: "scheduled",
    sourceStatus: "active",
    platforms: [{ slug: "ps5", name: "PlayStation 5", abbreviation: "PS5" } as ReleaseCard["platforms"][number]],
    popularityScore: 0,
    heatLevel: 0,
    gameType: "main_game",
    gameStatus: null,
    releaseEventIds: [10],
    hasDateHistory: false,
    ...over,
  };
}

function group(over: Partial<TimelineGroupData> & { key: string }): TimelineGroupData {
  return {
    kind: "day",
    periodStart: over.key.startsWith("day:") ? over.key.slice(4) : null,
    month: over.key.startsWith("day:") ? over.key.slice(4, 11) : null,
    monthTitle: "",
    title: over.key,
    cards: [],
    totalCount: over.cards?.length ?? 0,
    hiddenCount: 0,
    continuesFromPrev: false,
    continuesToNext: false,
    ...over,
  };
}

const card = (k: string): TimelineCardData => ({ g: 1, k, h: `/g/${k}`, n: k, p: [], pn: "", sk: "full", s: "正式版" });

describe("toTimelineCard", () => {
  it("基本欄位：連結、平台縮寫、階段文字；熱度 0 與無改期紀錄不帶欄位", () => {
    const c = toTimelineCard(releaseCard(), "zh-Hant", tZh);
    expect(c).toMatchObject({ k: "1-full", h: "/zh-Hant/games/game-1", n: "遊戲一", o: "Game One", p: ["PS5"], pn: "PlayStation 5", sk: "full" });
    expect(c.hv).toBeUndefined();
    expect(c.ids).toBeUndefined();
    expect(c.pl).toBeUndefined();
    expect(c.tk).toBeUndefined();
  });

  it("原名與顯示名稱相同時不帶 o；精度非 day 帶標示；延期帶狀態；熱度與改期紀錄", () => {
    const c = toTimelineCard(
      releaseCard({ name: "Same", originalName: "Same", precision: "month", status: "delayed", heatLevel: 4, hasDateHistory: true, releaseEventIds: [1, 2], sourceStatus: "removed" }),
      "en",
      tEn,
    );
    expect(c.o).toBeUndefined();
    expect(c.pl).toBe("Month known");
    expect(c).toMatchObject({ tk: "delayed", t: "Delayed", hv: 4, hl: "Heat 4/5", ids: [1, 2], r: 1 });
  });

  it("有改期紀錄旗標但沒有 id 時不帶 ids", () => {
    expect(toTimelineCard(releaseCard({ hasDateHistory: true, releaseEventIds: [] }), "en", tEn).ids).toBeUndefined();
  });
});

describe("組與月份標題", () => {
  it("日：月日＋星期（UTC）；月／季／年：精度說明＋期間；tbd：日期未定", () => {
    expect(timelineGroupTitle({ kind: "day", periodStart: "2026-10-13" }, "en", tEn)).toBe("Tuesday, October 13");
    expect(timelineGroupTitle({ kind: "day", periodStart: "2026-10-13" }, "zh-Hant", tZh)).toContain("10月13日");
    expect(timelineGroupTitle({ kind: "month", periodStart: "2026-12-01" }, "en", tEn)).toBe("Month known: December 2026");
    expect(timelineGroupTitle({ kind: "quarter", periodStart: "2027-04-01" }, "zh-Hant", tZh)).toContain("2027 年第 2 季");
    expect(timelineGroupTitle({ kind: "year", periodStart: "2027-01-01" }, "en", tEn)).toContain("2027");
    expect(timelineGroupTitle({ kind: "tbd", periodStart: null }, "zh-Hant", tZh)).toBe("日期未定");
  });

  it("月份區段標題：YYYY-MM 與 tbd(null)", () => {
    expect(timelineMonthTitle("2026-10", "en", tEn)).toBe("October 2026");
    expect(timelineMonthTitle(null, "en", tEn)).toBe("Date TBA");
  });
});

describe("buildTimelineChunk", () => {
  it("保留 cursor 與組的 flag，卡片轉成字串化資料", () => {
    const g: TimelineGroup = {
      key: "day:2026-10-13",
      kind: "day",
      periodStart: "2026-10-13",
      month: "2026-10",
      cards: [releaseCard()],
      totalCount: 12,
      hiddenCount: 2,
      continuesFromPrev: false,
      continuesToNext: true,
    };
    const page: TimelinePage = { groups: [g], nextCursor: "N", prevCursor: "P", today: "2026-10-13", anchor: "2026-10-13", groupPreview: 10, ignored: [] };
    const chunk = buildTimelineChunk(page, "en", tEn);
    expect(chunk.nextCursor).toBe("N");
    expect(chunk.prevCursor).toBe("P");
    expect(chunk.groups[0]).toMatchObject({ key: "day:2026-10-13", monthTitle: "October 2026", totalCount: 12, hiddenCount: 2, continuesToNext: true });
    expect(chunk.groups[0]!.cards).toHaveLength(1);
  });
});

describe("mergeTimelineChunk", () => {
  const a = group({ key: "day:2026-10-13", cards: [card("a"), card("b")], continuesToNext: true, totalCount: 5, hiddenCount: 0 });
  const b = group({ key: "day:2026-10-14", cards: [card("c")] });

  it("next：頁界切在組中間時同 key 合併、去重，旗標與 cursor 取新頁的", () => {
    const existing: TimelineChunk = { groups: [a], nextCursor: "N1", prevCursor: "P0" };
    const incoming: TimelineChunk = {
      groups: [group({ key: "day:2026-10-13", cards: [card("b"), card("d")], continuesFromPrev: true, continuesToNext: false, totalCount: 5 }), b],
      nextCursor: "N2",
      prevCursor: "Pignored",
    };
    const merged = mergeTimelineChunk(existing, incoming, "next");
    expect(merged.groups.map((g) => g.key)).toEqual(["day:2026-10-13", "day:2026-10-14"]);
    expect(merged.groups[0]!.cards.map((c) => c.k)).toEqual(["a", "b", "d"]);
    expect(merged.groups[0]!.continuesToNext).toBe(false);
    expect(merged.groups[0]!.continuesFromPrev).toBe(false);
    expect(merged.nextCursor).toBe("N2");
    expect(merged.prevCursor).toBe("P0");
  });

  it("next：沒有重疊的組直接接在後面", () => {
    const merged = mergeTimelineChunk({ groups: [a], nextCursor: "N1", prevCursor: null }, { groups: [b], nextCursor: null, prevCursor: null }, "next");
    expect(merged.groups.map((g) => g.key)).toEqual(["day:2026-10-13", "day:2026-10-14"]);
    expect(merged.nextCursor).toBeNull();
  });

  it("prev：新頁插在前面，邊界組合併（新的卡在前），prevCursor 取新頁的、nextCursor 保留", () => {
    const first = group({ key: "day:2026-10-13", cards: [card("c"), card("d")], continuesFromPrev: true });
    const earlier = group({ key: "day:2026-10-12", cards: [card("z")] });
    const incomingTail = group({ key: "day:2026-10-13", cards: [card("a"), card("b")], continuesToNext: true });
    const merged = mergeTimelineChunk(
      { groups: [first], nextCursor: "N", prevCursor: "P1" },
      { groups: [earlier, incomingTail], nextCursor: "ignored", prevCursor: "P2" },
      "prev",
    );
    expect(merged.groups.map((g) => g.key)).toEqual(["day:2026-10-12", "day:2026-10-13"]);
    expect(merged.groups[1]!.cards.map((c) => c.k)).toEqual(["a", "b", "c", "d"]);
    expect(merged.groups[1]!.continuesFromPrev).toBe(false);
    expect(merged.groups[1]!.continuesToNext).toBe(false);
    expect(merged.prevCursor).toBe("P2");
    expect(merged.nextCursor).toBe("N");
  });

  it("目前清單是空的：直接採用新頁", () => {
    const incoming: TimelineChunk = { groups: [b], nextCursor: "N", prevCursor: "P" };
    expect(mergeTimelineChunk({ groups: [], nextCursor: null, prevCursor: null }, incoming, "next")).toEqual(incoming);
  });

  it("不修改傳入的物件", () => {
    const existing: TimelineChunk = { groups: [a], nextCursor: "N1", prevCursor: null };
    const snapshot = JSON.stringify(existing);
    mergeTimelineChunk(existing, { groups: [group({ key: a.key, cards: [card("x")] })], nextCursor: null, prevCursor: null }, "next");
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});

describe("展開與剩餘數量", () => {
  it("appendGroupCards 接在後面並去重，更新總數", () => {
    const g = group({ key: "day:2026-10-13", cards: [card("a")], totalCount: 3, hiddenCount: 2 });
    const out = appendGroupCards({ groups: [g], nextCursor: null, prevCursor: null }, g.key, [card("a"), card("b")], 3);
    expect(out.groups[0]!.cards.map((c) => c.k)).toEqual(["a", "b"]);
  });

  it("remainingInGroup：預覽組＝hiddenCount；展開後遞減；跨頁中的組為 0", () => {
    const ten = Array.from({ length: 10 }, (_, i) => card(`c${i}`));
    expect(remainingInGroup(group({ key: "day:2026-10-13", cards: ten, totalCount: 25, hiddenCount: 15 }))).toBe(15);
    expect(remainingInGroup(group({ key: "day:2026-10-13", cards: [...ten, ...Array.from({ length: 5 }, (_, i) => card(`d${i}`))], totalCount: 25, hiddenCount: 15 }))).toBe(10);
    expect(remainingInGroup(group({ key: "day:2026-10-13", cards: ten, totalCount: 25, hiddenCount: 15, continuesToNext: true }))).toBe(0);
    expect(remainingInGroup(group({ key: "day:2026-10-13", cards: [card("a")], totalCount: 1, hiddenCount: 0 }))).toBe(0);
  });
});

describe("groupByMonth", () => {
  it("同月連續的組歸同一區段，tbd 另成一段", () => {
    const gs = [
      group({ key: "month:2026-10-01", kind: "month", periodStart: "2026-10-01", month: "2026-10", monthTitle: "2026年10月" }),
      group({ key: "day:2026-10-13", month: "2026-10", monthTitle: "2026年10月" }),
      group({ key: "day:2026-11-02", month: "2026-11", monthTitle: "2026年11月" }),
      group({ key: "tbd", kind: "tbd", periodStart: null, month: null, monthTitle: "日期未定" }),
    ];
    const sections = groupByMonth(gs);
    expect(sections.map((s) => [s.month, s.groups.length])).toEqual([
      ["2026-10", 2],
      ["2026-11", 1],
      [null, 1],
    ]);
  });
});

describe("todayMarkerIndex", () => {
  const today = "2026-10-13";
  const gs = [group({ key: "day:2026-10-10" }), group({ key: "day:2026-10-13" }), group({ key: "day:2026-10-20" })];

  it("放在第一個 periodStart ≥ 今天的組之前", () => {
    expect(todayMarkerIndex(gs, today, { startsAtToday: false, hasNext: true })).toBe(1);
  });

  it("從今天開始的頁：第一組之前（index 0）", () => {
    expect(todayMarkerIndex([group({ key: "day:2026-10-13" })], today, { startsAtToday: true, hasNext: true })).toBe(0);
  });

  it("跳到未來日期（第一組就在今天之後、且不是從今天開始）：不顯示", () => {
    expect(todayMarkerIndex([group({ key: "day:2027-01-05" })], today, { startsAtToday: false, hasNext: true })).toBeNull();
  });

  it("全部都早於今天：後面還有 → 不顯示；已到最後 → 接在最後一個有日期的組之後（tbd 之前）", () => {
    const past = [group({ key: "day:2026-10-01" }), group({ key: "day:2026-10-02" })];
    expect(todayMarkerIndex(past, today, { startsAtToday: false, hasNext: true })).toBeNull();
    expect(todayMarkerIndex(past, today, { startsAtToday: false, hasNext: false })).toBe(2);
    const withTbd = [...past, group({ key: "tbd", kind: "tbd", periodStart: null, month: null })];
    expect(todayMarkerIndex(withTbd, today, { startsAtToday: false, hasNext: false })).toBe(2);
  });

  it("沒有任何有日期的組：不顯示", () => {
    expect(todayMarkerIndex([], today, { startsAtToday: true, hasNext: false })).toBeNull();
    expect(todayMarkerIndex([group({ key: "tbd", kind: "tbd", periodStart: null, month: null })], today, { startsAtToday: true, hasNext: false })).toBeNull();
  });

  it("月份模糊區塊（period_start 在本月初）早於今天，線在它之後", () => {
    const g2 = [group({ key: "month:2026-10-01", kind: "month", periodStart: "2026-10-01", month: "2026-10" }), group({ key: "day:2026-10-15" })];
    expect(todayMarkerIndex(g2, today, { startsAtToday: false, hasNext: true })).toBe(1);
  });
});

describe("releaseHistoryText", () => {
  it("舊 → 新（更新日）；沒有 changedAt 時只有變化", () => {
    const out = releaseHistoryText(
      [
        { oldDate: "2026-12-31", oldPrecision: "day", newDate: "2027-03-31", newPrecision: "quarter", changedAt: "2026-09-01T00:00:00Z" },
        { oldDate: null, oldPrecision: null, newDate: "2026-05-01", newPrecision: "day", changedAt: null },
      ],
      "en",
      tEn,
    );
    expect(out[0]).toContain("→");
    expect(out[0]).toContain("September 1, 2026");
    expect(out[1]).not.toContain("(");
  });
});
