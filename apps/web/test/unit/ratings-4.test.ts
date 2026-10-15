// Phase 4：評分顯示——selectRatings 三層、環境變數（VISIBLE_SCORE_PROVIDERS／RATING_DISPLAY_PRIORITY 分別測試）、
// 詳情頁評分區（HTML）、JSON-LD aggregateRating、Metacritic 關閉時沒有評分任務。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import { ConfigError, getCoreEnv } from "@/kernel/config/env";
import { validateModules } from "@/kernel/modules/startup";
import { enabledModules } from "@/modules/registry";
import {
  DEFAULT_RATING_PRIORITY,
  getRatingDisplayConfig,
  selectRatings,
  shouldShowSourceSettings,
  validateRatingDisplayEnv,
  type GameDetail,
  type GameRating,
} from "@/modules/catalog";
import { defaultSelectedProviders, selectableProviders } from "@/modules/catalog/domain/rating-display";
import { RatingsSection } from "@/modules/catalog/ui/game/ratings-section";
import { gameJsonLd } from "@/modules/catalog/ui/seo/json-ld";

type Row = GameRating;
const row = (scoreProvider: Row["scoreProvider"], score: number | null, extra: Partial<Row> = {}): Row =>
  ({ scoreProvider, scoreType: scoreProvider === "metacritic_scrape" ? "metascore" : "critic_aggregate", score, scoreMax: 100, reviewCount: 12, platformId: null, sourceUrl: null, ...extra }) as Row;

const IGDB = row("igdb", 82);
const META = row("metacritic_scrape", 90, { reviewCount: 40 });
const META_USER = row("metacritic_scrape", 75, { scoreType: "user_score", reviewCount: 300 });
const PRIORITY = ["metacritic_scrape", "igdb"];

describe("selectRatings：05 三層順序", () => {
  it("score=NULL 的列視為無分數", () => {
    const r = selectRatings([row("igdb", null)], { visible: [], priority: PRIORITY });
    expect(r).toEqual({ shown: [], primary: null });
  });

  it("沒有分數列 → 不顯示", () => {
    expect(selectRatings([], { visible: [], selected: ["igdb"], priority: PRIORITY })).toEqual({ shown: [], primary: null });
  });

  it("層 1 visible：空＝不過濾；非空＝硬限制", () => {
    expect(selectRatings([IGDB, META], { visible: [], priority: PRIORITY }).shown).toHaveLength(2);
    const only = selectRatings([IGDB, META], { visible: ["igdb"], priority: PRIORITY });
    expect(only.shown).toEqual([IGDB]);
    expect(only.primary).toBe(IGDB);
  });

  it("層 2 selected：只在 visible 允許的來源中挑；undefined＝不過濾；[]＝什麼都沒選", () => {
    expect(selectRatings([IGDB, META], { visible: [], selected: ["igdb"], priority: PRIORITY }).shown).toEqual([IGDB]);
    expect(selectRatings([IGDB, META], { visible: [], selected: undefined, priority: PRIORITY }).shown).toHaveLength(2);
    expect(selectRatings([IGDB, META], { visible: [], selected: [], priority: PRIORITY })).toEqual({ shown: [], primary: null });
  });

  it("被隱藏的來源不得成為主分數，即使使用者選了它、優先序排第一", () => {
    const r = selectRatings([IGDB, META], { visible: ["igdb"], selected: ["metacritic_scrape", "igdb"], priority: PRIORITY });
    expect(r.primary).toBe(IGDB);
    expect(r.shown).toEqual([IGDB]);
  });

  it("使用者選到的來源都沒分數 → 不顯示，不退回沒選的來源", () => {
    const r = selectRatings([IGDB], { visible: [], selected: ["metacritic_scrape"], priority: PRIORITY });
    expect(r).toEqual({ shown: [], primary: null });
  });

  it("選的來源有 NULL 分數列、另一個沒選的有分數 → 仍不顯示", () => {
    const r = selectRatings([row("metacritic_scrape", null), IGDB], { visible: [], selected: ["metacritic_scrape"], priority: PRIORITY });
    expect(r).toEqual({ shown: [], primary: null });
  });

  it("層 3 priority：多來源時優先序在前的當主分數；改優先序主分數跟著變", () => {
    expect(selectRatings([IGDB, META], { visible: [], selected: ["igdb", "metacritic_scrape"], priority: PRIORITY }).primary).toBe(META);
    expect(selectRatings([META, IGDB], { visible: [], selected: ["igdb", "metacritic_scrape"], priority: ["igdb", "metacritic_scrape"] }).primary).toBe(IGDB);
    // 優先序沒列到的來源排最後
    expect(selectRatings([META, IGDB], { visible: [], priority: ["igdb"] }).primary).toBe(IGDB);
  });

  it("主分數只從 critic 類（metascore／critic_aggregate）挑；user_score 另列、排在後面", () => {
    const r = selectRatings([META_USER, IGDB], { visible: [], priority: PRIORITY });
    expect(r.primary).toBe(IGDB);
    expect(r.shown).toEqual([IGDB, META_USER]);
    // 只有 user_score → 有顯示但沒有主分數
    const onlyUser = selectRatings([META_USER], { visible: [], priority: PRIORITY });
    expect(onlyUser.shown).toEqual([META_USER]);
    expect(onlyUser.primary).toBeNull();
  });

  it("同一來源多列（不同平台）：不分平台的優先，其次評論數多的", () => {
    const perPlatform = row("metacritic_scrape", 70, { platformId: 5, reviewCount: 100 });
    const global = row("metacritic_scrape", 88, { platformId: null, reviewCount: 10 });
    expect(selectRatings([perPlatform, global], { visible: [], priority: PRIORITY }).primary).toBe(global);
    const a = row("metacritic_scrape", 70, { platformId: 5, reviewCount: 10 });
    const b = row("metacritic_scrape", 71, { platformId: 6, reviewCount: 99 });
    expect(selectRatings([a, b], { visible: [], priority: PRIORITY }).primary).toBe(b);
  });

  it("selectableProviders／shouldShowSourceSettings：只列層 1 之後實際有分數的來源，≥2 才出現設定", () => {
    expect(selectableProviders([IGDB], [])).toEqual(["igdb"]);
    expect(shouldShowSourceSettings([IGDB], [])).toBe(false);
    expect(shouldShowSourceSettings([IGDB, META], [])).toBe(true);
    expect(selectableProviders([IGDB, META], [])).toEqual(["metacritic_scrape", "igdb"]);
    expect(shouldShowSourceSettings([IGDB, META], ["igdb"])).toBe(false); // metacritic 被隱藏 → 只剩一個
    expect(shouldShowSourceSettings([IGDB, row("metacritic_scrape", null)], [])).toBe(false); // NULL 列不算來源
    expect(shouldShowSourceSettings([META, META_USER], [])).toBe(false); // 同一來源兩種類型仍是一個來源
  });

  it("defaultSelectedProviders：預設 igdb；站長把 igdb 隱藏時改用 visible", () => {
    expect(defaultSelectedProviders([])).toEqual(["igdb"]);
    expect(defaultSelectedProviders(["igdb", "metacritic_scrape"])).toEqual(["igdb"]);
    expect(defaultSelectedProviders(["metacritic_scrape"])).toEqual(["metacritic_scrape"]);
  });
});

const BASE_ENV = { DATABASE_URL: "postgres://x/y" };

describe("VISIBLE_SCORE_PROVIDERS（層 1）", () => {
  it("未設／空字串＝不過濾", () => {
    expect(getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV })).visible).toEqual([]);
    expect(getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV, VISIBLE_SCORE_PROVIDERS: "" })).visible).toEqual([]);
    expect(getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV, VISIBLE_SCORE_PROVIDERS: "  " })).visible).toEqual([]);
  });

  it("逗號分隔、去空白與重複", () => {
    const cfg = getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV, VISIBLE_SCORE_PROVIDERS: " igdb , metacritic_scrape,igdb" }));
    expect(cfg.visible).toEqual(["igdb", "metacritic_scrape"]);
  });

  it("未知名稱（含拼字錯誤、opencritic）→ 啟動報錯並列出名稱", () => {
    const env = getCoreEnv({ ...BASE_ENV, VISIBLE_SCORE_PROVIDERS: "igdb,metacritc_scrape" });
    expect(() => validateRatingDisplayEnv(env)).toThrow(ConfigError);
    expect(() => validateRatingDisplayEnv(env)).toThrow(/VISIBLE_SCORE_PROVIDERS.*metacritc_scrape/);
    expect(() => validateRatingDisplayEnv(getCoreEnv({ ...BASE_ENV, VISIBLE_SCORE_PROVIDERS: "opencritic" }))).toThrow(ConfigError);
  });

  it("只影響層 1：把 metacritic 排除 → 即使優先序第一也不會成為主分數", () => {
    const cfg = getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV, VISIBLE_SCORE_PROVIDERS: "igdb" }));
    const r = selectRatings([IGDB, META], { visible: cfg.visible, selected: ["igdb", "metacritic_scrape"], priority: cfg.priority });
    expect(r.primary).toBe(IGDB);
    expect(r.shown).toEqual([IGDB]);
  });
});

describe("RATING_DISPLAY_PRIORITY（層 3）", () => {
  it("預設 metacritic_scrape,igdb；空字串＝預設", () => {
    expect(getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV })).priority).toEqual(["metacritic_scrape", "igdb"]);
    expect(getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV, RATING_DISPLAY_PRIORITY: "" })).priority).toEqual(DEFAULT_RATING_PRIORITY);
  });

  it("可改成 igdb 優先", () => {
    const cfg = getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV, RATING_DISPLAY_PRIORITY: "igdb,metacritic_scrape" }));
    expect(cfg.priority).toEqual(["igdb", "metacritic_scrape"]);
    expect(selectRatings([META, IGDB], { visible: [], priority: cfg.priority }).primary).toBe(IGDB);
    const def = getRatingDisplayConfig(getCoreEnv({ ...BASE_ENV }));
    expect(selectRatings([META, IGDB], { visible: [], priority: def.priority }).primary).toBe(META);
  });

  it("未知名稱 → 啟動報錯", () => {
    const env = getCoreEnv({ ...BASE_ENV, RATING_DISPLAY_PRIORITY: "igdb,steam" });
    expect(() => validateRatingDisplayEnv(env)).toThrow(/RATING_DISPLAY_PRIORITY.*steam/);
  });

  it("兩個變數同時錯 → 一次列出", () => {
    const env = getCoreEnv({ ...BASE_ENV, VISIBLE_SCORE_PROVIDERS: "a", RATING_DISPLAY_PRIORITY: "b" });
    expect(() => validateRatingDisplayEnv(env)).toThrow(/VISIBLE_SCORE_PROVIDERS.*RATING_DISPLAY_PRIORITY/);
  });
});

describe("詳情頁評分區 HTML", () => {
  const config = { visible: [] as string[], priority: PRIORITY };
  const render = (locale: "zh-Hant" | "en" | "ja", ratings: GameRating[], cfg = config) =>
    renderToStaticMarkup(createElement(RatingsSection, { ratings, config: cfg, locale, t: createTranslator(locale) }));

  it("只有 IGDB：顯示來源與樣本數、帶 data-score-provider、沒有來源設定 UI", () => {
    const html = render("zh-Hant", [IGDB]);
    expect(html).toContain('data-score-provider="igdb"');
    expect(html).toContain("IGDB 82／100（12 則評論）");
    expect(html).not.toContain("data-rating-settings");
    expect(html).not.toContain("hidden=");
    expect(html).toContain('data-primary="true"');
  });

  it("三語文字", () => {
    expect(render("en", [IGDB])).toContain("IGDB 82/100 (12 reviews)");
    expect(render("en", [row("igdb", 82, { reviewCount: 1 })])).toContain("IGDB 82/100 (1 review)");
    expect(render("ja", [IGDB])).toContain("IGDB 82／100（レビュー12件）");
  });

  it("沒有評論數時不寫樣本數", () => {
    expect(render("en", [row("igdb", 82, { reviewCount: null })])).toContain("IGDB 82/100<");
  });

  it("沒有分數（空、全是 NULL 列）→ 不渲染整個區塊", () => {
    expect(render("zh-Hant", [])).toBe("");
    expect(render("en", [row("igdb", null)])).toBe("");
  });

  it("站長把所有有分數的來源都隱藏 → 不渲染", () => {
    expect(render("en", [IGDB], { visible: ["metacritic_scrape"], priority: PRIORITY })).toBe("");
  });

  it("2 個可見來源 → 出現來源設定 UI；伺服器輸出全部來源、預設只顯示 IGDB（Metacritic 列 hidden）", () => {
    const html = render("zh-Hant", [IGDB, META]);
    expect(html).toContain("data-rating-settings");
    expect(html).toContain('data-score-provider-toggle="igdb"');
    expect(html).toContain('data-score-provider-toggle="metacritic_scrape"');
    // 兩列都在 HTML 裡
    const items = html.match(/<li [^>]*>/g) ?? [];
    expect(items).toHaveLength(2);
    const meta = items.find((i) => i.includes('data-score-provider="metacritic_scrape"'))!;
    const igdb = items.find((i) => i.includes('data-score-provider="igdb"'))!;
    expect(meta).toContain("hidden");
    expect(igdb).not.toContain("hidden");
    expect(igdb).toContain('data-primary="true"'); // 預設只選 igdb → igdb 是主分數
    // Metacritic 純文字「Metascore」
    expect(html).toContain("Metascore 90／100（40 則評論）");
    // 設定 UI 在水合前隱藏（沒有 JS 時不顯示無作用的控制項）
    expect(html).toMatch(/<fieldset hidden=""/);
  });

  it("2 個來源但其中一個被站長隱藏 → 沒有設定 UI", () => {
    const html = render("zh-Hant", [IGDB, META], { visible: ["igdb"], priority: PRIORITY });
    expect(html).not.toContain("data-rating-settings");
    expect(html).not.toContain("metacritic_scrape");
  });

  it("預設來源沒有分數、只有 Metacritic 一個來源 → 不渲染（使用者看不到也改不了）", () => {
    expect(render("zh-Hant", [META])).toBe("");
  });
});

describe("JSON-LD aggregateRating 只用預設來源", () => {
  const game = (ratings: GameRating[]) =>
    ({ gameId: 1, igdbId: 1, slug: "g", name: "G", originalName: "G", summary: null, cover: null, trailerUrl: null,
      firstReleaseDate: null, firstReleasePrecision: null, platforms: [], genres: [], companies: [], ratings }) as unknown as GameDetail;
  const ctx = { origin: "https://sok.example", locale: "en" as const };

  it("IGDB 有分數且 count > 0 → 輸出", () => {
    expect(gameJsonLd(game([IGDB]), ctx).aggregateRating).toEqual({
      "@type": "AggregateRating", ratingValue: 82, bestRating: 100, worstRating: 0, ratingCount: 12,
    });
  });

  it("有 Metacritic 也只輸出預設來源（IGDB）", () => {
    expect((gameJsonLd(game([IGDB, META]), ctx).aggregateRating as { ratingValue: number }).ratingValue).toBe(82);
  });

  it("沒有分數、score=NULL、count 缺少或 0 → 省略", () => {
    expect(gameJsonLd(game([]), ctx)).not.toHaveProperty("aggregateRating");
    expect(gameJsonLd(game([row("igdb", null)]), ctx)).not.toHaveProperty("aggregateRating");
    expect(gameJsonLd(game([row("igdb", 82, { reviewCount: null })]), ctx)).not.toHaveProperty("aggregateRating");
    expect(gameJsonLd(game([row("igdb", 82, { reviewCount: 0 })]), ctx)).not.toHaveProperty("aggregateRating");
  });

  it("只有 Metacritic 有分數（預設來源 IGDB 沒有）→ 省略", () => {
    expect(gameJsonLd(game([META]), ctx)).not.toHaveProperty("aggregateRating");
  });

  it("站長把 igdb 隱藏 → 預設改用 visible；不輸出被隱藏的來源", () => {
    const cfg = { visible: ["metacritic_scrape"], priority: PRIORITY };
    expect((gameJsonLd(game([IGDB, META]), { ...ctx, ratingConfig: cfg }).aggregateRating as { ratingValue: number }).ratingValue).toBe(90);
    expect(gameJsonLd(game([IGDB]), { ...ctx, ratingConfig: cfg })).not.toHaveProperty("aggregateRating");
  });
});

describe("Metacritic 關閉時排程表沒有評分與比對任務（05、15 Phase 4）", () => {
  const jobNames = (env: Record<string, string | undefined>) =>
    enabledModules(env).flatMap((m) => (m.jobs ?? []).map((j) => j.name));
  const forbidden = (n: string) => n === "sync_ratings" || n.startsWith("repair_matches");

  it("METACRITIC_SCRAPE_ENABLED 未設／false／空字串 → 沒有 sync_ratings、repair_matches_*", () => {
    for (const env of [{}, { METACRITIC_SCRAPE_ENABLED: "false" }, { METACRITIC_SCRAPE_ENABLED: "" }, { MODULES: "accounts,discord,admin" }]) {
      const names = jobNames(env);
      expect(names.length).toBeGreaterThan(0); // 確實有任務可比對（不是空清單造成的假通過）
      expect(names.filter(forbidden)).toEqual([]);
    }
  });

  it("metacritic 不受 MODULES 控制：MODULES 列了 metacritic 仍無評分任務，且啟動檢查拒絕", () => {
    expect(jobNames({ MODULES: "metacritic" }).filter(forbidden)).toEqual([]);
    expect(() =>
      validateModules(enabledModules({ MODULES: "metacritic" }), {
        MODULES: "metacritic",
        DATABASE_URL: "postgres://x/y",
        IGDB_CLIENT_ID: "a",
        IGDB_CLIENT_SECRET: "b",
      }),
    ).toThrow(/metacritic/);
  });
});
