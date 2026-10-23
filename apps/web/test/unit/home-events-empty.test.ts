// 首頁近期活動空狀態的渲染（三語；伺服器渲染成字串後斷言文字）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator, type Locale } from "@sok/i18n";
import { HOME_EVENT_DAYS } from "@/modules/catalog/domain/home-dashboard";
import { HomeEventsEmpty } from "@/modules/catalog/ui/home/home-events-empty";

const EXPECTED: Record<Locale, string> = {
  "zh-Hant": "目前沒有進行中或 30 天內開始的活動。",
  en: "No events in progress or starting within 30 days.",
  ja: "開催中または 30 日以内に始まるイベントはありません。",
};

describe("首頁近期活動空狀態", () => {
  it("窗口天數是 30，三語文字含天數且帶 data-home-empty", () => {
    expect(HOME_EVENT_DAYS).toBe(30);
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      const html = renderToStaticMarkup(createElement(HomeEventsEmpty, { t: createTranslator(locale) }));
      expect(html, locale).toContain("data-home-empty");
      expect(html, locale).toContain(EXPECTED[locale]);
    }
  });
});
