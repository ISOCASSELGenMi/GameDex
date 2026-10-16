/**
 * Phase 5 iCal（單元）：產生函式（精度表、DTEND 排他、tbd／取消、UID 與語系無關、位元組相同、SEQUENCE、活動時間）、
 * ETag 公式、If-None-Match、原型驗證情境、字典與「程式碼不寫死中文」。
 * 視窗、60 天改期、30 天過渡期與 SEQUENCE 總和的資料面測試在 test/integration/ical-5.test.ts。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator, formatReleaseLabel } from "@sok/i18n";
import type { IcalEventItem, IcalReleaseItem } from "@/modules/catalog";
import { icalFeedPath } from "@/modules/catalog/ui/links";
import { slugFromIcsFile } from "@/modules/catalog/api/ical";
import {
  ICAL_FALLBACK_UID_DOMAIN,
  ICAL_FORMAT_VERSION,
  ICAL_REFRESH_SECONDS,
  PROTO_FEEDS,
  PROTO_STEPS,
  applyProtoStep,
  computeIcalEtag,
  eventUid,
  generateIcs,
  icalUidDomain,
  ifNoneMatchHits,
  parseProtoState,
  releaseUid,
  renderProtoFeed,
  type IcalGenerateInput,
} from "@/modules/catalog/use-cases/ical";
import { dateValue, eventByUid, parseIcs } from "../helpers/ics";

const DOMAIN = "sok.example";
const LINKS = { game: (s: string) => `https://sok.example/zh-Hant/games/${s}`, event: (s: string) => `https://sok.example/zh-Hant/events/${s}` };
const T0 = new Date("2026-10-01T10:00:00Z");

function rel(over: Partial<IcalReleaseItem> = {}): IcalReleaseItem {
  return {
    gameId: 1,
    gameSlug: "game-one",
    gameName: "Game One",
    platformId: 5,
    platformName: "PlayStation 5",
    platformAbbreviation: "PS5",
    stage: "full",
    regionCode: "WW",
    date: "2027-04-02",
    precision: "day",
    status: "scheduled",
    sequence: 0,
    updatedAt: T0,
    lastKnownDate: null,
    lastKnownPrecision: null,
    ...over,
  };
}

function evt(over: Partial<IcalEventItem> = {}): IcalEventItem {
  return {
    id: 7,
    slug: "summer-showcase",
    name: "Summer Showcase",
    kind: "showcase",
    description: null,
    startTime: new Date("2027-06-08T17:00:00Z"),
    endTime: null,
    url: null,
    streamUrl: null,
    organizer: null,
    sequence: 0,
    updatedAt: T0,
    ...over,
  };
}

function gen(releases: IcalReleaseItem[], over: Partial<IcalGenerateInput> = {}, events: IcalEventItem[] = []): string {
  return generateIcs({ locale: "zh-Hant", feed: { kind: "releases" }, releases, events, uidDomain: DOMAIN, links: LINKS, ...over });
}

const uidOf = (r: IcalReleaseItem) => releaseUid(r, DOMAIN);
const firstEvent = (ics: string) => parseIcs(ics).events[0];

describe("UID", () => {
  it("上市＝release-g{gameId}-p{platformId}-s{stage}@{網域}；活動＝event-{id}@{網域}", () => {
    expect(releaseUid({ gameId: 12, platformId: 34, stage: "early_access" }, "a.b")).toBe("release-g12-p34-searly_access@a.b");
    expect(eventUid(9, "a.b")).toBe("event-9@a.b");
  });

  it("網域取自 NEXT_PUBLIC_SITE_URL 的 host；沒設或不合法用固定 fallback", () => {
    expect(icalUidDomain("https://sok-studio.com")).toBe("sok-studio.com");
    expect(icalUidDomain("https://sok-studio.com/path?x=1")).toBe("sok-studio.com");
    expect(icalUidDomain("http://localhost:3000")).toBe("localhost:3000");
    expect(icalUidDomain(undefined)).toBe(ICAL_FALLBACK_UID_DOMAIN);
    expect(icalUidDomain("  ")).toBe(ICAL_FALLBACK_UID_DOMAIN);
    expect(icalUidDomain("not a url")).toBe(ICAL_FALLBACK_UID_DOMAIN);
    expect(ICAL_FALLBACK_UID_DOMAIN).toBe("sok.local");
  });

  it("同一組 (遊戲, 平台, 階段) 的 UID 不隨日期、標題、地區、語系改變", () => {
    const a = rel();
    const b = rel({ date: "2027-09-09", gameName: "改名", regionCode: "JP", status: "delayed", sequence: 4 });
    expect(uidOf(a)).toBe(uidOf(b));
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      expect(firstEvent(gen([a], { locale })).get("UID")).toBe(uidOf(a));
    }
  });

  it("不同平台、不同階段是不同 UID", () => {
    const uids = new Set([rel(), rel({ platformId: 6 }), rel({ stage: "early_access" })].map(uidOf));
    expect(uids.size).toBe(3);
  });
});

describe("精度 → 事件（08 §日期精度）", () => {
  it("day：單日全天，DTEND 為隔天（排他）", () => {
    const ev = firstEvent(gen([rel({ date: "2027-04-02" })]));
    expect(dateValue(ev, "DTSTART")).toBe("2027-04-02");
    expect(dateValue(ev, "DTEND")).toBe("2027-04-03");
    expect(ev.get("SUMMARY")).toBe("Game One（PS5）");
    expect(ev.get("STATUS")).toBeUndefined();
  });

  it("day：月底、年底的 DTEND 正確進位", () => {
    expect(dateValue(firstEvent(gen([rel({ date: "2027-02-28" })])), "DTEND")).toBe("2027-03-01");
    expect(dateValue(firstEvent(gen([rel({ date: "2027-12-31" })])), "DTEND")).toBe("2028-01-01");
    expect(dateValue(firstEvent(gen([rel({ date: "2028-02-28" })])), "DTEND")).toBe("2028-02-29");
  });

  it("month：整月，DTSTART＝當月 1 日、DTEND＝下月 1 日（排他），標題加 [暫定]", () => {
    const ev = firstEvent(gen([rel({ date: "2027-03-01", precision: "month" })]));
    expect(dateValue(ev, "DTSTART")).toBe("2027-03-01");
    expect(dateValue(ev, "DTEND")).toBe("2027-04-01");
    expect(ev.get("SUMMARY")?.startsWith(`${createTranslator("zh-Hant").t("ical.mark.provisional")} `)).toBe(true);
  });

  it("month：2 月、12 月（跨年）、閏年", () => {
    const end = (date: string) => dateValue(firstEvent(gen([rel({ date, precision: "month" })])), "DTEND");
    expect(end("2027-02-01")).toBe("2027-03-01");
    expect(end("2028-02-01")).toBe("2028-03-01");
    expect(end("2027-12-01")).toBe("2028-01-01");
  });

  it("month：代表日期不是 1 日時也從當月 1 日算起", () => {
    const ev = firstEvent(gen([rel({ date: "2027-03-17", precision: "month" })]));
    expect(dateValue(ev, "DTSTART")).toBe("2027-03-01");
    expect(dateValue(ev, "DTEND")).toBe("2027-04-01");
  });

  it("quarter／year：用 releaseDate（期間最後一天）單日，標題加 [暫定 …]，標籤來自 formatReleaseLabel", () => {
    for (const locale of ["zh-Hant", "en", "ja"] as const) {
      const t = createTranslator(locale);
      const q = firstEvent(gen([rel({ date: "2027-06-30", precision: "quarter" })], { locale }));
      expect(dateValue(q, "DTSTART")).toBe("2027-06-30");
      expect(dateValue(q, "DTEND")).toBe("2027-07-01");
      expect(q.get("SUMMARY")).toContain(t.t("ical.mark.provisionalLabel", { label: formatReleaseLabel("2027-06-30", "quarter", locale) }));
      const y = firstEvent(gen([rel({ date: "2027-12-31", precision: "year" })], { locale }));
      expect(dateValue(y, "DTSTART")).toBe("2027-12-31");
      expect(y.get("SUMMARY")).toContain(t.t("ical.mark.provisionalLabel", { label: formatReleaseLabel("2027-12-31", "year", locale) }));
    }
  });

  it("tbd 且原本有日期：留在最後已知日期、標題加延期標記、STATUS:TENTATIVE", () => {
    const t = createTranslator("zh-Hant");
    const ev = firstEvent(
      gen([rel({ precision: "tbd", date: null, status: "delayed", lastKnownDate: "2027-04-02", lastKnownPrecision: "day", sequence: 2 })]),
    );
    expect(ev.get("STATUS")).toBe("TENTATIVE");
    expect(ev.get("SUMMARY")?.startsWith(`${t.t("ical.mark.postponed")} `)).toBe(true);
    expect(dateValue(ev, "DTSTART")).toBe("2027-04-02");
    expect(dateValue(ev, "DTEND")).toBe("2027-04-03");
    expect(ev.get("UID")).toBe(releaseUid(rel(), DOMAIN));
  });

  it("tbd 且原本是月精度：仍整月；季精度：用最後已知的期間最後一天", () => {
    const m = firstEvent(gen([rel({ precision: "tbd", date: null, lastKnownDate: "2027-03-01", lastKnownPrecision: "month" })]));
    expect(dateValue(m, "DTSTART")).toBe("2027-03-01");
    expect(dateValue(m, "DTEND")).toBe("2027-04-01");
    const q = firstEvent(gen([rel({ precision: "tbd", date: null, lastKnownDate: "2027-06-30", lastKnownPrecision: "quarter" })]));
    expect(dateValue(q, "DTSTART")).toBe("2027-06-30");
    expect(dateValue(q, "DTEND")).toBe("2027-07-01");
  });

  it("tbd 從未有過日期：不產生", () => {
    expect(parseIcs(gen([rel({ precision: "tbd", date: null })])).events).toHaveLength(0);
    expect(parseIcs(gen([rel({ date: null, precision: "day" })])).events).toHaveLength(0);
  });

  it("取消：STATUS:CANCELLED＋標記，日期不變；沒有日期可用時不產生", () => {
    const t = createTranslator("zh-Hant");
    const ev = firstEvent(gen([rel({ status: "cancelled", sequence: 3 })]));
    expect(ev.get("STATUS")).toBe("CANCELLED");
    expect(ev.get("SUMMARY")?.startsWith(`${t.t("ical.mark.cancelled")} `)).toBe(true);
    expect(dateValue(ev, "DTSTART")).toBe("2027-04-02");
    const fromTbd = firstEvent(gen([rel({ status: "cancelled", precision: "tbd", date: null, lastKnownDate: "2027-05-05", lastKnownPrecision: "day" })]));
    expect(fromTbd.get("STATUS")).toBe("CANCELLED");
    expect(dateValue(fromTbd, "DTSTART")).toBe("2027-05-05");
    expect(parseIcs(gen([rel({ status: "cancelled", precision: "tbd", date: null })])).events).toHaveLength(0);
  });

  it("每個項目 TRANSP:TRANSPARENT（全天提醒不佔忙碌時間）", () => {
    expect(firstEvent(gen([rel()])).get("TRANSP")).toBe("TRANSPARENT");
  });

  it("非預設階段、非縮寫平台出現在標題括號內", () => {
    const ev = firstEvent(gen([rel({ stage: "early_access", platformAbbreviation: null, platformName: "PC" })], { locale: "en" }));
    expect(ev.get("SUMMARY")).toBe("Game One (PC, Early access)");
    expect(firstEvent(gen([rel({ stage: "full" })], { locale: "en" })).get("SUMMARY")).toBe("Game One (PS5)");
  });
});

describe("DTSTAMP／LAST-MODIFIED／位元組相同", () => {
  const compact = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  it("DTSTAMP 與 LAST-MODIFIED 取項目的 updatedAt，不取產生當下", () => {
    const ev = firstEvent(gen([rel({ updatedAt: new Date("2026-08-09T01:02:03Z") })]));
    expect(ev.get("DTSTAMP")).toBe("20260809T010203Z");
    expect(ev.get("LAST-MODIFIED")).toBe("20260809T010203Z");
  });

  it("同樣的資料重複產生位元組相同（含活動）", async () => {
    const items = [rel(), rel({ gameId: 2, date: "2027-05-05" }), rel({ gameId: 3, precision: "month", date: "2027-06-01" })];
    const a = gen(items, {}, [evt()]);
    await new Promise((r) => setTimeout(r, 20));
    const b = gen(items, {}, [evt()]);
    expect(b).toBe(a);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
  });

  it("輸入順序不同，輸出一樣（輸出順序固定：日期 → 遊戲 → 平台 → 階段）", () => {
    const items = [
      rel({ gameId: 3, date: "2027-05-05" }),
      rel({ gameId: 1, date: "2027-05-05" }),
      rel({ gameId: 2, date: "2027-04-01" }),
      rel({ gameId: 1, date: "2027-05-05", platformId: 9 }),
    ];
    const a = gen(items, {}, [evt({ id: 2 }), evt({ id: 1 })]);
    const b = gen([...items].reverse(), {}, [evt({ id: 1 }), evt({ id: 2 })]);
    expect(b).toBe(a);
    const uids = parseIcs(a).events.map((e) => e.get("UID"));
    expect(uids.slice(0, 4)).toEqual([
      "release-g2-p5-sfull@sok.example",
      "release-g1-p5-sfull@sok.example",
      "release-g1-p9-sfull@sok.example",
      "release-g3-p5-sfull@sok.example",
    ]);
  });

  it("updatedAt 改變 → 該項目的 DTSTAMP 與內容改變（ETag 之外另一個變動來源）", () => {
    expect(gen([rel({ updatedAt: new Date("2026-10-02T00:00:00Z") })])).not.toBe(gen([rel()]));
    expect(compact(T0)).toBe("20261001T100000Z");
  });
});

describe("SEQUENCE", () => {
  it("輸出項目的 sequence 原值（查詢端給整組總和）", () => {
    expect(firstEvent(gen([rel({ sequence: 7 })])).get("SEQUENCE")).toBe("7");
    expect(firstEvent(gen([rel({ sequence: 0 })])).get("SEQUENCE")).toBe("0");
  });

  it("日期、tbd、取消、復原：每一步遞增就單調不減（模擬 08 規則 2）", () => {
    let seq = 0;
    const steps: Array<Partial<IcalReleaseItem>> = [
      { date: "2027-05-05" },
      { precision: "tbd", date: null, status: "delayed", lastKnownDate: "2027-05-05", lastKnownPrecision: "day" },
      { status: "cancelled", precision: "tbd", date: null, lastKnownDate: "2027-05-05", lastKnownPrecision: "day" },
      { status: "scheduled", date: "2027-05-05", precision: "day" },
    ];
    const seen: number[] = [];
    for (const s of steps) {
      seq += 1;
      seen.push(Number(firstEvent(gen([rel({ ...s, sequence: seq })])).get("SEQUENCE")));
    }
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe("三語系", () => {
  it("同一個項目：UID 相同、SUMMARY／DESCRIPTION／日曆名稱不同，標記來自字典", () => {
    const item = rel({ precision: "tbd", date: null, status: "delayed", lastKnownDate: "2027-04-02", lastKnownPrecision: "day" });
    const out = (["zh-Hant", "en", "ja"] as const).map((locale) => {
      const parsed = parseIcs(gen([item], { locale }));
      return { locale, ev: parsed.events[0], name: parsed.calendar.find((p) => p.name === "X-WR-CALNAME")?.value };
    });
    expect(new Set(out.map((o) => o.ev.get("UID"))).size).toBe(1);
    expect(new Set(out.map((o) => o.ev.get("SUMMARY"))).size).toBe(3);
    expect(new Set(out.map((o) => o.name)).size).toBe(3);
    for (const o of out) {
      const t = createTranslator(o.locale);
      expect(o.ev.get("SUMMARY")).toContain(t.t("ical.mark.postponed"));
      expect(o.name).toBe(t.t("ical.calendarName.releases"));
      expect(o.ev.get("DESCRIPTION")).toContain(t.t("ical.description.note.postponed"));
    }
  });

  it("日曆層級屬性：X-WR-CALNAME、REFRESH-INTERVAL、X-PUBLISHED-TTL、PRODID", () => {
    const cal = parseIcs(gen([rel()])).calendar;
    const get = (n: string) => cal.find((p) => p.name === n)?.value;
    expect(get("X-WR-CALNAME")).toBe(createTranslator("zh-Hant").t("ical.calendarName.releases"));
    expect(get("REFRESH-INTERVAL")).toBe(`PT${ICAL_REFRESH_SECONDS / 3600}H`);
    expect(get("X-PUBLISHED-TTL")).toBe(`PT${ICAL_REFRESH_SECONDS / 3600}H`);
    expect(get("PRODID")).toContain("SoK Studio");
  });

  it("platform／game／events feed 的日曆名稱帶入名稱", () => {
    const name = (feed: IcalGenerateInput["feed"], locale: "en" | "zh-Hant" = "en") =>
      parseIcs(gen([], { feed, locale })).calendar.find((p) => p.name === "X-WR-CALNAME")?.value;
    expect(name({ kind: "platform", platformName: "Switch 2" })).toContain("Switch 2");
    expect(name({ kind: "game", gameName: "Zelda" })).toBe("Zelda");
    expect(name({ kind: "events" })).toBe(createTranslator("en").t("ical.calendarName.events"));
  });

  it("描述含平台、地區（字典名稱）、狀態、連結、IGDB 署名", () => {
    const t = createTranslator("en");
    const d = firstEvent(gen([rel({ regionCode: "JP" })], { locale: "en" })).get("DESCRIPTION") ?? "";
    expect(d).toContain(t.t("ical.description.platform", { value: "PlayStation 5" }));
    expect(d).toContain(t.t("ical.description.region", { value: t.t("enums.region.JP") }));
    expect(d).toContain(t.t("ical.description.status", { value: t.t("enums.releaseStatus.scheduled") }));
    expect(d).toContain("https://sok.example/zh-Hant/games/game-one");
    expect(d).toContain(t.t("ical.description.attribution"));
    expect(firstEvent(gen([rel()])).get("URL")).toBe("https://sok.example/zh-Hant/games/game-one");
  });

  it("沒有站台網址（links 回 null）時不輸出 URL", () => {
    const ev = firstEvent(gen([rel()], { links: { game: () => null, event: () => null } }));
    expect(ev.get("URL")).toBeUndefined();
    expect(ev.get("DESCRIPTION")).not.toContain("http");
  });
});

describe("活動", () => {
  it("輸出 UTC 絕對時間（結尾 Z、沒有 TZID），endTime 為 NULL → +1 小時", () => {
    const ics = gen([], {}, [evt()]);
    const ev = firstEvent(ics);
    expect(ev.get("DTSTART")).toBe("20270608T170000Z");
    expect(ev.get("DTEND")).toBe("20270608T180000Z");
    expect(ics).not.toContain("TZID");
    expect(ev.get("UID")).toBe("event-7@sok.example");
  });

  it("有 endTime 就用 endTime；endTime 不晚於開始 → 退回 +1 小時", () => {
    expect(firstEvent(gen([], {}, [evt({ endTime: new Date("2027-06-10T03:30:00Z") })])).get("DTEND")).toBe("20270610T033000Z");
    expect(firstEvent(gen([], {}, [evt({ endTime: new Date("2027-06-08T16:00:00Z") })])).get("DTEND")).toBe("20270608T180000Z");
  });

  it("DTSTAMP＝updatedAt、SEQUENCE＝sequence、類型與主辦來自字典與資料", () => {
    const ev = firstEvent(gen([], { locale: "en" }, [evt({ sequence: 3, organizer: "ACME", kind: "expo", updatedAt: new Date("2026-09-09T09:09:09Z") })]));
    expect(ev.get("SEQUENCE")).toBe("3");
    expect(ev.get("DTSTAMP")).toBe("20260909T090909Z");
    const t = createTranslator("en");
    expect(ev.get("DESCRIPTION")).toContain(t.t("ical.description.kind", { value: t.t("enums.eventKind.expo") }));
    expect(ev.get("DESCRIPTION")).toContain(t.t("ical.description.organizer", { value: "ACME" }));
  });

  it("活動依開始時間排序，同時間依 id", () => {
    const ics = gen([], {}, [
      evt({ id: 3, startTime: new Date("2027-07-01T00:00:00Z") }),
      evt({ id: 2, startTime: new Date("2027-06-01T00:00:00Z") }),
      evt({ id: 1, startTime: new Date("2027-06-01T00:00:00Z") }),
    ]);
    expect(parseIcs(ics).events.map((e) => e.get("UID"))).toEqual(["event-1@sok.example", "event-2@sok.example", "event-3@sok.example"]);
  });

  it("上市與活動可同時輸出（私人 feed 之後共用）", () => {
    const parsed = parseIcs(gen([rel()], {}, [evt()]));
    expect(parsed.events.map((e) => e.get("UID"))).toEqual([uidOf(rel()), "event-7@sok.example"]);
    expect(eventByUid(parsed, "event-7@sok.example")).toBeDefined();
  });
});

describe("ETag（公式）與 If-None-Match", () => {
  const base = { meta: { count: 10, maxUpdatedAt: new Date("2026-10-01T00:00:00Z") }, settingsVersion: 0, locale: "en", feedKey: "releases", today: "2026-10-15" };

  it("同樣輸入 → 同樣 ETag（強 ETag，帶引號）", () => {
    expect(computeIcalEtag(base)).toBe(computeIcalEtag({ ...base }));
    expect(computeIcalEtag(base)).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("max(updated_at)、count、settingsVersion、語系、feed、今天任一個變動 → ETag 不同；count 必須納入", () => {
    const e = computeIcalEtag(base);
    const variants = [
      { ...base, meta: { ...base.meta, maxUpdatedAt: new Date("2026-10-02T00:00:00Z") } },
      { ...base, meta: { ...base.meta, count: 9 } },
      { ...base, settingsVersion: 1 },
      { ...base, locale: "ja" },
      { ...base, feedKey: "platform:ps5" },
      { ...base, today: "2026-10-16" },
    ];
    for (const v of variants) expect(computeIcalEtag(v)).not.toBe(e);
    // 刪除不會改變 max(updated_at)，只有 count 變：ETag 仍要變
    expect(computeIcalEtag({ ...base, meta: { count: 9, maxUpdatedAt: base.meta.maxUpdatedAt } })).not.toBe(e);
  });

  it("沒有項目（maxUpdatedAt＝null）也能算", () => {
    expect(computeIcalEtag({ ...base, meta: { count: 0, maxUpdatedAt: null } })).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it("格式版本是 ETag 的一部分", () => {
    expect(ICAL_FORMAT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("If-None-Match：相符、多個值、*、弱驗證前綴、不相符、沒給", () => {
    const etag = '"abc123"';
    expect(ifNoneMatchHits('"abc123"', etag)).toBe(true);
    expect(ifNoneMatchHits('"zzz", "abc123"', etag)).toBe(true);
    expect(ifNoneMatchHits("*", etag)).toBe(true);
    expect(ifNoneMatchHits('W/"abc123"', etag)).toBe(true);
    expect(ifNoneMatchHits('"other"', etag)).toBe(false);
    expect(ifNoneMatchHits("", etag)).toBe(false);
    expect(ifNoneMatchHits(null, etag)).toBe(false);
    expect(ifNoneMatchHits(undefined, etag)).toBe(false);
  });
});

describe("網址與檔名", () => {
  it("icalFeedPath", () => {
    expect(icalFeedPath("en", "releases")).toBe("/ical/en/releases.ics");
    expect(icalFeedPath("zh-Hant", "events")).toBe("/ical/zh-Hant/events.ics");
    expect(icalFeedPath("ja", "platform", "ps5")).toBe("/ical/ja/platform/ps5.ics");
    expect(icalFeedPath("en", "game", "a b")).toBe("/ical/en/game/a%20b.ics");
    expect(icalFeedPath("en", "platform", "{slug}")).toBe("/ical/en/platform/{slug}.ics");
  });

  it("slugFromIcsFile：只接受 .ics 結尾，統一小寫", () => {
    expect(slugFromIcsFile("ps5.ics")).toBe("ps5");
    expect(slugFromIcsFile("PS5.ICS")).toBe("ps5");
    expect(slugFromIcsFile("ps5")).toBeNull();
    expect(slugFromIcsFile("ps5.json")).toBeNull();
    expect(slugFromIcsFile(".ics")).toBeNull();
  });
});

describe("原型驗證情境", () => {
  const NOW = new Date("2026-10-15T03:00:00Z");
  const LATER = new Date("2026-10-15T04:00:00Z");
  const opts = { locale: "en" as const, uidDomain: DOMAIN, links: LINKS };
  const run = (steps: Array<(typeof PROTO_STEPS)[number]>) => {
    let state = null as ReturnType<typeof applyProtoStep>["state"] | null;
    for (const s of steps) state = applyProtoStep(state, s, LATER).state;
    return state!;
  };
  const init = () => applyProtoStep(null, "init", NOW).state;
  const seqOf = (s: ReturnType<typeof init>, feed: "a" | "b", slug: string) => s.feeds[feed].releases.find((r) => r.gameSlug === slug)!.sequence;

  it("init 之外的步驟需要先 init", () => {
    expect(() => applyProtoStep(null, "region", NOW)).toThrow(/init/);
  });

  it("init：7 個上市（day、month、quarter 各一）＋1 個活動，a 與 b 內容相同", () => {
    const s = init();
    expect(s.feeds.a.releases).toHaveLength(7);
    expect(s.feeds.a.events).toHaveLength(1);
    expect(s.feeds.a).toEqual(s.feeds.b);
    expect(new Set(s.feeds.a.releases.map((r) => r.precision))).toEqual(new Set(["day", "month", "quarter"]));
    const ics = parseIcs(renderProtoFeed(s, "a", opts));
    expect(ics.events).toHaveLength(8);
  });

  it("region：同 UID 換地區屬性與日期，a 的 SEQUENCE +1，b 不動", () => {
    const s0 = init();
    const s1 = applyProtoStep(s0, "region", LATER).state;
    const uid = releaseUid(s0.feeds.a.releases.find((r) => r.gameSlug === "proto-region-game")!, DOMAIN);
    const before = eventByUid(parseIcs(renderProtoFeed(s0, "a", opts)), uid)!;
    const after = eventByUid(parseIcs(renderProtoFeed(s1, "a", opts)), uid)!;
    expect(after.get("UID")).toBe(before.get("UID"));
    expect(dateValue(after, "DTSTART")).not.toBe(dateValue(before, "DTSTART"));
    expect(after.get("DESCRIPTION")).toContain("Japan");
    expect(before.get("DESCRIPTION")).toContain("Worldwide");
    expect(seqOf(s1, "a", "proto-region-game")).toBe(1);
    expect(seqOf(s1, "b", "proto-region-game")).toBe(0);
    expect(after.get("DTSTAMP")).not.toBe(before.get("DTSTAMP"));
  });

  it("tbd：事件保留在原日期，加延期標記與 TENTATIVE", () => {
    const s = run(["init", "tbd"]);
    const item = s.feeds.a.releases.find((r) => r.gameSlug === "proto-delay-game")!;
    expect(item).toMatchObject({ precision: "tbd", date: null });
    const ev = eventByUid(parseIcs(renderProtoFeed(s, "a", opts)), releaseUid(item, DOMAIN))!;
    expect(ev.get("STATUS")).toBe("TENTATIVE");
    expect(ev.get("SUMMARY")).toContain(createTranslator("en").t("ical.mark.postponed"));
    expect(dateValue(ev, "DTSTART")).toBe(item.lastKnownDate);
  });

  it("cancel → restore：STATUS 先 CANCELLED 再回到沒有 STATUS；a 每次 +1", () => {
    const uidFor = (s: ReturnType<typeof init>) => releaseUid(s.feeds.a.releases.find((r) => r.gameSlug === "proto-cancel-game")!, DOMAIN);
    const c = run(["init", "cancel"]);
    expect(eventByUid(parseIcs(renderProtoFeed(c, "a", opts)), uidFor(c))!.get("STATUS")).toBe("CANCELLED");
    const r = run(["init", "cancel", "restore"]);
    const back = eventByUid(parseIcs(renderProtoFeed(r, "a", opts)), uidFor(r))!;
    expect(back.get("STATUS")).toBeUndefined();
    expect(seqOf(r, "a", "proto-cancel-game")).toBe(2);
    expect(seqOf(r, "b", "proto-cancel-game")).toBe(0);
  });

  it("seq-only：標題改變、日期不變；no-seq：日期改變、a／b 的 SEQUENCE 都不動", () => {
    const s0 = init();
    const s1 = applyProtoStep(s0, "seq-only", LATER).state;
    const p0 = s0.feeds.a.releases.find((r) => r.gameSlug === "proto-seq-probe")!;
    const p1 = s1.feeds.a.releases.find((r) => r.gameSlug === "proto-seq-probe")!;
    expect(p1.gameName).not.toBe(p0.gameName);
    expect(p1.date).toBe(p0.date);
    expect([seqOf(s1, "a", "proto-seq-probe"), seqOf(s1, "b", "proto-seq-probe")]).toEqual([1, 0]);
    const s2 = applyProtoStep(s1, "no-seq", LATER).state;
    const p2 = s2.feeds.a.releases.find((r) => r.gameSlug === "proto-seq-probe")!;
    expect(p2.date).not.toBe(p1.date);
    expect([seqOf(s2, "a", "proto-seq-probe"), seqOf(s2, "b", "proto-seq-probe")]).toEqual([1, 0]);
  });

  it("每一步都有動作說明與預期客戶端行為；步驟序號遞增", () => {
    let state = null as ReturnType<typeof init> | null;
    PROTO_STEPS.forEach((step, i) => {
      const r = applyProtoStep(state, step, LATER);
      expect(r.change.length).toBeGreaterThan(10);
      expect(r.expect.length).toBeGreaterThan(10);
      expect(r.state.stepNo).toBe(i + 1);
      state = r.state;
    });
  });

  it("狀態經 JSON 往返後（日期還原成 Date）輸出位元組相同", () => {
    const s = run(["init", "region", "tbd", "cancel"]);
    const again = parseProtoState(JSON.parse(JSON.stringify(s)));
    for (const feed of PROTO_FEEDS) expect(renderProtoFeed(again, feed, opts)).toBe(renderProtoFeed(s, feed, opts));
  });

  it("a、b 兩個 feed 的日曆名稱不同（行事曆裡分得出來）", () => {
    const s = init();
    const name = (f: "a" | "b") => parseIcs(renderProtoFeed(s, f, opts)).calendar.find((p) => p.name === "X-WR-CALNAME")?.value;
    expect(name("a")).not.toBe(name("b"));
  });
});

describe("字典與原始碼", () => {
  const root = path.resolve(__dirname, "../../src/modules/catalog");
  const CJK = /[　-鿿＀-￯]/;

  /** 去掉註解與字串以外的部分不好做，這裡只檢查「非註解行」是否含中日文字元。 */
  function codeLinesWithCjk(rel: string): string[] {
    const src = readFileSync(path.join(root, rel), "utf8");
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    return noBlock
      .split(/\r?\n/) // Windows CRLF checkout：`.` 不跨 \r，不切掉的話 `//.*$` 刪不到行尾註解
      .map((l) => l.replace(/\/\/.*$/, ""))
      .filter((l) => CJK.test(l));
  }

  it("iCal 產生與組裝程式碼不得寫死中日文字（標記全來自字典）", () => {
    for (const f of ["use-cases/ical/generate.ts", "use-cases/ical/feeds.ts", "api/ical.ts"]) {
      expect(codeLinesWithCjk(f), f).toEqual([]);
    }
  });

  it("ical 命名空間三語的標記都有值且互不相同", () => {
    for (const key of ["ical.mark.provisional", "ical.mark.postponed", "ical.mark.cancelled"]) {
      const values = (["zh-Hant", "en", "ja"] as const).map((l) => createTranslator(l).t(key));
      expect(new Set(values).size, key).toBe(3);
      for (const v of values) expect(v).not.toBe(key);
    }
  });

  it("訂閱頁字典：延遲文案依原型實測（Google 約 5～6 小時）、Google 行動版限制有說明", () => {
    for (const l of ["zh-Hant", "en", "ja"] as const) {
      const t = createTranslator(l);
      for (const key of ["changes.title", "changes.intro", "changes.postponed", "changes.cancelled", "changes.rescheduled"]) {
        expect(t.t(`ui.subscribe.${key}`).length, key).toBeGreaterThan(5);
      }
      expect(t.t("ui.subscribe.clients.google.note").length).toBeGreaterThan(20);
    }
    expect(createTranslator("zh-Hant").t("ui.subscribe.delay.body")).toContain("5～6 小時");
  });
});
