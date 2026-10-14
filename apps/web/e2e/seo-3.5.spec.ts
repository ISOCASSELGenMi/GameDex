/**
 * SEO（06 §SEO 與快取；15 Phase 3.5）：canonical、hreflang（含 x-default）、JSON-LD、sitemap、robots、語系隔離與快取標頭。
 * 用 request fixture 直接讀 HTML／XML（不需要瀏覽器渲染）。伺服器的 NEXT_PUBLIC_SITE_URL 見 support/env.ts。
 */
import { expect, test } from "@playwright/test";
import { E2E_SITE_ORIGIN } from "./support/env";
import { FIXTURE, FIXTURE_3B } from "./support/fixture-data";

const O = E2E_SITE_ORIGIN;
const LOCALES = ["zh-Hant", "en", "ja"] as const;

function links(html: string, rel: string): { href: string; hreflang?: string }[] {
  const out: { href: string; hreflang?: string }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    if (!new RegExp(String.raw`\brel="${rel}"`).test(tag)) continue;
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (href) out.push({ href: href.replace(/&amp;/g, "&"), hreflang: /\bhreflang="([^"]*)"/i.exec(tag)?.[1] });
  }
  return out;
}

function jsonLd(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

const gamePath = (l: string) => `/${l}/games/${FIXTURE.hero.slug}`;

test.describe("canonical／hreflang", () => {
  for (const locale of LOCALES) {
    test(`遊戲詳情（${locale}）：自我參照 canonical、各語系 alternates 與 x-default`, async ({ request }) => {
      const res = await request.get(gamePath(locale));
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(links(html, "canonical")).toEqual([{ href: `${O}${gamePath(locale)}` }]);
      const alt = links(html, "alternate").filter((l) => l.hreflang);
      const byLang = Object.fromEntries(alt.map((l) => [l.hreflang, l.href]));
      expect(byLang["zh-Hant"]).toBe(`${O}${gamePath("zh-Hant")}`);
      expect(byLang["en"]).toBe(`${O}${gamePath("en")}`);
      expect(byLang["ja"]).toBe(`${O}${gamePath("ja")}`);
      expect(byLang["x-default"]).toBe(`${O}${gamePath("zh-Hant")}`);
      expect(html).toContain(`<html lang="${locale}"`);
    });
  }

  test("月曆頁：帶篩選參數的 canonical 不含篩選", async ({ request }) => {
    const res = await request.get(`/en/calendar/${FIXTURE.month}?platform=${FIXTURE.platformPs5}&genre=${FIXTURE.genreRpg}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(links(html, "canonical")).toEqual([{ href: `${O}/en/calendar/${FIXTURE.month}` }]);
    // 兩個維度以上的組合 → noindex
    expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
  });

  test("查無此遊戲：404＋noindex", async ({ request }) => {
    const res = await request.get("/en/games/no-such-game-slug");
    expect(res.status()).toBe(404);
    expect(await res.text()).toMatch(/<meta name="robots" content="[^"]*noindex/);
  });
});

test.describe("JSON-LD", () => {
  test("遊戲詳情：VideoGame 可解析、沒有未跳脫的 <", async ({ request }) => {
    const html = await (await request.get(gamePath("en"))).text();
    const blocks = jsonLd(html);
    const game = blocks.find((b) => (b as { "@type"?: string })["@type"] === "VideoGame") as Record<string, unknown> | undefined;
    expect(game, "應有 VideoGame").toBeDefined();
    expect(game!["@context"]).toBe("https://schema.org");
    expect(game!.name).toBe(FIXTURE.hero.name);
    for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      expect(m[1]).not.toContain("<");
    }
  });

  test("活動詳情：Event 可解析、時間為 UTC ISO", async ({ request }) => {
    const html = await (await request.get(`/en/events/${FIXTURE_3B.events.showcase.slug}`)).text();
    const ev = jsonLd(html).find((b) => (b as { "@type"?: string })["@type"] === "Event") as Record<string, unknown> | undefined;
    expect(ev, "應有 Event").toBeDefined();
    expect(String(ev!.startDate)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });
});

test.describe("sitemap", () => {
  test("index 與 pages 分片是合法 XML，URL 帶各語系 alternates", async ({ request }) => {
    const idx = await request.get("/sitemap.xml");
    expect(idx.status()).toBe(200);
    expect(idx.headers()["content-type"]).toContain("application/xml");
    const xml = await idx.text();
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<sitemapindex /);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toContain(`${O}/sitemap/pages.xml`);
    expect(locs).toContain(`${O}/sitemap/games-0.xml`);

    const games = await request.get("/sitemap/games-0.xml");
    expect(games.status()).toBe(200);
    const g = await games.text();
    expect(g).toMatch(/<urlset /);
    const urls = g.match(/<url>/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.length).toBeLessThanOrEqual(50_000);
    expect(g).toContain(`<loc>${O}${gamePath("en")}</loc>`);
    expect(g).toContain('hreflang="x-default"');
    // 不含篩選後的網址
    expect(g).not.toMatch(/<loc>[^<]*\?(platform|genre|sort)=/);

    const pages = await (await request.get("/sitemap/pages.xml")).text();
    expect(pages).toContain(`<loc>${O}/en/timeline</loc>`);
    expect(pages).toMatch(new RegExp(String.raw`<loc>${O}/en/calendar/\d{4}-\d{2}</loc>`));
  });

  test("不存在的分片 → 404", async ({ request }) => {
    expect((await request.get("/sitemap/games-99999.xml")).status()).toBe(404);
    expect((await request.get("/sitemap/bogus.xml")).status()).toBe(404);
  });

  test("robots.txt 指向 sitemap index", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(`Sitemap: ${O}/sitemap.xml`);
  });
});

test.describe("語系隔離與快取標頭", () => {
  test("詳情頁 zh-Hant／en 交錯連續請求，語系不串", async ({ request }) => {
    for (const locale of ["zh-Hant", "en", "zh-Hant", "en", "ja", "en"] as const) {
      const res = await request.get(gamePath(locale));
      const html = await res.text();
      expect(html).toContain(`<html lang="${locale}"`);
      expect(links(html, "canonical")[0].href).toBe(`${O}${gamePath(locale)}`);
    }
  });

  for (const path of [gamePath("en"), `/en/events/${FIXTURE_3B.events.showcase.slug}`, `/en/calendar/${FIXTURE.month}`, "/en/timeline", "/sitemap.xml", "/sitemap/pages.xml"]) {
    test(`${path}：沒有 Set-Cookie，Cache-Control 可被 CDN 快取`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const h = res.headers();
      expect(h["set-cookie"]).toBeUndefined();
      expect(h["cache-control"], "Cache-Control").toMatch(/s-maxage=\d+/);
      expect(h["cache-control"]).not.toMatch(/no-store|private/);
    });
  }

  test("詳情頁 Vary 不含 Cookie", async ({ request }) => {
    const res = await request.get(gamePath("en"));
    expect(res.headers()["vary"] ?? "").not.toMatch(/cookie/i);
  });
});
