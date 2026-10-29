/**
 * Phase 6 Metacritic（整合）：slug 索引、修復比對（往前推進、manual 不覆寫、否決表）、抓分數（兩列分數、負向快取、解析失敗不寫）、
 * 兩道開關與被擋冷卻（關閉時對 metacritic.com 的請求數為 0）、每日額度、比對覆核、評分顯示與排名整合。
 * igdbId 9410xxx、slug 前綴 mc6-。HTTP 一律用假 fetch，不連外。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
import { clearSettingsCache, updateSettings } from "@/kernel/settings";
import { games, ratings } from "@/modules/catalog/schema";
import { getGameDetail } from "@/modules/catalog/use-cases/read/get-game-detail";
import { getRatingsRanking } from "@/modules/catalog/use-cases/read/get-ratings-ranking";
import { setCatalogExtensions } from "@/modules/catalog/extensions";
import { selectRatings } from "@/modules/catalog/domain/rating-display";
import { listMatchReviewQueue, getRejectedExternalIds } from "@/modules/catalog/repository/external-ratings";
import { insertSlugs, countSlugs } from "@/modules/metacritic/repository/slugs";
import { MetacriticHttp } from "@/modules/metacritic/provider/http";
import { refreshSlugIndex, runRepairMatches, runSyncRatings, PARSE_FAIL_ALERT } from "@/modules/metacritic/use-cases/jobs";
import { applyReviewAction, loadReviewQueue } from "@/modules/metacritic/use-cases/review";
import { BLOCKED_STATE, BUDGET_STATE } from "@/modules/metacritic/use-cases/runtime";
import { metascoreColumn, userscoreColumn } from "@/modules/metacritic";
import { normalizeTitle } from "@/modules/catalog";
import { fakeMetacriticFetch, gamePageHtml, ROBOTS_TXT, SITEMAP_INDEX, SITEMAP_SHARD } from "../helpers/metacritic-fixtures";

vi.mock("next/server", () => ({ connection: async () => {} }));

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const SRC = "metacritic_scrape";
const base = 9_410_000;
const today = new Date();
const isoDay = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

let seq = 0;
async function addGame(name: string, over: Partial<typeof games.$inferInsert> = {}): Promise<number> {
  seq += 1;
  const [g] = await getDb()
    .insert(games)
    .values({ igdbId: base + seq, slug: `mc6-${seq}`, name, firstReleaseDate: isoDay(-30), firstReleasePrecision: "day", gameType: "main_game", popularityScore: 500 - seq, ...over })
    .returning({ id: games.id });
  return g!.id;
}
const slugRow = (slug: string) => ({ slug, nameNorm: normalizeTitle(slug.replace(/-/g, " ")) });
const ratingRows = (gameId: number) => getDb().select().from(ratings).where(and(eq(ratings.gameId, gameId), eq(ratings.scoreProvider, SRC)));
const extRow = async (gameId: number) => (await getDb().execute<{ external_id: string; needs_review: boolean; match_method: string; confidence_pct: number }>(sql`SELECT external_id, needs_review, match_method, confidence_pct FROM external_ids WHERE game_id = ${gameId} AND source = ${SRC}`)).rows[0];
const setExt = (gameId: number, slug: string, needsReview = false, method = "auto") =>
  getDb().execute(sql`INSERT INTO external_ids (game_id, source, external_id, confidence_pct, needs_review, match_method) VALUES (${gameId}, ${SRC}, ${slug}, 95, ${needsReview}, ${method})`);

function mkIo(routes: Parameters<typeof fakeMetacriticFetch>[0], extra: Record<string, unknown> = {}) {
  const f = fakeMetacriticFetch({ "/robots.txt": { body: ROBOTS_TXT }, ...routes });
  const alerts: string[] = [];
  const http = new MetacriticHttp({
    gate: async () => (await import("@/kernel/settings")).isMetacriticScrapeAllowed(),
    fetchImpl: f.impl,
    sleep: async () => {},
    minIntervalMs: 0,
  });
  return { io: { log: noLog, http, now: today, alert: async (m: string) => void alerts.push(m), ...extra }, alerts, calls: f.calls };
}
const pageCalls = (calls: Array<{ path: string }>) => calls.filter((c) => c.path.startsWith("/game/") || c.path.endsWith(".xml"));

async function wipe(): Promise<void> {
  const db = getDb();
  await db.execute(sql`TRUNCATE app_settings, app_settings_audit, metacritic_slugs RESTART IDENTITY`);
  await db.execute(sql`DELETE FROM sync_state WHERE job_name LIKE 'metacritic%'`);
  await db.execute(sql`DELETE FROM games WHERE slug LIKE 'mc6-%'`);
  clearSettingsCache();
}
const allow = () => updateSettings([{ key: "metacritic.scrapeAllowed", value: true }], "test");

describe.skipIf(!enabled)("Metacritic（整合）", () => {
  const saved = process.env.METACRITIC_SCRAPE_ENABLED;
  beforeAll(async () => {
    process.env.METACRITIC_SCRAPE_ENABLED = "true";
    await wipe();
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.METACRITIC_SCRAPE_ENABLED;
    else process.env.METACRITIC_SCRAPE_ENABLED = saved;
    await wipe();
    setCatalogExtensions({});
    await closeDb();
  });
  beforeEach(async () => {
    process.env.METACRITIC_SCRAPE_ENABLED = "true";
    await wipe();
  });

  describe("兩道開關：關閉時對 metacritic.com 的請求數為 0", () => {
    it("環境變數關、或後台沒允許 → 三個任務都不發任何請求", async () => {
      const g = await addGame("Fixture Quest");
      await setExt(g, "fixture-quest");
      for (const [env, db] of [["false", true], ["true", false], ["false", false]] as const) {
        process.env.METACRITIC_SCRAPE_ENABLED = env;
        await updateSettings([{ key: "metacritic.scrapeAllowed", value: db }], "t");
        const { io, calls } = mkIo({ "/game/fixture-quest/": { body: gamePageHtml() }, "/games.xml": { body: SITEMAP_INDEX } });
        expect(await runSyncRatings(io)).toMatchObject({ attempted: 0 });
        expect(await runRepairMatches(io)).toMatchObject({ tried: 0 });
        expect(await refreshSlugIndex(io)).toEqual({ shards: 0, added: 0 });
        expect(calls).toHaveLength(0);
        expect(io.http.requests).toBe(0);
      }
      expect(await ratingRows(g)).toHaveLength(0);
    });
  });

  describe("slug 索引（站內搜尋被 robots 禁止，改讀公開 sitemap）", () => {
    it("讀 sitemap 分片寫入索引、記錄進度；只發 robots／games.xml／分片請求，不碰 /search", async () => {
      await allow();
      const { io, calls } = mkIo({
        "/games.xml": { body: SITEMAP_INDEX },
        "/games/1.xml": { body: SITEMAP_SHARD(["fixture-quest", "other-game"]) },
        "/games/2.xml": { body: SITEMAP_SHARD(["third-game"]) },
      });
      const r = await refreshSlugIndex(io);
      expect(r).toEqual({ shards: 2, added: 3 });
      expect(await countSlugs()).toBe(3);
      expect(calls.map((c) => c.path)).toEqual(["/robots.txt", "/games.xml", "/games/1.xml", "/games/2.xml"]);
      expect((await getSyncState("metacritic_slug_index"))?.cursor).toBe("0"); // 繞回第一片
      expect((await getSyncState(BUDGET_STATE))?.meta).toMatchObject({ used: 4 });
      // 重跑不重複寫入
      expect((await refreshSlugIndex(mkIo({ "/games.xml": { body: SITEMAP_INDEX }, "/games/1.xml": { body: SITEMAP_SHARD(["fixture-quest"]) }, "/games/2.xml": { body: SITEMAP_SHARD([]) } }).io)).added).toBe(0);
    });
  });

  describe("repair_matches_metacritic", () => {
    it("配對：高信心且年份驗證通過 → 自動採用；年份差太多 → 進覆核；無候選只記嘗試", async () => {
      await allow();
      const hit = await addGame("Fixture Quest Chronicles", { firstReleaseDate: isoDay(-40) });
      const wrongYear = await addGame("Another Great Game", { firstReleaseDate: isoDay(-50) });
      const none = await addGame("Zzqx Unmatchable Title");
      await insertSlugs(["fixture-quest-chronicles", "another-great-game", "unrelated-thing"].map(slugRow));
      const y = today.getUTCFullYear();
      const { io, calls } = mkIo({
        "/game/fixture-quest-chronicles/": { body: gamePageHtml({ year: y }) },
        "/game/another-great-game/": { body: gamePageHtml({ year: y - 9 }) },
      });
      const stats = await runRepairMatches(io);
      expect(stats).toMatchObject({ tried: 3, matched: 1, review: 1, noCandidate: 1, verifiedMismatch: 1 });
      expect(await extRow(hit)).toMatchObject({ external_id: "fixture-quest-chronicles", needs_review: false, match_method: "auto" });
      expect(await extRow(wrongYear)).toMatchObject({ external_id: "another-great-game", needs_review: true });
      expect(await extRow(none)).toBeUndefined();
      const attempts = await getDb().execute<{ game_id: number; last_result: string }>(sql`SELECT game_id, last_result FROM external_match_attempts WHERE source = ${SRC} AND game_id IN (${hit}, ${wrongYear}, ${none})`);
      expect(Object.fromEntries(attempts.rows.map((r) => [r.game_id, r.last_result]))).toEqual({ [hit]: "matched", [wrongYear]: "low_confidence", [none]: "no_candidate" });
      expect(calls.some((c) => c.path === "/search")).toBe(false);
    });
    it("往前推進：最久沒試的優先，每輪換新的一批（不會永遠撈到同一批）", async () => {
      await allow();
      const ids = [await addGame("Qqqq One"), await addGame("Qqqq Two"), await addGame("Qqqq Three")];
      await insertSlugs([slugRow("something-else")]);
      const seen: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        await runRepairMatches(mkIo({}).io, 1);
        const rows = await getDb().execute<{ game_id: number }>(sql`SELECT game_id FROM external_match_attempts WHERE source = ${SRC} AND game_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
        seen.push(rows.rows.length);
      }
      expect(seen).toEqual([1, 2, 3]);
    });
    it("manual 不覆寫；否決表裡的候選不再提出；同一外部 ID 被兩款遊戲配到 → 都進覆核", async () => {
      await allow();
      const manual = await addGame("Fixture Quest Chronicles");
      await setExt(manual, "hand-picked", false, "manual");
      const rejected = await addGame("Fixture Quest Chronicles Reborn");
      await getDb().execute(sql`INSERT INTO external_id_rejections (game_id, source, external_id) VALUES (${rejected}, ${SRC}, 'fixture-quest-chronicles-reborn')`);
      await insertSlugs(["fixture-quest-chronicles", "fixture-quest-chronicles-reborn"].map(slugRow));
      const y = today.getUTCFullYear();
      await runRepairMatches(mkIo({ "/game/fixture-quest-chronicles/": { body: gamePageHtml({ year: y }) } }).io);
      expect(await extRow(manual)).toMatchObject({ external_id: "hand-picked", match_method: "manual" });
      expect(await getRejectedExternalIds(rejected, SRC)).toEqual(new Set(["fixture-quest-chronicles-reborn"]));
      const r = await extRow(rejected);
      expect(r?.external_id).not.toBe("fixture-quest-chronicles-reborn");

      // 重複：兩款遊戲配到同一個 slug
      const a = await addGame("Dupe Target Game");
      const b = await addGame("Dupe Target Game ");
      await insertSlugs([slugRow("dupe-target-game")]);
      await runRepairMatches(mkIo({ "/game/dupe-target-game/": { body: gamePageHtml({ year: y }) } }).io);
      expect((await extRow(a))?.needs_review).toBe(true);
      expect((await extRow(b))?.needs_review).toBe(true);
    });
  });

  describe("sync_ratings", () => {
    it("只抓已確認的外部 ID；一次請求寫 metascore 與 user_score 兩列（user 換成 100 分制）；未確認的不抓", async () => {
      await allow();
      const ok = await addGame("Sync One");
      const pending = await addGame("Sync Pending");
      await setExt(ok, "sync-one");
      await setExt(pending, "sync-pending", true);
      const { io, calls } = mkIo({ "/game/sync-one/": { body: gamePageHtml({ meta: 88, metaCount: 40, user: 7.4, userCount: 1200 }) }, "/game/sync-pending/": { body: gamePageHtml() } });
      expect(await runSyncRatings(io)).toMatchObject({ attempted: 1, saved: 1 });
      expect(calls.some((c) => c.path === "/game/sync-pending/")).toBe(false);
      const rows = await ratingRows(ok);
      expect(rows.map((r) => [r.scoreType, r.score, r.scoreMax, r.reviewCount, r.scoreOrigin]).sort()).toEqual([
        ["metascore", 88, 100, 40, "metacritic"],
        ["user_score", 74, 100, 1200, "metacritic"],
      ]);
      expect(rows.every((r) => r.nextRefreshAt && r.nextRefreshAt.getTime() > Date.now() && r.sourceUrl === "https://www.metacritic.com/game/sync-one/")).toBe(true);
      // 不存評論全文：ratings 只有數字欄位
      expect(Object.keys(rows[0]!)).not.toContain("body");
      // 下次更新時間未到 → 不會被重選
      const again = mkIo({ "/game/sync-one/": { body: gamePageHtml() } });
      expect(await runSyncRatings(again.io)).toMatchObject({ attempted: 0 });
      expect(pageCalls(again.calls)).toHaveLength(0);
    });
    it("查無分數（tbd）與 404 寫負向快取（score=NULL＋nextRefreshAt），之後不再重選；IGDB 列存在時 Metacritic 仍會被選中", async () => {
      await allow();
      const tbd = await addGame("Sync Tbd");
      const gone = await addGame("Sync Gone");
      const withIgdb = await addGame("Sync Igdb");
      await setExt(tbd, "sync-tbd");
      await setExt(gone, "sync-gone");
      await setExt(withIgdb, "sync-igdb");
      await getDb().execute(sql`INSERT INTO ratings (game_id, score_origin, score_provider, score_type, score, score_max, review_count, next_refresh_at) VALUES (${withIgdb}, 'igdb-aggregate', 'igdb', 'critic_aggregate', 80, 100, 12, NULL)`);
      const { io } = mkIo({
        "/game/sync-tbd/": { body: gamePageHtml({ meta: "tbd", user: "tbd" }) },
        "/game/sync-gone/": { status: 404, body: "nf" },
        "/game/sync-igdb/": { body: gamePageHtml({ meta: 70, user: 6 }) },
      });
      expect(await runSyncRatings(io)).toMatchObject({ attempted: 3, saved: 2, notFound: 1 });
      for (const id of [tbd, gone]) {
        const rows = await ratingRows(id);
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.score === null && r.nextRefreshAt !== null)).toBe(true);
      }
      expect((await ratingRows(withIgdb)).map((r) => r.score).sort()).toEqual([60, 70]);
      expect(await runSyncRatings(mkIo({}).io)).toMatchObject({ attempted: 0 });
    });
    it("解析失敗：不寫負向快取（改版時不該把整批標成沒分數）；失敗率偏高時告警並停止本輪", async () => {
      await allow();
      const n = PARSE_FAIL_ALERT.minAttempts + 2;
      const routes: Parameters<typeof fakeMetacriticFetch>[0] = {};
      const ids: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const id = await addGame(`Sync Odd ${i}`);
        ids.push(id);
        await setExt(id, `sync-odd-${i}`);
        routes[`/game/sync-odd-${i}/`] = { body: "<html>new layout</html>" };
      }
      const { io, alerts } = mkIo(routes);
      const s = await runSyncRatings(io);
      expect(s.parseFailed).toBeGreaterThanOrEqual(PARSE_FAIL_ALERT.minAttempts);
      expect(s.attempted).toBeLessThan(n + 1);
      expect(alerts.join("\n")).toContain("解析失敗率偏高");
      expect((await getDb().select().from(ratings).where(and(inArray(ratings.gameId, ids), eq(ratings.scoreProvider, SRC)))).length).toBe(0);
    });
    it("被擋（403）：停止、記冷卻、告警；之後的任務在冷卻內不發任何請求，也不重試繞過", async () => {
      await allow();
      const a = await addGame("Sync Block A");
      const b = await addGame("Sync Block B");
      await setExt(a, "block-a");
      await setExt(b, "block-b");
      const first = mkIo({ "/game/block-a/": { status: 403, body: "Access denied" }, "/game/block-b/": { body: gamePageHtml() } });
      await runSyncRatings(first.io);
      expect(first.calls.filter((c) => c.path === "/game/block-a/")).toHaveLength(1);
      expect(first.calls.some((c) => c.path === "/game/block-b/")).toBe(false);
      expect(first.alerts.join("")).toContain("被擋");
      expect((await getSyncState(BLOCKED_STATE))?.meta).toMatchObject({ until: expect.any(String) });
      expect(await ratingRows(a)).toHaveLength(0);
      const second = mkIo({ "/game/block-a/": { body: gamePageHtml() } });
      expect(await runSyncRatings(second.io)).toMatchObject({ attempted: 0 });
      expect(await runRepairMatches(second.io)).toMatchObject({ tried: 0 });
      expect(second.calls).toHaveLength(0);
      // 冷卻過後才能再試
      const later = mkIo({ "/game/block-a/": { body: gamePageHtml() } }, { now: new Date(today.getTime() + 25 * 3_600_000) });
      expect((await runSyncRatings(later.io)).attempted).toBeGreaterThan(0);
    });
    it("每日請求額度：用完就停，三個任務共用", async () => {
      await allow();
      for (let i = 0; i < 6; i += 1) {
        const id = await addGame(`Sync Budget ${i}`);
        await setExt(id, `budget-${i}`);
      }
      const routes: Parameters<typeof fakeMetacriticFetch>[0] = {};
      for (let i = 0; i < 6; i += 1) routes[`/game/budget-${i}/`] = { body: gamePageHtml() };
      const one = mkIo(routes, { dailyLimit: 4 });
      const s = await runSyncRatings(one.io);
      expect(s.attempted).toBe(3); // 額度 4 含 robots.txt
      expect(one.io.http.requests).toBe(4);
      expect((await getSyncState(BUDGET_STATE))?.meta).toMatchObject({ day: today.toISOString().slice(0, 10), used: one.io.http.requests });
      // 同一天再跑一次：額度已用完 → 0 請求
      const two = mkIo(routes, { dailyLimit: 4 });
      await runSyncRatings(two.io);
      expect(two.calls).toHaveLength(0);
    });
  });

  describe("比對覆核（12）", () => {
    it("確認＝標 manual 且不再進佇列；清除＝寫否決表、刪列、刪該遊戲的 Metacritic 分數；手動輸入＝manual", async () => {
      const g1 = await addGame("Review One");
      const g2 = await addGame("Review Two");
      const g3 = await addGame("Review Three");
      await setExt(g1, "review-one", true);
      await setExt(g2, "review-two", true);
      await getDb().execute(sql`UPDATE external_ids SET confidence_pct = 70 WHERE game_id = ${g2}`);
      await getDb().execute(sql`INSERT INTO ratings (game_id, score_origin, score_provider, score_type, score, score_max) VALUES (${g2}, 'metacritic', 'metacritic_scrape', 'metascore', 71, 100)`);
      const q = await loadReviewQueue();
      expect(q.total).toBe(2);
      expect(q.items.map((i) => i.gameId)).toEqual([g2, g1]); // 信心由低到高

      const id1 = q.items.find((i) => i.gameId === g1)!.id;
      const id2 = q.items.find((i) => i.gameId === g2)!.id;
      expect(await applyReviewAction({ action: "confirm", id: id1 })).toEqual({ ok: true });
      expect(await extRow(g1)).toMatchObject({ needs_review: false, match_method: "manual" });
      expect(await applyReviewAction({ action: "reject", id: id2 })).toEqual({ ok: true });
      expect(await extRow(g2)).toBeUndefined();
      expect(await getRejectedExternalIds(g2, SRC)).toEqual(new Set(["review-two"]));
      expect(await ratingRows(g2)).toHaveLength(0);
      expect(await applyReviewAction({ action: "reject", id: id2 })).toEqual({ ok: false, error: "not_found" });

      expect(await applyReviewAction({ action: "manual", gameId: g3, slug: "Review-Three" })).toEqual({ ok: true });
      expect(await extRow(g3)).toMatchObject({ external_id: "review-three", match_method: "manual", needs_review: false });
      expect(await applyReviewAction({ action: "manual", gameId: g3, slug: "../bad" })).toEqual({ ok: false, error: "invalid_slug" });
      expect(await applyReviewAction({ action: "manual", gameId: 2_000_000_000, slug: "x" })).toEqual({ ok: false, error: "not_found" });
      expect(await listMatchReviewQueue(SRC, 10)).toEqual([]);
    });
  });

  describe("評分顯示整合", () => {
    it("詳情頁讀到 Metacritic 兩列；IGDB 列存在時主分數仍依優先序選 Metascore；user_score 另列不當主分數", async () => {
      const g = await addGame("Display One");
      await getDb().execute(sql`INSERT INTO ratings (game_id, score_origin, score_provider, score_type, score, score_max, review_count) VALUES
        (${g}, 'igdb-aggregate', 'igdb', 'critic_aggregate', 80, 100, 10),
        (${g}, 'metacritic', 'metacritic_scrape', 'metascore', 91, 100, 50),
        (${g}, 'metacritic', 'metacritic_scrape', 'user_score', 83, 100, 900)`);
      const detail = await getGameDetail({ slug: `mc6-${seq}`, locale: "en" });
      expect(detail!.ratings.map((r) => `${r.scoreProvider}:${r.scoreType}`).sort()).toEqual(["igdb:critic_aggregate", "metacritic_scrape:metascore", "metacritic_scrape:user_score"]);
      const sel = selectRatings(detail!.ratings, { visible: [], priority: ["metacritic_scrape", "igdb"] });
      expect(sel.primary?.scoreType).toBe("metascore");
      expect(selectRatings(detail!.ratings, { visible: [], priority: ["igdb", "metacritic_scrape"] }).primary?.scoreProvider).toBe("igdb");
    });
    it("評分排名頁：metascore／userscore 欄可排序；10 分制的 userscore 以 100 分制存", async () => {
      setCatalogExtensions({ ratingColumns: [metascoreColumn, userscoreColumn] });
      const hi = await addGame("Rank Hi");
      const lo = await addGame("Rank Lo");
      await getDb().execute(sql`INSERT INTO ratings (game_id, score_origin, score_provider, score_type, score, score_max, review_count) VALUES
        (${hi}, 'metacritic', 'metacritic_scrape', 'metascore', 95, 100, 40), (${lo}, 'metacritic', 'metacritic_scrape', 'metascore', 60, 100, 40),
        (${hi}, 'metacritic', 'metacritic_scrape', 'user_score', 70, 100, 400), (${lo}, 'metacritic', 'metacritic_scrape', 'user_score', 88, 100, 400)`);
      const meta = await getRatingsRanking({ sort: "metascore", locale: "en", minVotes: 1 });
      const mine = (r: Awaited<ReturnType<typeof getRatingsRanking>>) => r.rows.filter((x) => x.gameId === hi || x.gameId === lo).map((x) => x.gameId);
      expect(mine(meta)).toEqual([hi, lo]);
      const user = await getRatingsRanking({ sort: "userscore", locale: "en", minVotes: 1 });
      expect(mine(user)).toEqual([lo, hi]);
      expect(user.columns.map((c) => c.id)).toEqual(expect.arrayContaining(["igdb", "metascore", "userscore"]));
      setCatalogExtensions({});
      expect((await getRatingsRanking({ sort: "metascore", locale: "en", minVotes: 1 })).sort).toBe("igdb"); // 模組停用：欄位與 sort 一併消失
    });
  });
});
