// 語言支援區塊：三態呈現邏輯與 HTML（絕不出現「不支援」）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import { buildLanguageSupport } from "@/modules/catalog/domain/entities";
import { LanguageSupportBody } from "@/modules/catalog/ui/game/language-support";
import { buildLanguageSupportView, languageNames } from "@/modules/catalog/ui/game/language-support-view";

const entries = [
  { languageCode: "ja-JP", supportType: "audio" },
  { languageCode: "en", supportType: "interface" },
  { languageCode: "en", supportType: "subtitles" },
  { languageCode: "zh-Hant", supportType: "interface" },
];

function render(locale: "zh-Hant" | "en", support: ReturnType<typeof buildLanguageSupport>): string {
  return renderToStaticMarkup(createElement(LanguageSupportBody, { support, locale, t: createTranslator(locale), headingId: "sec-languages" }));
}

describe("buildLanguageSupportView", () => {
  it("三類都沒資料 → no_data（整區）", () => {
    expect(buildLanguageSupportView(buildLanguageSupport([], "en"), "en")).toEqual({ state: "no_data" });
  });

  it("有資料：當前網站語言置頂，欄狀態與每格是否有資料正確", () => {
    const view = buildLanguageSupportView(buildLanguageSupport(entries, "zh-Hant"), "zh-Hant");
    if (view.state !== "available") throw new Error("expected available");
    expect(view.rows.map((r) => r.code)).toEqual(["zh-Hant", "en", "ja-JP"]);
    expect(view.columns).toEqual([
      { type: "interface", state: "has_data" },
      { type: "subtitles", state: "has_data" },
      { type: "audio", state: "has_data" },
    ]);
    const en = view.rows.find((r) => r.code === "en")!;
    expect(en.has).toEqual({ interface: true, subtitles: true, audio: false });
  });

  it("某欄完全沒資料 → 該欄 no_data，其他欄不受影響", () => {
    const view = buildLanguageSupportView(buildLanguageSupport([{ languageCode: "en", supportType: "interface" }], "en"), "en");
    if (view.state !== "available") throw new Error("expected available");
    expect(view.columns.map((c) => c.state)).toEqual(["has_data", "no_data", "no_data"]);
  });

  it("沒有任何表示「不支援」的欄位", () => {
    const view = buildLanguageSupportView(buildLanguageSupport(entries, "en"), "en");
    expect(JSON.stringify(view).toLowerCase()).not.toMatch(/unsupported|not_supported|notsupported/);
  });
});

describe("languageNames（Intl.DisplayNames）", () => {
  it("依網站語言顯示名稱，附自稱", () => {
    const zh = languageNames("ja-JP", "zh-Hant");
    expect(zh.name).toContain("日");
    expect(zh.nativeName).toContain("日本語");
    const en = languageNames("ja-JP", "en");
    expect(en.name).toMatch(/Japanese/);
  });
  it("名稱與自稱相同時不重複顯示自稱", () => {
    expect(languageNames("en", "en").nativeName).toBeNull();
  });
  it("不合法的代碼不會丟錯，退回代碼本身", () => {
    expect(languageNames("not a code!!", "en")).toEqual({ name: "not a code!!", nativeName: null });
    expect(languageNames("", "en").name).toBe("");
  });
});

describe("LanguageSupportBody HTML", () => {
  it("整區沒資料：「尚無語言資料」，沒有表格", () => {
    const html = render("zh-Hant", buildLanguageSupport([], "zh-Hant"));
    expect(html).toContain("尚無語言資料");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("不支援");
    const en = render("en", buildLanguageSupport([], "en"));
    expect(en).toContain("No language data yet");
    expect(en.toLowerCase()).not.toContain("not supported");
    expect(en.toLowerCase()).not.toContain("unsupported");
  });

  it("有資料：表格、✓ 加螢幕閱讀器文字、自稱標 lang", () => {
    const html = render("zh-Hant", buildLanguageSupport(entries, "zh-Hant"));
    expect(html).toContain("<table");
    expect(html).toContain("✓");
    expect(html).toContain('lang="ja-JP"');
    expect(html).toContain("介面");
    expect(html).toContain("字幕");
    expect(html).toContain("語音");
    expect(html).not.toContain("不支援");
    expect(html).not.toContain("未提供資料");
  });

  it("某欄沒資料：該欄只出現一次「未提供資料」（rowSpan 合併），且不是「不支援」", () => {
    const support = buildLanguageSupport(
      [
        { languageCode: "en", supportType: "interface" },
        { languageCode: "ja-JP", supportType: "interface" },
        { languageCode: "fr-FR", supportType: "interface" },
      ],
      "en",
    );
    const html = render("en", support);
    expect(html.match(/No data provided/g)?.length).toBe(2); // 字幕、語音兩欄各一格
    expect(html).toContain('rowSpan="3"');
    expect(html.toLowerCase()).not.toContain("not supported");
    expect(html.toLowerCase()).not.toContain("unsupported");
  });

  it("沒資料的格子是空白（只有 sr-only 文字）", () => {
    const html = render("en", buildLanguageSupport(entries, "en"));
    expect(html).toContain('<span class="sr-only">No data</span>');
  });
});
