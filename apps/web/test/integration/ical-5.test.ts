/**
 * Phase 5 iCal（整合，08）：公開 feed 視窗、60 天改期、tbd／取消 30 天過渡期、聚合規則共用、SEQUENCE 總和單調（含 D75）、
 * ETag 摘要與內容一致、取前 N 筆、活動 feed、單一遊戲／平台 feed。
 * 「今天」固定為 2037-06-01；igdbId 97xxxx、slug 前綴 ical5-。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { coreEnvSchema } from "@/kernel/config/env";
import { resolveFilterSlugs, resolveReport, submitReport, upsertReleaseEvent } from "@/modules/catalog";
import { listIcalEvents, listIcalReleases, getIcalEventMeta, getIcalReleaseMeta, type IcalReleaseQuery } from "@/modules/catalog/repository/ical";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { events, gamePlatforms, games, regions, releaseDateHistory, releaseEvents } from "@/modules/catalog/schema";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";
import { generateIcs, prepareIcalFeed, releaseUid } from "@/modules/catalog/use-cases/ical";
import { utcToday } from "@/modules/catalog/domain/utc-date";
import { RELEASE_STATUSES, type IcalReleaseItem } from "@/modules/catalog";
import { parseIcs } from "../helpers/ics";

const enabled = !!process.env.TEST_DATABASE_URL;
const TODAY = "2037-06-01";
const LINKS = { game: (s: string) => `https://x.test/en/games/${s}`, event: (s: string) => `https://x.test/en/events/${s}` };
const noLog = () => {};

type Prec = "day" | "month" | "quarter" | "year" | "tbd";
interface Rel {
  platform: number;
  region?: string;
  date: string | null;
  periodStart?: string | null;
  precision?: Prec;
  stage?: "unspecified" | "full" | "early_access";
  status?: "scheduled" | "delayed" | "released" | "cancelled";
  sequence?: number;
  updatedAt?: string;
  source?: "igdb" | "manual";
}

describe.skipIf(!enabled)("iCal（整合）", () => {
  const regionId: Record<string, number> = {};
  const gid: Record<string, number> = {};
  let ps = 0;
  let pc = 0;

  async function addGame(
    key: string,
    rels: Rel[],
    opts: { popularity?: number; displayNames?: Record<string, string>; gameStatus?: string | null; gameType?: string } = {},
  ): Promise<number> {
    const db = getDb();
    const n = Object.keys(gid).length + 1;
    const [g] = await db
      .insert(games)
      .values({
        igdbId: 970000 + n,
        slug: `ical5-${key}`,
        name: `Ical5 ${key}`,
        displayNames: opts.displayNames ?? {},
        popularityScore: opts.popularity ?? 0,
        gameStatus: opts.gameStatus ?? null,
        gameType: opts.gameType ?? "main_game",
      })
      .returning({ id: games.id });
    gid[key] = g.id;
    for (const p of [...new Set(rels.map((r) => r.platform))]) await db.insert(gamePlatforms).values({ gameId: g.id, platformId: p });
    for (const r of rels) {
      await db.insert(releaseEvents).values({
        gameId: g.id,
        platformId: r.platform,
        regionId: regionId[r.region ?? "WW"],
        releaseDate: r.date,
        periodStart: r.periodStart === undefined ? r.date : r.periodStart,
        precision: r.precision ?? "day",
        releaseStage: r.stage ?? "full",
        status: r.status ?? "scheduled",
        sequence: r.sequence ?? 0,
        source: r.source ?? "igdb",
        ...(r.updatedAt ? { updatedAt: new Date(r.updatedAt) } : {}),
      });
    }
    return g.id;
  }

  /** 在 (遊戲, 平台) 的第一列加一筆改期紀錄。 */
  async function addHistory(key: string, h: { oldDate: string | null; oldPrecision: Prec; newDate: string | null; newPrecision: Prec; changedAt: string }) {
    const db = getDb();
    const [row] = await db.select({ id: releaseEvents.id }).from(releaseEvents).where(eq(releaseEvents.gameId, gid[key])).limit(1);
    await db.insert(releaseDateHistory).values({
      releaseEventId: row.id,
      oldDate: h.oldDate,
      oldPrecision: h.oldPrecision,
      newDate: h.newDate,
      newPrecision: h.newPrecision,
      changedAt: new Date(h.changedAt),
    });
  }

  async function query(over: Partial<IcalReleaseQuery> = {}, limit = 5000): Promise<IcalReleaseQuery> {
    const { filter } = await resolveFilterSlugs({ statuses: [...RELEASE_STATUSES] });
    return { scope: { type: "public", today: TODAY, limit }, filter, locale: "en", regionPref: "WW", ...over };
  }
  const mine = (items: IcalReleaseItem[]) => items.filter((i) => i.gameSlug.startsWith("ical5-"));
  const slugs = (items: IcalReleaseItem[]) => mine(items).map((i) => i.gameSlug.replace("ical5-", "")).sort();

  beforeAll(async () => {
    const db = getDb();
    for (const r of await db.select().from(regions)) regionId[r.code] = r.id;
    ps = (await upsertPlatform({ igdbId: 970901, slug: "ical5-ps", name: "Ical5 PlayStation", abbreviation: "I5PS", kind: "console" })).id;
    pc = (await upsertPlatform({ igdbId: 970902, slug: "ical5-pc", name: "Ical5 PC", kind: "pc" })).id;

    // ── 視窗 ──
    await addGame("in-window", [{ platform: ps, date: "2037-06-20" }], { popularity: 1000 });
    await addGame("far-out", [{ platform: ps, date: "2037-12-25" }]);
    await addGame("far-moved-recent", [{ platform: ps, date: "2037-12-25", sequence: 1 }]);
    await addHistory("far-moved-recent", { oldDate: "2037-06-20", oldPrecision: "day", newDate: "2037-12-25", newPrecision: "day", changedAt: "2037-05-20T00:00:00Z" });
    await addGame("far-moved-old", [{ platform: ps, date: "2037-12-25", sequence: 1 }]);
    await addHistory("far-moved-old", { oldDate: "2037-06-20", oldPrecision: "day", newDate: "2037-12-25", newPrecision: "day", changedAt: "2037-03-01T00:00:00Z" });
    // 月：本月 1 日（今天）在；上個月不在；period_start 超過 +90 天不在；8/1 在
    await addGame("month-now", [{ platform: ps, date: "2037-06-01", precision: "month" }]);
    await addGame("month-past", [{ platform: ps, date: "2037-05-01", precision: "month" }]);
    await addGame("month-late", [{ platform: ps, date: "2037-09-01", precision: "month" }]);
    await addGame("month-aug", [{ platform: ps, date: "2037-08-01", precision: "month" }]);
    // 季：期間內在；期間還沒開始（> +90 天）不在
    await addGame("quarter-in", [{ platform: ps, date: "2037-09-30", periodStart: "2037-07-01", precision: "quarter" }]);
    await addGame("quarter-late", [{ platform: ps, date: "2037-12-31", periodStart: "2037-10-01", precision: "quarter" }]);

    // ── tbd ──
    const tbd = { platform: ps, date: null, periodStart: null, precision: "tbd" as const, status: "delayed" as const, sequence: 1 };
    await addGame("tbd-recent", [tbd]);
    await addHistory("tbd-recent", { oldDate: "2037-06-25", oldPrecision: "day", newDate: null, newPrecision: "tbd", changedAt: "2037-05-25T00:00:00Z" });
    await addGame("tbd-old", [tbd]);
    await addHistory("tbd-old", { oldDate: "2037-06-25", oldPrecision: "day", newDate: null, newPrecision: "tbd", changedAt: "2037-04-01T00:00:00Z" });
    await addGame("tbd-never", [{ ...tbd, sequence: 0, status: "scheduled" }]);

    // ── 取消 ──
    const cancelled = { platform: ps, status: "cancelled" as const };
    await addGame("cancel-recent", [{ ...cancelled, date: "2037-12-25", sequence: 1, updatedAt: "2037-05-25T00:00:00Z" }]);
    await addGame("cancel-never-changed", [{ ...cancelled, date: "2037-06-20", sequence: 0, updatedAt: "2037-05-25T00:00:00Z" }]);
    await addGame("cancel-old", [{ ...cancelled, date: "2037-06-20", sequence: 2, updatedAt: "2037-03-01T00:00:00Z" }]);

    // ── 共用的聚合規則 ──
    await addGame("rumored", [{ platform: ps, date: "2037-06-20" }], { gameStatus: "rumored" });
    await addGame("dlc", [{ platform: ps, date: "2037-06-20" }], { gameType: "dlc_addon" });
    await addGame("two-regions", [
      { platform: ps, region: "WW", date: "2037-06-21", sequence: 2, updatedAt: "2037-05-01T00:00:00Z" },
      { platform: ps, region: "JP", date: "2037-06-22", sequence: 3, updatedAt: "2037-05-10T00:00:00Z" },
    ], { popularity: 999 });
    await addGame("two-platforms", [
      { platform: ps, date: "2037-06-23" },
      { platform: pc, date: "2037-06-23" },
    ]);
    await addGame("two-stages", [
      { platform: ps, date: "2037-06-24", stage: "early_access" },
      { platform: ps, date: "2037-07-24", stage: "full" },
    ]);
    await addGame("localized", [{ platform: pc, date: "2037-06-26" }], { displayNames: { "zh-Hant": "在地化遊戲", ja: "ローカライズ" } });
  });

  afterAll(async () => {
    await closeDb();
  });

  describe("視窗（08 §公開 feed、§RFC 5545 規則 3）", () => {
    it("90 天視窗、60 天內改期、月／季精度、tbd 與取消的 30 天過渡期", async () => {
      const items = await listIcalReleases(await query());
      expect(slugs(items)).toEqual(
        [
          "cancel-recent", // 30 天內取消（視窗外也留著）
          "far-moved-recent", // 視窗外，但 60 天內改過期
          "in-window", // 視窗內
          "localized",
          "month-aug", // 月精度：period_start 在 +90 天內
          "month-now", // 月精度：release_date＝今天
          "quarter-in", // 季精度：期間內
          "tbd-recent", // 30 天內延期成 tbd
          "two-platforms", // 同日兩個平台＝兩個項目
          "two-platforms",
          "two-regions",
          "two-stages", // 兩個階段＝兩個項目
          "two-stages",
        ].sort(),
      );
      // 反例（不在上面的清單內）：far-out、far-moved-old、month-past、month-late、quarter-late、tbd-old、tbd-never、
      // cancel-never-changed（建立時就是取消、從沒變動）、cancel-old、rumored、dlc
    });

    it("tbd：回傳最後一個已知日期與精度；取消：保留原日期", async () => {
      const items = mine(await listIcalReleases(await query()));
      const tbd = items.find((i) => i.gameSlug === "ical5-tbd-recent")!;
      expect(tbd).toMatchObject({ precision: "tbd", date: null, status: "delayed", lastKnownDate: "2037-06-25", lastKnownPrecision: "day" });
      const cancelled = items.find((i) => i.gameSlug === "ical5-cancel-recent")!;
      expect(cancelled).toMatchObject({ status: "cancelled", date: "2037-12-25", precision: "day" });
    });

    it("視窗邊界：release_date＝今天在、昨天不在；今天+90 天在、+91 天不在", async () => {
      await addGame("edge-today", [{ platform: ps, date: TODAY }]);
      await addGame("edge-yesterday", [{ platform: ps, date: "2037-05-31" }]);
      await addGame("edge-90", [{ platform: ps, date: "2037-08-30" }]);
      await addGame("edge-91", [{ platform: ps, date: "2037-08-31" }]);
      const s = slugs(await listIcalReleases(await query()));
      expect(s).toContain("edge-today");
      expect(s).toContain("edge-90");
      expect(s).not.toContain("edge-yesterday");
      expect(s).not.toContain("edge-91");
    });
  });

  describe("聚合規則共用（每組挑一列）", () => {
    it("同鍵多地區 → 一個項目；地區偏好與 WW 的挑選與月曆相同；sequence 是整組總和、updatedAt 是整組最大值", async () => {
      const ww = mine(await listIcalReleases(await query())).find((i) => i.gameSlug === "ical5-two-regions")!;
      expect(ww).toMatchObject({ regionCode: "WW", date: "2037-06-21", sequence: 5 });
      expect(ww.updatedAt.toISOString()).toBe("2037-05-10T00:00:00.000Z");
      const jp = mine(await listIcalReleases(await query({ regionPref: "JP" }))).find((i) => i.gameSlug === "ical5-two-regions")!;
      expect(jp).toMatchObject({ regionCode: "JP", date: "2037-06-22", sequence: 5 });
      // UID 與地區無關
      expect(releaseUid(ww, "d")).toBe(releaseUid(jp, "d"));
    });

    it("同日的兩個平台是兩個項目（UID 粒度是 遊戲×平台×階段）；不同階段也各一個", async () => {
      const items = mine(await listIcalReleases(await query()));
      expect(items.filter((i) => i.gameSlug === "ical5-two-platforms").map((i) => i.platformId).sort()).toEqual([ps, pc].sort());
      expect(items.filter((i) => i.gameSlug === "ical5-two-stages").map((i) => i.stage).sort()).toEqual(["early_access", "full"]);
      expect(new Set(items.map((i) => releaseUid(i, "d"))).size).toBe(items.length);
    });

    it("語系：名稱依 displayNames，沒有則原名；UID 不變", async () => {
      const pick = async (locale: string) =>
        mine(await listIcalReleases(await query({ locale }))).find((i) => i.gameSlug === "ical5-localized")!;
      const [zh, en, ja] = [await pick("zh-Hant"), await pick("en"), await pick("ja")];
      expect([zh.gameName, en.gameName, ja.gameName]).toEqual(["在地化遊戲", "Ical5 localized", "ローカライズ"]);
      expect(new Set([zh, en, ja].map((i) => releaseUid(i, "d"))).size).toBe(1);
    });

    it("同鍵同時有 cancelled 與 scheduled 列：挑 scheduled（不被取消列蓋掉）", async () => {
      await addGame("mixed-status", [
        { platform: ps, region: "JP", date: "2037-06-27", status: "cancelled", sequence: 1 },
        { platform: ps, region: "WW", date: "2037-06-28", status: "scheduled" },
      ]);
      const item = mine(await listIcalReleases(await query({ regionPref: "JP" }))).find((i) => i.gameSlug === "ical5-mixed-status")!;
      expect(item).toMatchObject({ status: "scheduled", date: "2037-06-28", regionCode: "WW", sequence: 1 });
    });
  });

  describe("取前 N 筆與 ETag 摘要", () => {
    it("limit：依熱度高到低取前 N，meta.count 同步", async () => {
      const q = await query({}, 2);
      const items = await listIcalReleases(q);
      expect(items.map((i) => i.gameSlug)).toEqual(["ical5-in-window", "ical5-two-regions"]);
      expect(await getIcalReleaseMeta(q)).toMatchObject({ count: 2 });
    });

    it("meta（count、max updatedAt）與實際產生的項目一致", async () => {
      const q = await query();
      const items = await listIcalReleases(q);
      const meta = await getIcalReleaseMeta(q);
      expect(meta.count).toBe(items.length);
      const maxMs = Math.max(...items.map((i) => i.updatedAt.getTime()));
      expect(meta.maxUpdatedAt?.getTime()).toBe(maxMs);
      const ics = parseIcs(generateIcs({ locale: "en", feed: { kind: "releases" }, releases: items, events: [], uidDomain: "d", links: LINKS }));
      expect(ics.events).toHaveLength(items.length);
    });

    it("prepareIcalFeed：同資料同 ETag；資料變動 ETag 變；整個 key 被刪（count 變、max(updated_at) 不變）ETag 也變；render 位元組相同", async () => {
      const gameKey = "etag-game";
      const g = await addGame(gameKey, [{ platform: ps, date: "2037-06-30", updatedAt: "2037-05-01T00:00:00Z" }, { platform: pc, date: "2037-06-30", updatedAt: "2037-04-01T00:00:00Z" }]);
      const prep = () => prepareIcalFeed({ spec: { kind: "game", slug: `ical5-${gameKey}` }, locale: "en", links: LINKS, today: TODAY });
      const a = (await prep())!;
      const b = (await prep())!;
      expect(b.etag).toBe(a.etag);
      expect(await b.render()).toBe(await a.render());
      expect(a.meta.count).toBe(2);

      // 刪掉較舊（非 max）的 pc 鍵：max(updated_at) 不變，count 變
      await getDb().delete(releaseEvents).where(and(eq(releaseEvents.gameId, g), eq(releaseEvents.platformId, pc)));
      const afterDelete = (await prep())!;
      expect(afterDelete.meta.maxUpdatedAt?.getTime()).toBe(a.meta.maxUpdatedAt?.getTime());
      expect(afterDelete.meta.count).toBe(1);
      expect(afterDelete.etag).not.toBe(a.etag);

      // 改期（upsert 會更新 updated_at）→ ETag 變
      const ww = regionId.WW;
      await upsertReleaseEvent({ gameId: g, platformId: ps, regionId: ww, releaseStage: "full", releaseDate: "2037-07-15", periodStart: "2037-07-15", precision: "day", status: "scheduled" });
      const moved = (await prep())!;
      expect(moved.etag).not.toBe(afterDelete.etag);
      expect(parseIcs(await moved.render()).events[0].get("SEQUENCE")).toBe("1");

      // 語系、今天不同 → ETag 不同
      const ja = await prepareIcalFeed({ spec: { kind: "game", slug: `ical5-${gameKey}` }, locale: "ja", links: LINKS, today: TODAY });
      expect(ja!.etag).not.toBe(moved.etag);
      const tomorrow = await prepareIcalFeed({ spec: { kind: "game", slug: `ical5-${gameKey}` }, locale: "en", links: LINKS, today: "2037-06-02" });
      expect(tomorrow!.etag).not.toBe(moved.etag);
    });

    it("平台 feed：只含該平台；不存在的平台、不存在的遊戲 → null", async () => {
      const feed = (await prepareIcalFeed({ spec: { kind: "platform", slug: "ical5-pc" }, locale: "en", links: LINKS, today: TODAY }))!;
      const parsed = parseIcs(await feed.render());
      const platformIds = new Set(parsed.events.map((e) => /-p(\d+)-/.exec(e.get("UID") ?? "")?.[1]));
      expect(platformIds).toEqual(new Set([String(pc)]));
      expect(parsed.calendar.find((p) => p.name === "X-WR-CALNAME")?.value).toContain("Ical5 PC");
      expect(await prepareIcalFeed({ spec: { kind: "platform", slug: "no-such-platform" }, locale: "en", links: LINKS })).toBeNull();
      expect(await prepareIcalFeed({ spec: { kind: "game", slug: "no-such-game" }, locale: "en", links: LINKS })).toBeNull();
    });

    it("單一遊戲 feed 不受視窗限制（遠期、取消的都給），從未有日期的 tbd 不給", async () => {
      const one = async (key: string) => {
        const f = await prepareIcalFeed({ spec: { kind: "game", slug: `ical5-${key}` }, locale: "en", links: LINKS, today: TODAY });
        return { meta: f!.meta, events: parseIcs(await f!.render()).events };
      };
      expect((await one("far-out")).events).toHaveLength(1);
      expect((await one("cancel-never-changed")).events[0].get("STATUS")).toBe("CANCELLED");
      const never = await one("tbd-never");
      expect(never.events).toHaveLength(0);
      expect(never.meta.count).toBe(0);
      const old = await one("tbd-old"); // 有過日期，不論多久以前
      expect(old.events).toHaveLength(1);
      expect(old.events[0].get("STATUS")).toBe("TENTATIVE");
    });
  });

  describe("真實流程：tbd、取消、SEQUENCE 單調（含 D75）", () => {
    // 真實流程的資料列由 upsertReleaseEvent 寫入，updated_at／changed_at 是「現在」，所以用單一遊戲範圍讀（不受視窗限制），
    // 公開視窗另用真實今天檢查。
    const itemOf = async (key: string) =>
      (await listIcalReleases(await query({ scope: { type: "game", gameId: gid[key], today: TODAY } })))[0];
    const publicToday = utcToday();
    const inPublicFeed = async (key: string) =>
      mine(await listIcalReleases(await query({ scope: { type: "public", today: publicToday, limit: 5000 } }))).some((i) => i.gameSlug === `ical5-${key}`);

    it("upsertReleaseEvent 把日期改成 tbd → release_date_history 留下舊日期 → feed 保留在原日期＋TENTATIVE", async () => {
      const g = await addGame("flow-tbd", [{ platform: ps, date: "2037-06-18" }]);
      const key = { gameId: g, platformId: ps, regionId: regionId.WW, releaseStage: "full" as const };
      const before = (await itemOf("flow-tbd"))!;
      expect(before).toMatchObject({ date: "2037-06-18", sequence: 0 });
      await upsertReleaseEvent({ ...key, releaseDate: null, periodStart: null, precision: "tbd", status: "delayed" });
      const after = (await itemOf("flow-tbd"))!;
      expect(await inPublicFeed("flow-tbd")).toBe(true); // 剛延期成 tbd：公開 feed 保留（30 天內）
      expect(after).toMatchObject({ precision: "tbd", date: null, lastKnownDate: "2037-06-18", lastKnownPrecision: "day", sequence: 1 });
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      const ics = parseIcs(generateIcs({ locale: "ja", feed: { kind: "releases" }, releases: [after], events: [], uidDomain: "d", links: LINKS }));
      expect(ics.events[0].get("STATUS")).toBe("TENTATIVE");
      expect(ics.events[0].get("UID")).toBe(releaseUid(before, "d"));
    });

    it("取消 → 復原：每次 SEQUENCE +1、UID 不變、取消期間 STATUS:CANCELLED", async () => {
      const g = await addGame("flow-cancel", [{ platform: ps, date: "2037-06-19" }]);
      const key = { gameId: g, platformId: ps, regionId: regionId.WW, releaseStage: "full" as const };
      const base = { releaseDate: "2037-06-19", periodStart: "2037-06-19", precision: "day" as const };
      const seqs: number[] = [(await itemOf("flow-cancel"))!.sequence];
      await upsertReleaseEvent({ ...key, ...base, status: "cancelled" });
      const cancelled = (await itemOf("flow-cancel"))!;
      seqs.push(cancelled.sequence);
      expect(cancelled.status).toBe("cancelled");
      expect(await inPublicFeed("flow-cancel")).toBe(true); // 剛取消：公開 feed 保留（30 天內，不受 90 天視窗限制）
      await upsertReleaseEvent({ ...key, ...base, status: "scheduled" });
      const restored = (await itemOf("flow-cancel"))!;
      seqs.push(restored.sequence);
      expect(restored.status).toBe("scheduled");
      expect(await inPublicFeed("flow-cancel")).toBe(false); // 復原後日期在 2037，回到一般視窗規則
      expect(seqs).toEqual([0, 1, 2]);
      expect(releaseUid(cancelled, "d")).toBe(releaseUid(restored, "d"));
    });

    describe("D75：manual 被 IGDB 日期更新覆蓋時，iCal 的 SEQUENCE 仍單調不減", () => {
      const PS = 970950;
      type R = { date?: number; date_format: number; platform: number; release_region: number; status?: number };
      const ts = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
      const raw = (releases: R[]) => ({ id: 970800, name: "Ical5 d75", slug: "ical5-d75", game_type: 0, updated_at: ts("2037-01-01"), platforms: [PS], release_dates: releases });
      const provider = (r: () => ReturnType<typeof raw>): GameDataProvider => ({
        sourceName: "fake",
        fetchPlatforms: async () => [],
        fetchEvents: async () => [],
        fetchGames: async (q: { afterId?: number; limit: number }) =>
          [toGameRecord(r())].filter((x) => q.afterId === undefined || x.igdbId > q.afterId).slice(0, q.limit),
      });
      const rel = (date: string): R => ({ date: ts(date), date_format: 0, platform: PS, release_region: 8, status: 6 });
      const env = () => coreEnvSchema.parse({ DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: "test", REPORT_MAX_PER_IP_PER_DAY: "50", TURNSTILE_SECRET_KEY: "x" });

      it("IGDB 建立 → 人工更正（manual）→ IGDB 日期更新（manual 標 removed）→ 再人工更正 → 每一步 sequence 都不減，日期變動時嚴格增加", async () => {
        await upsertPlatform({ igdbId: PS, slug: "ical5-d75-ps", name: "Ical5 D75 PS", kind: "console" });
        const sync = (d: string, at: string) => syncGames(provider(() => raw([rel(d)])), { startedAt: new Date(at), log: noLog });
        const seqNow = async () => {
          const [g] = await getDb().select({ id: games.id }).from(games).where(eq(games.slug, "ical5-d75"));
          const it = (await listIcalReleases(await query({ scope: { type: "game", gameId: g.id, today: TODAY } })))[0];
          return { sequence: it.sequence, date: it.date, updatedAt: it.updatedAt.getTime() };
        };
        const submit = async (body: unknown) => {
          const res = await submitReport({ body, turnstileToken: "t", clientIp: "198.51.100.77" }, { env: env(), verifyTurnstile: async () => ({ ok: true }), warn: noLog });
          if (!res.ok) throw new Error(JSON.stringify(res));
          return res.id;
        };
        const correct = async (date: string) => {
          const igdbRow = (await getDb().select().from(releaseEvents).innerJoin(games, eq(games.id, releaseEvents.gameId)).where(and(eq(games.slug, "ical5-d75"), eq(releaseEvents.source, "igdb"))))[0].release_events;
          const id = await submit({ reportType: "wrong_date", targetType: "release_event", targetId: igdbRow.id, sourceUrl: "https://example.com/x", proposed: { date, precision: "day" } });
          expect(await resolveReport(id, "accept")).toMatchObject({ ok: true });
        };

        const trail: Array<{ step: string; sequence: number; date: string | null }> = [];
        const mark = async (step: string) => trail.push({ step, ...(await seqNow()) });

        await sync("2037-06-10", "2037-01-01T00:00:00Z");
        await mark("igdb 建立");
        await correct("2037-06-12");
        await mark("人工更正 → manual");
        await sync("2037-06-20", "2037-01-02T00:00:00Z");
        await mark("IGDB 改日期 → 覆蓋 manual");
        await correct("2037-06-22");
        await mark("再次人工更正");
        await sync("2037-06-25", "2037-01-03T00:00:00Z");
        await mark("IGDB 再改日期");

        // 單調不減；每次日期不同時嚴格增加（客戶端才會採用新版本）
        for (let i = 1; i < trail.length; i++) {
          expect(trail[i].sequence, `${trail[i - 1].step} → ${trail[i].step}`).toBeGreaterThanOrEqual(trail[i - 1].sequence);
          if (trail[i].date !== trail[i - 1].date) expect(trail[i].sequence, trail[i].step).toBeGreaterThan(trail[i - 1].sequence);
        }
        expect(trail.map((t) => t.date)).toEqual(["2037-06-10", "2037-06-12", "2037-06-20", "2037-06-22", "2037-06-25"]);
      });
    });
  });

  describe("活動 feed", () => {
    it("start_time 非 NULL、結束在近 30 天內或之後；endTime NULL 保留；sequence＝start_time 改期次數", async () => {
      const db = getDb();
      const mk = (slug: string, start: string | null, end: string | null = null) =>
        db.insert(events).values({ slug: `ical5-ev-${slug}`, name: `Ical5 ${slug}`, startTime: start ? new Date(start) : null, endTime: end ? new Date(end) : null }).returning({ id: events.id });
      await mk("future", "2037-07-01T10:00:00Z");
      await mk("recent-end", "2037-05-20T10:00:00Z", "2037-05-25T10:00:00Z");
      await mk("old-end", "2037-04-01T10:00:00Z", "2037-04-03T10:00:00Z");
      await mk("old-no-end", "2037-04-01T10:00:00Z");
      await mk("undated", null);
      const got = (await listIcalEvents({ today: TODAY, limit: 5000 })).filter((e) => e.slug.startsWith("ical5-ev-")).map((e) => e.slug.replace("ical5-ev-", ""));
      expect(got).toEqual(["recent-end", "future"]);

      const meta = await getIcalEventMeta({ today: TODAY, limit: 5000 });
      expect(meta.count).toBe((await listIcalEvents({ today: TODAY, limit: 5000 })).length);

      const feed = (await prepareIcalFeed({ spec: { kind: "events" }, locale: "ja", links: LINKS, today: TODAY }))!;
      const parsed = parseIcs(await feed.render());
      const future = parsed.events.find((e) => e.get("SUMMARY") === "Ical5 future")!;
      expect(future.get("DTSTART")).toBe("20370701T100000Z");
      expect(future.get("DTEND")).toBe("20370701T110000Z");
      expect(future.get("SEQUENCE")).toBe("0");
    });
  });

  it("開發資料保護：測試不應連到開發資料庫", () => {
    expect(new URL(process.env.DATABASE_URL ?? "postgres://x/y_test").pathname.endsWith("_test")).toBe(true);
  });
});
