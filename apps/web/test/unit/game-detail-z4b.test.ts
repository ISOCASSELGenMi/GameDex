// 遊戲詳情頁補資訊（Z4B）：公司分欄、空欄位隱藏、版本標註、相對時間、相關內容 HTML。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import type { GameCompanyCredit, GameDetail, GameDetailExtra, GameSummary } from "@/modules/catalog/domain/entities";
import { AboutSection } from "@/modules/catalog/ui/game/about-section";
import {
  companyColumns,
  editionNotice,
  editionNoticeParts,
  editionNoticeText,
  localizedTitleRegionLabel,
  relativeReleaseText,
} from "@/modules/catalog/ui/game/detail-view";
import { RelatedSection } from "@/modules/catalog/ui/game/related-section";

const summary = (slug: string, name: string, gameType = "main_game"): GameSummary => ({
  gameId: slug.length,
  slug,
  name,
  originalName: name,
  cover: null,
  firstReleaseDate: "2020-01-02",
  firstReleasePrecision: "day",
  gameType,
  popularityScore: 0,
});

const emptyExtra = (): GameDetailExtra => ({
  storyline: null,
  gameModes: [],
  playerPerspectives: [],
  engines: [],
  localizedTitles: [],
  alternativeTitles: [],
  edition: { versionTitle: null, versionParent: null },
  related: [],
  relatedTotal: 0,
});

const company = (slug: string, roles: GameCompanyCredit["roles"]): GameCompanyCredit => ({ slug, name: slug.toUpperCase(), roles });

describe("companyColumns", () => {
  it("開發商、發行商、協力開發商分欄；移植標 porting", () => {
    const cols = companyColumns([
      company("dev", ["developer"]),
      company("both", ["developer", "publisher"]),
      company("pub", ["publisher"]),
      company("sup", ["supporting"]),
      company("port", ["porting"]),
      company("support", ["supporting", "porting"]),
    ]);
    expect(cols.mainDevelopers.map((e) => e.company.slug)).toEqual(["dev", "both"]);
    expect(cols.publishers.map((e) => e.company.slug)).toEqual(["both", "pub"]);
    expect(cols.supporting.map((e) => [e.company.slug, e.porting])).toEqual([
      ["sup", false],
      ["port", true],
      ["support", false],
    ]);
  });
});

describe("editionNotice", () => {
  const t = createTranslator("zh-Hant");
  const base = { gameType: "main_game", parent: null, extra: emptyExtra() };

  it("一般遊戲：沒有標註", () => {
    expect(editionNotice(base)).toEqual({ kind: "none" });
  });

  it("DLC：標註是本體的 DLC", () => {
    const n = editionNotice({ ...base, gameType: "dlc_addon", parent: summary("base", "本體") });
    expect(n.kind).toBe("derived");
    expect(editionNoticeText(t, n)).toBe("這是《本體》的DLC／追加內容");
    expect(editionNoticeParts(t, n)).toEqual({ before: "這是《", after: "》的DLC／追加內容" });
  });

  it("有 version_title 的版本：標註版本名稱", () => {
    const extra = { ...emptyExtra(), edition: { versionTitle: "Nintendo Switch 2 Edition", versionParent: summary("x", "X") } };
    const n = editionNotice({ ...base, extra });
    expect(n).toMatchObject({ kind: "edition", versionTitle: "Nintendo Switch 2 Edition" });
    expect(editionNoticeText(t, n)).toBe("這是《X》的 Nintendo Switch 2 Edition");
    expect(editionNoticeText(createTranslator("en"), n)).toBe("This is the Nintendo Switch 2 Edition of X");
  });

  it("版本沒有 version_title：用「版本」字樣", () => {
    const extra = { ...emptyExtra(), edition: { versionTitle: null, versionParent: summary("x", "X") } };
    expect(editionNoticeText(t, editionNotice({ ...base, extra }))).toBe("這是《X》的版本");
  });

  it("重製版有 version_parent：用 gameType 名稱", () => {
    const extra = { ...emptyExtra(), edition: { versionTitle: null, versionParent: summary("x", "X") } };
    expect(editionNoticeText(t, editionNotice({ ...base, gameType: "remake", extra }))).toBe("這是《X》的重製版");
  });

  it("非主遊戲但本體尚未同步：不標註", () => {
    expect(editionNotice({ ...base, gameType: "dlc_addon" })).toEqual({ kind: "none" });
  });
});

describe("relativeReleaseText", () => {
  it("只在精確到日時顯示", () => {
    expect(relativeReleaseText("2027-05-31", "month", "2027-01-01", "en")).toBeNull();
    expect(relativeReleaseText(null, null, "2027-01-01", "en")).toBeNull();
  });
  it("天／月／年", () => {
    expect(relativeReleaseText("2027-01-01", "day", "2027-01-01", "en")).toBe("today");
    expect(relativeReleaseText("2027-01-11", "day", "2027-01-01", "en")).toBe("in 10 days");
    expect(relativeReleaseText("2027-04-01", "day", "2027-01-01", "en")).toBe("in 3 months");
    expect(relativeReleaseText("2024-01-01", "day", "2027-01-01", "en")).toBe("3 years ago");
    expect(relativeReleaseText("2027-04-01", "day", "2027-01-01", "zh-Hant")).toBe("3 個月後");
  });
});

describe("localizedTitleRegionLabel", () => {
  it("字典有的用字典，沒有的用語言名稱，最後退回代碼", () => {
    expect(localizedTitleRegionLabel(createTranslator("zh-Hant"), "zh-Hant", "ja")).toBe("日本");
    expect(localizedTitleRegionLabel(createTranslator("en"), "en", "th")).toBe("Thai");
    expect(localizedTitleRegionLabel(createTranslator("en"), "en", "!!")).toBe("!!");
  });
});

function gameWith(extra: Partial<GameDetailExtra>, over: Partial<GameDetail> = {}): GameDetail {
  return {
    gameType: "main_game",
    genres: [],
    themes: [],
    companies: [],
    extra: { ...emptyExtra(), ...extra },
    ...over,
  } as unknown as GameDetail;
}

function renderAbout(game: GameDetail, locale: "zh-Hant" | "en" = "zh-Hant"): string {
  return renderToStaticMarkup(createElement(AboutSection, { game, franchises: [], locale, t: createTranslator(locale) }));
}

describe("AboutSection", () => {
  it("什麼都沒有：整區不顯示", () => {
    expect(renderAbout(gameWith({}))).toBe("");
  });

  it("空欄位整欄不顯示、有資料的欄用 <dl>", () => {
    const html = renderAbout(
      gameWith(
        { gameModes: [{ slug: "single-player", name: "Single player" }], engines: [{ slug: "havok", name: "Havok" }] },
        { companies: [company("nintendo", ["publisher"]), company("monolith", ["supporting"]), company("tose", ["porting"])] },
      ),
    );
    expect(html).toContain("<dl");
    expect(html).toContain('data-about-item="publishers"');
    expect(html).toContain('data-about-item="supporting-developers"');
    expect(html).toContain('data-about-item="game-modes"');
    expect(html).toContain("單人");
    expect(html).toContain('data-about-item="engines"');
    expect(html).not.toContain('data-about-item="main-developers"');
    expect(html).not.toContain('data-about-item="player-perspectives"');
    expect(html).not.toContain('data-about-item="themes"');
    expect(html).not.toContain("data-about-story");
    expect(html).not.toContain("data-about-titles");
    // porting 標「移植」，supporting 不標
    expect(html.match(/移植/g)).toHaveLength(1);
  });

  it("故事、各語言標題、其他稱呼", () => {
    const html = renderAbout(
      gameWith({
        storyline: "Link wakes up.",
        localizedTitles: [{ localeCode: "ja", name: "ゼルダ" }],
        alternativeTitles: [
          { name: "BotW", comment: "Acronym" },
          { name: "無註記", comment: null },
        ],
      }),
    );
    expect(html).toContain("Link wakes up.");
    expect(html).toContain("日本");
    expect(html).toContain('lang="ja"');
    expect(html).toContain("Acronym:");
    expect(html).toContain("無註記");
  });
});

describe("RelatedSection", () => {
  it("沒有相關內容：不渲染", () => {
    const html = renderToStaticMarkup(createElement(RelatedSection, { extra: emptyExtra(), locale: "en", t: createTranslator("en") }));
    expect(html).toBe("");
  });

  it("依組顯示標題與數量；total 大於已列出時顯示「還有 X 款」；預設收合", () => {
    const extra: GameDetailExtra = {
      ...emptyExtra(),
      relatedTotal: 6,
      related: [
        { key: "dlcs", games: [summary("d1", "DLC One", "dlc_addon"), summary("d2", "DLC Two", "dlc_addon")], total: 5 },
        { key: "ports", games: [summary("p1", "Port One", "port")], total: 1 },
      ],
    };
    const html = renderToStaticMarkup(createElement(RelatedSection, { extra, locale: "en", t: createTranslator("en") }));
    expect(html).toContain('data-open="false"');
    expect(html).toContain('id="related-title"');
    expect(html).toContain("DLCs (5)");
    expect(html).toContain("Ports (1)");
    expect(html).toContain("3 more");
    expect(html.match(/data-related-more/g)).toHaveLength(1);
    expect(html).toContain('href="/en/games/d1"');
  });
});
