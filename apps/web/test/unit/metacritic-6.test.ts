/**
 * Phase 6 Metacritic（單元）：解析、robots、HTTP 出口（限速／退避／擋頁不繞過／關閉時 0 請求）、更新頻率分層。
 */
import { describe, expect, it } from "vitest";
import { nextRefreshAt, periodEndDate, refreshIntervalDays } from "@/modules/catalog/domain/rating-refresh";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { collectCatalogExtensions, enabledModules } from "@/modules/registry";
import {
  DEFAULT_USER_AGENT,
  MetacriticBlockedError,
  MetacriticDisabledError,
  MetacriticDisallowedError,
  MetacriticHttp,
  MetacriticTransientError,
} from "@/modules/metacritic/provider/http";
import { isPathAllowed, looksLikeChallenge, parseGamePage, parseRobotsDisallow, parseSitemapLocs, slugFromGameUrl, slugToName } from "@/modules/metacritic/provider/parse";
import { createMetacriticProvider } from "@/modules/metacritic/provider/provider";
import { fakeMetacriticFetch, gamePageHtml, ROBOTS_TXT, SITEMAP_INDEX, SITEMAP_SHARD } from "../helpers/metacritic-fixtures";

describe("parseGamePage", () => {
  it("取出 Metascore、玩家評分、評論則數與上市年份", () => {
    const p = parseGamePage(gamePageHtml())!;
    expect(p.metascore).toEqual({ value: 97, count: 109 });
    expect(p.userScore).toEqual({ value: 8.9, count: 27453 });
    expect(p.releaseYear).toBe(2017);
    expect(p.title).toBe("Fixture Quest");
  });
  it("tbd＝沒有分數（不是 0 分）", () => {
    const p = parseGamePage(gamePageHtml({ meta: "tbd", user: "tbd" }))!;
    expect(p.metascore).toBeNull();
    expect(p.userScore).toBeNull();
  });
  it("結構認不得（改版）→ null，不猜", () => {
    expect(parseGamePage("<html><body><h1>whatever</h1></body></html>")).toBeNull();
  });
  it("超出範圍的值視為無分數", () => {
    expect(parseGamePage(gamePageHtml({ meta: 187 }))!.metascore).toBeNull();
  });
});

describe("robots／sitemap／slug", () => {
  it("只取 User-agent: * 的 Disallow；/search 被禁，/game/ 可抓", () => {
    const d = parseRobotsDisallow(ROBOTS_TXT);
    expect(d).toEqual(["/search", "/signup", "/user", "/jl/"]);
    expect(isPathAllowed("/search?q=x", d)).toBe(false);
    expect(isPathAllowed("/game/zelda/", d)).toBe(true);
    expect(isPathAllowed("/games.xml", d)).toBe(true);
  });
  it("sitemap 與 slug", () => {
    expect(parseSitemapLocs(SITEMAP_INDEX)).toHaveLength(2);
    const slugs = parseSitemapLocs(SITEMAP_SHARD(["a-b", "c"])).map(slugFromGameUrl);
    expect(slugs).toEqual(["a-b", "c"]);
    expect(slugFromGameUrl("https://www.metacritic.com/movie/x/")).toBeNull();
    expect(slugToName("the-legend-of-zelda")).toBe("the legend of zelda");
  });
  it("挑戰頁偵測", () => {
    expect(looksLikeChallenge(403, "")).toBe(true);
    expect(looksLikeChallenge(200, "<title>Just a moment...</title>")).toBe(true);
    expect(looksLikeChallenge(200, gamePageHtml())).toBe(false);
  });
});

function mkHttp(routes: Parameters<typeof fakeMetacriticFetch>[0], gate = async () => true, extra: Partial<ConstructorParameters<typeof MetacriticHttp>[0]> = {}) {
  const f = fakeMetacriticFetch({ "/robots.txt": { body: ROBOTS_TXT }, ...routes });
  const sleeps: number[] = [];
  const http = new MetacriticHttp({ gate, fetchImpl: f.impl, sleep: async (ms) => void sleeps.push(ms), ...extra });
  return { http, ...f, sleeps };
}

describe("MetacriticHttp", () => {
  it("gate 關閉：不發出任何請求（請求數 0）", async () => {
    const { http, calls } = mkHttp({}, async () => false);
    await expect(http.get("/game/x/")).rejects.toBeInstanceOf(MetacriticDisabledError);
    expect(calls).toHaveLength(0);
    expect(http.requests).toBe(0);
  });
  it("robots 禁止的路徑不請求；帶可辨識的 User-Agent；robots.txt 只抓一次", async () => {
    const { http, calls } = mkHttp({ "/game/a/": { body: gamePageHtml() }, "/game/b/": { body: gamePageHtml() } });
    await expect(http.get("/search?q=zelda")).rejects.toBeInstanceOf(MetacriticDisallowedError);
    await http.get("/game/a/");
    await http.get("/game/b/");
    expect(calls.filter((c) => c.path === "/robots.txt")).toHaveLength(1);
    expect(calls.every((c) => c.ua === DEFAULT_USER_AGENT)).toBe(true);
    expect(DEFAULT_USER_AGENT).toMatch(/GameDexBot/);
    expect(calls.some((c) => c.path === "/search")).toBe(false);
  });
  it("限速：請求之間至少 minIntervalMs（每秒不超過 1 次）", async () => {
    const t = { now: 1_000_000 };
    const sleeps: number[] = [];
    const { http } = mkHttp({ "/game/a/": { body: "x" }, "/game/b/": { body: "x" } }, async () => true, {
      now: () => t.now,
      minIntervalMs: 1100,
      sleep: async (ms) => {
        sleeps.push(ms);
        t.now += ms;
      },
    });
    await http.get("/game/a/"); // 含 robots.txt 與頁面兩個請求：第二個請求要等滿間隔
    await http.get("/game/b/");
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    expect(sleeps.every((ms) => ms > 0 && ms <= 1100)).toBe(true);
    expect(http.requests).toBe(3);
  });
  it("429 依 Retry-After 退避後重試；仍失敗丟暫時性錯誤", async () => {
    let n = 0;
    const ok = mkHttp({ "/game/a/": () => (++n === 1 ? { status: 429, headers: { "retry-after": "3" } } : { body: "<html>ok</html>" }) });
    const res = await ok.http.get("/game/a/");
    expect(res.status).toBe(200);
    expect(ok.sleeps).toContain(3000);
    const bad = mkHttp({ "/game/a/": { status: 503 } });
    await expect(bad.http.get("/game/a/")).rejects.toBeInstanceOf(MetacriticTransientError);
    expect(bad.calls.filter((c) => c.path === "/game/a/")).toHaveLength(3); // 1 次 + 2 次重試
  });
  it("403／挑戰頁：丟 Blocked，不重試、不繞過", async () => {
    const a = mkHttp({ "/game/a/": { status: 403, body: "denied" } });
    await expect(a.http.get("/game/a/")).rejects.toBeInstanceOf(MetacriticBlockedError);
    expect(a.calls.filter((c) => c.path === "/game/a/")).toHaveLength(1);
    const b = mkHttp({ "/game/a/": { status: 200, body: "<title>Just a moment...</title>" } });
    await expect(b.http.get("/game/a/")).rejects.toBeInstanceOf(MetacriticBlockedError);
    expect(b.calls.filter((c) => c.path === "/game/a/")).toHaveLength(1);
  });
});

describe("provider.getScoreById", () => {
  it("一次請求拿兩個分數；玩家評分 10 分制換 100 分制", async () => {
    const { http } = mkHttp({ "/game/fixture-quest/": { body: gamePageHtml() } });
    const r = await createMetacriticProvider(http).getScoreById("fixture-quest");
    expect(r).toMatchObject({ kind: "ok", year: 2017 });
    if (r.kind !== "ok") throw new Error();
    expect(r.scores).toEqual([
      { scoreType: "metascore", score: 97, scoreMax: 100, reviewCount: 109 },
      { scoreType: "user_score", score: 89, scoreMax: 100, reviewCount: 27453 },
    ]);
    expect(http.requests).toBe(2); // robots.txt ＋ 遊戲頁
  });
  it("404＝not_found；結構不符＝parse_failed；不合法的 slug 不發請求", async () => {
    const { http, calls } = mkHttp({ "/game/gone/": { status: 404, body: "nf" }, "/game/odd/": { body: "<html>new layout</html>" } });
    const p = createMetacriticProvider(http);
    expect((await p.getScoreById("gone")).kind).toBe("not_found");
    expect((await p.getScoreById("odd")).kind).toBe("parse_failed");
    expect((await p.getScoreById("../etc/passwd")).kind).toBe("not_found");
    expect(calls.some((c) => c.path.includes("passwd"))).toBe(false);
  });
});

describe("分層更新頻率（05）", () => {
  const D = (s: string) => new Date(`${s}T12:00:00Z`);
  it("上市前 7 天以內～上市後 14 天：每天；15~90 天：每週；90 天~2 年：每月；其餘不排程", () => {
    expect(refreshIntervalDays("2026-10-20", "2026-10-15")).toBe(1); // 上市前 5 天
    expect(refreshIntervalDays("2026-10-20", "2026-10-01")).toBeNull(); // 上市前 19 天
    expect(refreshIntervalDays("2026-10-01", "2026-10-15")).toBe(1); // 後 14 天
    expect(refreshIntervalDays("2026-10-01", "2026-10-16")).toBe(7); // 後 15 天
    expect(refreshIntervalDays("2026-07-01", "2026-10-15")).toBe(30); // 後 106 天
    expect(refreshIntervalDays("2024-01-01", "2026-10-15")).toBeNull(); // 超過 2 年
    expect(refreshIntervalDays(null, "2026-10-15")).toBeNull();
  });
  it("月／季／年精度以期間最後一天為基準", () => {
    expect(periodEndDate("2026-11-01", "month")).toBe("2026-11-30");
    expect(periodEndDate("2026-10-01", "quarter")).toBe("2026-12-31");
    expect(periodEndDate("2026-01-01", "year")).toBe("2026-12-31");
    expect(periodEndDate("2026-11-15", "day")).toBe("2026-11-15");
    expect(periodEndDate("2026-01-01", "tbd")).toBeNull();
  });
  it("nextRefreshAt：窗口內回未來時間，不排程回 null", () => {
    expect(nextRefreshAt("2026-10-14", "day", D("2026-10-15"))!.toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(nextRefreshAt("2020-10-14", "day", D("2026-10-15"))).toBeNull();
  });
});

describe("模組開關（原則三）", () => {
  it("METACRITIC_SCRAPE_ENABLED 預設 false：registry 不收模組、沒有 Metacritic 的排名欄與任務；MODULES 不能開它", () => {
    const off = { MODULES: "accounts,metacritic" };
    expect(isModuleEnabled("metacritic", off)).toBe(false);
    const mods = enabledModules(off);
    expect(mods.some((m) => m.name === "metacritic")).toBe(false);
    expect(collectCatalogExtensions(mods).ratingColumns.some((c) => c.id === "metascore")).toBe(false);
    expect(mods.flatMap((m) => m.jobs ?? []).some((j) => j.name === "sync_ratings" || j.name === "repair_matches_metacritic")).toBe(false);
  });
  it("開啟後註冊三個任務與 metascore／userscore 兩欄", () => {
    const on = { METACRITIC_SCRAPE_ENABLED: "true" };
    const mods = enabledModules(on);
    const names = mods.flatMap((m) => m.jobs ?? []).map((j) => j.name);
    expect(names).toEqual(expect.arrayContaining(["sync_ratings", "repair_matches_metacritic", "refresh_metacritic_index"]));
    expect(collectCatalogExtensions(mods).ratingColumns.map((c) => c.id)).toEqual(expect.arrayContaining(["metascore", "userscore"]));
  });
});
