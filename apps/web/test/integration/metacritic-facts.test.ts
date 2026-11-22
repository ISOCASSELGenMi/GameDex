/**
 * Metacritic 頁面資料補抓（整合）：哪些 slug 需要補、順序（待校驗最先）、已經有資料的跳過、兩道開關關閉時不發請求。
 * igdbId 9450xxx、slug 前綴 mcf-。不連外。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { clearSettingsCache } from "@/kernel/settings";
import { games } from "@/modules/catalog/schema";
import { upsertPage } from "@/modules/metacritic/repository/pages";
import { runFactsStep, slugsNeedingFacts } from "../../scripts/lib/review-facts";

const enabled = !!process.env.TEST_DATABASE_URL;
const SRC = "metacritic_scrape";
let seq = 0;

async function addGame(name: string): Promise<number> {
  seq += 1;
  const [g] = await getDb()
    .insert(games)
    .values({ igdbId: 9_450_000 + seq, slug: `mcf-${seq}`, name, firstReleaseDate: "2025-01-01", firstReleasePrecision: "day", gameType: "main_game" })
    .returning({ id: games.id });
  return g!.id;
}
const ext = (gameId: number, slug: string, method: string, needsReview: boolean) =>
  getDb().execute(sql`INSERT INTO external_ids (game_id, source, external_id, confidence_pct, needs_review, match_method) VALUES (${gameId}, ${SRC}, ${slug}, 90, ${needsReview}, ${method})`);
const wipe = async () => {
  await getDb().execute(sql`DELETE FROM games WHERE slug LIKE 'mcf-%'`);
  await getDb().execute(sql`DELETE FROM sync_state WHERE job_name LIKE 'metacritic%'`);
  await getDb().execute(sql`TRUNCATE metacritic_pages`);
  await getDb().execute(sql`TRUNCATE app_settings, app_settings_audit RESTART IDENTITY`);
  clearSettingsCache();
};
const cache = (slug: string, expiresInDays = 30) =>
  upsertPage({ slug, state: "ok", title: "T", releaseDate: "2025-01-01", fetchedAt: new Date(), expiresAt: new Date(Date.now() + expiresInDays * 86_400_000) });

describe.skipIf(!enabled)("Metacritic 頁面資料補抓（整合）", () => {
  const saved = process.env.METACRITIC_SCRAPE_ENABLED;
  beforeAll(wipe);
  afterAll(async () => {
    if (saved === undefined) delete process.env.METACRITIC_SCRAPE_ENABLED;
    else process.env.METACRITIC_SCRAPE_ENABLED = saved;
    await wipe();
    await closeDb();
  });
  beforeEach(wipe);

  it("slugsNeedingFacts：待校驗（auto2 待覆核）→ 已採用／手動 → 已移除的候選 → 尚未重驗的舊配對；已有未過期快取的跳過", async () => {
    const review = await addGame("Review One");
    const adopted = await addGame("Adopted One");
    const manual = await addGame("Manual One");
    const old = await addGame("Old One");
    const oldReview = await addGame("Old Review");
    const rejected = await addGame("Rejected One");
    await ext(review, "mcf-review", "auto2", true);
    await ext(adopted, "mcf-adopted", "auto2", false);
    await ext(manual, "mcf-manual", "manual", false);
    await ext(old, "mcf-old", "auto", false);
    await ext(oldReview, "mcf-old-review", "auto", true);
    await getDb().execute(sql`INSERT INTO external_id_rejections (game_id, source, external_id) VALUES (${rejected}, ${SRC}, 'mcf-rejected')`);

    expect(await slugsNeedingFacts()).toEqual(["mcf-review", "mcf-adopted", "mcf-manual", "mcf-rejected", "mcf-old"]);
    // 每日自動抓取只補校驗頁會看到的（優先 0、1）
    expect(await slugsNeedingFacts(1)).toEqual(["mcf-review", "mcf-adopted", "mcf-manual"]);
    // 已經有未過期快取的不列；過期的要再抓
    await cache("mcf-review");
    await cache("mcf-manual");
    await cache("mcf-adopted", -1);
    expect(await slugsNeedingFacts(1)).toEqual(["mcf-adopted"]);
  });

  it("runFactsStep：環境變數關閉（或後台沒允許）時直接略過，不發請求、不扣額度", async () => {
    const g = await addGame("Gate One");
    await ext(g, "mcf-gate", "auto2", true);
    for (const env of ["false", "true"]) {
      process.env.METACRITIC_SCRAPE_ENABLED = env; // "true" 但後台沒有允許抓取，也要略過
      const r = await runFactsStep({ max: 10 });
      expect(r).toMatchObject({ fetched: 0, requests: 0 });
      expect(r.skipped).toBeTruthy();
    }
    expect((await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM metacritic_pages`)).rows[0]!.n).toBe(0);
    const budget = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM sync_state WHERE job_name = 'metacritic_budget'`);
    expect(budget.rows[0]!.n).toBe(0);
  });
});
