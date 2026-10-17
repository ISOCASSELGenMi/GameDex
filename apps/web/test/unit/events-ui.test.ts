// 活動列表／詳情 UI 的純函式。
import { describe, expect, it } from "vitest";
import { createTranslator, formatEventTimeText } from "@sok/i18n";
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

describe("活動時間依時區（formatEventTimeText）", () => {
  const start = "2026-06-05T17:00:00.000Z";
  it("三語：主行依指定時區，UTC 與其他時區結果不同", () => {
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      const taipei = formatEventTimeText(start, null, locale, "Asia/Taipei").start;
      const utc = formatEventTimeText(start, null, locale, "UTC").start;
      expect(taipei, locale).not.toBe(utc);
      expect(utc, locale).toContain("UTC");
    }
    expect(formatEventTimeText(start, null, "en", "Asia/Taipei").start).toMatch(/Jun 6, 2026.*1:00\s?AM/);
    expect(formatEventTimeText(start, null, "en", "America/Los_Angeles").start).toMatch(/Jun 5, 2026.*10:00\s?AM/);
  });
  it("跨日：UTC 同一天的區間，在東八區變成跨日 → 結束要帶日期；反之亦然", () => {
    const end = "2026-06-05T18:30:00.000Z"; // UTC 同一天
    const utc = formatEventTimeText(start, end, "en", "UTC");
    expect(utc.end).not.toMatch(/Jun/);
    const lateStart = "2026-06-05T15:30:00.000Z";
    const lateEnd = "2026-06-05T16:30:00.000Z"; // Taipei 23:30 → 00:30 隔天
    const taipei = formatEventTimeText(lateStart, lateEnd, "en", "Asia/Taipei");
    expect(taipei.end).toMatch(/Jun 6/);
  });
  it("結束等於開始或沒有結束 → end 為 null；不合法時區退回 UTC；不合法時間原樣", () => {
    expect(formatEventTimeText(start, start, "en", "UTC").end).toBeNull();
    expect(formatEventTimeText(start, null, "en", "UTC").end).toBeNull();
    expect(formatEventTimeText(start, null, "en", "Not/AZone").start).toContain("UTC");
    expect(formatEventTimeText("bad", null, "en", "UTC").start).toBe("bad");
  });
});
