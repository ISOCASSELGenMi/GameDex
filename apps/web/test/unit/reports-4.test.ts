/**
 * Phase 4 Slice 2 單元測試：回報的欄位驗證、日期換算、核可計畫、IP 雜湊、Turnstile provider、
 * 管理介面的 Basic auth 與 CSRF。不需要資料庫。
 */
import { describe, expect, it, vi } from "vitest";
import { adminGateResponse, checkAdminGate, parseBasicAuth } from "@/kernel/http/admin-gate";
import { createCsrfToken, isSameOrigin, verifyCsrfToken } from "@/modules/admin/csrf";
import type { ReleaseEvent } from "@/modules/catalog";
import { validateReportRequest, spanFromProposed, isValidIsoDate, parseHttpUrl, reportTypesForTarget } from "@/modules/catalog/domain/report-validation";
import { chooseSlotStage, planManualRelease } from "@/modules/catalog/domain/report-resolution";
import { sendAlertWebhook } from "@/modules/catalog/providers/alert-webhook";
import { verifyTurnstileToken } from "@/modules/catalog/providers/turnstile";
import { hashReporterIp, normalizeClientIp } from "@/modules/catalog/use-cases/reports/ip-hash";

const valid = (extra: Record<string, unknown>) => ({
  reportType: "missing_region_date",
  targetType: "game",
  targetId: 5,
  sourceUrl: "https://example.com/news",
  proposed: { platformId: 3, regionCode: "tw", date: "2036-06-01", precision: "day" },
  ...extra,
});

describe("validateReportRequest", () => {
  it("合法的補登：地區轉大寫、來源網址正規化", () => {
    const r = validateReportRequest(valid({}));
    expect(r).toMatchObject({ ok: true, value: { reportType: "missing_region_date", targetType: "game", targetId: 5 } });
    if (r.ok) {
      expect(r.value.proposed).toEqual({ precision: "day", date: "2036-06-01", platformId: 3, regionCode: "TW" });
      expect(r.value.sourceUrl).toBe("https://example.com/news");
    }
  });

  it("日期類缺來源網址 → required；不是 http(s) → invalid", () => {
    expect(validateReportRequest(valid({ sourceUrl: undefined }))).toEqual({ ok: false, fields: { sourceUrl: "required" } });
    expect(validateReportRequest(valid({ sourceUrl: "   " }))).toEqual({ ok: false, fields: { sourceUrl: "required" } });
    for (const bad of ["javascript:alert(1)", "ftp://x.example/a", "data:text/html,hi", "not a url", "//evil.example"]) {
      expect(validateReportRequest(valid({ sourceUrl: bad }))).toEqual({ ok: false, fields: { sourceUrl: "invalid" } });
    }
  });

  it("非日期類回報的來源網址選填，但填了就必須合法", () => {
    const base = { reportType: "other", targetType: "platform", note: "x" };
    expect(validateReportRequest(base).ok).toBe(true);
    expect(validateReportRequest({ ...base, sourceUrl: "https://a.example" }).ok).toBe(true);
    expect(validateReportRequest({ ...base, sourceUrl: "file:///etc/passwd" })).toEqual({ ok: false, fields: { sourceUrl: "invalid" } });
  });

  it("reportType 與 targetType 的組合", () => {
    expect(validateReportRequest(valid({ reportType: "wrong_date", targetType: "game" }))).toMatchObject({ ok: false, fields: { targetType: "invalid" } });
    expect(validateReportRequest({ reportType: "language_support", targetType: "platform", targetId: 1, proposed: { language: "zh-TW", supportType: "interface" } })).toMatchObject({ ok: false });
    expect(validateReportRequest({ reportType: "bogus", targetType: "game" })).toMatchObject({ ok: false, fields: { reportType: "invalid" } });
    expect(reportTypesForTarget("platform")).toEqual(["duplicate", "takedown", "other"]);
    expect(reportTypesForTarget("release_event")).toContain("wrong_date");
  });

  it("需要 targetId 的類型缺 targetId → required；takedown／other 不需要", () => {
    expect(validateReportRequest(valid({ targetId: undefined }))).toMatchObject({ ok: false, fields: { targetId: "required" } });
    expect(validateReportRequest({ reportType: "takedown", targetType: "game" }).ok).toBe(true);
    expect(validateReportRequest({ reportType: "other", targetType: "event" }).ok).toBe(true);
    expect(validateReportRequest({ reportType: "other", targetType: "event", targetId: -3 })).toMatchObject({ ok: false, fields: { targetId: "invalid" } });
    expect(validateReportRequest({ reportType: "other", targetType: "event", targetId: 1.5 })).toMatchObject({ ok: false });
  });

  it("proposed 欄位格式：日期、精度、地區、平台、階段、語言", () => {
    const f = (proposed: Record<string, unknown>) => validateReportRequest(valid({ proposed }));
    expect(f({ platformId: 3, regionCode: "TW", date: "2036-02-30" })).toMatchObject({ ok: false, fields: { "proposed.date": "invalid" } });
    expect(f({ platformId: 3, regionCode: "TW" })).toMatchObject({ ok: false, fields: { "proposed.date": "required" } });
    expect(f({ platformId: 3, regionCode: "TW", date: "2036-06-01", precision: "week" })).toMatchObject({ ok: false, fields: { "proposed.precision": "invalid" } });
    expect(f({ regionCode: "TW", date: "2036-06-01" })).toMatchObject({ ok: false, fields: { "proposed.platformId": "required" } });
    expect(f({ platformId: 3, date: "2036-06-01" })).toMatchObject({ ok: false, fields: { "proposed.regionCode": "required" } });
    expect(f({ platformId: 3, regionCode: "T W", date: "2036-06-01" })).toMatchObject({ ok: false, fields: { "proposed.regionCode": "invalid" } });
    expect(f({ platformId: 3, regionCode: "TW", date: "2036-06-01", stage: "gold" })).toMatchObject({ ok: false, fields: { "proposed.stage": "invalid" } });
    // tbd 不需要日期
    expect(f({ platformId: 3, regionCode: "TW", precision: "tbd" }).ok).toBe(true);
    expect(validateReportRequest({ reportType: "language_support", targetType: "game", targetId: 1, proposed: { language: "zh-TW", supportType: "dubbing" } })).toMatchObject({ ok: false, fields: { "proposed.supportType": "invalid" } });
    expect(validateReportRequest({ reportType: "wrong_stage", targetType: "release_event", targetId: 1, proposed: { stage: "full" } }).ok).toBe(true);
  });

  it("note 長度上限與型別", () => {
    expect(validateReportRequest(valid({ note: "x".repeat(1000) })).ok).toBe(true);
    expect(validateReportRequest(valid({ note: "x".repeat(1001) }))).toMatchObject({ ok: false, fields: { note: "too_long" } });
    expect(validateReportRequest(valid({ note: 5 }))).toMatchObject({ ok: false, fields: { note: "invalid" } });
  });

  it("本體不是物件 → body invalid", () => {
    for (const body of [null, "x", 3, [], undefined]) expect(validateReportRequest(body)).toEqual({ ok: false, fields: { body: "invalid" } });
  });
});

describe("日期工具", () => {
  it("isValidIsoDate", () => {
    expect(isValidIsoDate("2036-02-29")).toBe(true); // 2036 是閏年
    expect(isValidIsoDate("2035-02-29")).toBe(false);
    expect(isValidIsoDate("2036-13-01")).toBe(false);
    expect(isValidIsoDate("2036-6-1")).toBe(false);
  });
  it("spanFromProposed 與 P24 一致", () => {
    expect(spanFromProposed("2036-06-15", "day")).toEqual({ releaseDate: "2036-06-15", periodStart: "2036-06-15", precision: "day" });
    expect(spanFromProposed("2036-06-15", "month")).toEqual({ releaseDate: "2036-06-01", periodStart: "2036-06-01", precision: "month" });
    expect(spanFromProposed("2036-05-02", "quarter")).toEqual({ releaseDate: "2036-06-30", periodStart: "2036-04-01", precision: "quarter" });
    expect(spanFromProposed("2036-11-02", "quarter")).toEqual({ releaseDate: "2036-12-31", periodStart: "2036-10-01", precision: "quarter" });
    expect(spanFromProposed("2036-02-10", "quarter")).toEqual({ releaseDate: "2036-03-31", periodStart: "2036-01-01", precision: "quarter" });
    expect(spanFromProposed("2036-06-15", "year")).toEqual({ releaseDate: "2036-12-31", periodStart: "2036-01-01", precision: "year" });
    expect(spanFromProposed(undefined, "tbd")).toEqual({ releaseDate: null, periodStart: null, precision: "tbd" });
  });
  it("parseHttpUrl", () => {
    expect(parseHttpUrl(" https://a.example/x?y=1 ")).toBe("https://a.example/x?y=1");
    expect(parseHttpUrl("ssh://a.example")).toBeNull();
    expect(parseHttpUrl("https://" + "a".repeat(2100) + ".example")).toBeNull();
  });
});

function row(p: Partial<ReleaseEvent>): ReleaseEvent {
  return {
    id: 1, gameId: 10, platformId: 3, regionId: 1, releaseDate: "2036-06-01", periodStart: "2036-06-01", precision: "day",
    status: "scheduled", releaseStage: "full", sourceStatus: "active", sequence: 0, source: "igdb", sourceUpdatedAt: null,
    createdAt: null, updatedAt: null, ...p,
  };
}

describe("planManualRelease", () => {
  const today = "2036-01-01";
  it("missing_region_date：沿用同平台現有列的階段（偏好 full），sequence 下限＝igdb 最大值+1", () => {
    const res = planManualRelease({
      reportType: "missing_region_date",
      proposed: { platformId: 3, regionCode: "TW", date: "2036-07-01", precision: "day" },
      event: null,
      gameId: 10,
      regionId: 9,
      platformRows: [row({ id: 1, releaseStage: "early_access", sequence: 7 }), row({ id: 2, releaseStage: "full", sequence: 4 })],
      today,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan).toMatchObject({ gameId: 10, platformId: 3, regionId: 9, stage: "full", status: "scheduled", existingManual: null, replaces: null, minSequence: 5 });
      expect(res.plan.span).toMatchObject({ releaseDate: "2036-07-01", precision: "day" });
    }
  });
  it("沒有現有列：階段 unspecified、sequence 下限 0", () => {
    const res = planManualRelease({ reportType: "missing_region_date", proposed: { platformId: 3, regionCode: "TW", date: "2036-07-01", precision: "day" }, event: null, gameId: 10, regionId: 9, platformRows: [], today });
    expect(res.ok && res.plan.stage).toBe("unspecified");
    expect(res.ok && res.plan.minSequence).toBe(0);
  });
  it("指定階段優先於推測", () => {
    const res = planManualRelease({ reportType: "missing_region_date", proposed: { platformId: 3, regionCode: "TW", date: "2036-07-01", precision: "day", stage: "demo" }, event: null, gameId: 10, regionId: 9, platformRows: [row({})], today });
    expect(res.ok && res.plan.stage).toBe("demo");
  });
  it("wrong_date：沿用事件的鍵；延期 → delayed；取代 igdb 列", () => {
    const igdb = row({ id: 5, sequence: 2 });
    const res = planManualRelease({ reportType: "wrong_date", proposed: { date: "2036-09-09", precision: "day" }, event: igdb, gameId: null, regionId: null, platformRows: [igdb], today });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan).toMatchObject({ gameId: 10, platformId: 3, regionId: 1, stage: "full", status: "delayed", minSequence: 3, existingManual: null });
      expect(res.plan.replaces?.id).toBe(5);
    }
  });
  it("wrong_date：已有 manual 列 → 更新它（existingManual），提前 → scheduled", () => {
    const igdb = row({ id: 5, sequence: 2 });
    const manual = row({ id: 6, source: "manual", sequence: 3, releaseDate: "2036-09-09", periodStart: "2036-09-09" });
    const res = planManualRelease({ reportType: "wrong_date", proposed: { date: "2036-05-05", precision: "day" }, event: igdb, gameId: null, regionId: null, platformRows: [igdb, manual], today });
    expect(res.ok && res.plan.existingManual?.id).toBe(6);
    expect(res.ok && res.plan.status).toBe("scheduled");
    expect(res.ok && res.plan.minSequence).toBe(3);
  });
  it("日期已過的 day → released", () => {
    const res = planManualRelease({ reportType: "missing_region_date", proposed: { platformId: 3, regionCode: "TW", date: "2035-12-01", precision: "day" }, event: null, gameId: 10, regionId: 9, platformRows: [], today });
    expect(res.ok && res.plan.status).toBe("released");
  });
  it("其他類型、缺資料 → 不產生計畫", () => {
    expect(planManualRelease({ reportType: "other", proposed: null, event: null, gameId: null, regionId: null, platformRows: [], today })).toEqual({ ok: false, reason: "not_a_date_report" });
    expect(planManualRelease({ reportType: "wrong_date", proposed: { date: "2036-05-05", precision: "day" }, event: null, gameId: null, regionId: null, platformRows: [], today })).toEqual({ ok: false, reason: "target_missing" });
    expect(planManualRelease({ reportType: "missing_region_date", proposed: { precision: "day" }, event: null, gameId: 1, regionId: 1, platformRows: [], today })).toEqual({ ok: false, reason: "invalid_proposal" });
  });
  it("chooseSlotStage", () => {
    expect(chooseSlotStage([{ releaseStage: "beta" }, { releaseStage: "demo" }])).toBe("beta");
    expect(chooseSlotStage([{ releaseStage: "unspecified" }, { releaseStage: "beta" }])).toBe("unspecified");
  });
});

describe("IP 雜湊", () => {
  it("同一個 IP＋同一把金鑰結果固定；金鑰不同、IP 不同則不同；輸出 64 位十六進位", () => {
    const a = hashReporterIp("203.0.113.9", "secret-secret-secret");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashReporterIp("203.0.113.9", "secret-secret-secret")).toBe(a);
    expect(hashReporterIp("203.0.113.10", "secret-secret-secret")).not.toBe(a);
    expect(hashReporterIp("203.0.113.9", "other-secret-other")).not.toBe(a);
    expect(a).not.toContain("203");
  });
  it("normalizeClientIp：IPv6 取前 64 位、IPv4-mapped 還原、空值 unknown", () => {
    expect(normalizeClientIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(normalizeClientIp("2001:DB8:1:2::1"));
    expect(normalizeClientIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:0001:0002::/64");
    expect(normalizeClientIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(normalizeClientIp("  ")).toBe("unknown");
    expect(normalizeClientIp(null)).toBe("unknown");
    expect(normalizeClientIp("not-an-ip")).toBe("unknown");
  });
});

describe("Turnstile provider", () => {
  const mk = (body: unknown, ok = true) => vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
  it("success=true → ok；送出 secret、response、remoteip（表單編碼）", async () => {
    const f = mk({ success: true });
    const r = await verifyTurnstileToken("tok", { secret: "s", remoteIp: "1.2.3.4", fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(String(init.body)).toBe("secret=s&response=tok&remoteip=1.2.3.4");
  });
  it("success=false → rejected（帶錯誤碼）；internal-error／HTTP 失敗／例外 → unavailable", async () => {
    expect(await verifyTurnstileToken("t", { secret: "s", fetchImpl: mk({ success: false, "error-codes": ["invalid-input-response"] }) as unknown as typeof fetch })).toEqual({ ok: false, reason: "rejected", codes: ["invalid-input-response"] });
    expect(await verifyTurnstileToken("t", { secret: "s", fetchImpl: mk({ success: false, "error-codes": ["internal-error"] }) as unknown as typeof fetch })).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifyTurnstileToken("t", { secret: "s", fetchImpl: mk({}, false) as unknown as typeof fetch })).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifyTurnstileToken("t", { secret: "s", fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch })).toEqual({ ok: false, reason: "unavailable" });
  });
  it("空 token 不打外部 API", async () => {
    const f = mk({ success: true });
    expect(await verifyTurnstileToken("  ", { secret: "s", fetchImpl: f as unknown as typeof fetch })).toMatchObject({ ok: false, reason: "rejected" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("告警 webhook", () => {
  it("同時送 content 與 text；失敗回 false 不丟例外", async () => {
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await sendAlertWebhook("https://hooks.example/x", "hello", { fetchImpl: f as unknown as typeof fetch })).toBe(true);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ content: "hello", text: "hello" });
    expect(await sendAlertWebhook("https://hooks.example/x", "hi", { fetchImpl: (async () => { throw new Error("x"); }) as unknown as typeof fetch })).toBe(false);
  });
});

describe("admin：Basic auth 與 CSRF", () => {
  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
  const env = { MODULES: "admin", ADMIN_BASIC_AUTH_USER: "boss", ADMIN_BASIC_AUTH_PASS: "p:ass word" };

  it("parseBasicAuth：密碼可含冒號；格式不對回 null", () => {
    expect(parseBasicAuth(basic("boss", "p:ass word"))).toEqual({ user: "boss", pass: "p:ass word" });
    expect(parseBasicAuth("Bearer abc")).toBeNull();
    expect(parseBasicAuth("Basic !!!")).toBeNull();
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from("nocolon").toString("base64")}`)).toBeNull();
  });

  it("checkAdminGate：ok／unauthorized／unconfigured／disabled", () => {
    expect(checkAdminGate(basic("boss", "p:ass word"), env)).toBe("ok");
    expect(checkAdminGate(basic("boss", "wrong"), env)).toBe("unauthorized");
    expect(checkAdminGate(basic("Boss", "p:ass word"), env)).toBe("unauthorized");
    expect(checkAdminGate(null, env)).toBe("unauthorized");
    expect(checkAdminGate(basic("boss", "p:ass word"), { ...env, ADMIN_BASIC_AUTH_PASS: "" })).toBe("unconfigured");
    expect(checkAdminGate(basic("", ""), { MODULES: "admin" })).toBe("unconfigured");
    expect(checkAdminGate(basic("boss", "p:ass word"), { ...env, MODULES: "none" })).toBe("disabled");
    expect(checkAdminGate(basic("boss", "p:ass word"), { ...env, MODULES: "" })).toBe("ok"); // 預設清單含 admin
  });

  it("adminGateResponse：401 帶 WWW-Authenticate，404／401 都是 no-store", () => {
    expect(adminGateResponse("ok")).toBeNull();
    const r401 = adminGateResponse("unauthorized")!;
    expect(r401.status).toBe(401);
    expect(r401.headers.get("WWW-Authenticate")).toMatch(/^Basic /);
    expect(r401.headers.get("Cache-Control")).toBe("no-store");
    for (const k of ["disabled", "unconfigured"] as const) {
      const r = adminGateResponse(k)!;
      expect(r.status).toBe(404);
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("CSRF token：驗證、竄改、過期、換密碼", () => {
    const now = 1_800_000_000_000;
    const t = createCsrfToken("pw", now);
    expect(verifyCsrfToken(t, "pw", now + 1000)).toBe(true);
    expect(verifyCsrfToken(t, "other", now + 1000)).toBe(false);
    expect(verifyCsrfToken(t, "pw", now + 13 * 3600 * 1000)).toBe(false);
    const [exp, mac] = t.split(".");
    expect(verifyCsrfToken(`${Number(exp) + 100000}.${mac}`, "pw", now)).toBe(false);
    expect(verifyCsrfToken(`${exp}.${"0".repeat(64)}`, "pw", now)).toBe(false);
    expect(verifyCsrfToken("garbage", "pw", now)).toBe(false);
    expect(verifyCsrfToken(null, "pw", now)).toBe(false);
  });

  it("同源檢查：Origin（無則 Referer）的主機必須等於 Host／X-Forwarded-Host", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(isSameOrigin(h({ origin: "https://sok.example", host: "sok.example" }))).toBe(true);
    expect(isSameOrigin(h({ origin: "https://evil.example", host: "sok.example" }))).toBe(false);
    expect(isSameOrigin(h({ referer: "https://sok.example/internal/reports", host: "sok.example" }))).toBe(true);
    expect(isSameOrigin(h({ origin: "https://sok.example", host: "10.0.0.5:3000", "x-forwarded-host": "sok.example" }))).toBe(true);
    expect(isSameOrigin(h({ host: "sok.example" }))).toBe(false);
    expect(isSameOrigin(h({ origin: "null", host: "sok.example" }))).toBe(false);
  });
});
