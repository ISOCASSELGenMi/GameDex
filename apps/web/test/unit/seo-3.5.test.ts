// Phase 3.5：canonical／hreflang、JSON-LD 跳脫、sitemap 分片與 XML 的純函式。
import { describe, expect, it } from "vitest";
import type { Locale } from "@sok/i18n";
import type { EventDetail, GameDetail } from "@/modules/catalog/domain/entities";
import { PAGE_RULE, buildAlternates, canonicalQuery, enumRule, hreflangOf, localizedUrl } from "@/modules/catalog/ui/seo/alternates";
import { breadcrumbJsonLd, datePublished, eventJsonLd, gameJsonLd, serializeJsonLd } from "@/modules/catalog/ui/seo/json-ld";
import { eventDetailMetadata, gameDetailMetadata, seoMetadata, seoSlug, truncateDescription } from "@/modules/catalog/ui/seo/metadata";
import { activeFilterDimensions, shouldNoindexFilter } from "@/modules/catalog/ui/seo/robots-policy";
import { absoluteUrl, siteOrigin } from "@/modules/catalog/ui/seo/site-url";
import {
  SITEMAP_MAX_URLS,
  calendarMonthRange,
  entitiesPerShard,
  escapeXml,
  franchiseSitemapSpec,
  pageSpecs,
  parseShardName,
  planShards,
  renderSitemapIndex,
  renderUrlset,
  shardCount,
} from "@/modules/catalog/ui/seo/sitemap";

const THREE: Locale[] = ["zh-Hant", "en", "ja"];
const TWO: Locale[] = ["zh-Hant", "en"];
const ORIGIN = "https://sok.example";

describe("siteOrigin／absoluteUrl", () => {
  it("只留 origin、去尾斜線；沒設或不是 http(s) → null", () => {
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://sok.example/" })).toBe(ORIGIN);
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://sok.example/zh/x?y=1" })).toBe(ORIGIN);
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "" })).toBeNull();
    expect(siteOrigin({})).toBeNull();
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).toBeNull();
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "not a url" })).toBeNull();
  });
  it("origin 為 null → 相對網址", () => {
    expect(absoluteUrl(null, "/en/games/x")).toBe("/en/games/x");
    expect(absoluteUrl(ORIGIN, "/en/games/x")).toBe(`${ORIGIN}/en/games/x`);
  });
});

describe("canonical／hreflang", () => {
  it("自我參照 canonical＋各語系＋x-default（預設語系）", () => {
    const a = buildAlternates({ origin: ORIGIN, locale: "en", supported: THREE, defaultLocale: "zh-Hant", path: "/games/control" });
    expect(a.canonical).toBe(`${ORIGIN}/en/games/control`);
    expect(a.languages).toEqual({
      "zh-Hant": `${ORIGIN}/zh-Hant/games/control`,
      en: `${ORIGIN}/en/games/control`,
      ja: `${ORIGIN}/ja/games/control`,
      "x-default": `${ORIGIN}/zh-Hant/games/control`,
    });
  });
  it("語系清單以設定為準：只支援兩種語系 → 沒有 ja", () => {
    const a = buildAlternates({ origin: ORIGIN, locale: "zh-Hant", supported: TWO, defaultLocale: "zh-Hant", path: "/timeline" });
    expect(Object.keys(a.languages)).toEqual(["zh-Hant", "en", "x-default"]);
  });
  it("x-default 跟著 DEFAULT_LOCALE", () => {
    const a = buildAlternates({ origin: ORIGIN, locale: "ja", supported: THREE, defaultLocale: "en", path: "/games" });
    expect(a.languages["x-default"]).toBe(`${ORIGIN}/en/games`);
  });
  it("根路徑與 query；origin 為 null → 相對", () => {
    expect(localizedUrl(null, "en", "/")).toBe("/en");
    expect(localizedUrl(ORIGIN, "en", "/games", "page=2")).toBe(`${ORIGIN}/en/games?page=2`);
    expect(localizedUrl(ORIGIN, "en", "/games", "?page=2")).toBe(`${ORIGIN}/en/games?page=2`);
  });
  it("hreflang 取 BCP 47 標籤", () => {
    expect(hreflangOf("zh-Hant")).toBe("zh-Hant");
    expect(hreflangOf("ja")).toBe("ja");
  });
  it("每個語系版本的 alternates 完全相同（只有 canonical 不同）", () => {
    const base = { origin: ORIGIN, supported: THREE, defaultLocale: "zh-Hant" as Locale, path: "/platforms/ps5", query: "page=3" };
    const langs = THREE.map((l) => buildAlternates({ ...base, locale: l }));
    expect(new Set(langs.map((x) => JSON.stringify(x.languages))).size).toBe(1);
    expect(langs.map((x) => x.canonical)).toEqual(THREE.map((l) => `${ORIGIN}/${l}/platforms/ps5?page=3`));
  });
});

describe("canonicalQuery", () => {
  it("只保留規則內的參數，其餘（篩選、排序、at）全部去掉", () => {
    expect(canonicalQuery({ platform: "ps5", sort: "name", at: "2027-01-01" }, [PAGE_RULE])).toBe("");
    expect(canonicalQuery({ platform: "ps5", page: "3" }, [PAGE_RULE])).toBe("page=3");
  });
  it("page：1、0、負數、非數字、超長都不寫入", () => {
    for (const bad of ["1", "0", "-2", "abc", "2.5", "99999999", ""]) expect(canonicalQuery({ page: bad }, [PAGE_RULE])).toBe("");
  });
  it("陣列參數取第一個值", () => {
    expect(canonicalQuery({ page: ["4", "5"] }, [PAGE_RULE])).toBe("page=4");
  });
  it("enumRule：只保留指定值，順序依規則", () => {
    const rules = [enumRule("kind", ["collection"]), PAGE_RULE];
    expect(canonicalQuery({ page: "2", kind: "collection" }, rules)).toBe("kind=collection&page=2");
    expect(canonicalQuery({ kind: "franchise" }, rules)).toBe("");
    expect(canonicalQuery({ kind: "evil&x=1" }, rules)).toBe("");
  });
});

describe("noindex 規則（多維組合、搜尋）", () => {
  it("單一維度可索引；兩個維度以上 noindex", () => {
    expect(shouldNoindexFilter({ platform: "ps5" })).toBe(false);
    expect(shouldNoindexFilter({ platform: "ps5,pc" })).toBe(false); // 同維度多值仍是一個維度
    expect(shouldNoindexFilter({ platform: "ps5", genre: "indie" })).toBe(true);
    expect(shouldNoindexFilter({ platform: "ps5", region: "JP" })).toBe(true);
  });
  it("搜尋一律 noindex；sort 與 page 不算維度", () => {
    expect(shouldNoindexFilter({ q: "zelda" })).toBe(true);
    expect(shouldNoindexFilter({ sort: "name", page: "2" })).toBe(false);
    expect(activeFilterDimensions({ platform: ["ps5"], sort: "name" })).toBe(1);
  });
  it("格式錯的值不算", () => {
    expect(shouldNoindexFilter({ platform: "ps5", genre: "NOT VALID!!" })).toBe(false);
  });
});

describe("seoMetadata", () => {
  const config = { supported: THREE, defaultLocale: "zh-Hant" as Locale };
  it("篩選頁：canonical 不帶篩選參數，多維 noindex", () => {
    const m = seoMetadata({
      locale: "en",
      config,
      path: "/games",
      searchParams: { platform: "ps5", genre: "indie", page: "2" },
      queryRules: [PAGE_RULE],
      filterPage: true,
      origin: ORIGIN,
    });
    expect(m.alternates?.canonical).toBe(`${ORIGIN}/en/games?page=2`);
    expect(m.robots).toEqual({ index: false, follow: true });
  });
  it("單一維度：可索引（沒有 robots）", () => {
    const m = seoMetadata({ locale: "en", config, path: "/games", searchParams: { platform: "ps5" }, queryRules: [], filterPage: true, origin: ORIGIN });
    expect(m.robots).toBeUndefined();
    expect(m.alternates?.canonical).toBe(`${ORIGIN}/en/games`);
  });
  it("沒給 queryRules → 正規網址不帶 query", () => {
    const m = seoMetadata({ locale: "ja", config, path: "/events/x", searchParams: { page: "9" }, origin: ORIGIN });
    expect(m.alternates?.canonical).toBe(`${ORIGIN}/ja/events/x`);
  });
  it("seoSlug：已編碼與未編碼的 slug 得到同一種寫法", () => {
    expect(seoSlug("a%20b")).toBe("a%20b");
    expect(seoSlug("a b")).toBe("a%20b");
    expect(seoSlug("%E3%81%82")).toBe("%E3%81%82");
  });
  it("truncateDescription：壓縮空白、160 字內原樣、超過加刪節號、不切斷代理對", () => {
    expect(truncateDescription("  a \n b ")).toBe("a b");
    expect(truncateDescription(null)).toBeUndefined();
    const long = truncateDescription("😀".repeat(200))!;
    expect([...long].length).toBe(160);
    expect(long.endsWith("…")).toBe(true);
  });
});

const baseGame = {
  gameId: 1,
  igdbId: 1,
  slug: "control",
  name: "Control",
  originalName: "Control",
  summary: "A game.",
  cover: { original: "o", small: "s", medium: "m", large: "https://img.example/l.jpg", resized: false },
  trailerUrl: null,
  ratings: [],
  firstReleaseDate: "2019-08-27",
  firstReleasePrecision: "day",
  platforms: [{ slug: "ps5", name: "PlayStation 5", abbreviation: "PS5", kind: "console" }],
  genres: [{ slug: "adventure", name: "Adventure" }],
  companies: [
    { slug: "remedy", name: "Remedy Entertainment", roles: ["developer"] },
    { slug: "505", name: "505 Games", roles: ["publisher"] },
    { slug: "x", name: "Support Co", roles: ["supporting"] },
  ],
} as unknown as GameDetail;

describe("JSON-LD 跳脫（防 </script> 注入）", () => {
  it("serializeJsonLd 不含 < > &，解析後值不變", () => {
    const evil = '</script><script>alert(1)</script><!-- &    ';
    const out = serializeJsonLd({ name: evil });
    expect(out).not.toMatch(/[<>&]/);
    expect(out).not.toContain(" ");
    expect(out).not.toContain(" ");
    expect(JSON.parse(out)).toEqual({ name: evil });
  });
  it("惡意遊戲名稱：整份 VideoGame 輸出沒有 </script>，且可解析", () => {
    const g = { ...baseGame, name: "</script><img src=x onerror=alert(1)>", originalName: "<b>" } as GameDetail;
    const out = serializeJsonLd(gameJsonLd(g, { origin: ORIGIN, locale: "en" }));
    expect(out.toLowerCase()).not.toContain("</script");
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe(g.name);
  });
});

describe("gameJsonLd／eventJsonLd／breadcrumb", () => {
  it("VideoGame 欄位", () => {
    const ld = gameJsonLd(baseGame, { origin: ORIGIN, locale: "en" });
    expect(ld["@type"]).toBe("VideoGame");
    expect(ld.url).toBe(`${ORIGIN}/en/games/control`);
    expect(ld.gamePlatform).toEqual(["PlayStation 5"]);
    expect(ld.datePublished).toBe("2019-08-27");
    expect(ld.genre).toEqual(["Adventure"]);
    expect(ld.image).toBe("https://img.example/l.jpg");
    expect((ld.author as { name: string }[]).map((x) => x.name)).toEqual(["Remedy Entertainment"]);
    expect((ld.publisher as { name: string }[]).map((x) => x.name)).toEqual(["505 Games"]);
    expect(ld).not.toHaveProperty("aggregateRating");
    expect(ld).not.toHaveProperty("alternateName");
  });
  it("原名不同 → alternateName；沒有的欄位不輸出", () => {
    const g = { ...baseGame, name: "控制", cover: null, summary: null, platforms: [], genres: [], companies: [] } as unknown as GameDetail;
    const ld = gameJsonLd(g, { origin: null, locale: "zh-Hant" });
    expect(ld.alternateName).toBe("Control");
    expect(ld.url).toBe("/zh-Hant/games/control");
    for (const k of ["image", "description", "gamePlatform", "genre", "author", "publisher"]) expect(ld).not.toHaveProperty(k);
  });
  it("datePublished 依精度：day／month／year；quarter／tbd／無 → 省略", () => {
    expect(datePublished("2027-05-01", "day")).toBe("2027-05-01");
    expect(datePublished("2027-05-01", "month")).toBe("2027-05");
    expect(datePublished("2027-12-31", "year")).toBe("2027");
    expect(datePublished("2027-06-30", "quarter")).toBeUndefined();
    expect(datePublished("2027-06-30", "tbd")).toBeUndefined();
    expect(datePublished(null, null)).toBeUndefined();
  });
  it("Event：UTC ISO；有直播連結才標線上；時間未定 → null", () => {
    const ev = {
      slug: "gamescom",
      name: "Gamescom",
      startTime: "2026-08-25T18:00:00+00:00",
      endTime: null,
      description: null,
      logo: null,
      organizer: null,
      streamUrl: "https://twitch.tv/x",
    } as unknown as EventDetail;
    const ld = eventJsonLd(ev, { origin: ORIGIN, locale: "ja" })!;
    expect(ld["@type"]).toBe("Event");
    expect(ld.startDate).toBe("2026-08-25T18:00:00.000Z");
    expect(ld.eventStatus).toBe("https://schema.org/EventScheduled");
    expect(ld.eventAttendanceMode).toBe("https://schema.org/OnlineEventAttendanceMode");
    expect(ld).not.toHaveProperty("endDate");
    expect(eventJsonLd({ ...ev, streamUrl: null } as EventDetail, { origin: ORIGIN, locale: "ja" })).not.toHaveProperty("eventAttendanceMode");
    expect(eventJsonLd({ ...ev, startTime: null } as EventDetail, { origin: ORIGIN, locale: "ja" })).toBeNull();
  });
  it("Event：不安全的直播連結（javascript:）不輸出", () => {
    const ev = { slug: "e", name: "E", startTime: "2026-01-01T00:00:00Z", streamUrl: "javascript:alert(1)" } as unknown as EventDetail;
    const ld = eventJsonLd(ev, { origin: ORIGIN, locale: "en" })!;
    expect(ld).not.toHaveProperty("location");
  });
  it("麵包屑：位置遞增，最後一項（目前頁）沒有 item", () => {
    const ld = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Games", path: "/games" }, { name: "Control" }], { origin: ORIGIN, locale: "en" });
    const items = ld.itemListElement as { position: number; item?: string }[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[0]!.item).toBe(`${ORIGIN}/en`);
    expect(items[1]!.item).toBe(`${ORIGIN}/en/games`);
    expect(items[2]).not.toHaveProperty("item");
  });
});

describe("詳情頁 metadata", () => {
  const config = { supported: THREE, defaultLocale: "zh-Hant" as Locale };
  it("遊戲：標題、description、canonical、og", () => {
    const m = gameDetailMetadata(baseGame, { locale: "ja", config, origin: ORIGIN });
    expect(m.title).toBe("Control");
    expect(m.alternates?.canonical).toBe(`${ORIGIN}/ja/games/control`);
    expect(m.description).toBe("A game.");
    expect(m.openGraph).toMatchObject({ url: `${ORIGIN}/ja/games/control`, title: "Control" });
  });
  it("活動：沒有簡介就沒有 description", () => {
    const ev = { slug: "e", name: "E", description: null, logo: null } as unknown as EventDetail;
    const m = eventDetailMetadata(ev, { locale: "en", config, origin: ORIGIN });
    expect(m).not.toHaveProperty("description");
    expect(m.alternates?.canonical).toBe(`${ORIGIN}/en/events/e`);
  });
});

describe("sitemap 分片", () => {
  it("每片實體數：實體 × 語系數 ≤ 50,000，上限 10,000", () => {
    for (const n of [1, 2, 3, 4, 5, 8, 20, 100]) expect(entitiesPerShard(n) * n).toBeLessThanOrEqual(SITEMAP_MAX_URLS);
    expect(entitiesPerShard(3)).toBe(10_000);
    expect(entitiesPerShard(8)).toBe(6_250);
    expect(entitiesPerShard(100)).toBe(500);
    expect(entitiesPerShard(0)).toBe(10_000);
  });
  it("shardCount 邊界", () => {
    expect(shardCount(0, 10_000)).toBe(0);
    expect(shardCount(1, 10_000)).toBe(1);
    expect(shardCount(10_000, 10_000)).toBe(1);
    expect(shardCount(10_001, 10_000)).toBe(2);
    expect(shardCount(314_606, 10_000)).toBe(32);
  });
  it("planShards：pages 一片＋各實體分片，名稱可被 parseShardName 還原", () => {
    const names = planShards({ games: 314_606, companies: 58_950, franchises: 12_829 }, 3);
    expect(names[0]).toBe("pages.xml");
    expect(names.filter((n) => n.startsWith("games-"))).toHaveLength(32);
    expect(names.filter((n) => n.startsWith("companies-"))).toHaveLength(6);
    expect(names.filter((n) => n.startsWith("franchises-"))).toHaveLength(2);
    for (const n of names) expect(parseShardName(n)).not.toBeNull();
    expect(planShards({ games: 0, companies: 0, franchises: 0 }, 3)).toEqual(["pages.xml"]);
  });
  it("parseShardName：只接受規定格式", () => {
    expect(parseShardName("games-12.xml")).toEqual({ type: "entities", kind: "games", shard: 12 });
    expect(parseShardName("pages.xml")).toEqual({ type: "pages" });
    for (const bad of ["games-01.xml", "games-.xml", "games-1", "games-1.xml.gz", "../etc/passwd", "events-0.xml", "games-1234567.xml", "GAMES-1.xml"]) {
      expect(parseShardName(bad)).toBeNull();
    }
  });
});

describe("sitemap XML", () => {
  const ctx = { origin: ORIGIN, supported: THREE, defaultLocale: "zh-Hant" as Locale };
  it("一個實體 × 每個語系＝一個 <url>，各自帶完整 alternates（含自己與 x-default）", () => {
    const xml = renderUrlset([{ path: "/games/control", lastModified: "2026-10-12T16:45:48.641Z" }], ctx);
    expect(xml.match(/<url>/g)).toHaveLength(3);
    expect(xml.match(/<xhtml:link /g)).toHaveLength(12); // 3 個 url × (3 語系＋x-default)
    for (const l of THREE) expect(xml).toContain(`<loc>${ORIGIN}/${l}/games/control</loc>`);
    expect(xml).toContain('hreflang="x-default" href="https://sok.example/zh-Hant/games/control"');
    expect(xml).toContain("<lastmod>2026-10-12T16:45:48.641Z</lastmod>");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
  it("query 的 & 跳脫成 &amp;（系列的 collection）", () => {
    const xml = renderUrlset([franchiseSitemapSpec({ slug: "mario", lastModified: null, kind: "collection" })], ctx);
    expect(xml).toContain("/en/franchises/mario?kind=collection</loc>");
    expect(escapeXml("a&b<c>\"d'")).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
    expect(renderUrlset([{ path: "/x", query: "a=1&b=2" }], ctx)).toContain("?a=1&amp;b=2");
  });
  it("franchise（預設 kind）不帶 query", () => {
    const xml = renderUrlset([franchiseSitemapSpec({ slug: "mario", lastModified: null, kind: "franchise" })], ctx);
    expect(xml).not.toContain("kind=");
  });
  it("slug 的特殊字元保持編碼；沒有 lastmod 時不輸出", () => {
    const xml = renderUrlset([{ path: `/games/${encodeURIComponent("a b/é")}` }], ctx);
    expect(xml).toContain("/games/a%20b%2F%C3%A9</loc>");
    expect(xml).not.toContain("<lastmod>");
  });
  it("無效 lastmod 不輸出", () => {
    expect(renderUrlset([{ path: "/x", lastModified: "garbage" }], ctx)).not.toContain("<lastmod>");
  });
  it("index：列出各分片網址", () => {
    const xml = renderSitemapIndex(ORIGIN, ["pages.xml", "games-0.xml"]);
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap/pages.xml</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap/games-0.xml</loc>`);
  });
  it("月曆範圍：今天所在月往前 12、往後 24（共 37 個月）", () => {
    const r = calendarMonthRange(new Date("2026-10-14T00:00:00Z"));
    expect(r).toHaveLength(37);
    expect(r[0]).toEqual({ year: 2025, month: 10 });
    expect(r[12]).toEqual({ year: 2026, month: 10 });
    expect(r[36]).toEqual({ year: 2028, month: 10 });
  });
  it("pages.xml：固定頁＋月曆＋平台＋活動，不含篩選網址", () => {
    const specs = pageSpecs({
      now: new Date("2026-10-14T00:00:00Z"),
      platforms: [{ slug: "ps5", lastModified: null }],
      events: [{ slug: "tgs", lastModified: "2026-09-01T00:00:00Z" }],
    });
    const paths = specs.map((s) => s.path);
    for (const p of ["/timeline", "/trending", "/games", "/platforms", "/events", "/platforms/ps5", "/events/tgs", "/calendar/2026-10"]) {
      expect(paths).toContain(p);
    }
    expect(specs.every((s) => !s.query)).toBe(true);
    expect(paths.every((p) => !p.includes("?"))).toBe(true);
  });
  it("一片最滿的情況：10,000 個實體 × 3 語系 = 30,000 個 url，≤ 50,000", () => {
    const specs = Array.from({ length: entitiesPerShard(3) }, (_, i) => ({ path: `/games/g-${i}` }));
    expect(renderUrlset(specs, ctx).match(/<url>/g)).toHaveLength(30_000);
  });
});
