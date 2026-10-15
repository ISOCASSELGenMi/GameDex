/**
 * Phase 4 Slice 2 整合測試（15 §Phase 4 回報完成標準）：
 * - submitReport：驗證、目標存在、每 IP 上限、Turnstile、IP 只存雜湊、takedown 通知
 * - 每日清除 90 天前的 IP 雜湊
 * - resolveReport：核可日期類回報 → manual 列＋history＋change_feed＋sequence 高於 igdb；其餘只改狀態；已處理／找不到
 * - 同步與人工更正（2026-10-15）：status／別的鍵／igdb removed 不影響 manual；igdb 同鍵日期變動或新建 → manual removed、igdb sequence 高於 manual；
 *   不同地區不受影響；覆蓋後再核可 → manual 重新 active
 * igdbId 96xxxx、slug 前綴 rep4-；每個測試用自己的 IP 字串（上限以 IP 雜湊計算）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "@/kernel/db/client";
import { coreEnvSchema, type CoreEnv } from "@/kernel/config/env";
import type { GameRecord } from "@/modules/catalog";
import { clearOldReporterIpHashes, getCalendarMonth, getGameDetail, getReportQueueItem, listReportQueue, resolveReport, submitReport } from "@/modules/catalog";
import type { GameDataProvider } from "@/modules/catalog/providers/game-data-provider.interface";
import { toGameRecord } from "@/modules/catalog/providers/igdb";
import { upsertPlatform } from "@/modules/catalog/repository/platforms";
import { dataReports, changeFeed, gamePlatforms, games, regions, releaseDateHistory, releaseEvents } from "@/modules/catalog/schema";
import { syncGames } from "@/modules/catalog/use-cases/sync/sync-games";

const enabled = !!process.env.TEST_DATABASE_URL;
const noLog = () => {};
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

function envWith(extra: Record<string, string | undefined> = {}): CoreEnv {
  return coreEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: "test",
    REPORT_MAX_PER_IP_PER_DAY: "5",
    TURNSTILE_SECRET_KEY: "test-secret",
    ...extra,
  });
}

/** 某遊戲在該月出現在哪些日子（有日期的卡片；undated 不算）。 */
const datesOf = (m: Awaited<ReturnType<typeof getCalendarMonth>>, slug: string) =>
  Object.entries(m.days)
    .filter(([, cards]) => cards.some((c) => c.slug === slug))
    .map(([date]) => date);

let ip = 0;
const nextIp = () => `198.51.100.${(ip += 1)}`;

describe.skipIf(!enabled)("資料更正回報（整合）", () => {
  const regionId: Record<string, number> = {};
  let ps5 = 0;
  let switchP = 0;
  let gameA = 0; // 單平台，igdb WW full 2037-05-10 sequence 3
  let gameB = 0;
  let releaseA = 0;

  beforeAll(async () => {
    const db = getDb();
    for (const r of await db.select().from(regions)) regionId[r.code] = r.id;
    ps5 = (await upsertPlatform({ igdbId: 960001, slug: "rep4-ps5", name: "Rep4 PS5", kind: "console" })).id;
    switchP = (await upsertPlatform({ igdbId: 960002, slug: "rep4-switch", name: "Rep4 Switch", kind: "hybrid" })).id;
    const [a] = await db.insert(games).values({ igdbId: 960101, slug: "rep4-game-a", name: "Rep4 Game A" }).returning({ id: games.id });
    const [b] = await db.insert(games).values({ igdbId: 960102, slug: "rep4-game-b", name: "Rep4 Game B" }).returning({ id: games.id });
    gameA = a.id;
    gameB = b.id;
    await db.insert(gamePlatforms).values([{ gameId: gameA, platformId: ps5 }, { gameId: gameB, platformId: ps5 }]);
    const [rel] = await db
      .insert(releaseEvents)
      .values({
        gameId: gameA, platformId: ps5, regionId: regionId.WW, releaseStage: "full", releaseDate: "2037-05-10", periodStart: "2037-05-10",
        precision: "day", status: "scheduled", source: "igdb", sequence: 3,
      })
      .returning({ id: releaseEvents.id });
    releaseA = rel.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  const missingTw = (extra: Record<string, unknown> = {}) => ({
    reportType: "missing_region_date",
    targetType: "game",
    targetId: gameA,
    sourceUrl: "https://example.com/tw-release",
    proposed: { platformId: ps5, regionCode: "TW", date: "2037-05-12", precision: "day" },
    ...extra,
  });
  const submit = (body: unknown, clientIp: string, deps: Parameters<typeof submitReport>[1] = {}) =>
    submitReport({ body, turnstileToken: "tok", clientIp }, { env: envWith(), verifyTurnstile: async () => ({ ok: true }), warn: noLog, ...deps });

  describe("submitReport", () => {
    it("寫入一筆 open 回報：IP 只存 64 位雜湊，不含原始 IP", async () => {
      const clientIp = nextIp();
      const res = await submit(missingTw(), clientIp);
      expect(res).toMatchObject({ ok: true, status: "open" });
      if (!res.ok) return;
      const [row] = await getDb().select().from(dataReports).where(eq(dataReports.id, res.id));
      expect(row).toMatchObject({
        targetType: "game", targetId: gameA, reportType: "missing_region_date", status: "open",
        sourceUrl: "https://example.com/tw-release", reporterUserId: null,
        proposed: { platformId: ps5, regionCode: "TW", date: "2037-05-12", precision: "day" },
      });
      expect(row.reporterIpHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(clientIp);
    });

    it("欄位驗證錯誤、目標不存在、提案的平台／地區／語言不存在 → validation_failed，不寫入", async () => {
      const db = getDb();
      const before = (await db.select({ id: dataReports.id }).from(dataReports)).length;
      const ipx = nextIp();
      expect(await submit(missingTw({ sourceUrl: undefined }), ipx)).toEqual({ ok: false, error: "validation_failed", fields: { sourceUrl: "required" } });
      expect(await submit(missingTw({ targetId: 99999999 }), ipx)).toMatchObject({ ok: false, fields: { targetId: "invalid" } });
      expect(await submit(missingTw({ proposed: { platformId: switchP, regionCode: "TW", date: "2037-05-12" } }), ipx)).toMatchObject({ ok: false, fields: { "proposed.platformId": "invalid" } });
      expect(await submit(missingTw({ proposed: { platformId: ps5, regionCode: "ZZ", date: "2037-05-12" } }), ipx)).toMatchObject({ ok: false, fields: { "proposed.regionCode": "invalid" } });
      expect(
        await submit({ reportType: "language_support", targetType: "game", targetId: gameA, proposed: { language: "xx-NOPE", supportType: "audio" } }, ipx),
      ).toMatchObject({ ok: false, fields: { "proposed.language": "invalid" } });
      expect(await submit({ reportType: "wrong_date", targetType: "release_event", targetId: 99999999, sourceUrl: "https://a.example", proposed: { date: "2037-01-01" } }, ipx)).toMatchObject({ ok: false, fields: { targetId: "invalid" } });
      expect((await db.select({ id: dataReports.id }).from(dataReports)).length).toBe(before);
    });

    it("每 IP 每日上限：超過 → rate_limited；其他 IP 不受影響；24 小時前的不算", async () => {
      const env = envWith({ REPORT_MAX_PER_IP_PER_DAY: "2" });
      const mine = nextIp();
      const body = { reportType: "other", targetType: "platform", targetId: ps5, note: "x" };
      expect(await submit(body, mine, { env })).toMatchObject({ ok: true });
      expect(await submit(body, mine, { env })).toMatchObject({ ok: true });
      expect(await submit(body, mine, { env })).toMatchObject({ ok: false, error: "rate_limited" });
      expect(await submit(body, nextIp(), { env })).toMatchObject({ ok: true });
      // 把這個 IP 的回報都改成 25 小時前 → 又可以送
      const later = new Date(Date.now() + 25 * 3600 * 1000);
      expect(await submit(body, mine, { env, now: () => later })).toMatchObject({ ok: true });
    });

    it("Turnstile：token 與 IP 傳給驗證；未通過 → captcha_failed；服務掛了 → captcha_unavailable；都不寫入", async () => {
      const db = getDb();
      const n = async () => (await db.select({ id: dataReports.id }).from(dataReports)).length;
      const before = await n();
      const body = { reportType: "other", targetType: "platform", targetId: ps5, note: "captcha" };
      const verify = vi.fn(async () => ({ ok: false as const, reason: "rejected" as const, codes: ["invalid-input-response"] }));
      const clientIp = nextIp();
      expect(await submitReport({ body, turnstileToken: "bad", clientIp }, { env: envWith(), verifyTurnstile: verify, warn: noLog })).toEqual({ ok: false, error: "captcha_failed" });
      expect(verify).toHaveBeenCalledWith("bad", expect.objectContaining({ secret: "test-secret", remoteIp: clientIp }));
      expect(await submitReport({ body, turnstileToken: "x", clientIp }, { env: envWith(), verifyTurnstile: async () => ({ ok: false, reason: "unavailable" }), warn: noLog })).toEqual({ ok: false, error: "captcha_unavailable" });
      expect(await n()).toBe(before);
    });

    it("設定缺漏：production 缺 Turnstile 金鑰或 IP 雜湊金鑰 → not_configured；非 production 缺金鑰 → 跳過驗證並 warn", async () => {
      const body = { reportType: "other", targetType: "platform", targetId: ps5, note: "cfg" };
      const prod = { NODE_ENV: "production", REPORT_IP_HASH_SECRET: "x".repeat(16) };
      expect(await submit(body, nextIp(), { env: envWith({ ...prod, TURNSTILE_SECRET_KEY: undefined }) })).toEqual({ ok: false, error: "not_configured", missing: "TURNSTILE_SECRET_KEY" });
      expect(await submit(body, nextIp(), { env: envWith({ NODE_ENV: "production" }) })).toEqual({ ok: false, error: "not_configured", missing: "REPORT_IP_HASH_SECRET" });
      expect(await submit(body, nextIp(), { env: envWith(prod) })).toMatchObject({ ok: true });
      const warn = vi.fn();
      const verify = vi.fn(async () => ({ ok: true as const }));
      expect(await submitReport({ body, turnstileToken: null, clientIp: nextIp() }, { env: envWith({ TURNSTILE_SECRET_KEY: undefined }), verifyTurnstile: verify, warn })).toMatchObject({ ok: true });
      expect(verify).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("TURNSTILE_SECRET_KEY"));
    });

    it("takedown：不需目標，通知站長（訊息不含備註）；通知失敗不影響結果；沒設網址就不通知", async () => {
      const alert = vi.fn(async () => true);
      const body = { reportType: "takedown", targetType: "game", note: "請下架 秘密備註內容" };
      const env = envWith({ ALERT_WEBHOOK_URL: "https://hooks.example/alert" });
      const res = await submit(body, nextIp(), { env, alert });
      expect(res).toMatchObject({ ok: true });
      expect(alert).toHaveBeenCalledTimes(1);
      const [url, message] = alert.mock.calls[0] as unknown as [string, string];
      expect(url).toBe("https://hooks.example/alert");
      expect(message).toContain("下架");
      expect(message).not.toContain("秘密備註內容");
      if (res.ok) {
        const [row] = await getDb().select().from(dataReports).where(eq(dataReports.id, res.id));
        expect(row).toMatchObject({ reportType: "takedown", targetId: null, status: "open" });
      }
      const boom = vi.fn(async () => {
        throw new Error("webhook down");
      });
      expect(await submit(body, nextIp(), { env, alert: boom })).toMatchObject({ ok: true });
      const none = vi.fn(async () => true);
      expect(await submit(body, nextIp(), { alert: none })).toMatchObject({ ok: true });
      expect(none).not.toHaveBeenCalled();
    });
  });

  it("clearOldReporterIpHashes：只清 90 天前建立的雜湊", async () => {
    const db = getDb();
    const day = 24 * 3600 * 1000;
    const rows = await db
      .insert(dataReports)
      .values([
        { targetType: "platform", targetId: ps5, reportType: "other", reporterIpHash: "a".repeat(64), createdAt: new Date(Date.now() - 91 * day) },
        { targetType: "platform", targetId: ps5, reportType: "other", reporterIpHash: "b".repeat(64), createdAt: new Date(Date.now() - 89 * day) },
        { targetType: "platform", targetId: ps5, reportType: "other", reporterIpHash: null, createdAt: new Date(Date.now() - 200 * day) },
      ])
      .returning({ id: dataReports.id });
    const cleared = await clearOldReporterIpHashes();
    expect(cleared).toBeGreaterThanOrEqual(1);
    const after = await db.select({ id: dataReports.id, h: dataReports.reporterIpHash }).from(dataReports).where(inArray(dataReports.id, rows.map((r) => r.id))).orderBy(asc(dataReports.id));
    expect(after.map((r) => r.h)).toEqual([null, "b".repeat(64), null]);
    // 再跑一次沒有新的可清（冪等）
    expect(await clearOldReporterIpHashes()).toBe(0);
  });

  async function report(body: unknown): Promise<number> {
    const res = await submit(body, nextIp());
    if (!res.ok) throw new Error(`送出失敗：${JSON.stringify(res)}`);
    return res.id;
  }
  const rowsOf = (gameId: number) =>
    getDb()
      .select({
        id: releaseEvents.id, region: regions.code, stage: releaseEvents.releaseStage, date: releaseEvents.releaseDate,
        precision: releaseEvents.precision, status: releaseEvents.status, source: releaseEvents.source,
        sourceStatus: releaseEvents.sourceStatus, sequence: releaseEvents.sequence,
      })
      .from(releaseEvents)
      .innerJoin(regions, eq(regions.id, releaseEvents.regionId))
      .where(eq(releaseEvents.gameId, gameId))
      .orderBy(asc(releaseEvents.id));

  describe("resolveReport", () => {
    it("核可 missing_region_date：manual 列（階段沿用、sequence > igdb）、change_feed、狀態；聚合顯示 manual 日期", async () => {
      const id = await report(missingTw());
      const item = await getReportQueueItem(id);
      expect(item?.plan).toMatchObject({ regionCode: "TW", stage: "full", releaseDate: "2037-05-12", status: "scheduled", replaces: null });
      expect(item?.target).toMatchObject({ name: "Rep4 Game A", gameSlug: "rep4-game-a" });

      const res = await resolveReport(id, "accept", "  已核對  ");
      expect(res).toMatchObject({ ok: true, report: { status: "accepted", resolutionNote: "已核對" }, applied: { result: "created", gameSlug: "rep4-game-a" } });
      if (!res.ok || !res.applied) return;
      expect(res.report.resolvedAt).not.toBeNull();

      const rows = await rowsOf(gameA);
      const manual = rows.find((r) => r.source === "manual")!;
      const igdb = rows.find((r) => r.source === "igdb")!;
      expect(manual).toMatchObject({ region: "TW", stage: "full", date: "2037-05-12", precision: "day", status: "scheduled", sourceStatus: "active" });
      expect(manual.sequence).toBeGreaterThan(igdb.sequence);
      expect(manual.sequence).toBe(4);
      expect(igdb).toMatchObject({ date: "2037-05-10", sequence: 3 }); // igdb 列原樣

      const feed = await getDb().select().from(changeFeed).where(and(eq(changeFeed.entityType, "release_event"), eq(changeFeed.entityId, manual.id)));
      expect(feed.map((f) => f.changeType)).toEqual(["created"]);

      const may = await getCalendarMonth({ year: 2037, month: 5, locale: "en", regionPref: "TW" });
      expect(datesOf(may, "rep4-game-a")).toEqual(["2037-05-12"]);
    });

    it("核可 wrong_date（igdb 列）：同鍵新增 manual 列、改期紀錄、date_changed、sequence > igdb、delayed", async () => {
      const id = await report({
        reportType: "wrong_date", targetType: "release_event", targetId: releaseA, sourceUrl: "https://example.com/delay",
        proposed: { date: "2037-08-01", precision: "month" },
      });
      const res = await resolveReport(id, "accept");
      expect(res).toMatchObject({ ok: true, applied: { result: "created" } });
      const rows = await rowsOf(gameA);
      const manual = rows.find((r) => r.source === "manual" && r.region === "WW")!;
      expect(manual).toMatchObject({ stage: "full", date: "2037-08-01", precision: "month", status: "delayed" });
      expect(manual.sequence).toBeGreaterThan(3);
      const hist = await getDb().select().from(releaseDateHistory).where(eq(releaseDateHistory.releaseEventId, manual.id));
      expect(hist).toEqual([expect.objectContaining({ oldDate: "2037-05-10", oldPrecision: "day", newDate: "2037-08-01", newPrecision: "month" })]);
      const feed = await getDb().select().from(changeFeed).where(and(eq(changeFeed.entityType, "release_event"), eq(changeFeed.entityId, manual.id)));
      expect(feed.map((f) => f.changeType).sort()).toEqual(["created", "date_changed"]);
      expect(rows.find((r) => r.source === "igdb")).toMatchObject({ date: "2037-05-10", sequence: 3 });

      // 第二次更正同一筆 → 更新既有 manual 列（不再新增），sequence +1，history 追加
      const id2 = await report({
        reportType: "wrong_date", targetType: "release_event", targetId: releaseA, sourceUrl: "https://example.com/again",
        proposed: { date: "2037-06-15", precision: "day" },
      });
      const res2 = await resolveReport(id2, "accept");
      expect(res2).toMatchObject({ ok: true, applied: { result: "updated", releaseEventId: manual.id } });
      const after = (await rowsOf(gameA)).find((r) => r.id === manual.id)!;
      expect(after).toMatchObject({ date: "2037-06-15", precision: "day", status: "scheduled" });
      expect(after.sequence).toBe(manual.sequence + 1);
      expect(await getDb().select().from(releaseDateHistory).where(eq(releaseDateHistory.releaseEventId, manual.id))).toHaveLength(2);
    });

    it("駁回／標重複只改狀態；已處理的不能再處理；找不到；備註太長", async () => {
      const before = await rowsOf(gameB);
      const id = await report(missingTw({ targetId: gameB }));
      expect(await resolveReport(id, "reject", "來源不可信")).toMatchObject({ ok: true, report: { status: "rejected", resolutionNote: "來源不可信" }, applied: null });
      expect(await resolveReport(id, "accept")).toEqual({ ok: false, error: "already_resolved" });
      const id2 = await report(missingTw({ targetId: gameB }));
      expect(await resolveReport(id2, "duplicate")).toMatchObject({ ok: true, report: { status: "duplicate" }, applied: null });
      expect(await rowsOf(gameB)).toEqual(before);
      expect(await resolveReport(99999999, "accept")).toEqual({ ok: false, error: "not_found" });
      const id3 = await report(missingTw({ targetId: gameB }));
      expect(await resolveReport(id3, "accept", "x".repeat(1001))).toEqual({ ok: false, error: "invalid_note" });
      expect((await getReportQueueItem(id3))?.report.status).toBe("open");
    });

    it("其他類型核可只改狀態與備註，不改資料", async () => {
      const before = await rowsOf(gameA);
      const id = await report({ reportType: "cancelled", targetType: "game", targetId: gameA, note: "聽說取消了" });
      expect(await resolveReport(id, "accept", "已手動處理")).toMatchObject({ ok: true, report: { status: "accepted", resolutionNote: "已手動處理" }, applied: null });
      expect(await rowsOf(gameA)).toEqual(before);
      const tk = await report({ reportType: "takedown", targetType: "game", note: "t" });
      expect(await resolveReport(tk, "accept", "已下架")).toMatchObject({ ok: true, report: { status: "accepted", resolutionNote: "已下架" } });
    });

    it("目標在回報後被刪除 → cannot_apply，回報維持 open、沒有任何寫入", async () => {
      const db = getDb();
      const [g] = await db.insert(games).values({ igdbId: 960103, slug: "rep4-game-c", name: "Rep4 Game C" }).returning({ id: games.id });
      await db.insert(gamePlatforms).values({ gameId: g.id, platformId: ps5 });
      const id = await report(missingTw({ targetId: g.id }));
      await db.delete(games).where(eq(games.id, g.id));
      expect(await resolveReport(id, "accept")).toEqual({ ok: false, error: "cannot_apply", detail: "target_missing" });
      expect((await getReportQueueItem(id))?.report.status).toBe("open");
    });

    it("審核佇列：open 依建立時間舊到新，附同目標的其他回報", async () => {
      const a = await report({ reportType: "other", targetType: "event", targetId: await anyEventId(), note: "一" });
      const b = await report({ reportType: "other", targetType: "event", targetId: await anyEventId(), note: "二" });
      const { items, counts } = await listReportQueue({ status: "open", limit: 200 });
      const ids = items.map((i) => i.report.id);
      expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b));
      expect(items.find((i) => i.report.id === a)?.others.map((o) => o.id)).toContain(b);
      expect(counts.open).toBeGreaterThanOrEqual(2);
    });
  });

  describe("同步與人工更正（使用者 2026-10-15：IGDB 日期更新覆蓋人工更正）", () => {
    const PS = 960167;
    type Rel = { date?: number; date_format: number; platform: number; release_region: number; status?: number };
    const raw = (id: number, slug: string, releases: Rel[]) => ({
      id, name: `Rep4 ${slug}`, slug, game_type: 0, updated_at: ts("2037-01-01"), platforms: [PS], release_dates: releases,
    });
    const provider = (r: () => ReturnType<typeof raw>): GameDataProvider => ({
      sourceName: "fake",
      fetchPlatforms: async () => [],
      fetchEvents: async () => [],
      fetchGames: async (q: { afterId?: number; limit: number }) =>
        [toGameRecord(r())].filter((g: GameRecord) => q.afterId === undefined || g.igdbId > q.afterId).slice(0, q.limit),
    });
    const sync = (r: () => ReturnType<typeof raw>, at: string) => syncGames(provider(r), { startedAt: new Date(at), log: noLog });
    // IGDB release_region：8＝WW、5＝JP；status 6＝Full Release（階段 full）
    const rel = (region: number, date: string): Rel => ({ date: ts(date), date_format: 0, platform: PS, release_region: region, status: 6 });
    const WW = 8;
    const JP = 5;
    const feedOf = (eventId: number) =>
      getDb().select().from(changeFeed).where(and(eq(changeFeed.entityType, "release_event"), eq(changeFeed.entityId, eventId))).orderBy(asc(changeFeed.id));
    const june = (pref: string) => getCalendarMonth({ year: 2037, month: 6, locale: "en", regionPref: pref });

    let psId = 0;
    /** 建立遊戲（第一輪同步）並回傳 id。 */
    async function setup(id: number, slug: string, releases: Rel[]): Promise<number> {
      psId = (await upsertPlatform({ igdbId: PS, slug: "rep4-sync-ps", name: "Rep4 Sync PS", kind: "console" })).id;
      await sync(() => raw(id, slug, releases), "2037-01-01T00:00:00Z");
      const [g] = await getDb().select().from(games).where(eq(games.igdbId, id));
      return g.id;
    }
    /** 核可一筆 wrong_date（目標＝該遊戲該地區的 igdb 列）。 */
    async function correctDate(gameId: number, region: string, date: string): Promise<void> {
      const igdb = (await rowsOf(gameId)).find((r) => r.source === "igdb" && r.region === region)!;
      const id = await report({
        reportType: "wrong_date", targetType: "release_event", targetId: igdb.id, sourceUrl: "https://example.com/fix",
        proposed: { date, precision: "day" },
      });
      expect(await resolveReport(id, "accept")).toMatchObject({ ok: true });
    }

    it("(a) igdb 只有 status 變動、別的鍵變動、或 igdb 列被標 removed → manual 列不變、仍 active", async () => {
      const g = await setup(960201, "rep4-sync-a", [rel(WW, "2037-06-10"), rel(JP, "2037-06-15")]);
      await correctDate(g, "WW", "2037-06-12");
      const manualBefore = (await rowsOf(g)).find((r) => r.source === "manual")!;
      expect(manualBefore).toMatchObject({ region: "WW", date: "2037-06-12", sourceStatus: "active" });

      // 日期不變，但「今天」已過 igdb WW 的 06-10 → igdb 只有 status scheduled→released
      await sync(() => raw(960201, "rep4-sync-a", [rel(WW, "2037-06-10"), rel(JP, "2037-06-15")]), "2037-06-11T00:00:00Z");
      let rows = await rowsOf(g);
      expect(rows.find((r) => r.source === "igdb" && r.region === "WW")).toMatchObject({ status: "released", date: "2037-06-10" });
      expect(rows.find((r) => r.source === "manual")).toEqual(manualBefore);

      // 別的鍵（JP）日期變動 → WW manual 不變
      await sync(() => raw(960201, "rep4-sync-a", [rel(WW, "2037-06-10"), rel(JP, "2037-06-18")]), "2037-06-11T01:00:00Z");
      rows = await rowsOf(g);
      expect(rows.find((r) => r.source === "igdb" && r.region === "JP")).toMatchObject({ date: "2037-06-18" });
      expect(rows.find((r) => r.source === "manual")).toEqual(manualBefore);

      // 來源拿掉 WW 上市日 → igdb WW 標 removed，manual 仍 active
      await sync(() => raw(960201, "rep4-sync-a", [rel(JP, "2037-06-18")]), "2037-06-11T02:00:00Z");
      rows = await rowsOf(g);
      expect(rows.find((r) => r.source === "igdb" && r.region === "WW")).toMatchObject({ sourceStatus: "removed" });
      expect(rows.find((r) => r.source === "manual")).toEqual(manualBefore);
      expect((await feedOf(manualBefore.id)).map((f) => f.changeType)).toEqual(["created", "date_changed"]);

      // 聚合：偏好 WW 仍以 manual 日期為準
      expect(datesOf(await june("WW"), "rep4-sync-a")).toContain("2037-06-12");
    });

    it("(b) igdb 同鍵日期變動 → manual removed、igdb sequence > manual 原值、聚合與詳情顯示 igdb 新日期、change_feed 有紀錄", async () => {
      const g = await setup(960202, "rep4-sync-b", [rel(WW, "2037-06-10")]);
      await correctDate(g, "WW", "2037-06-12");
      const before = await rowsOf(g);
      const manualBefore = before.find((r) => r.source === "manual")!;
      const igdbBefore = before.find((r) => r.source === "igdb")!;
      expect(datesOf(await june("WW"), "rep4-sync-b")).toEqual(["2037-06-12"]);

      await sync(() => raw(960202, "rep4-sync-b", [rel(WW, "2037-06-20")]), "2037-01-02T00:00:00Z");
      const rows = await rowsOf(g);
      const manual = rows.find((r) => r.source === "manual")!;
      const igdb = rows.find((r) => r.source === "igdb")!;
      expect(manual).toMatchObject({ sourceStatus: "removed", date: "2037-06-12", sequence: manualBefore.sequence });
      expect(igdb).toMatchObject({ sourceStatus: "active", date: "2037-06-20" });
      expect(igdb.sequence).toBeGreaterThan(manualBefore.sequence);
      expect(igdb.sequence).toBeGreaterThan(igdbBefore.sequence);

      const feed = await feedOf(manual.id);
      expect(feed.at(-1)).toMatchObject({ changeType: "removed", payload: { reason: "superseded_by_igdb", igdbEventId: igdb.id } });
      for (const pref of ["WW", "TW"]) expect(datesOf(await june(pref), "rep4-sync-b"), pref).toEqual(["2037-06-20"]);

      // 詳情頁：只列 igdb 新日期，manual（removed）不列
      const d = await getGameDetail({ slug: "rep4-sync-b", locale: "en" });
      const listed = d!.releaseGroups.flatMap((x) => x.releases);
      expect(listed.map((r) => [r.source, r.date])).toEqual([["igdb", "2037-06-20"]]);

      // 再次同步同樣內容 → 沒有任何變動（不重複覆蓋、sequence 不再增加）
      await sync(() => raw(960202, "rep4-sync-b", [rel(WW, "2037-06-20")]), "2037-01-02T01:00:00Z");
      expect(await rowsOf(g)).toEqual(rows);
    });

    it("(c) igdb 新建同鍵列 → manual removed、igdb sequence > manual、聚合顯示 igdb 日期", async () => {
      const g = await setup(960203, "rep4-sync-c", [rel(WW, "2037-06-10")]);
      const id = await report({
        reportType: "missing_region_date", targetType: "game", targetId: g, sourceUrl: "https://example.com/jp",
        proposed: { platformId: psId, regionCode: "JP", date: "2037-06-12", precision: "day" },
      });
      expect(await resolveReport(id, "accept")).toMatchObject({ ok: true, applied: { result: "created" } });
      const manualBefore = (await rowsOf(g)).find((r) => r.source === "manual")!;
      expect(manualBefore).toMatchObject({ region: "JP", stage: "full", date: "2037-06-12", sourceStatus: "active" });
      expect(datesOf(await june("JP"), "rep4-sync-c")).toEqual(["2037-06-12"]);

      await sync(() => raw(960203, "rep4-sync-c", [rel(WW, "2037-06-10"), rel(JP, "2037-06-14")]), "2037-01-02T00:00:00Z");
      const rows = await rowsOf(g);
      const manual = rows.find((r) => r.source === "manual")!;
      const igdbJp = rows.find((r) => r.source === "igdb" && r.region === "JP")!;
      expect(manual).toMatchObject({ sourceStatus: "removed", sequence: manualBefore.sequence });
      expect(igdbJp).toMatchObject({ date: "2037-06-14", sourceStatus: "active" });
      expect(igdbJp.sequence).toBeGreaterThan(manualBefore.sequence);
      expect((await feedOf(manual.id)).at(-1)).toMatchObject({ changeType: "removed", payload: { reason: "superseded_by_igdb" } });
      expect(datesOf(await june("JP"), "rep4-sync-c")).toEqual(["2037-06-14"]);
    });

    it("(d) TW manual ＋ WW igdb 日期變動 → TW manual 不變，偏好 TW 仍顯示 manual", async () => {
      const g = await setup(960204, "rep4-sync-d", [rel(WW, "2037-06-10")]);
      const id = await report({
        reportType: "missing_region_date", targetType: "game", targetId: g, sourceUrl: "https://example.com/tw",
        proposed: { platformId: psId, regionCode: "TW", date: "2037-06-12", precision: "day" },
      });
      expect(await resolveReport(id, "accept")).toMatchObject({ ok: true });
      const manualBefore = (await rowsOf(g)).find((r) => r.source === "manual")!;

      await sync(() => raw(960204, "rep4-sync-d", [rel(WW, "2037-06-20")]), "2037-01-02T00:00:00Z");
      const rows = await rowsOf(g);
      expect(rows.find((r) => r.source === "igdb")).toMatchObject({ date: "2037-06-20" });
      expect(rows.find((r) => r.source === "manual")).toEqual(manualBefore);
      expect(datesOf(await june("TW"), "rep4-sync-d")).toEqual(["2037-06-12"]);
      // 聚合 manual 優先於 igdb（不論地區）：TW manual 仍 active，偏好 WW 也挑 manual；igdb WW 的新日期在詳情頁與 iCal 之外不單獨出現
      expect(datesOf(await june("WW"), "rep4-sync-d")).toEqual(["2037-06-12"]);
    });

    it("(e) 覆蓋後再核可同鍵回報 → manual 重新 active、sequence 再遞增並高於 igdb，詳情頁又隱藏 igdb 列", async () => {
      const g = await setup(960205, "rep4-sync-e", [rel(WW, "2037-06-10")]);
      await correctDate(g, "WW", "2037-06-12");
      await sync(() => raw(960205, "rep4-sync-e", [rel(WW, "2037-06-20")]), "2037-01-02T00:00:00Z");
      const overridden = await rowsOf(g);
      const manualOld = overridden.find((r) => r.source === "manual")!;
      const igdb = overridden.find((r) => r.source === "igdb")!;
      expect(manualOld.sourceStatus).toBe("removed");

      await correctDate(g, "WW", "2037-06-25");
      const rows = await rowsOf(g);
      const manual = rows.find((r) => r.source === "manual")!;
      expect(rows.filter((r) => r.source === "manual")).toHaveLength(1); // 沿用同一列
      expect(manual).toMatchObject({ id: manualOld.id, sourceStatus: "active", date: "2037-06-25" });
      expect(manual.sequence).toBeGreaterThan(manualOld.sequence);
      expect(manual.sequence).toBeGreaterThan(igdb.sequence);
      expect((await feedOf(manual.id)).map((f) => f.changeType)).toContain("restored");
      expect(datesOf(await june("WW"), "rep4-sync-e")).toEqual(["2037-06-25"]);
      const d = await getGameDetail({ slug: "rep4-sync-e", locale: "en" });
      expect(d!.releaseGroups.flatMap((x) => x.releases).map((r) => [r.source, r.date])).toEqual([["manual", "2037-06-25"]]);
    });
  });
});

async function anyEventId(): Promise<number> {
  const { events } = await import("@/modules/catalog/schema");
  const db = getDb();
  const existing = await db.select({ id: events.id }).from(events).limit(1);
  if (existing[0]) return existing[0].id;
  const [e] = await db.insert(events).values({ slug: "rep4-event", name: "Rep4 Event", kind: "other" }).returning({ id: events.id });
  return e.id;
}
