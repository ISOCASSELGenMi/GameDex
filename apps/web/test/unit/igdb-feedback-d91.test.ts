/**
 * D91 待回饋 IGDB 清單：登錄表（建項目、顯示文字、採納偵測）與 localized_title 驗證。純函式，不連資料庫。
 */
import { describe, expect, it } from "vitest";
import { IGDB_FEEDBACK_FIELDS, REPORT_TYPES } from "@/modules/catalog/domain/entities";
import {
  IGDB_FEEDBACK_REGISTRY,
  buildFeedbackDraft,
  buildFeedbackPasteText,
  feedbackFieldForReportType,
  isFeedbackAdopted,
  igdbGameUrl,
  type FeedbackBuildContext,
  type IgdbAdoptionSnapshot,
} from "@/modules/catalog/domain/igdb-feedback-fields";
import { REPORT_TITLE_MAX, validateReportRequest } from "@/modules/catalog/domain/report-validation";

const game = { id: 1, igdbId: 100, slug: "g", name: "Game", gameStatus: null, zhHantTitle: "舊標題" };
const report = (over: Partial<FeedbackBuildContext["report"]>): FeedbackBuildContext["report"] => ({
  id: 7, reportType: "other", targetType: "game", targetId: 1, proposed: null, sourceUrl: "https://e.example", note: "n", ...over,
});
const ctx = (over: Partial<FeedbackBuildContext> & { report: FeedbackBuildContext["report"] }): FeedbackBuildContext => ({ game, event: null, plan: null, ...over });
const snap = (over: Partial<IgdbAdoptionSnapshot> = {}): IgdbAdoptionSnapshot => ({ releases: [], languages: [], gameStatus: null, names: [], ...over });

describe("登錄表", () => {
  it("每個欄位鍵都有登錄；核可後會建項目的回報類型對應欄位，duplicate／takedown／other 不建", () => {
    expect(Object.keys(IGDB_FEEDBACK_REGISTRY).sort()).toEqual([...IGDB_FEEDBACK_FIELDS].sort());
    const mapped = REPORT_TYPES.filter((t) => feedbackFieldForReportType(t) !== null).sort();
    expect(mapped).toEqual(["cancelled", "language_support", "localized_title", "missing_region_date", "wrong_date", "wrong_stage"]);
    expect(feedbackFieldForReportType("duplicate")).toBeNull();
    expect(feedbackFieldForReportType("takedown")).toBeNull();
    expect(feedbackFieldForReportType("other")).toBeNull();
    for (const def of Object.values(IGDB_FEEDBACK_REGISTRY)) {
      expect(def.label).not.toBe("");
      expect(def.igdbLocation).not.toBe("");
      expect(def.adoptionRule).not.toBe("");
    }
  });

  it("buildFeedbackDraft：六種回報各自的快照", () => {
    const plan = { platformId: 5, regionCode: "TW", stage: "full" as const, span: { releaseDate: "2037-05-12", periodStart: "2037-05-12", precision: "day" as const }, igdbRow: { releaseDate: "2037-05-10", precision: "day" as const } };
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "wrong_date" }), plan }))).toEqual({
      field: "release_date", platformId: 5, regionCode: "TW", stage: "full", oldValue: { date: "2037-05-10", precision: "day" }, newValue: { date: "2037-05-12", precision: "day" },
    });
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "missing_region_date" }), plan: { ...plan, igdbRow: null } }))).toMatchObject({ field: "region_date", oldValue: null });
    const event = { platformId: 5, regionCode: "JP", stage: "beta" as const, status: "delayed" };
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "wrong_stage", targetType: "release_event", proposed: { stage: "full" } }), event }))).toEqual({
      field: "stage", platformId: 5, regionCode: "JP", stage: "beta", oldValue: { stage: "beta" }, newValue: { stage: "full" },
    });
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "language_support", proposed: { language: "ja", supportType: "audio" } }) }))).toEqual({
      field: "language_support", platformId: null, regionCode: null, stage: null, oldValue: null, newValue: { language: "ja", supportType: "audio" },
    });
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "cancelled", targetType: "release_event" }), event }))).toMatchObject({ platformId: 5, oldValue: { status: "delayed" }, newValue: { status: "cancelled" } });
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "cancelled" }), game: { ...game, gameStatus: "beta" } }))).toMatchObject({ platformId: null, oldValue: { status: "beta" } });
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "localized_title", proposed: { title: " 新標題 " } }) }))).toEqual({
      field: "localized_title", platformId: null, regionCode: null, stage: null, oldValue: { title: "舊標題" }, newValue: { title: "新標題" },
    });
  });

  it("資料不足時不建項目（null）", () => {
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "wrong_date" }) }))).toBeNull();
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "wrong_stage", targetType: "release_event" }) }))).toBeNull();
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "cancelled", targetType: "release_event" }) }))).toBeNull();
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "localized_title", proposed: { title: "  " } }) }))).toBeNull();
    expect(buildFeedbackDraft(ctx({ report: report({ reportType: "other" }) }))).toBeNull();
  });

  it("整理文字：含遊戲、IGDB 遊戲頁、欄位位置、定位、舊新值、佐證、備註", () => {
    const text = buildFeedbackPasteText({
      field: "release_date", gameName: "Game", gameSlug: "g", igdbGameId: 100, platformName: "PS5", regionCode: "WW", stage: "full",
      oldValue: { date: "2037-05-10", precision: "day" }, newValue: { date: "2037-08-01", precision: "month" }, sourceUrl: "https://e.example", reporterNote: "備註",
    });
    expect(text.split("\n")).toEqual([
      "遊戲：Game",
      "IGDB：https://www.igdb.com/games/g",
      `欄位：${IGDB_FEEDBACK_REGISTRY.release_date.label}（${IGDB_FEEDBACK_REGISTRY.release_date.igdbLocation}）`,
      "平台／地區／階段：PS5／WW／正式版",
      "目前（IGDB）：2037-05-10（精度：日）",
      "建議改為：2037-08-01（精度：月）",
      "佐證：https://e.example",
      "回報者備註：備註",
    ]);
    const bare = buildFeedbackPasteText({ field: "localized_title", gameName: "G", gameSlug: "g", igdbGameId: 100, platformName: null, regionCode: null, stage: null, oldValue: null, newValue: { title: "T" }, sourceUrl: null, reporterNote: null });
    expect(bare).not.toContain("平台／地區／階段");
    expect(bare).not.toContain("佐證");
    expect(bare).toContain("目前（IGDB）：（無）");
  });
});

describe("igdbGameUrl", () => {
  it("去掉 slug 衝突時加的 -<igdbId> 尾綴；其他不動", () => {
    expect(igdbGameUrl("zelda-123", 123)).toBe("https://www.igdb.com/games/zelda");
    expect(igdbGameUrl("zelda-123", 456)).toBe("https://www.igdb.com/games/zelda-123");
    expect(igdbGameUrl("-123", 123)).toBe("https://www.igdb.com/games/-123");
  });
});

describe("isFeedbackAdopted（登錄表驅動的採納偵測）", () => {
  const rel = { platformId: 5, regionCode: "WW", stage: "full" as const, date: "2037-08-01", precision: "month" as const, status: "scheduled" };
  const item = (over: Record<string, unknown>) => ({ field: "release_date" as const, platformId: 5, regionCode: "WW", stage: "full" as const, newValue: {}, ...over });

  it("release_date／region_date：同鍵、日期與精度都相同", () => {
    const it = item({ newValue: { date: "2037-08-01", precision: "month" } });
    expect(isFeedbackAdopted(it, snap({ releases: [rel] }))).toBe(true);
    expect(isFeedbackAdopted(it, snap({ releases: [{ ...rel, precision: "day" }] }))).toBe(false);
    expect(isFeedbackAdopted(it, snap({ releases: [{ ...rel, regionCode: "JP" }] }))).toBe(false);
    expect(isFeedbackAdopted(it, snap({ releases: [{ ...rel, stage: "beta" }] }))).toBe(false);
    expect(isFeedbackAdopted({ ...it, field: "region_date" }, snap({ releases: [rel] }))).toBe(true);
    const tbd = item({ newValue: { date: null, precision: "tbd" } });
    expect(isFeedbackAdopted(tbd, snap({ releases: [{ ...rel, date: null, precision: "tbd" }] }))).toBe(true);
  });

  it("stage：同 (平台, 地區) 有列且階段相同（不看日期）", () => {
    const it = item({ field: "stage", newValue: { stage: "beta" } });
    expect(isFeedbackAdopted(it, snap({ releases: [{ ...rel, stage: "beta" }] }))).toBe(true);
    expect(isFeedbackAdopted(it, snap({ releases: [rel] }))).toBe(false);
  });

  it("language_support、cancelled、localized_title", () => {
    expect(isFeedbackAdopted(item({ field: "language_support", newValue: { language: "ja", supportType: "audio" } }), snap({ languages: [{ code: "ja", supportType: "audio" }] }))).toBe(true);
    expect(isFeedbackAdopted(item({ field: "language_support", newValue: { language: "ja", supportType: "audio" } }), snap({ languages: [{ code: "ja", supportType: "subtitles" }] }))).toBe(false);
    expect(isFeedbackAdopted(item({ field: "cancelled", newValue: { status: "cancelled" } }), snap({ releases: [{ ...rel, status: "cancelled" }] }))).toBe(true);
    expect(isFeedbackAdopted(item({ field: "cancelled", platformId: null, regionCode: null, stage: null }), snap({ gameStatus: "cancelled" }))).toBe(true);
    expect(isFeedbackAdopted(item({ field: "cancelled", platformId: null, regionCode: null, stage: null }), snap({ releases: [{ ...rel, status: "cancelled" }] }))).toBe(false);
    const title = item({ field: "localized_title", newValue: { title: "ＡＢＣ　遊戲" } });
    expect(isFeedbackAdopted(title, snap({ names: [" abc 遊戲 "] }))).toBe(true);
    expect(isFeedbackAdopted(title, snap({ names: ["abc"] }))).toBe(false);
    expect(isFeedbackAdopted(item({ field: "localized_title", newValue: { title: " " } }), snap({ names: [""] }))).toBe(false);
  });
});

describe("validateReportRequest：localized_title", () => {
  const body = (over: Record<string, unknown> = {}) => ({ reportType: "localized_title", targetType: "game", targetId: 3, proposed: { title: "  新標題  ", locale: "zh-Hant" }, ...over });

  it("合法：title trim、locale 固定 zh-Hant、sourceUrl 選填", () => {
    expect(validateReportRequest(body())).toEqual({
      ok: true, value: { reportType: "localized_title", targetType: "game", targetId: 3, proposed: { title: "新標題", locale: "zh-Hant" }, sourceUrl: null, note: null },
    });
    expect(validateReportRequest(body({ proposed: { title: "T" }, sourceUrl: "https://e.example/a" }))).toMatchObject({ ok: true, value: { proposed: { title: "T", locale: "zh-Hant" }, sourceUrl: "https://e.example/a" } });
  });

  it("title：必填、1～200 字、字串", () => {
    expect(validateReportRequest(body({ proposed: {} }))).toEqual({ ok: false, fields: { "proposed.title": "required" } });
    expect(validateReportRequest(body({ proposed: { title: "   " } }))).toEqual({ ok: false, fields: { "proposed.title": "required" } });
    expect(validateReportRequest(body({ proposed: { title: 5 } }))).toEqual({ ok: false, fields: { "proposed.title": "invalid" } });
    expect(validateReportRequest(body({ proposed: { title: "字".repeat(REPORT_TITLE_MAX) } })).ok).toBe(true);
    expect(validateReportRequest(body({ proposed: { title: "字".repeat(REPORT_TITLE_MAX + 1) } }))).toEqual({ ok: false, fields: { "proposed.title": "too_long" } });
    expect(validateReportRequest(body({ proposed: undefined }))).toEqual({ ok: false, fields: { "proposed.title": "required" } });
  });

  it("locale 只允許 zh-Hant；目標只能是遊戲且必填；sourceUrl 有填只收 http(s)", () => {
    expect(validateReportRequest(body({ proposed: { title: "T", locale: "en" } }))).toEqual({ ok: false, fields: { "proposed.locale": "invalid" } });
    expect(validateReportRequest(body({ targetType: "platform" }))).toMatchObject({ ok: false, fields: { targetType: "invalid" } });
    expect(validateReportRequest(body({ targetId: undefined }))).toMatchObject({ ok: false, fields: { targetId: "required" } });
    expect(validateReportRequest(body({ sourceUrl: "ftp://x.example" }))).toEqual({ ok: false, fields: { sourceUrl: "invalid" } });
  });
});
