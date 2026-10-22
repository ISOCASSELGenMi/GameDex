/**
 * Phase 7 第 6 波（單元）：追蹤與私人 iCal 的純函式、擴充點收集、顯示規則、遷移檔與 Caddy 設定。
 * 資料面（API、排程、ETag、內容規則）在 test/integration/follows-6.test.ts。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@sok/i18n";
import {
  FOLLOW_COUNT_MIN_DISPLAY_DEFAULT,
  FOLLOW_TARGET_TYPES,
  displayFollowerCount,
  followingFeedKey,
  getCatalogExtensions,
  parseMineListValue,
  resolveFollowCountMinDisplay,
  resolveMineGameIds,
  setCatalogExtensions,
  type ReleaseCard,
} from "@/modules/catalog";
import { pickNextRelease } from "@/modules/catalog/use-cases/read/get-my-games";
import { generateIcs } from "@/modules/catalog/use-cases/ical";
import {
  FEED_CREATE_LIMIT_PER_HOUR,
  FEED_REVOKED_EMPTY_DAYS,
  FEED_TOKEN_PATTERN,
  FOLLOW_MAX_PER_DAY_DEFAULT,
  FOLLOW_STATE_TARGETS_MAX,
  FOLLOW_TARGETS,
  isFollowTarget,
  parseFollowPath,
  parseStateTargets,
  resolveFollowMaxPerDay,
  revokedFeedState,
  tokenFromIcsFile,
  validateFeedPatch,
} from "@/modules/accounts/domain/entities";
import { generateFeedToken, hashFeedToken } from "@/modules/accounts/use-cases/calendar-feeds";
import { isMineValue } from "@/modules/accounts/use-cases/catalog-extensions";
import { parseMineParam } from "@/modules/accounts/use-cases/my-games";
import { accountsModule } from "@/modules/accounts";
import { collectCatalogExtensions, enabledModules } from "@/modules/registry";
import { parseIcs } from "../helpers/ics";

describe("追蹤目標", () => {
  it("accounts 的 FOLLOW_TARGETS 與 catalog 的 FOLLOW_TARGET_TYPES 一致（兩邊各自定義，不能 import 彼此的 domain）", () => {
    expect([...FOLLOW_TARGETS]).toEqual([...FOLLOW_TARGET_TYPES]);
    expect(isFollowTarget("game")).toBe(true);
    expect(isFollowTarget("user")).toBe(false);
  });

  it("parseFollowPath：種類與正整數 id", () => {
    expect(parseFollowPath("game", "12")).toEqual({ targetType: "game", targetId: 12 });
    expect(parseFollowPath("company", "2147483647")).toEqual({ targetType: "company", targetId: 2147483647 });
    for (const [t, i] of [["game", "0"], ["game", "-1"], ["game", "1.5"], ["game", "abc"], ["game", "2147483648"], ["game", ""], ["x", "1"]]) {
      expect(parseFollowPath(t!, i!)).toBeNull();
    }
  });

  it("parseStateTargets：去重、保留順序、格式與上限", () => {
    expect(parseStateTargets("game:1, event:2,game:1")).toEqual({
      ok: true,
      value: [{ targetType: "game", targetId: 1 }, { targetType: "event", targetId: 2 }],
    });
    expect(parseStateTargets(null)).toEqual({ ok: false, fields: { targets: "required" } });
    expect(parseStateTargets(" , ")).toEqual({ ok: false, fields: { targets: "required" } });
    expect(parseStateTargets("game")).toEqual({ ok: false, fields: { targets: "invalid" } });
    expect(parseStateTargets("game:1:2")).toEqual({ ok: false, fields: { targets: "invalid" } });
    const many = Array.from({ length: FOLLOW_STATE_TARGETS_MAX + 1 }, (_, i) => `game:${i + 1}`).join(",");
    expect(parseStateTargets(many)).toEqual({ ok: false, fields: { targets: "too_many" } });
  });

  it("FOLLOW_MAX_PER_DAY：正整數，其餘用預設 200", () => {
    expect(resolveFollowMaxPerDay(undefined)).toBe(FOLLOW_MAX_PER_DAY_DEFAULT);
    expect(FOLLOW_MAX_PER_DAY_DEFAULT).toBe(200);
    expect(resolveFollowMaxPerDay("50")).toBe(50);
    for (const bad of ["", "0", "-3", "1.5", "abc"]) expect(resolveFollowMaxPerDay(bad)).toBe(200);
  });

  it("人數顯示門檻（D48）：低於 FOLLOW_COUNT_MIN_DISPLAY 為 null；預設 10", () => {
    expect(FOLLOW_COUNT_MIN_DISPLAY_DEFAULT).toBe(10);
    expect(resolveFollowCountMinDisplay(undefined)).toBe(10);
    expect(resolveFollowCountMinDisplay("25")).toBe(25);
    expect(resolveFollowCountMinDisplay("0")).toBe(10);
    expect(displayFollowerCount(9, 10)).toBeNull();
    expect(displayFollowerCount(10, 10)).toBe(10);
    expect(displayFollowerCount(0, 1)).toBeNull();
  });
});

describe("私人 iCal：token 與驗證", () => {
  it("token：256-bit、base64url 43 字元、每次不同；雜湊是 SHA-256 hex", () => {
    const a = generateFeedToken();
    const b = generateFeedToken();
    expect(a).toMatch(FEED_TOKEN_PATTERN);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(hashFeedToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFeedToken(a)).toBe(hashFeedToken(a));
    expect(hashFeedToken(a)).not.toBe(hashFeedToken(b));
  });

  it("tokenFromIcsFile：只接受 {43 字元}.ics", () => {
    const t = generateFeedToken();
    expect(tokenFromIcsFile(`${t}.ics`)).toBe(t);
    expect(tokenFromIcsFile(`${t}.ICS`)).toBe(t);
    for (const bad of [t, `${t}.txt`, `${t.slice(1)}.ics`, `${t}x.ics`, ".ics", "../x.ics", `${t.slice(1)}/.ics`]) expect(tokenFromIcsFile(bad)).toBeNull();
  });

  it("撤銷後：30 天內空 ics、之後 410（邊界含第 30 天）", () => {
    expect(FEED_REVOKED_EMPTY_DAYS).toBe(30);
    expect(FEED_CREATE_LIMIT_PER_HOUR).toBe(10);
    const revoked = new Date("2030-01-01T00:00:00Z");
    expect(revokedFeedState(revoked, new Date("2030-01-01T00:00:01Z"))).toBe("empty");
    expect(revokedFeedState(revoked, new Date("2030-01-31T00:00:00Z"))).toBe("empty");
    expect(revokedFeedState(revoked, new Date("2030-01-31T00:00:01Z"))).toBe("gone");
  });

  const deps = { isSupportedLocale: (v: string) => ["zh-Hant", "en", "ja"].includes(v), isKnownStage: (v: string) => ["full", "early_access"].includes(v) };
  it("validateFeedPatch：欄位、去重、上限、至少一個欄位", () => {
    expect(validateFeedPatch({ name: " 我的 ", locale: "ja", filterPlatforms: [1, 1, 2], includeEvents: false }, deps)).toEqual({
      ok: true,
      value: { name: "我的", locale: "ja", filterPlatforms: [1, 2], includeEvents: false },
    });
    expect(validateFeedPatch({}, deps)).toEqual({ ok: false, fields: { body: "empty" } });
    expect(validateFeedPatch(null, deps)).toEqual({ ok: false, fields: { body: "invalid" } });
    expect(validateFeedPatch({ locale: "fr" }, deps)).toEqual({ ok: false, fields: { locale: "invalid" } });
    expect(validateFeedPatch({ filterStages: ["full", "x"] }, deps)).toEqual({ ok: false, fields: { filterStages: "invalid" } });
    expect(validateFeedPatch({ filterGenres: ["RPG"] }, deps)).toEqual({ ok: false, fields: { filterGenres: "invalid" } });
    expect(validateFeedPatch({ filterRegions: [0] }, deps)).toEqual({ ok: false, fields: { filterRegions: "invalid" } });
    expect(validateFeedPatch({ includeReleases: 1 }, deps)).toEqual({ ok: false, fields: { includeReleases: "invalid" } });
    expect(validateFeedPatch({ name: "   " }, deps)).toEqual({ ok: false, fields: { name: "required" } });
  });

  it("followingFeedKey：集合與設定相同則相同（與順序、重複無關），任何一項不同就不同", () => {
    const base = {
      follows: { gameIds: [3, 1, 2], eventIds: [], platformIds: [], franchiseIds: [], companyIds: [] },
      filters: { platformIds: [], regionCodes: [], genreSlugs: [], stages: [] },
      includeReleases: true,
      includeEvents: true,
    };
    const k = followingFeedKey(base);
    expect(followingFeedKey({ ...base, follows: { ...base.follows, gameIds: [1, 2, 3, 3] } })).toBe(k);
    expect(followingFeedKey({ ...base, follows: { ...base.follows, gameIds: [1, 2, 4] } })).not.toBe(k);
    expect(followingFeedKey({ ...base, follows: { ...base.follows, eventIds: [1] } })).not.toBe(k);
    expect(followingFeedKey({ ...base, filters: { ...base.filters, stages: ["full"] } })).not.toBe(k);
    expect(followingFeedKey({ ...base, includeEvents: false })).not.toBe(k);
  });

  it("generateIcs：following 種類用使用者設定的日曆名稱；說明文字三語都有字典", () => {
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      const t = createTranslator(locale);
      expect(t.has("ical.calendarName.following")).toBe(true);
      expect(t.has("ical.calendarDescription.following")).toBe(true);
      const text = generateIcs({
        locale,
        feed: { kind: "following", calendarName: "My Calendar" },
        releases: [],
        events: [],
        uidDomain: "sok.example",
        links: { game: () => null, event: () => null },
      });
      const cal = parseIcs(text).calendar;
      expect(cal.find((p) => p.name === "X-WR-CALNAME")?.value).toBe("My Calendar");
      expect(cal.find((p) => p.name === "X-WR-CALDESC")?.value).toBe(t.t("ical.calendarDescription.following"));
    }
  });
});

describe("我的遊戲", () => {
  it("parseMineParam／isMineValue：followed｜owned｜collected｜list:<id>，逗號組合、去重、上限", () => {
    expect(parseMineParam("followed")).toEqual(["followed"]);
    expect(parseMineParam("followed, owned,followed,list:3")).toEqual(["followed", "owned", "list:3"]);
    for (const bad of [null, "", " , ", "all", "list:", "list:0", "list:x", "followed,all"]) expect(parseMineParam(bad)).toBeNull();
    expect(parseMineParam(Array.from({ length: 21 }, (_, i) => `list:${i + 1}`).join(","))).toBeNull();
    expect(isMineValue("collected")).toBe(true);
    expect(parseMineListValue("list:12")).toBe(12);
    expect(parseMineListValue("list:12x")).toBeNull();
  });

  const card = (over: Partial<ReleaseCard>): ReleaseCard =>
    ({
      gameId: 1, slug: "g", name: "g", originalName: "g", cover: null, date: "2030-06-10", periodStart: null, precision: "day",
      stage: "full", status: "scheduled", sourceStatus: "active", platforms: [], popularityScore: 0, heatLevel: 0, gameType: "main_game",
      gameStatus: null, releaseEventIds: [], hasDateHistory: false, ...over,
    }) as ReleaseCard;

  it("pickNextRelease：未來最早 → 日期未定 → 過去最近；month 精度以月底判斷", () => {
    const today = "2030-06-15";
    const past = card({ date: "2030-05-01" });
    const nearPast = card({ date: "2030-06-14" });
    const soon = card({ date: "2030-06-20" });
    const later = card({ date: "2030-09-01" });
    const tbd = card({ date: null, precision: "tbd" });
    expect(pickNextRelease([later, soon, past], today)).toMatchObject({ card: soon, relation: "upcoming" });
    expect(pickNextRelease([past, tbd, nearPast], today)).toMatchObject({ card: tbd, relation: "tbd" });
    expect(pickNextRelease([past, nearPast], today)).toMatchObject({ card: nearPast, relation: "past" });
    expect(pickNextRelease([], today)).toBeNull();
    // month 精度：代表日是 1 日，但整個 6 月都還沒結束 → upcoming
    expect(pickNextRelease([card({ date: "2030-06-01", precision: "month" })], today)?.relation).toBe("upcoming");
    expect(pickNextRelease([card({ date: "2030-05-01", precision: "month" })], today)?.relation).toBe("past");
  });
});

describe("擴充點收集（registry）", () => {
  it("accounts 啟用 → 提供 site_follows、site_follows_7d 與 mine 篩選；停用 → 空（與沒有擴充點時相同）", () => {
    const on = collectCatalogExtensions(enabledModules({ MODULES: "accounts" }));
    expect(on.popularitySignals.map((s) => s.name)).toEqual(["site_follows", "site_follows_7d"]);
    expect(on.gameFilters.map((f) => f.dimension)).toEqual(["mine"]);
    expect(accountsModule.popularitySignals).toHaveLength(2);
    expect(collectCatalogExtensions(enabledModules({ MODULES: "none" }))).toEqual({ popularitySignals: [], gameFilters: [], ratingColumns: [] });
  });

  it("catalog 的執行期擴充點：沒注入＝空；mine 值沒有提供者處理 → null", async () => {
    setCatalogExtensions({});
    expect(getCatalogExtensions()).toEqual({ popularitySignals: [], gameFilters: [], ratingColumns: [] });
    expect(await resolveMineGameIds(1, "followed")).toBeNull();
    setCatalogExtensions({
      gameFilters: [{ dimension: "mine", handles: (v) => v === "followed", resolve: async () => [7, 8] }],
    });
    expect(await resolveMineGameIds(1, "followed")).toEqual([7, 8]);
    expect(await resolveMineGameIds(1, "owned")).toBeNull();
    setCatalogExtensions({});
  });
});

describe("遷移與營運設定", () => {
  const root = path.resolve(__dirname, "../..");
  it("migration 0010：follows 複合主鍵＋byTarget 索引；calendar_feeds token_hash 唯一、每人最多一個有效 following feed（partial unique）", () => {
    const sql = readFileSync(path.join(root, "drizzle/0010_whole_fenris.sql"), "utf8");
    expect(sql).toMatch(/CREATE TYPE "public"\."follow_target" AS ENUM\('game', 'event', 'platform', 'franchise', 'company'\)/);
    expect(sql).toMatch(/PRIMARY KEY\("user_id","target_type","target_id"\)/);
    expect(sql).toMatch(/CREATE INDEX "follows_by_target_idx" ON "follows" USING btree \("target_type","target_id"\)/);
    expect(sql).toMatch(/CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE\("token_hash"\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "calendar_feeds_following_active_uq" ON "calendar_feeds" USING btree \("user_id"\) WHERE .*'following' AND .*"revoked_at" IS NULL/);
    expect(sql).toMatch(/"user_id" integer NOT NULL/);
  });

  it("Caddy：/ical/u/* 不寫 access log（網址本身就是密碼）", () => {
    const caddy = readFileSync(path.resolve(root, "../../infra/Caddyfile"), "utf8");
    expect(caddy).toMatch(/@icalu path \/ical\/u\/\*/);
    expect(caddy).toMatch(/log_skip @icalu/);
  });

  it("accounts 的 manifest 帶新任務與兩張新表", () => {
    expect(accountsModule.ownedTables).toEqual(expect.arrayContaining(["follows", "calendar_feeds"]));
    const job = accountsModule.jobs?.find((j) => j.name === "cleanup_orphan_follows");
    expect(job?.cron).toBe("47 3 * * *");
  });
});
