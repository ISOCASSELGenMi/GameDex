/**
 * Phase 3b 熱度（整合）：refresh_popularity 寫訊號、群內 PERCENT_RANK 算分數與等級（與 domain/heat.ts 對照）、
 * 版本未變不重抓、IGDB 失敗仍更新分數、外部訊號、熱門榜讀取。
 * 會 TRUNCATE games（分數是全群相對值，需要乾淨的群）；整合測試檔依序執行、各自建資料。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { getSyncState } from "@/kernel/db/sync-state";
// 直接 import 實作檔（不經 catalog/index.ts，避免同時開發中的其他匯出影響本檔）
import type { ExternalHypeRecord, ExternalHypeSource, PopularitySignal } from "@/modules/catalog/domain/entities";
import { getTrending } from "@/modules/catalog/use-cases/read/get-trending";
import { combineHypeRecords, heatLevelOf, popularityScoreOf, resolveHeatWeights } from "@/modules/catalog/domain/heat";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { replaceExternalSignal } from "@/modules/catalog/repository/popularity";
import { POPULARITY_STATE, refreshPopularity } from "@/modules/catalog/use-cases/sync/refresh-popularity";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const TODAY = "2026-10-13";
const startedAt = new Date(`${TODAY}T10:00:00Z`);
const IGDB_BASE = 97_700_000; // 其他整合測試用 77xxxx、88xxxx
const N_UP = 120; // upcoming 群
const N_REL = 30; // released 群

/** 決定性的假亂數。 */
function rand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

interface Fixture {
  igdbId: number;
  date: string | null;
  platforms: number; // 前幾個平台
  regions: number; // 前幾個地區
  reviewCount: number;
  hype: number | null; // want_to_play 原始值
}

const fixtures: Fixture[] = [];
{
  const r = rand(42);
  for (let i = 0; i < N_UP + N_REL; i++) {
    const upcoming = i < N_UP;
    const noSignal = i % 17 === 0; // 完全無訊號：沒平台、沒地區、沒評分、沒 hype
    fixtures.push({
      igdbId: IGDB_BASE + i,
      date: upcoming ? (i % 5 === 0 ? null : i % 7 === 0 ? "2026-09-20" : "2027-03-01") : "2020-01-01",
      platforms: noSignal ? 0 : 1 + Math.floor(r() * 2),
      regions: noSignal ? 0 : Math.floor(r() * 3),
      reviewCount: noSignal ? 0 : Math.floor(r() * 4) * 3,
      hype: noSignal || r() < 0.3 ? null : Math.round(r() * 1000) / 1e6,
    });
  }
}

const hypeRecords = (): ExternalHypeRecord[] => [
  ...fixtures.filter((f) => f.hype !== null).map((f) => ({ igdbGameId: f.igdbId, signal: "want_to_play" as const, value: f.hype! })),
  // 我方沒有的遊戲：略過
  { igdbGameId: 999_999_001, signal: "most_wishlisted_upcoming", value: 1 },
];

function fakeSource(opts: { version?: string; fail?: boolean; records?: () => ExternalHypeRecord[] } = {}) {
  const calls = { version: 0, records: 0 };
  const source: ExternalHypeSource = {
    fetchHypeVersion: async () => {
      calls.version++;
      if (opts.fail) throw new Error("IGDB down");
      return { want_to_play: opts.version ?? "v1", most_wishlisted_upcoming: opts.version ?? "v1" };
    },
    fetchHypeRecords: async () => {
      calls.records++;
      return (opts.records ?? hypeRecords)();
    },
  };
  return { source, calls };
}

let platformIds: number[] = [];
let genreId = 0;

async function q<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await getDb().execute<T>(query)).rows as T[];
}

/** PostgreSQL PERCENT_RANK（ORDER BY v ASC）。 */
function percentRank(values: number[]): number[] {
  const n = values.length;
  return values.map((v) => (n <= 1 ? 0 : values.filter((x) => x < v).length / (n - 1)));
}

async function expectGroupMatchesDomain(igdbIds: number[], weights: { site: number; igdb: number; struct: number }) {
  const rows = await q<{ igdb_id: number; hype: number; struct: number; score: number; level: number }>(sql`
    SELECT g.igdb_id,
      COALESCE((SELECT value FROM game_popularity_signals s WHERE s.game_id = g.id AND s.signal_name = 'igdb_hype'), 0) AS hype,
      COALESCE((SELECT value FROM game_popularity_signals s WHERE s.game_id = g.id AND s.signal_name = 'structural'), 0) AS struct,
      g.popularity_score AS score, g.heat_level AS level
    FROM games g WHERE g.igdb_id = ANY(${`{${igdbIds.join(",")}}`}::int[]) ORDER BY g.igdb_id
  `);
  expect(rows).toHaveLength(igdbIds.length);
  const pIgdb = percentRank(rows.map((r) => r.hype));
  const pStruct = percentRank(rows.map((r) => r.struct));
  const has = rows.map((r) => r.hype > 0 || r.struct > 0);
  const expScore = rows.map((_, i) => (has[i] ? popularityScoreOf(weights, { igdb: pIgdb[i], struct: pStruct[i] }) : 0));
  const sigScores = expScore.filter((_, i) => has[i]);
  const expLevel = rows.map((_, i) => {
    if (!has[i]) return 0;
    const higher = sigScores.filter((s) => s > expScore[i]).length;
    return heatLevelOf(sigScores.length <= 1 ? 0 : higher / (sigScores.length - 1), true);
  });
  expect(rows.map((r) => r.score)).toEqual(expScore);
  expect(rows.map((r) => r.level)).toEqual(expLevel);
  return rows;
}

describe.skipIf(!enabled)("熱度（整合）", () => {
  beforeAll(async () => {
    const db = getDb();
    await db.execute(sql`TRUNCATE games, game_popularity_signals RESTART IDENTITY CASCADE`);
    await db.execute(sql`DELETE FROM sync_state WHERE job_name = ${POPULARITY_STATE}`);
    platformIds = [];
    for (const [i, kind] of (["console", "pc", "mobile"] as const).entries()) {
      const p = await upsertPlatform({ igdbId: 98_800_001 + i, slug: `pop-plat-${i}`, name: `Pop Plat ${i}`, kind });
      platformIds.push(p.id);
    }
    const [g] = await q<{ id: number }>(sql`
      INSERT INTO genres (igdb_id, name, slug) VALUES (98_801_101, 'Pop Genre', 'pop-genre')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`);
    genreId = g.id;
    const regionRows = await q<{ id: number }>(sql`SELECT id FROM regions ORDER BY id LIMIT 3`);

    for (const f of fixtures) {
      const [row] = await q<{ id: number }>(sql`
        INSERT INTO games (igdb_id, slug, name, first_release_date, first_release_precision, cover_url, display_names)
        VALUES (${f.igdbId}, ${`pop-${f.igdbId}`}, ${`Pop ${f.igdbId}`}, ${f.date}::date, ${f.date ? "day" : null}::date_precision,
          ${"https://images.igdb.com/igdb/image/upload/t_thumb/co1abc.jpg"}, ${JSON.stringify({ "zh-Hant": `熱 ${f.igdbId}` })}::jsonb)
        RETURNING id`);
      for (let p = 0; p < f.platforms; p++) {
        await q(sql`INSERT INTO game_platforms (game_id, platform_id) VALUES (${row.id}, ${platformIds[p]})`);
      }
      for (let r = 0; r < f.regions; r++) {
        await q(sql`INSERT INTO release_events (game_id, platform_id, region_id, release_date, precision)
          VALUES (${row.id}, ${platformIds[0]}, ${regionRows[r].id}, ${f.date}::date, 'day')`);
      }
      if (f.reviewCount > 0) {
        await q(sql`INSERT INTO ratings (game_id, score_origin, score_provider, score_type, score, review_count)
          VALUES (${row.id}, 'igdb-aggregate', 'igdb', 'critic_aggregate', 80, ${f.reviewCount})`);
      }
      if (f.igdbId % 2 === 0) await q(sql`INSERT INTO game_genres (game_id, genre_id) VALUES (${row.id}, ${genreId})`);
    }
  });
  afterAll(async () => {
    await closeDb();
  });

  const upIds = () => fixtures.slice(0, N_UP).map((f) => f.igdbId);
  const relIds = () => fixtures.slice(N_UP).map((f) => f.igdbId);

  it("第一次：抓 IGDB、寫訊號、兩群分數與等級與 domain 公式一致", async () => {
    const { source, calls } = fakeSource();
    const res = await refreshPopularity(source, { startedAt, log: noLog }, { coldStartFollows: 5000 });
    expect(res.groups).toEqual(["upcoming", "released"]);
    expect(calls.records).toBe(1);
    const withHype = fixtures.filter((f) => f.hype !== null).length;
    expect(res.hype.write).toMatchObject({ matched: withHype, upserted: withHype, deleted: 0 });

    // igdb_hype 值＝combineHypeRecords
    const combined = combineHypeRecords(hypeRecords());
    const stored = await q<{ igdb_id: number; value: number }>(sql`
      SELECT g.igdb_id, s.value FROM game_popularity_signals s JOIN games g ON g.id = s.game_id
      WHERE s.signal_name = 'igdb_hype' ORDER BY g.igdb_id`);
    for (const r of stored) expect(r.value).toBe(combined.get(r.igdb_id));

    // structural＝評分樣本數＋平台數＋地區數
    const f0 = fixtures[1];
    const [st] = await q<{ value: number }>(sql`
      SELECT s.value FROM game_popularity_signals s JOIN games g ON g.id = s.game_id
      WHERE s.signal_name = 'structural' AND g.igdb_id = ${f0.igdbId}`);
    expect(st.value).toBe(f0.reviewCount + f0.platforms + f0.regions);

    const w = resolveHeatWeights({ siteFollowsTotal: 0, coldStartFollows: 5000, hasIgdbSignal: true });
    expect(res.scores.upcoming?.weights).toEqual(w);
    const up = await expectGroupMatchesDomain(upIds(), w);
    await expectGroupMatchesDomain(relIds(), w);
    expect(res.scores.upcoming?.games).toBe(N_UP);
    expect(res.scores.released?.games).toBe(N_REL);

    // 完全無訊號 → 0；有訊號者每一級都有人（120 款夠覆蓋 5 級）
    const noSig = up.filter((_, i) => i % 17 === 0);
    expect(noSig.every((r) => r.level === 0 && r.score === 0)).toBe(true);
    expect(new Set(up.map((r) => r.level))).toEqual(new Set([0, 1, 2, 3, 4, 5]));

    const state = await getSyncState(POPULARITY_STATE);
    expect(state?.meta).toMatchObject({ lastFullAt: startedAt.toISOString(), hypeVersion: { want_to_play: "v1" } });
  });

  it("一小時後：版本未變不重抓、只算 upcoming", async () => {
    const { source, calls } = fakeSource();
    const later = new Date(startedAt.getTime() + 3600_000);
    const res = await refreshPopularity(source, { startedAt: later, log: noLog }, { coldStartFollows: 5000 });
    expect(calls).toEqual({ version: 1, records: 0 });
    expect(res.groups).toEqual(["upcoming"]);
    expect(res.scores.upcoming?.updated).toBe(0);
  });

  it("版本改變 → 整份取代（消失的遊戲刪除）；回 0 筆不清空", async () => {
    const keep = fixtures.filter((f) => f.hype !== null).slice(0, 5);
    const { source } = fakeSource({
      version: "v2",
      records: () => keep.map((f) => ({ igdbGameId: f.igdbId, signal: "want_to_play" as const, value: f.hype! })),
    });
    const res = await refreshPopularity(source, { startedAt, log: noLog }, { coldStartFollows: 5000, scope: "upcoming" });
    expect(res.hype.write?.matched).toBe(5);
    const [{ n }] = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM game_popularity_signals WHERE signal_name = 'igdb_hype'`);
    expect(n).toBe(5);

    const empty = fakeSource({ version: "v3", records: () => [] });
    await expect(
      refreshPopularity(empty.source, { startedAt, log: noLog }, { coldStartFollows: 5000, scope: "upcoming" }),
    ).rejects.toThrow(/0 筆/);
    const [{ n: n2 }] = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM game_popularity_signals WHERE signal_name = 'igdb_hype'`);
    expect(n2).toBe(5);
    // 版本沒推進（下次仍會重抓）
    expect((await getSyncState(POPULARITY_STATE))?.meta).toMatchObject({ hypeVersion: { want_to_play: "v2" } });
  });

  it("IGDB 失敗：仍用既有訊號更新分數，最後丟錯", async () => {
    await q(sql`UPDATE games SET popularity_score = 0, heat_level = 0`);
    const { source } = fakeSource({ fail: true });
    await expect(
      refreshPopularity(source, { startedAt, log: noLog }, { coldStartFollows: 5000, scope: "upcoming" }),
    ).rejects.toThrow(/IGDB down/);
    const [{ n }] = await q<{ n: number }>(sql`SELECT count(*)::int AS n FROM games WHERE heat_level > 0`);
    expect(n).toBeGreaterThan(0);
  });

  it("外部訊號（PopularitySignal）：寫入並影響 wSite；保留名稱拒絕", async () => {
    const [g] = await q<{ id: number }>(sql`SELECT id FROM games WHERE igdb_id = ${IGDB_BASE + 1}`);
    const follows: PopularitySignal = { name: "site_follows", fetch: async () => [{ gameId: g.id, value: 2500 }] };
    const { source } = fakeSource({ version: "v2" });
    const res = await refreshPopularity(source, { startedAt, log: noLog }, {
      coldStartFollows: 5000,
      scope: "upcoming",
      externalSignals: [follows],
    });
    expect(res.external).toEqual([{ name: "site_follows", write: { matched: 1, upserted: 1, deleted: 0 } }]);
    expect(res.scores.upcoming?.weights.site).toBeCloseTo(0.3);
    await expect(replaceExternalSignal("igdb_hype", [])).rejects.toThrow(/保留名稱/);
    await replaceExternalSignal("site_follows", []);
  });

  it("熱門榜：依分數、分群、篩選、分頁、封面", async () => {
    const { source } = fakeSource({ version: "v4" });
    await refreshPopularity(source, { startedAt, log: noLog }, { coldStartFollows: 5000, scope: "all" });

    const page = await getTrending({ locale: "zh-Hant", today: TODAY, limit: 10 });
    expect(page.group).toBe("upcoming");
    expect(page.items).toHaveLength(10);
    expect(page.hasMore).toBe(true);
    const scores = page.items.map((c) => c.popularityScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(page.items.every((c) => c.heatLevel >= 1)).toBe(true);
    expect(page.items[0].name.startsWith("熱 ")).toBe(true);
    expect(page.items[0].cover?.resized).toBe(true);
    const upSet = new Set(upIds().map((id) => `pop-${id}`));
    expect(page.items.every((c) => upSet.has(c.slug))).toBe(true);

    const next = await getTrending({ locale: "en", today: TODAY, limit: 10, offset: 10 });
    expect(next.items[0].slug).not.toBe(page.items[0].slug);
    expect(new Set([...page.items, ...next.items].map((c) => c.gameId)).size).toBe(20);

    const all1 = await getTrending({ locale: "en", today: TODAY, limit: 100 });
    const all2 = await getTrending({ locale: "en", today: TODAY, limit: 100, offset: 100 });
    expect(all1.hasMore).toBe(true);
    expect(all2.hasMore).toBe(false);
    // 無訊號（沒平台）的不上榜
    expect(all1.items.length + all2.items.length).toBe(fixtures.slice(0, N_UP).filter((f) => f.platforms > 0).length);

    const rel = await getTrending({ locale: "en", today: TODAY, group: "released", limit: 100 });
    const relSet = new Set(relIds().map((id) => `pop-${id}`));
    expect(rel.items.length).toBeGreaterThan(0);
    expect(rel.items.every((c) => relSet.has(c.slug))).toBe(true);
    expect(rel.items[0].releaseDate).toBe("2020-01-01");
    expect(rel.items[0].releasePrecision).toBe("day");

    const genre = await getTrending({ locale: "en", today: TODAY, limit: 100, filter: { genreSlugs: ["pop-genre", "nope"] } });
    expect(genre.items.every((c) => Number(c.slug.slice(4)) % 2 === 0)).toBe(true);
    expect(genre.ignored).toEqual([{ dimension: "genre", slug: "nope" }]);

    const pc = await getTrending({ locale: "en", today: TODAY, limit: 100, filter: { platformSlugs: ["pop-plat-1"] } });
    const withTwo = new Set(fixtures.filter((f) => f.platforms >= 2).map((f) => `pop-${f.igdbId}`));
    expect(pc.items.length).toBeGreaterThan(0);
    expect(pc.items.every((c) => withTwo.has(c.slug))).toBe(true);
    const kind = await getTrending({ locale: "en", today: TODAY, limit: 100, filter: { platformKinds: ["pc"] } });
    expect(kind.items.map((c) => c.slug)).toEqual(pc.items.map((c) => c.slug));

    const clamped = await getTrending({ locale: "en", today: TODAY, limit: 500, offset: -3 });
    expect(clamped.limit).toBe(100);
    expect(clamped.offset).toBe(0);
  });
});
