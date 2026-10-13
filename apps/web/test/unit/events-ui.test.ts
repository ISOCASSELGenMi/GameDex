// 活動列表／詳情 UI 的純函式。
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import {
  EVENTS_PAGE_MAX,
  eventStatusLabel,
  eventTimeText,
  parseEventKind,
  parseEventScope,
  parseEventsPage,
} from "@/modules/catalog/ui/events/view-model";

const tZh = createTranslator("zh-Hant");
const tEn = createTranslator("en");

describe("活動網址參數", () => {
  it("when：未知值回 upcoming", () => {
    expect(parseEventScope("past")).toBe("past");
    expect(parseEventScope("undated")).toBe("undated");
    expect(parseEventScope("tbd")).toBe("upcoming");
    expect(parseEventScope(undefined)).toBe("upcoming");
  });

  it("kind：只認 4 種，其餘＝全部", () => {
    for (const k of ["showcase", "expo", "awards", "other"]) expect(parseEventKind(k)).toBe(k);
    expect(parseEventKind("concert")).toBeNull();
    expect(parseEventKind("")).toBeNull();
    expect(parseEventKind(undefined)).toBeNull();
  });

  it("page：1~上限", () => {
    expect(parseEventsPage("2")).toBe(2);
    expect(parseEventsPage("0")).toBe(1);
    expect(parseEventsPage("x")).toBe(1);
    expect(parseEventsPage(String(EVENTS_PAGE_MAX + 1))).toBe(1);
  });
});

describe("活動時間文字（UTC）", () => {
  it("時間未定", () => {
    expect(eventTimeText({ startTime: null, endTime: null }, "zh-Hant", tZh)).toBe("時間未定");
    expect(eventTimeText({ startTime: null, endTime: null }, "en", tEn)).toBe("Date to be announced");
  });

  it("只有開始時間：標註 UTC", () => {
    const text = eventTimeText({ startTime: "2026-06-05T17:00:00.000Z", endTime: null }, "en", tEn);
    expect(text).toContain("UTC");
    expect(text).toMatch(/Jun/);
    expect(text).toMatch(/5:00/);
  });

  it("有結束時間：顯示區間；結束等於開始時只顯示一次", () => {
    const range = eventTimeText({ startTime: "2026-06-05T17:00:00.000Z", endTime: "2026-06-08T17:00:00.000Z" }, "en", tEn);
    expect(range).toContain(" – ");
    expect(range.match(/UTC/g)?.length).toBe(2);
    // 同一個 UTC 日：結束只顯示時間
    const sameDay = eventTimeText({ startTime: "2026-06-05T17:00:00.000Z", endTime: "2026-06-05T18:30:00.000Z" }, "en", tEn);
    expect(sameDay).toContain(" – ");
    expect(sameDay.match(/Jun/g)?.length).toBe(1);
    expect(sameDay.match(/UTC/g)?.length).toBe(2);
    const same = eventTimeText({ startTime: "2026-06-05T17:00:00.000Z", endTime: "2026-06-05T17:00:00.000Z" }, "en", tEn);
    expect(same).not.toContain(" – ");
  });
});

describe("活動狀態與連結", () => {
  it("upcoming 與 undated 不另標，進行中／已結束有標籤", () => {
    expect(eventStatusLabel(tEn, "upcoming")).toBeNull();
    expect(eventStatusLabel(tEn, "ongoing")).toBe("Happening now");
    expect(eventStatusLabel(tZh, "past")).toBe("已結束");
    expect(eventStatusLabel(tZh, "undated")).toBeNull();
  });
});
