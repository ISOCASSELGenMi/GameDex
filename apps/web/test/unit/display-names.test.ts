import { describe, expect, it } from "vitest";
import { pickTraditionalChineseAlternative, resolveDisplayNames } from "@/modules/catalog/domain/display-names";
import { gameNameLang } from "@/modules/catalog/ui/name-lang";

describe("resolveDisplayNames", () => {
  it("localizations 直接對應語系；manual 蓋過 igdb", () => {
    expect(
      resolveDisplayNames(
        [
          { localeCode: "ja", name: "バイオハザード ヴィレッジ", source: "igdb" },
          { localeCode: "ko", name: "바이오하자드 빌리지", source: "igdb" },
          { localeCode: "ja", name: "バイオハザード ヴィレッジ（手動）", source: "manual" },
        ],
        [],
      ),
    ).toEqual({ ja: "バイオハザード ヴィレッジ（手動）", ko: "바이오하자드 빌리지" });
  });

  it("沒有任何資料 → 空物件（讀取端退回原名）", () => {
    expect(resolveDisplayNames([], [])).toEqual({});
  });

  it("zh-Hant：只採 comment 明確標 Traditional／Taiwan 的別名", () => {
    const alts = [
      { name: "艾爾登法環", comment: "Chinese title - simplified" },
      { name: "Eldun Faan Waan", comment: "Chinese title - romanization" },
      { name: "艾尔登法环", comment: "Chinese title" },
      { name: "艾爾登法環", comment: "Chinese title - traditional" },
    ];
    expect(resolveDisplayNames([], alts)).toEqual({ "zh-Hant": "艾爾登法環" });
  });

  it("zh-Hant：人工（manual）localization 優先於別名", () => {
    expect(
      resolveDisplayNames([{ localeCode: "zh-Hant", name: "人工名稱", source: "manual" }], [{ name: "別名", comment: "Taiwanese title" }]),
    ).toEqual({ "zh-Hant": "人工名稱" });
  });
});

describe("pickTraditionalChineseAlternative", () => {
  it.each([
    [[{ name: "只有簡體", comment: "Chinese title - simplified" }], null],
    [[{ name: "不明繁簡", comment: "Chinese title" }], null],
    [[{ name: "繁體 translated", comment: "Chinese title - traditional translated" }], null],
    [[{ name: "Latin only", comment: "Chinese title - traditional" }], null], // 沒有漢字
    [[{ name: "ゲーム漢字", comment: "Chinese title - traditional" }], null], // 含假名 → 不是中文
    [[{ name: "台灣名稱", comment: "Taiwan title" }], "台灣名稱"],
    [[{ name: "繁體名稱", comment: "Chinese traditional title" }], "繁體名稱"],
    [[{ name: "荒岛求生：逃出美女岛", comment: "Chinese title - traditional" }], null], // 標 traditional 但含簡體專用字
    [[{ name: "x", comment: null }], null],
  ])("%j → %s", (alts, expected) => {
    expect(pickTraditionalChineseAlternative(alts)).toBe(expected);
  });
});

describe("gameNameLang", () => {
  it("在地化名稱（非原名）不標", () => {
    expect(gameNameLang("バイオハザード", false, "ja")).toBeUndefined();
  });
  it("原名為英文：ja／zh-Hant 頁面標 en，en 頁面不標", () => {
    expect(gameNameLang("Elden Ring", true, "ja")).toBe("en");
    expect(gameNameLang("Elden Ring", true, "zh-Hant")).toBe("en");
    expect(gameNameLang("Elden Ring", true, "en")).toBeUndefined();
  });
  it("原名含假名／韓文依文字標；與頁面語系相同不標；純漢字不標", () => {
    expect(gameNameLang("ファイナルファンタジー", true, "zh-Hant")).toBe("ja");
    expect(gameNameLang("ファイナルファンタジー", true, "ja")).toBeUndefined();
    expect(gameNameLang("메이플스토리", true, "ja")).toBe("ko");
    expect(gameNameLang("三國志", true, "ja")).toBeUndefined();
  });
});
