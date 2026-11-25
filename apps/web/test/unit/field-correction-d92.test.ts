/**
 * D92 field_correction：形狀表、驗證、登錄表（舊值快照、整理文字、採納比對）與三語系 i18n 完整性。純函式，不連資料庫。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIELD_CORRECTION_KEYS,
  FIELD_OPS,
  IGDB_FEEDBACK_FIELDS,
  type FieldCorrectionKey,
  type FieldCorrectionValue,
  type FieldOp,
  type GameFacts,
} from "@/modules/catalog/domain/entities";
import { FIELD_CORRECTION_SPECS, FIELD_GROUPS, fieldKeysByGroup, valueInputs, type FieldShape } from "@/modules/catalog/domain/field-corrections";
import {
  IGDB_FEEDBACK_REGISTRY,
  buildFeedbackDraft,
  buildFeedbackPasteText,
  emptyGameFacts,
  feedbackFieldFor,
  feedbackSourceUrl,
  isFeedbackAdopted,
  type FeedbackBuildContext,
  type IgdbAdoptionSnapshot,
} from "@/modules/catalog/domain/igdb-feedback-fields";
import { REPORT_TYPE_RULES, validateReportRequest } from "@/modules/catalog/domain/report-validation";

/** 每種形狀一個合法的值（依欄位微調）。 */
function sampleValue(key: FieldCorrectionKey): FieldCorrectionValue {
  const spec = FIELD_CORRECTION_SPECS[key];
  switch (spec.shape as FieldShape) {
    case "text":
      return { text: spec.choices ? spec.choices[0] : "新的文字" };
    case "name":
      return { name: "Roguelike" };
    case "altName":
      return { name: "別名", comment: "Japan title" };
    case "localizedTitle":
      return { locale: "ja", name: "日本語タイトル" };
    case "company":
      return { name: "Studio X", ...((spec.roles?.length ?? 0) > 1 ? { role: "porting" as const } : {}) };
    case "link":
      return { url: "https://example.com/game", label: "Official" };
    case "ageRating":
      return { organization: "ESRB", rating: "T" };
    case "relation":
      return { relation: "dlc", gameName: "Some DLC", gameSlug: "some-dlc" };
    case "media":
      return { url: "https://img.example.com/a.jpg" };
  }
}

const body = (proposed: unknown, over: Record<string, unknown> = {}) => ({
  reportType: "field_correction", targetType: "game", targetId: 1, proposed, ...over,
});

describe("形狀表", () => {
  it("24 個欄位鍵都有形狀、至少一個動作、分區；IGDB_FEEDBACK_FIELDS 含全部", () => {
    expect(FIELD_CORRECTION_KEYS).toHaveLength(24);
    for (const key of FIELD_CORRECTION_KEYS) {
      const spec = FIELD_CORRECTION_SPECS[key];
      expect(spec, key).toBeDefined();
      expect(spec.ops.length).toBeGreaterThan(0);
      expect(FIELD_GROUPS).toContain(spec.group);
      expect(valueInputs(key).length).toBeGreaterThan(0);
      expect((IGDB_FEEDBACK_FIELDS as readonly string[]).includes(key)).toBe(true);
      expect(IGDB_FEEDBACK_REGISTRY[key]).toBeDefined();
    }
    expect(Object.keys(FIELD_CORRECTION_SPECS).sort()).toEqual([...FIELD_CORRECTION_KEYS].sort());
    expect(fieldKeysByGroup().flatMap((g) => g.keys).sort()).toEqual([...FIELD_CORRECTION_KEYS].sort());
  });

  it("單值文字欄位只允許 change；媒體與多值欄位依規格", () => {
    for (const k of ["name", "summary", "storyline", "game_type", "game_status"] as const) expect(FIELD_CORRECTION_SPECS[k].ops).toEqual(["change"]);
    expect(FIELD_CORRECTION_SPECS.screenshot.ops).toEqual(["add", "remove"]);
    expect(FIELD_CORRECTION_SPECS.genre.ops).toEqual(["add", "change", "remove"]);
  });

  it("回報類型規則：目標只能是遊戲、必填", () => {
    expect(REPORT_TYPE_RULES.field_correction).toEqual({ targets: ["game"], targetRequired: true });
  });
});

describe("驗證（validateReportRequest）", () => {
  it("每個欄位 × 每個允許的動作：合法值通過，輸出已 trim 與正規化", () => {
    for (const key of FIELD_CORRECTION_KEYS) {
      for (const op of FIELD_CORRECTION_SPECS[key].ops) {
        const res = validateReportRequest(body({ field: key, op, value: sampleValue(key) }));
        expect(res.ok, `${key}/${op}: ${JSON.stringify(res)}`).toBe(true);
        if (res.ok) expect(res.value.proposed).toMatchObject({ field: key, op });
      }
    }
  });

  it("每個欄位：不允許的動作 → proposed.op invalid", () => {
    for (const key of FIELD_CORRECTION_KEYS) {
      for (const op of FIELD_OPS.filter((o) => !FIELD_CORRECTION_SPECS[key].ops.includes(o))) {
        const res = validateReportRequest(body({ field: key, op, value: sampleValue(key) }));
        expect(res).toEqual({ ok: false, fields: { "proposed.op": "invalid" } });
      }
    }
  });

  it("欄位鍵、動作、值缺漏或不合法", () => {
    expect(validateReportRequest(body({ op: "change", value: { text: "x" } }))).toMatchObject({ ok: false, fields: { "proposed.field": "required" } });
    expect(validateReportRequest(body({ field: "nope", op: "change", value: { text: "x" } }))).toMatchObject({ ok: false, fields: { "proposed.field": "invalid" } });
    expect(validateReportRequest(body({ field: "summary", value: { text: "x" } }))).toMatchObject({ ok: false, fields: { "proposed.op": "required" } });
    expect(validateReportRequest(body({ field: "summary", op: "change" }))).toMatchObject({ ok: false, fields: { "proposed.value": "required" } });
    expect(validateReportRequest(body({ field: "summary", op: "change", value: { text: "   " } }))).toMatchObject({ ok: false, fields: { "proposed.value.text": "required" } });
    expect(validateReportRequest(body({ field: "genre", op: "remove", value: {} }))).toMatchObject({ ok: false, fields: { "proposed.value.name": "required" } });
    expect(validateReportRequest(body(null))).toMatchObject({ ok: false });
  });

  it("長度上限：summary 4000、name 200、role 等", () => {
    expect(validateReportRequest(body({ field: "summary", op: "change", value: { text: "a".repeat(4000) } })).ok).toBe(true);
    expect(validateReportRequest(body({ field: "summary", op: "change", value: { text: "a".repeat(4001) } }))).toMatchObject({ ok: false, fields: { "proposed.value.text": "too_long" } });
    expect(validateReportRequest(body({ field: "name", op: "change", value: { text: "a".repeat(201) } }))).toMatchObject({ ok: false, fields: { "proposed.value.text": "too_long" } });
    expect(validateReportRequest(body({ field: "genre", op: "add", value: { name: "a".repeat(201) } }))).toMatchObject({ ok: false, fields: { "proposed.value.name": "too_long" } });
    expect(validateReportRequest(body({ field: "alternative_name", op: "add", value: { name: "ok", comment: "c".repeat(201) } }))).toMatchObject({ ok: false, fields: { "proposed.value.comment": "too_long" } });
  });

  it("URL 只收 http(s)（外部連結與媒體）", () => {
    for (const key of ["external_link", "cover", "video"] as const) {
      for (const bad of ["javascript:alert(1)", "ftp://x.example/a", "not a url", "//x.example"]) {
        expect(validateReportRequest(body({ field: key, op: "add", value: { url: bad } })), `${key} ${bad}`).toMatchObject({ ok: false, fields: { "proposed.value.url": "invalid" } });
      }
    }
    expect(validateReportRequest(body({ field: "cover", op: "add", value: { url: "  https://img.example.com/a.jpg  " } }))).toMatchObject({
      ok: true, value: { proposed: { value: { url: "https://img.example.com/a.jpg" } } },
    });
  });

  it("game_type／game_status 只收字典值；locale 為 BCP-47；公司角色", () => {
    expect(validateReportRequest(body({ field: "game_type", op: "change", value: { text: "remake" } })).ok).toBe(true);
    expect(validateReportRequest(body({ field: "game_type", op: "change", value: { text: "Remake!" } }))).toMatchObject({ ok: false, fields: { "proposed.value.text": "invalid" } });
    expect(validateReportRequest(body({ field: "game_status", op: "change", value: { text: "cancelled" } })).ok).toBe(true);
    expect(validateReportRequest(body({ field: "localized_title_other", op: "add", value: { locale: "zh-Hans", name: "x" } })).ok).toBe(true);
    expect(validateReportRequest(body({ field: "localized_title_other", op: "add", value: { locale: "not a locale", name: "x" } }))).toMatchObject({ ok: false, fields: { "proposed.value.locale": "invalid" } });
    // 開發商／發行商：角色由欄位決定，忽略輸入；協力／移植要選
    expect(validateReportRequest(body({ field: "company_developer", op: "add", value: { name: "X", role: "publisher" } }))).toMatchObject({ ok: true, value: { proposed: { value: { role: "developer" } } } });
    expect(validateReportRequest(body({ field: "company_supporting", op: "add", value: { name: "X" } }))).toMatchObject({ ok: false, fields: { "proposed.value.role": "required" } });
    expect(validateReportRequest(body({ field: "company_supporting", op: "add", value: { name: "X", role: "developer" } }))).toMatchObject({ ok: false, fields: { "proposed.value.role": "invalid" } });
    expect(validateReportRequest(body({ field: "relation_parent", op: "add", value: { relation: "sequel", gameName: "x" } }))).toMatchObject({ ok: false, fields: { "proposed.value.relation": "invalid" } });
  });

  it("oldValue：只在 change、非 text 形狀才收；會驗證；一律 trim", () => {
    const ok = validateReportRequest(body({ field: "genre", op: "change", value: { name: " RPG " }, oldValue: { name: " Action " } }));
    expect(ok).toMatchObject({ ok: true, value: { proposed: { value: { name: "RPG" }, oldValue: { name: "Action" } } } });
    expect(validateReportRequest(body({ field: "genre", op: "add", value: { name: "RPG" }, oldValue: { name: "Action" } }))).toMatchObject({ ok: false, fields: { "proposed.oldValue": "invalid" } });
    expect(validateReportRequest(body({ field: "summary", op: "change", value: { text: "x" }, oldValue: { text: "y" } }))).toMatchObject({ ok: false, fields: { "proposed.oldValue": "invalid" } });
    expect(validateReportRequest(body({ field: "external_link", op: "change", value: { url: "https://a.example" }, oldValue: { url: "ftp://b" } }))).toMatchObject({ ok: false, fields: { "proposed.oldValue.url": "invalid" } });
  });

  it("目標必須是遊戲；來源網址選填但填了要是 http(s)", () => {
    const base = { field: "genre", op: "add", value: { name: "RPG" } };
    expect(validateReportRequest(body(base, { targetType: "platform" }))).toMatchObject({ ok: false, fields: { targetType: "invalid" } });
    expect(validateReportRequest(body(base, { targetId: undefined }))).toMatchObject({ ok: false, fields: { targetId: "required" } });
    expect(validateReportRequest(body(base)).ok).toBe(true);
    expect(validateReportRequest(body(base, { sourceUrl: "ftp://x" }))).toMatchObject({ ok: false, fields: { sourceUrl: "invalid" } });
  });
});

const game = { id: 1, igdbId: 100, slug: "g", name: "Game", gameStatus: null, zhHantTitle: null };
const facts = (over: Partial<GameFacts> = {}): GameFacts => ({
  ...emptyGameFacts(),
  name: "Elden Ring",
  summary: "A big   world.",
  genres: [{ name: "Role-playing (RPG)", slug: "role-playing-rpg" }],
  companies: [
    { name: "FromSoftware", slug: "fromsoftware", role: "developer" },
    { name: "Bandai Namco", slug: "bandai-namco", role: "publisher" },
  ],
  ...over,
});
const ctxFor = (proposed: FeedbackBuildContext["report"]["proposed"], f: GameFacts | null = facts()): FeedbackBuildContext => ({
  report: { id: 9, reportType: "field_correction", targetType: "game", targetId: 1, proposed, sourceUrl: null, note: "n" },
  game, event: null, plan: null, facts: f,
});
const snap = (f: GameFacts): IgdbAdoptionSnapshot => ({ releases: [], languages: [], gameStatus: f.gameStatus, names: [], facts: f });
const adopted = (field: FieldCorrectionKey, newValue: Parameters<typeof isFeedbackAdopted>[0]["newValue"], f: GameFacts) =>
  isFeedbackAdopted({ field, platformId: null, regionCode: null, stage: null, newValue }, snap(f));

describe("登錄表（field_correction）", () => {
  it("24 個欄位都有 label、推測標註的位置提示、field_correction 類型；媒體欄位是手動標記", () => {
    for (const key of FIELD_CORRECTION_KEYS) {
      const def = IGDB_FEEDBACK_REGISTRY[key];
      expect(def.label).not.toBe("");
      expect(def.igdbLocation).toContain("推測");
      expect(def.reportTypes).toEqual(["field_correction"]);
      expect(def.adoptionRule).not.toBe("");
      expect(def.manualAdoption === true).toBe(FIELD_CORRECTION_SPECS[key].group === "media");
      if (def.manualAdoption) expect(def.adoptionRule).toContain("手動標記");
    }
  });

  it("feedbackFieldFor：field_correction 取提案的欄位鍵；其他類型照舊", () => {
    expect(feedbackFieldFor("field_correction", { field: "genre" })).toBe("genre");
    expect(feedbackFieldFor("field_correction", null)).toBeNull();
    expect(feedbackFieldFor("wrong_stage", null)).toBe("stage");
    expect(feedbackFieldFor("other", null)).toBeNull();
  });

  it("buildFeedbackDraft：每個欄位 × 動作都能建；舊值是我方資料快照、新值帶 op", () => {
    for (const key of FIELD_CORRECTION_KEYS) {
      for (const op of FIELD_CORRECTION_SPECS[key].ops) {
        const draft = buildFeedbackDraft(ctxFor({ field: key, op: op as FieldOp, value: sampleValue(key) }));
        expect(draft, `${key}/${op}`).toMatchObject({ field: key, platformId: null, newValue: { op } });
      }
    }
    expect(buildFeedbackDraft(ctxFor({ field: "genre", op: "add", value: { name: "RPG" } }))).toEqual({
      field: "genre", platformId: null, regionCode: null, stage: null, oldValue: { list: ["Role-playing (RPG)"] }, newValue: { name: "RPG", op: "add" },
    });
    expect(buildFeedbackDraft(ctxFor({ field: "summary", op: "change", value: { text: "new" } }))).toMatchObject({ oldValue: { text: "A big   world." }, newValue: { text: "new", op: "change" } });
    expect(buildFeedbackDraft(ctxFor({ field: "company_developer", op: "add", value: { name: "X", role: "developer" } }))).toMatchObject({ oldValue: { list: ["FromSoftware"] } });
    expect(buildFeedbackDraft(ctxFor({ field: "genre", op: "change", value: { name: "A" }, oldValue: { name: "B" } }))).toMatchObject({ newValue: { name: "A", op: "change", replaces: { name: "B" } } });
  });

  it("資料不足、欄位與提案不符時不建項目", () => {
    expect(buildFeedbackDraft(ctxFor({ field: "genre", op: "add" }))).toBeNull();
    expect(buildFeedbackDraft(ctxFor({ op: "add", value: { name: "x" } }))).toBeNull();
    expect(buildFeedbackDraft(ctxFor({ field: "summary", op: "add", value: { text: "x" } }))).toBeNull(); // summary 不允許 add
    // 沒有 facts（讀不到遊戲資料）仍可建，只是舊值未知
    expect(buildFeedbackDraft(ctxFor({ field: "genre", op: "add", value: { name: "x" } }, null))).toMatchObject({ oldValue: null });
  });

  it("舊值快照：relation_parent 依關聯類型取對應的目前值；清單過長會截斷", () => {
    const f = facts({
      parent: { name: "Base", slug: "base" },
      children: [{ name: "DLC 1", slug: "dlc-1", gameType: "dlc_addon" }, { name: "Exp 1", slug: "exp-1", gameType: "expansion" }],
    });
    expect(buildFeedbackDraft(ctxFor({ field: "relation_parent", op: "add", value: { relation: "parent", gameName: "X" } }, f))?.oldValue).toEqual({ list: ["Base"] });
    expect(buildFeedbackDraft(ctxFor({ field: "relation_parent", op: "add", value: { relation: "dlc", gameName: "X" } }, f))?.oldValue).toEqual({ list: ["DLC 1"] });
    expect(buildFeedbackDraft(ctxFor({ field: "relation_parent", op: "add", value: { relation: "expansion", gameName: "X" } }, f))?.oldValue).toEqual({ list: ["Exp 1"] });
    const many = facts({ externalLinks: Array.from({ length: 50 }, (_, i) => `https://e.example/${i}`) });
    expect(buildFeedbackDraft(ctxFor({ field: "external_link", op: "add", value: { url: "https://x.example" } }, many))?.oldValue?.list).toHaveLength(30);
  });

  it("formatValue 與整理文字：說清楚新增／修改／移除哪一個值、舊值、新值、佐證", () => {
    const def = IGDB_FEEDBACK_REGISTRY.genre;
    expect(def.formatValue({ name: "RPG", op: "add" })).toBe("新增：RPG");
    expect(def.formatValue({ name: "RPG", op: "remove" })).toBe("移除：RPG");
    expect(def.formatValue({ name: "RPG", op: "change", replaces: { name: "Action" } })).toBe("修改：Action → RPG");
    expect(def.formatValue({ list: ["A", "B"] })).toBe("A、B");
    expect(def.formatValue({ list: [] })).toBe("（無）");
    expect(def.formatValue(null)).toBe("（無）");
    expect(IGDB_FEEDBACK_REGISTRY.company_supporting.formatValue({ name: "X", role: "porting", op: "add" })).toBe("新增：X（移植）");
    expect(IGDB_FEEDBACK_REGISTRY.relation_parent.formatValue({ relation: "dlc", gameName: "D", gameSlug: "d", op: "add" })).toBe("新增：DLC（以本作為本傳）：D（d）");

    const paste = buildFeedbackPasteText({
      field: "genre", gameName: "Elden Ring", gameSlug: "elden-ring", igdbGameId: 100, platformName: null, regionCode: null, stage: null,
      oldValue: { list: ["Action"] }, newValue: { name: "RPG", op: "change", replaces: { name: "Action" } },
      sourceUrl: "https://example.com/src", reporterNote: "備註",
    });
    expect(paste).toContain("欄位：類型（遊戲頁 → Edit → Genres（推測，待對照 IGDB 編輯頁））");
    expect(paste).toContain("目前（IGDB）：Action");
    expect(paste).toContain("動作：修改");
    expect(paste).toContain("要修改的舊值：Action");
    expect(paste).toContain("修改後的新值：RPG");
    expect(paste).toContain("佐證：https://example.com/src");
    expect(paste).toContain("回報者備註：備註");
    const add = buildFeedbackPasteText({ field: "screenshot", gameName: "G", gameSlug: "g", igdbGameId: 1, platformName: null, regionCode: null, stage: null, oldValue: { list: [] }, newValue: { url: "https://i.example/a.png", op: "add" }, sourceUrl: null, reporterNote: null });
    expect(add).toContain("動作：新增");
    expect(add).toContain("要新增的值：https://i.example/a.png");
    expect(add).not.toContain("佐證");
    // 第 1 波欄位的文字不變
    const old = buildFeedbackPasteText({ field: "stage", gameName: "G", gameSlug: "g", igdbGameId: 1, platformName: "PS5", regionCode: "WW", stage: "full", oldValue: { stage: "full" }, newValue: { stage: "beta" }, sourceUrl: null, reporterNote: null });
    expect(old).toContain("建議改為：Beta");
    expect(old).not.toContain("動作：");
  });

  it("媒體欄位的佐證連結＝值的網址（報告沒填來源時）", () => {
    const media = { field: "cover" as const, newValue: { url: "https://i.example/c.jpg", op: "add" as const } };
    expect(feedbackSourceUrl(null, media)).toBe("https://i.example/c.jpg");
    expect(feedbackSourceUrl("https://src.example", media)).toBe("https://src.example");
    expect(feedbackSourceUrl(null, { field: "genre", newValue: { name: "x", op: "add" } })).toBeNull();
  });
});

describe("採納比對（isAdopted）", () => {
  it("text 類：NFKC、去頭尾空白、忽略大小寫；內部空白不同視為未採納", () => {
    expect(adopted("name", { text: "ＥＬＤＥＮ　ＲＩＮＧ ", op: "change" }, facts())).toBe(true); // 全形＋全形空白（NFKC 後為半形空白，trim）
    expect(adopted("name", { text: "elden ring", op: "change" }, facts())).toBe(true);
    expect(adopted("name", { text: "Elden Ring 2", op: "change" }, facts())).toBe(false);
    expect(adopted("summary", { text: "A big world.", op: "change" }, facts())).toBe(false);
    expect(adopted("summary", { text: " a big   world. ", op: "change" }, facts())).toBe(true);
    expect(adopted("game_type", { text: "remake", op: "change" }, facts({ gameType: "remake" }))).toBe(true);
    expect(adopted("game_type", { text: "remake", op: "change" }, facts({ gameType: "main_game" }))).toBe(false);
    expect(adopted("game_status", { text: "cancelled", op: "change" }, facts({ gameStatus: "cancelled" }))).toBe(true);
    expect(adopted("storyline", { text: "x", op: "change" }, facts({ storyline: null }))).toBe(false);
  });

  it("名稱類：add 含、remove 不含、change 含新值且（有舊值時）舊值已消失；接受字典 slug", () => {
    const f = facts();
    expect(adopted("genre", { name: "role-playing (rpg)", op: "add" }, f)).toBe(true);
    expect(adopted("genre", { name: "ROLE-PLAYING-RPG", op: "add" }, f)).toBe(true); // slug
    expect(adopted("genre", { name: "Strategy", op: "add" }, f)).toBe(false);
    expect(adopted("genre", { name: "Strategy", op: "remove" }, f)).toBe(true);
    expect(adopted("genre", { name: "Role-playing (RPG)", op: "remove" }, f)).toBe(false);
    expect(adopted("genre", { name: "Role-playing (RPG)", op: "change", replaces: { name: "Action" } }, f)).toBe(true);
    expect(adopted("genre", { name: "Role-playing (RPG)", op: "change", replaces: { name: "Role-playing (RPG)" } }, f)).toBe(false); // 舊值還在
    expect(adopted("genre", { name: "Strategy", op: "change" }, f)).toBe(false);
    expect(adopted("platform", { name: "PC", op: "add" }, facts({ platforms: [{ name: "PC (Microsoft Windows)", slug: "win" }] }))).toBe(false);
    expect(adopted("platform", { name: "win", op: "add" }, facts({ platforms: [{ name: "PC (Microsoft Windows)", slug: "win" }] }))).toBe(true);
    expect(adopted("franchise", { name: "Souls", op: "add" }, facts({ franchises: [{ name: "Souls", slug: "souls" }] }))).toBe(true);
    expect(adopted("collection", { name: "Souls", op: "add" }, facts({ franchises: [{ name: "Souls", slug: "souls" }] }))).toBe(false); // franchise 不等於 collection
    expect(adopted("engine", { name: "Unreal", op: "remove" }, facts({ engines: [{ name: "Unreal", slug: "ue" }] }))).toBe(false);
  });

  it("alternative_name：註記有給時也要相等；localized_title_other：在地化名稱或別名", () => {
    const f = facts({ alternativeNames: [{ name: "エルデンリング", comment: "Japan title" }], localizationNames: ["艾爾登法環"] });
    expect(adopted("alternative_name", { name: "エルデンリング", op: "add" }, f)).toBe(true);
    expect(adopted("alternative_name", { name: "エルデンリング", comment: "japan TITLE", op: "add" }, f)).toBe(true);
    expect(adopted("alternative_name", { name: "エルデンリング", comment: "Korean", op: "add" }, f)).toBe(false);
    expect(adopted("alternative_name", { name: "エルデンリング", op: "remove" }, f)).toBe(false);
    expect(adopted("localized_title_other", { locale: "ja", name: "エルデンリング", op: "add" }, f)).toBe(true);
    expect(adopted("localized_title_other", { locale: "zh-Hant", name: "艾爾登法環", op: "add" }, f)).toBe(true);
    expect(adopted("localized_title_other", { locale: "ko", name: "엘든 링", op: "add" }, f)).toBe(false);
  });

  it("公司：公司名（或 slug）與角色都要符合；支援 supporting／porting", () => {
    const f = facts({ companies: [{ name: "FromSoftware", slug: "fromsoftware", role: "developer" }, { name: "Port Co", slug: "port-co", role: "porting" }] });
    expect(adopted("company_developer", { name: "fromsoftware", role: "developer", op: "add" }, f)).toBe(true);
    expect(adopted("company_publisher", { name: "FromSoftware", role: "publisher", op: "add" }, f)).toBe(false); // 角色不同
    expect(adopted("company_publisher", { name: "FromSoftware", role: "publisher", op: "remove" }, f)).toBe(true);
    expect(adopted("company_supporting", { name: "port-co", role: "porting", op: "add" }, f)).toBe(true);
    expect(adopted("company_supporting", { name: "Port Co", role: "supporting", op: "add" }, f)).toBe(false);
  });

  it("外部連結：去 www.、結尾斜線、#fragment 後相等；query 不同視為不同", () => {
    const f = facts({ externalLinks: ["https://www.Example.com/game/?a=1"] });
    expect(adopted("external_link", { url: "https://example.com/game?a=1#top", op: "add" }, f)).toBe(true);
    expect(adopted("external_link", { url: "https://example.com/game?a=2", op: "add" }, f)).toBe(false);
    expect(adopted("external_link", { url: "https://example.com/game?a=1", op: "remove" }, f)).toBe(false);
    expect(adopted("external_link", { url: "https://other.example/", op: "remove" }, f)).toBe(true);
  });

  it("年齡分級：標籤同時含分級機構與分級（彙總字串用包含判斷）", () => {
    const f = facts({ ageRatingLabel: "ESRB: M / PEGI: 18" });
    expect(adopted("age_rating", { organization: "esrb", rating: "m", op: "add" }, f)).toBe(true);
    expect(adopted("age_rating", { organization: "CERO", rating: "Z", op: "add" }, f)).toBe(false);
    expect(adopted("age_rating", { organization: "ESRB", rating: "M", op: "add" }, facts({ ageRatingLabel: null }))).toBe(false);
  });

  it("本傳／DLC／版本關聯：依關聯類型比對名稱或 slug", () => {
    const f = facts({
      parent: { name: "Base Game", slug: "base-game" },
      versionParent: { name: "Original", slug: "original" },
      children: [{ name: "Shadow DLC", slug: "shadow-dlc", gameType: "dlc_addon" }, { name: "Big Expansion", slug: "big-exp", gameType: "expansion" }],
    });
    expect(adopted("relation_parent", { relation: "parent", gameName: "base game", op: "add" }, f)).toBe(true);
    expect(adopted("relation_parent", { relation: "parent", gameName: "?", gameSlug: "base-game", op: "add" }, f)).toBe(true);
    expect(adopted("relation_parent", { relation: "parent", gameName: "Other", op: "add" }, f)).toBe(false);
    expect(adopted("relation_parent", { relation: "parent", gameName: "Other", op: "remove" }, f)).toBe(true);
    expect(adopted("relation_parent", { relation: "version_parent", gameName: "Original", op: "add" }, f)).toBe(true);
    expect(adopted("relation_parent", { relation: "dlc", gameName: "Shadow DLC", op: "add" }, f)).toBe(true);
    expect(adopted("relation_parent", { relation: "dlc", gameName: "Big Expansion", op: "add" }, f)).toBe(false); // 類型不同
    expect(adopted("relation_parent", { relation: "expansion", gameName: "Big Expansion", op: "add" }, f)).toBe(true);
    expect(adopted("relation_parent", { relation: "parent", gameName: "Base Game", op: "remove" }, f)).toBe(false);
  });

  it("封面、截圖、影片：永遠不自動偵測", () => {
    const f = facts({ coverUrl: "https://i.example/c.jpg", screenshotUrls: ["https://i.example/s.jpg"], trailerUrl: "https://v.example/t" });
    expect(adopted("cover", { url: "https://i.example/c.jpg", op: "change" }, f)).toBe(false);
    expect(adopted("screenshot", { url: "https://i.example/s.jpg", op: "add" }, f)).toBe(false);
    expect(adopted("screenshot", { url: "https://i.example/zzz.jpg", op: "remove" }, f)).toBe(false);
    expect(adopted("video", { url: "https://v.example/t", op: "add" }, f)).toBe(false);
  });

  it("缺 op 的值（資料毀損）不會被標為採納", () => {
    expect(adopted("genre", { name: "Role-playing (RPG)" }, facts())).toBe(false);
  });
});

describe("i18n：登錄表每個欄位在三語系都有 key", () => {
  const dir = path.resolve(__dirname, "../../../../packages/i18n/messages");
  const load = (locale: string, ns: string) => JSON.parse(readFileSync(path.join(dir, locale, `${ns}.json`), "utf8")) as Record<string, unknown>;
  const get = (o: unknown, p: string): unknown => p.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);

  for (const locale of ["zh-Hant", "en", "ja"]) {
    it(`${locale}`, () => {
      const ui = load(locale, "ui");
      const enums = load(locale, "enums");
      const nonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";
      expect(nonEmpty(get(ui, "report.type.field_correction"))).toBe(true);
      for (const key of FIELD_CORRECTION_KEYS) expect(nonEmpty(get(ui, `report.fc.field.${key}`)), `field.${key}`).toBe(true);
      for (const g of FIELD_GROUPS) expect(nonEmpty(get(ui, `report.fc.group.${g}`)), `group.${g}`).toBe(true);
      for (const op of FIELD_OPS) expect(nonEmpty(get(ui, `report.fc.op.${op}`)), `op.${op}`).toBe(true);
      const inputKeys = new Set(FIELD_CORRECTION_KEYS.flatMap((k) => valueInputs(k).map((i) => i.key)));
      for (const k of inputKeys) expect(nonEmpty(get(ui, `report.fc.input.${k}`)), `input.${k}`).toBe(true);
      for (const r of ["supporting", "porting"]) expect(nonEmpty(get(ui, `report.fc.role.${r}`))).toBe(true);
      for (const r of ["parent", "version_parent", "dlc", "expansion"]) expect(nonEmpty(get(ui, `report.fc.relation.${r}`))).toBe(true);
      for (const k of ["intro", "fieldLabel", "opLabel", "oldValueLegend", "hint.media", "hint.locale", "hint.oldValue", "hint.remove"]) expect(nonEmpty(get(ui, `report.fc.${k}`)), k).toBe(true);
      for (const v of FIELD_CORRECTION_SPECS.game_type.choices ?? []) expect(nonEmpty(get(enums, `gameType.${v}`)), `gameType.${v}`).toBe(true);
      for (const v of FIELD_CORRECTION_SPECS.game_status.choices ?? []) expect(nonEmpty(get(enums, `gameStatus.${v}`)), `gameStatus.${v}`).toBe(true);
    });
  }
});
