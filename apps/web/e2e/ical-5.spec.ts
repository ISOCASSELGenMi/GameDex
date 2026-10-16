/**
 * Phase 5：公開 iCal feed 與訂閱頁（08、06 §路由）。
 * - 三種 feed 200＋content-type＋Cache-Control＋ETag＋無 Set-Cookie；If-None-Match 相符 → 304；語系／平台／檔名不對 → 404；
 *   原型驗證 feed 在 ICAL_PROTO_ENABLED 未開時 404；單一遊戲「下載 .ics」。
 * - 訂閱頁：axe（桌機、375、320 無水平溢出）、webcal／https 連結、複製按鈕、平台選單、各客戶端步驟與延遲文案。
 * 測試資料在 beforeAll 直接寫入測試資料庫，日期相對「今天」（公開 feed 的視窗是 90 天），遊戲 igdbId 4430xx。
 */
import pg from "pg";
import { parseIcs } from "../test/helpers/ics";
import { E2E_SITE_ORIGIN, testDatabaseUrl } from "./support/env";
import { FIXTURE, LOCALES, expect, expectNoA11yViolations, msg, test, type TestLocale } from "./support/helpers";

const GAME = { igdbId: 443001, slug: "e2e-ical-game", name: "E2E Ical Game", zhName: "日曆測試遊戲", jaName: "カレンダーテスト" };
const MONTH_GAME = { igdbId: 443002, slug: "e2e-ical-month", name: "E2E Ical Month Game" };
const EVENT = { slug: "e2e-ical-event", name: "E2E Ical Showcase" };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const TODAY = new Date(`${iso(new Date())}T00:00:00Z`);
const GAME_DATE = iso(addDays(TODAY, 15));
const NEXT_MONTH_FIRST = iso(new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 1, 1)));

let gameId = 0;
let monthGameId = 0;
let eventId = 0;
let ps5Id = 0;

test.beforeAll(async () => {
  const c = new pg.Client({ connectionString: testDatabaseUrl() });
  await c.connect();
  try {
    await c.query("SELECT pg_advisory_lock(443001)");
    ps5Id = (await c.query("SELECT id FROM platforms WHERE slug = $1", [FIXTURE.platformPs5])).rows[0].id;
    const ww = (await c.query("SELECT id FROM regions WHERE code = 'WW'")).rows[0].id;
    const addGame = async (g: { igdbId: number; slug: string; name: string }, names: Record<string, string>) => {
      const r = await c.query(
        `INSERT INTO games (igdb_id, slug, name, display_names, game_type, popularity_score) VALUES ($1, $2, $3, $4, 'main_game', 900)
         ON CONFLICT (igdb_id) DO UPDATE SET name = excluded.name RETURNING id`,
        [g.igdbId, g.slug, g.name, JSON.stringify(names)],
      );
      const id: number = r.rows[0].id;
      await c.query("INSERT INTO game_platforms (game_id, platform_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, ps5Id]);
      return id;
    };
    gameId = await addGame(GAME, { "zh-Hant": GAME.zhName, ja: GAME.jaName });
    monthGameId = await addGame(MONTH_GAME, {});
    const insertRel = async (id: number, date: string, precision: string) => {
      if ((await c.query("SELECT 1 FROM release_events WHERE game_id = $1", [id])).rowCount === 0) {
        await c.query(
          `INSERT INTO release_events (game_id, platform_id, region_id, release_date, period_start, precision, release_stage, status, source, sequence)
           VALUES ($1, $2, $3, $4, $4, $5, 'full', 'scheduled', 'igdb', 2)`,
          [id, ps5Id, ww, date, precision],
        );
      }
    };
    await insertRel(gameId, GAME_DATE, "day");
    await insertRel(monthGameId, NEXT_MONTH_FIRST, "month");
    const ev = await c.query(
      `INSERT INTO events (slug, name, kind, start_time, source) VALUES ($1, $2, 'showcase', $3, 'manual')
       ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`,
      [EVENT.slug, EVENT.name, `${iso(addDays(TODAY, 10))}T17:00:00Z`],
    );
    eventId = ev.rows[0].id;
    await c.query("SELECT pg_advisory_unlock(443001)");
  } finally {
    await c.end();
  }
});

const uidDomain = new URL(E2E_SITE_ORIGIN).host;
const gameUid = () => `release-g${gameId}-p${ps5Id}-sfull@${uidDomain}`;

test.describe("公開 feed", () => {
  for (const locale of LOCALES) {
    test(`releases.ics（${locale}）：標頭、內容、語系名稱、UID 與語系無關`, async ({ request }) => {
      const res = await request.get(`/ical/${locale}/releases.ics`);
      expect(res.status()).toBe(200);
      const h = res.headers();
      expect(h["content-type"]).toBe("text/calendar; charset=utf-8");
      expect(h["cache-control"]).toBe("public, max-age=300");
      expect(h["etag"]).toMatch(/^"[0-9a-f]{32}"$/);
      expect(h["set-cookie"]).toBeUndefined();
      const ics = parseIcs(await res.text());
      expect(ics.calendar.find((p) => p.name === "X-WR-CALNAME")?.value).toBe(msg(locale, "ical.calendarName.releases"));
      expect(ics.calendar.find((p) => p.name === "REFRESH-INTERVAL")).toBeDefined();
      expect(ics.calendar.find((p) => p.name === "X-PUBLISHED-TTL")).toBeDefined();
      const ev = ics.events.find((e) => e.get("UID") === gameUid());
      expect(ev, "找得到測試遊戲").toBeDefined();
      const name = locale === "zh-Hant" ? GAME.zhName : locale === "ja" ? GAME.jaName : GAME.name;
      expect(ev?.get("SUMMARY")).toContain(name);
    });
  }

  test("同一個項目的 UID 在三個語系相同、SUMMARY 不同", async ({ request }) => {
    const summaries: string[] = [];
    for (const locale of LOCALES) {
      const ics = parseIcs(await (await request.get(`/ical/${locale}/releases.ics`)).text());
      const ev = ics.events.filter((e) => e.get("UID") === gameUid());
      expect(ev).toHaveLength(1);
      summaries.push(ev[0].get("SUMMARY") ?? "");
    }
    expect(new Set(summaries).size).toBe(3);
  });

  test("日期與精度：day 單日（DTEND 隔天）、month 整月（DTEND 下月 1 日，排他）並帶 [暫定] 標記", async ({ request }) => {
    const ics = parseIcs(await (await request.get("/ical/en/releases.ics")).text());
    const day = ics.events.find((e) => e.get("UID") === gameUid())!;
    const compact = (s: string) => s.replaceAll("-", "");
    const ymd = (v: string) => new Date(`${v}T00:00:00Z`);
    expect(day.props.find((p) => p.name === "DTSTART")?.value).toBe(compact(GAME_DATE));
    expect(day.props.find((p) => p.name === "DTEND")?.value).toBe(compact(iso(addDays(ymd(GAME_DATE), 1))));
    const month = ics.events.find((e) => e.get("UID") === `release-g${monthGameId}-p${ps5Id}-sfull@${uidDomain}`)!;
    expect(month.props.find((p) => p.name === "DTSTART")?.value).toBe(compact(NEXT_MONTH_FIRST));
    const afterMonth = iso(new Date(Date.UTC(ymd(NEXT_MONTH_FIRST).getUTCFullYear(), ymd(NEXT_MONTH_FIRST).getUTCMonth() + 1, 1)));
    expect(month.props.find((p) => p.name === "DTEND")?.value).toBe(compact(afterMonth));
    expect(month.get("SUMMARY")).toContain(msg("en", "ical.mark.provisional"));
  });

  test("ETag：If-None-Match 相符 → 304（無本體、仍帶 ETag 與 Cache-Control）；不相符 → 200", async ({ request }) => {
    for (const path of ["/ical/en/releases.ics", "/ical/ja/events.ics", `/ical/zh-Hant/platform/${FIXTURE.platformPs5}.ics`]) {
      const first = await request.get(path);
      expect(first.status(), path).toBe(200);
      const etag = first.headers()["etag"]!;
      const again = await request.get(path, { headers: { "If-None-Match": etag } });
      expect(again.status(), path).toBe(304);
      expect((await again.body()).length).toBe(0);
      expect(again.headers()["etag"]).toBe(etag);
      expect(again.headers()["cache-control"]).toBe("public, max-age=300");
      expect(again.headers()["set-cookie"]).toBeUndefined();
      const other = await request.get(path, { headers: { "If-None-Match": '"not-the-etag"' } });
      expect(other.status(), path).toBe(200);
      expect(other.headers()["etag"]).toBe(etag); // 資料沒變 → ETag 穩定
    }
  });

  test("不同語系的 ETag 不同；重複請求內容位元組相同", async ({ request }) => {
    const [zh, en] = await Promise.all([request.get("/ical/zh-Hant/releases.ics"), request.get("/ical/en/releases.ics")]);
    expect(zh.headers()["etag"]).not.toBe(en.headers()["etag"]);
    const a = await (await request.get("/ical/en/releases.ics")).body();
    const b = await (await request.get("/ical/en/releases.ics")).body();
    expect(a.equals(b)).toBe(true);
  });

  test("events.ics：活動是絕對時間（UTC，結尾 Z，沒有 TZID），沒有結束時間 → +1 小時", async ({ request }) => {
    const res = await request.get("/ical/en/events.ics");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("TZID");
    const ev = parseIcs(text).events.find((e) => e.get("UID") === `event-${eventId}@${uidDomain}`)!;
    expect(ev.get("SUMMARY")).toBe(EVENT.name);
    expect(ev.get("DTSTART")).toBe(`${iso(addDays(TODAY, 10)).replaceAll("-", "")}T170000Z`);
    expect(ev.get("DTEND")).toBe(`${iso(addDays(TODAY, 10)).replaceAll("-", "")}T180000Z`);
  });

  test("platform feed：只含該平台、名稱帶平台；單一遊戲下載帶 Content-Disposition: attachment", async ({ request }) => {
    const res = await request.get(`/ical/en/platform/${FIXTURE.platformPs5}.ics`);
    expect(res.status()).toBe(200);
    const ics = parseIcs(await res.text());
    expect(ics.calendar.find((p) => p.name === "X-WR-CALNAME")?.value).toContain("E2E PlayStation 5");
    for (const e of ics.events) expect(e.get("UID")).toContain(`-p${ps5Id}-`);
    expect(ics.events.some((e) => e.get("UID") === gameUid())).toBe(true);

    const dl = await request.get(`/ical/en/game/${GAME.slug}.ics`);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-disposition"]).toBe(`attachment; filename="${GAME.slug}.ics"`);
    expect(dl.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
    const one = parseIcs(await dl.text());
    expect(one.events).toHaveLength(1);
    expect(one.events[0].get("UID")).toBe(gameUid());
  });

  test("404：不支援的語系、不存在的平台／遊戲、檔名不是 .ics、原型 feed 未啟用", async ({ request }) => {
    const paths = [
      "/ical/fr/releases.ics",
      "/ical/zh-TW/releases.ics",
      "/ical/en/platform/no-such-platform.ics",
      "/ical/en/platform/no-such-platform",
      `/ical/en/platform/${FIXTURE.platformPs5}.json`,
      "/ical/en/game/no-such-game.ics",
      "/ical/en/releases.json",
      "/ical/_proto/a.ics",
      "/ical/_proto/b.ics",
    ];
    for (const p of paths) {
      const res = await request.get(p);
      expect(res.status(), p).toBe(404);
      expect(res.headers()["set-cookie"], p).toBeUndefined();
    }
  });

  test("/ical/* 不做語系導向（沒有 302）", async ({ request }) => {
    const res = await request.get("/ical/en/releases.ics", { maxRedirects: 0, headers: { "Accept-Language": "ja" } });
    expect(res.status()).toBe(200);
  });
});

test.describe("單一遊戲「下載 .ics」入口", () => {
  test("詳情頁有連結，點了下載 {slug}.ics", async ({ page }) => {
    await page.goto(`/en/games/${GAME.slug}`);
    const link = page.locator('a[data-action="download-ics"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/ical/en/game/${GAME.slug}.ics`);
    await expect(link).toContainText(msg("en", "ui.game.downloadIcs"));
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe(`${GAME.slug}.ics`);
  });
});

for (const locale of LOCALES) {
  test.describe(`訂閱頁（${locale}）`, () => {
    const url = `/${locale}/subscribe`;
    const m = (key: string) => msg(locale as TestLocale, key);

    test("內容：標題、三個 feed、webcal 與 https 網址、各客戶端步驟、延遲文案、即時通知引導", async ({ page }) => {
      const res = await page.goto(url);
      expect(res?.status()).toBe(200);
      expect(res?.headers()["set-cookie"]).toBeUndefined();
      await expect(page.locator("main h1")).toHaveText(m("ui.subscribe.title"));
      expect(await page.title()).toContain(m("ui.subscribe.title"));

      for (const [feed, path] of [
        ["releases", `/ical/${locale}/releases.ics`],
        ["events", `/ical/${locale}/events.ics`],
      ] as const) {
        const card = page.locator(`section[data-feed="${feed}"]`);
        await expect(card.locator("input")).toHaveValue(`${E2E_SITE_ORIGIN}${path}`);
        await expect(card.locator('a[data-action="open"]')).toHaveAttribute("href", `webcal://${uidDomain}${path}`);
      }
      const platformCard = page.locator('section[data-feed="platform"]');
      await expect(platformCard.locator("select")).toBeVisible();
      await expect(platformCard.locator("input")).toHaveValue(new RegExp(`^${E2E_SITE_ORIGIN}/ical/${locale}/platform/.+\\.ics$`));

      await expect(page.locator('[data-section="delay"]')).toContainText(m("ui.subscribe.delay.body"));
      for (const client of ["apple", "google", "outlook"]) {
        const section = page.locator(`[data-client="${client}"]`);
        await expect(section.locator("h3")).toHaveText(m(`ui.subscribe.clients.${client}.title`));
        await expect(section.locator("ol > li")).toHaveCount(3);
      }
      await expect(page.locator('[data-client="google"]')).toContainText(m("ui.subscribe.clients.google.note"));
      for (const k of ["title", "intro", "postponed", "cancelled", "rescheduled"]) {
        await expect(page.locator('[data-section="changes"]')).toContainText(m(`ui.subscribe.changes.${k}`));
      }
      await expect(page.locator('[data-section="realtime"]')).toContainText(m("ui.subscribe.realtime.body"));
      // 私人 feed 入口屬 accounts（Phase 7 第 6 波）：未登入時不該出現（slot 外殼在伺服器 HTML，入口由登入後的客戶端元件決定）
      await page.waitForLoadState("networkidle");
      await expect(page.locator('[data-section="private-feed"]')).toHaveCount(0);
    });

    test("axe：桌機", async ({ page }) => {
      await page.goto(url);
      await expect(page.locator("main h1")).toBeVisible();
      await expectNoA11yViolations(page, `${locale} /subscribe 桌機`);
    });

    for (const width of [375, 320]) {
      test(`axe 與水平溢出：手機 ${width} 寬`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 });
        await page.goto(url);
        await expect(page.locator("main h1")).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${width} 寬不可水平捲動（溢出 ${overflow}px）`).toBeLessThanOrEqual(0);
        await expectNoA11yViolations(page, `${locale} /subscribe ${width}`);
      });
    }

    test("複製按鈕：把 https 網址放進剪貼簿並用 live region 告知", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto(url);
      const card = page.locator('section[data-feed="releases"]');
      await card.locator('button[data-action="copy"]').click();
      await expect(card.locator("[role=status]")).toHaveText(m("ui.subscribe.feed.copied"));
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${E2E_SITE_ORIGIN}/ical/${locale}/releases.ics`);
    });

    test("平台選單：換平台後網址與 webcal 連結跟著換", async ({ page }) => {
      await page.goto(url);
      const card = page.locator('section[data-feed="platform"]');
      await card.locator("select").selectOption(FIXTURE.platformSwitch);
      await expect(card.locator("input")).toHaveValue(`${E2E_SITE_ORIGIN}/ical/${locale}/platform/${FIXTURE.platformSwitch}.ics`);
      await expect(card.locator('a[data-action="open"]')).toHaveAttribute("href", `webcal://${uidDomain}/ical/${locale}/platform/${FIXTURE.platformSwitch}.ics`);
    });
  });
}

test.describe("入口", () => {
  test("頁尾有訂閱連結；平台頁的連結帶 ?platform= 預選該平台", async ({ page }) => {
    await page.goto("/en/calendar");
    await page.locator("footer").getByRole("link", { name: msg("en", "ui.subscribe.footerLink") }).click();
    await expect(page).toHaveURL(/\/en\/subscribe$/);

    await page.goto(`/en/platforms/${FIXTURE.platformSwitch}`);
    await page.locator('a[data-action="subscribe-platform"]').click();
    await expect(page).toHaveURL(new RegExp(`/en/subscribe\\?platform=${FIXTURE.platformSwitch}`));
    await expect(page.locator('section[data-feed="platform"] select')).toHaveValue(FIXTURE.platformSwitch);
    await expect(page.locator('section[data-feed="platform"] input')).toHaveValue(`${E2E_SITE_ORIGIN}/ical/en/platform/${FIXTURE.platformSwitch}.ics`);
  });

  test("沒有語系前綴的 /subscribe 導向語系頁", async ({ request }) => {
    const res = await request.get("/subscribe", { maxRedirects: 0, headers: { "Accept-Language": "en" } });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toMatch(/\/en\/subscribe$/);
  });

  test("sitemap 收錄訂閱頁", async ({ request }) => {
    const xml = await (await request.get("/sitemap/pages.xml")).text();
    expect(xml).toContain(`${E2E_SITE_ORIGIN}/zh-Hant/subscribe`);
  });
});
