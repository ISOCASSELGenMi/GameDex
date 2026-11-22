/**
 * Metacritic 頁面快取與每請求記帳（整合）：repair 第二輪 0 請求、parse_failed／not_found 的 TTL、sync_ratings 強制重抓、
 * facts 步驟不重抓、中途失敗仍記帳（不重複不遺漏）、import-facts 冪等。
 * igdbId 9460xxx、slug 前綴 mcp-。HTTP 一律用假 fetch，不連外。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import { clearSettingsCache, updateSettings } from "@/kernel/settings";
import { games } from "@/modules/catalog/schema";
import { normalizeTitle } from "@/modules/catalog";
import { insertSlugs } from "@/modules/metacritic/repository/slugs";
import { getPage } from "@/modules/metacritic/repository/pages";
import { MetacriticHttp } from "@/modules/metacritic/provider/http";
import { createMetacriticProvider } from "@/modules/metacritic/provider/provider";
import { runRepairMatches, runReverifyMatches, runSyncRatings } from "@/modules/metacritic/use-cases/jobs";
import { importPageFacts } from "@/modules/metacritic/use-cases/import-facts";
import { createCachedPages } from "@/modules/metacritic/use-cases/pages";
import { BUDGET_STATE, loadBudget } from "@/modules/metacritic/use-cases/runtime";
import { fakeMetacriticFetch, gamePageHtml, ROBOTS_TXT } from "../helpers/metacritic-fixtures";
import { importFactsFile, runFactsStep } from "../../scripts/lib/review-facts";

vi.mock("next/server", () => ({ connection: async () => {} }));

const enabled = !!process.env.TEST_DATABASE_URL;
const SRC = "metacritic_scrape";
const today = new Date();
const dayMs = 86_400_000;
const later = (d: number) => new Date(today.getTime() + d * dayMs);
const isoDay = (offset: number) => later(offset).toISOString().slice(0, 10);

let seq = 0;
async function addGame(name: string): Promise<number> {
  seq += 1;
  const [g] = await getDb()
    .insert(games)
    .values({ igdbId: 9_460_000 + seq, slug: `mcp-${seq}`, name, firstReleaseDate: isoDay(-30), firstReleasePrecision: "day", gameType: "main_game", popularityScore: 500 - seq })
    .returning({ id: games.id });
  return g!.id;
}
const setExt = (gameId: number, slug: string) =>
  getDb().execute(sql`INSERT INTO external_ids (game_id, source, external_id, confidence_pct, needs_review, match_method) VALUES (${gameId}, ${SRC}, ${slug}, 95, false, 'auto')`);
const slugRow = (slug: string) => ({ slug, nameNorm: normalizeTitle(slug.replace(/-/g, " ")) });
const allow = () => updateSettings([{ key: "metacritic.scrapeAllowed", value: true }], "test");
const usedToday = async () => ((await getSyncState(BUDGET_STATE))?.meta as { used?: number } | undefined)?.used ?? 0;

function mkHttp(routes: Parameters<typeof fakeMetacriticFetch>[0]) {
  const f = fakeMetacriticFetch({ "/robots.txt": { body: ROBOTS_TXT }, ...routes });
  const http = new MetacriticHttp({ gate: async () => true, fetchImpl: f.impl, sleep: async () => {}, minIntervalMs: 0 });
  return { http, calls: f.calls };
}
function mkIo(routes: Parameters<typeof fakeMetacriticFetch>[0], extra: Record<string, unknown> = {}) {
  const t = mkHttp(routes);
  return { io: { log: () => {}, http: t.http, now: today, alert: async () => {}, ...extra }, calls: t.calls };
}
const pageCalls = (calls: Array<{ path: string }>, slug: string) => calls.filter((c) => c.path === `/game/${slug}/`).length;

async function wipe(): Promise<void> {
  const db = getDb();
  await db.execute(sql`TRUNCATE app_settings, app_settings_audit, metacritic_slugs, metacritic_pages RESTART IDENTITY`);
  await db.execute(sql`DELETE FROM sync_state WHERE job_name LIKE 'metacritic%'`);
  await db.execute(sql`DELETE FROM games WHERE slug LIKE 'mcp-%'`);
  clearSettingsCache();
}

describe.skipIf(!enabled)("Metacritic 頁面快取（整合）", () => {
  const saved = process.env.METACRITIC_SCRAPE_ENABLED;
  beforeAll(async () => {
    process.env.METACRITIC_SCRAPE_ENABLED = "true";
    await wipe();
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.METACRITIC_SCRAPE_ENABLED;
    else process.env.METACRITIC_SCRAPE_ENABLED = saved;
    await wipe();
    await closeDb();
  });
  beforeEach(async () => {
    process.env.METACRITIC_SCRAPE_ENABLED = "true";
    await wipe();
    await allow();
  });

  it("repair 第二輪：同一候選（驗證不通過）的頁面來自快取，http 請求數 0", async () => {
    const g = await addGame("Mcp Quest One");
    await insertSlugs([slugRow("mcp-quest-one")]);
    const routes = { "/game/mcp-quest-one/": { body: gamePageHtml({ name: "Totally Different Title", date: isoDay(-30) }) } };
    const one = mkIo(routes, { onlyGameIds: [g] });
    expect(await runRepairMatches(one.io, 100)).toMatchObject({ tried: 1, rejected: 1 });
    expect(pageCalls(one.calls, "mcp-quest-one")).toBe(1);
    const two = mkIo(routes, { onlyGameIds: [g] });
    expect(await runRepairMatches(two.io, 100)).toMatchObject({ tried: 1, rejected: 1 });
    expect(two.calls).toHaveLength(0);
    expect(two.io.http.requests).toBe(0);
    expect((await getPage("mcp-quest-one"))?.state).toBe("ok");
  });

  it("parse_failed：TTL（7 天）內由快取回傳不發請求；過期後重抓", async () => {
    const g = await addGame("Mcp Odd Layout");
    await insertSlugs([slugRow("mcp-odd-layout")]);
    const routes = { "/game/mcp-odd-layout/": { body: "<html>new layout</html>" } };
    const run = async (now: Date) => {
      const t = mkIo(routes, { onlyGameIds: [g], now });
      await runRepairMatches(t.io, 100);
      return t;
    };
    expect(pageCalls((await run(today)).calls, "mcp-odd-layout")).toBe(1);
    expect((await getPage("mcp-odd-layout"))?.state).toBe("parse_failed");
    expect((await run(later(6))).calls).toHaveLength(0);
    expect(pageCalls((await run(later(8))).calls, "mcp-odd-layout")).toBe(1);
  });

  it("not_found：TTL（30 天）內不發請求；過期後重抓", async () => {
    const g = await addGame("Mcp Gone Game");
    await insertSlugs([slugRow("mcp-gone-game")]);
    const routes = { "/game/mcp-gone-game/": { status: 404, body: "nf" } };
    const run = async (now: Date) => {
      const t = mkIo(routes, { onlyGameIds: [g], now });
      await runRepairMatches(t.io, 100);
      return t;
    };
    expect(pageCalls((await run(today)).calls, "mcp-gone-game")).toBe(1);
    expect((await getPage("mcp-gone-game"))?.state).toBe("not_found");
    expect((await run(later(29))).calls).toHaveLength(0);
    expect(pageCalls((await run(later(31))).calls, "mcp-gone-game")).toBe(1);
  });

  it("reverify 也吃快取：parse_failed 頁在 TTL 內 skipped 但不發請求", async () => {
    const g = await addGame("Mcp Reverify Odd");
    await setExt(g, "mcp-reverify-odd");
    const routes = { "/game/mcp-reverify-odd/": { body: "<html>x</html>" } };
    const a = mkIo(routes, { onlyGameIds: [g] });
    expect(await runReverifyMatches(a.io, 100)).toMatchObject({ skipped: 1, checked: 0 });
    expect(pageCalls(a.calls, "mcp-reverify-odd")).toBe(1);
    const b = mkIo(routes, { onlyGameIds: [g] });
    expect(await runReverifyMatches(b.io, 100)).toMatchObject({ skipped: 1, checked: 0 });
    expect(b.calls).toHaveLength(0);
  });

  it("sync_ratings 到期：強制重抓並更新快取列（fetched_at 變新、分數更新）", async () => {
    const g = await addGame("Mcp Sync One");
    await setExt(g, "mcp-sync-one");
    const a = mkIo({ "/game/mcp-sync-one/": { body: gamePageHtml({ meta: 70 }) } });
    await runSyncRatings(a.io);
    const first = (await getPage("mcp-sync-one"))!;
    expect(first).toMatchObject({ state: "ok", metascore: 70 });
    // 分數到了更新時間（next_refresh_at 設成過去）；快取仍未過期（90 天）也必須重抓
    await getDb().execute(sql`UPDATE ratings SET next_refresh_at = now() - interval '1 day' WHERE game_id = ${g}`);
    const b = mkIo({ "/game/mcp-sync-one/": { body: gamePageHtml({ meta: 80 }) } }, { now: later(1) });
    await runSyncRatings(b.io);
    expect(pageCalls(b.calls, "mcp-sync-one")).toBe(1);
    const second = (await getPage("mcp-sync-one"))!;
    expect(second.metascore).toBe(80);
    expect(second.fetchedAt.getTime()).toBeGreaterThan(first.fetchedAt.getTime());
  });

  it("重抓失敗（forceRefresh 遇到 parse_failed）不蓋掉先前的 ok 列；快取命中還原成與原本相同的 PageResult", async () => {
    const t = mkHttp({ "/game/mcp-keep/": { body: gamePageHtml({ name: "Keep Me" }) } });
    const pages = createCachedPages(createMetacriticProvider(t.http), () => today);
    expect((await pages.getScoreById("mcp-keep")).kind).toBe("ok");
    const broken = mkHttp({ "/game/mcp-keep/": { body: "<html>x</html>" } });
    const pages2 = createCachedPages(createMetacriticProvider(broken.http), () => today);
    expect((await pages2.getScoreById("mcp-keep", { forceRefresh: true })).kind).toBe("parse_failed");
    expect(await getPage("mcp-keep")).toMatchObject({ state: "ok", title: "Keep Me" });
    const again = await pages2.getScoreById("mcp-keep");
    expect(again).toMatchObject({ kind: "ok", title: "Keep Me", scores: [{ scoreType: "metascore", score: 97, reviewCount: 109 }, { scoreType: "user_score", score: 89, reviewCount: 27453 }] });
  });

  it("facts 步驟：先 repair 抓過的頁面，補頁面資料不再發請求", async () => {
    const g = await addGame("Mcp Facts One");
    await insertSlugs([slugRow("mcp-facts-one")]);
    const routes = { "/game/mcp-facts-one/": { body: gamePageHtml({ name: "Mcp Facts One", date: isoDay(-30) }) } };
    const a = mkIo(routes, { onlyGameIds: [g] });
    expect(await runRepairMatches(a.io, 100)).toMatchObject({ tried: 1 });
    expect(pageCalls(a.calls, "mcp-facts-one")).toBe(1);
    const f = mkHttp(routes);
    const r = await runFactsStep({ max: 50, maxPriority: 1, http: f.http });
    expect(r.skipped).toBeUndefined();
    expect(pageCalls(f.calls, "mcp-facts-one")).toBe(0); // repair 抓過了；其他測試檔殘留的配對（若有）不是本測試的 slug
  });

  describe("每請求記帳", () => {
    it("Budget.track：每 5 個請求寫入一次（被殺最多少算 4 個）；flush 補齊且重複 flush 不重複扣", async () => {
      const { http } = mkHttp({ "/game/mcp-a/": { body: "x" } });
      const budget = await loadBudget(today, 100);
      budget.track(http, 5);
      for (let i = 0; i < 7; i += 1) await http.get("/game/mcp-a/"); // robots 1 + 7 頁 = 8 個請求
      expect(http.requests).toBe(8);
      expect(budget.remaining()).toBe(92); // 即時
      expect(await usedToday()).toBe(5); // 已寫入的（每滿 5 個寫一次）
      await budget.flush();
      await budget.flush();
      expect(await usedToday()).toBe(8);
      await budget.spend(0);
      expect(await usedToday()).toBe(8);
    });

    it("任務中途失敗（第三頁連線全失敗）：已發出的請求（含重試）全部記帳，總數＝http.requests，不重複不遺漏", async () => {
      const routes: Parameters<typeof fakeMetacriticFetch>[0] = {};
      for (let i = 0; i < 4; i += 1) {
        const id = await addGame(`Mcp Mid ${i}`);
        await setExt(id, `mcp-mid-${i}`);
        routes[`/game/mcp-mid-${i}/`] = i === 2 ? () => { throw new Error("連線中斷"); } : { body: gamePageHtml() };
      }
      const t = mkIo(routes);
      // 依 popularity 排序：mid-0、mid-1、mid-2（失敗，重試 3 次後 MetacriticTransientError，任務乾淨結束）
      await runSyncRatings(t.io);
      expect(t.io.http.requests).toBe(1 + 1 + 1 + 3); // robots、兩個成功頁、失敗頁 3 次嘗試
      expect(await usedToday()).toBe(t.io.http.requests);
      expect((await loadBudget(today, 500)).remaining()).toBe(500 - t.io.http.requests);
    });

    it("任務以未預期例外結束：finally 仍寫入用量；之後的輪次不重複扣", async () => {
      const g = await addGame("Mcp Boom");
      await setExt(g, "mcp-boom");
      const routes = { "/game/mcp-boom/": { body: gamePageHtml() } };
      const boom = mkIo(routes, { log: () => { throw new Error("boom"); } });
      await expect(runSyncRatings(boom.io)).rejects.toThrow("boom");
      expect(boom.io.http.requests).toBe(2);
      expect(await usedToday()).toBe(2);
      const next = mkIo(routes); // 這款已有分數、不再被選
      await runSyncRatings(next.io);
      expect(next.io.http.requests).toBe(0);
      expect(await usedToday()).toBe(2);
    });
  });

  describe("import-facts", () => {
    const fetchedAt = "2026-11-01T00:00:00.000Z";
    const map = {
      "mcp-old-ok": { title: "Old", releaseDate: "2020-01-01", companies: ["A"], platforms: ["PC"], fetchedAt, state: "ok" as const },
      "mcp-open-ok": { title: "Open", releaseDate: null, companies: [], platforms: [], fetchedAt, state: "ok" as const },
      "mcp-gone": { title: null, releaseDate: null, companies: [], platforms: [], fetchedAt, state: "not_found" as const },
      "mcp-bad": { title: "Bad", releaseDate: null, companies: [], platforms: [], fetchedAt: "not-a-date", state: "ok" as const },
    };
    const count = async () => (await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM metacritic_pages WHERE slug LIKE 'mcp-%'`)).rows[0]!.n;
    it("匯入筆數正確、expires_at 依 TTL 由 fetchedAt 推算；重複匯入冪等、不覆蓋既有列", async () => {
      expect(await importPageFacts(map)).toEqual({ total: 4, added: 3, skipped: 1 });
      expect(await count()).toBe(3);
      const ttlDays = async (s: string) => Math.round(((await getPage(s))!.expiresAt.getTime() - new Date(fetchedAt).getTime()) / dayMs);
      expect([await ttlDays("mcp-old-ok"), await ttlDays("mcp-open-ok"), await ttlDays("mcp-gone")]).toEqual([90, 7, 30]);
      expect(await getPage("mcp-old-ok")).toMatchObject({ title: "Old", releaseDate: "2020-01-01", releaseYear: 2020, companies: ["A"], platforms: ["PC"] });
      await getDb().execute(sql`UPDATE metacritic_pages SET title = 'Newer' WHERE slug = 'mcp-old-ok'`);
      expect(await importPageFacts(map)).toEqual({ total: 4, added: 0, skipped: 1 });
      expect(await count()).toBe(3);
      expect((await getPage("mcp-old-ok"))!.title).toBe("Newer");
    });
    it("importFactsFile 讀舊側檔；檔案不存在回 null；重複匯入冪等", async () => {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-")), "facts.json");
      expect(await importFactsFile(file)).toBeNull();
      fs.writeFileSync(file, JSON.stringify(map));
      expect(await importFactsFile(file)).toEqual({ total: 4, added: 3, skipped: 1 });
      expect(await importFactsFile(file)).toEqual({ total: 4, added: 0, skipped: 1 });
      expect(await count()).toBe(3);
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    });
  });
});
