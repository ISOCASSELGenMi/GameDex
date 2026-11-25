/**
 * 待回饋 IGDB 清單的欄位登錄表（12 §待回饋 IGDB 清單，D91）。純函式、零外部依賴。
 * 核可回報時建立項目、後台顯示與整理貼上文字、同步後偵測「IGDB 已採納」都由這份登錄表驅動：
 * 新增一個可回饋的欄位＝IGDB_FEEDBACK_FIELDS 加鍵＋這裡加一筆（build、formatValue、isAdopted）＋對應的回報類型，不必動其他分支。
 * 程式完全不呼叫 IGDB 的寫入；項目只是給管理者手動到 IGDB 網站提交修改的清單。
 */
import type {
  DatePrecision,
  FieldCorrectionKey,
  FieldCorrectionValue,
  GameFacts,
  IgdbFeedbackDraft,
  IgdbFeedbackField,
  IgdbFeedbackItem,
  IgdbFeedbackValue,
  IsoDate,
  LanguageSupportType,
  ReleaseStage,
  ReportProposed,
  ReportType,
} from "./entities";
import { FIELD_CORRECTION_KEYS } from "./entities";
import { FIELD_CORRECTION_SPECS, type FieldShape } from "./field-corrections";
import type { ProposedSpan } from "./report-validation";

// ── 建立項目時需要的資料（repository 讀好後交給純函式）──────────────────────

export interface FeedbackGameInfo {
  id: number;
  igdbId: number;
  /** games.slug（即 IGDB 的遊戲 slug）。 */
  slug: string;
  name: string;
  gameStatus: string | null;
  /** 核可前的 zh-Hant 顯示標題（games.displayNames['zh-Hant']）。 */
  zhHantTitle: string | null;
}

export interface FeedbackReportInfo {
  id: number;
  reportType: ReportType;
  targetType: string;
  targetId: number | null;
  proposed: ReportProposed | null;
  sourceUrl: string | null;
  note: string | null;
}

/** 日期類回報核可時會寫入的 manual 列（domain/report-resolution.ts planManualRelease 的結果，加上地區代碼與同鍵 igdb 列的值）。 */
export interface FeedbackDatePlan {
  platformId: number;
  regionCode: string;
  stage: ReleaseStage;
  span: ProposedSpan;
  /** 同 (遊戲, 平台, 地區, 階段) 的 igdb 列；沒有＝IGDB 無此上市日。 */
  igdbRow: { releaseDate: IsoDate | null; precision: DatePrecision } | null;
}

export interface FeedbackBuildContext {
  report: FeedbackReportInfo;
  game: FeedbackGameInfo;
  /** wrong_stage／cancelled（目標是上市事件）的目標列。 */
  event: { platformId: number; regionCode: string; stage: ReleaseStage; status: string } | null;
  plan: FeedbackDatePlan | null;
  /** 目標遊戲目前的資料（field_correction 的舊值快照用；日期類與第 1 波的欄位不需要）。 */
  facts?: GameFacts | null;
}

// ── 偵測「IGDB 已採納」用的資料（同步剛寫入的 IGDB 資料，一款遊戲取一次）──────────

export interface IgdbAdoptionSnapshot {
  /** source='igdb' 且 sourceStatus='active' 的上市列。 */
  releases: ReadonlyArray<{ platformId: number; regionCode: string; stage: ReleaseStage; date: IsoDate | null; precision: DatePrecision; status: string }>;
  /** source='igdb' 的語言支援。 */
  languages: ReadonlyArray<{ code: string; supportType: LanguageSupportType }>;
  gameStatus: string | null;
  /** games.alternativeNames 的名稱＋source='igdb' 的 game_localizations 名稱。 */
  names: readonly string[];
  /** 這款遊戲目前的資料（field_correction 的採納比對用）。 */
  facts: GameFacts;
}

export const emptyGameFacts = (): GameFacts => ({
  igdbId: 0, name: "", summary: null, storyline: null, gameType: null, gameStatus: null, coverUrl: null, trailerUrl: null,
  screenshotUrls: [], ageRatingLabel: null, alternativeNames: [], localizationNames: [],
  genres: [], themes: [], gameModes: [], playerPerspectives: [], engines: [], franchises: [], collections: [], platforms: [],
  companies: [], externalLinks: [], parent: null, versionParent: null, children: [],
});

export type AdoptionTarget = Pick<IgdbFeedbackItem, "field" | "platformId" | "regionCode" | "stage" | "newValue">;

// ── 顯示用文字（後台固定 zh-Hant）──────────────────────────────────────────

const PRECISION_TEXT: Record<DatePrecision, string> = { day: "日", month: "月", quarter: "季", year: "年", tbd: "未定" };
const STAGE_TEXT: Record<ReleaseStage, string> = {
  unspecified: "未標示", full: "正式版", early_access: "搶先體驗", beta: "Beta", alpha: "Alpha", demo: "試玩版", other: "其他",
};
const SUPPORT_TEXT: Record<LanguageSupportType, string> = { interface: "介面", subtitles: "字幕", audio: "語音" };
const STATUS_TEXT: Record<string, string> = {
  scheduled: "預定", delayed: "延期", released: "已上市", cancelled: "已取消",
  alpha: "Alpha", beta: "Beta", early_access: "搶先體驗", offline: "已下線", rumored: "傳聞", delisted: "已下架",
};

export const stageText = (s: ReleaseStage): string => STAGE_TEXT[s] ?? s;

function dateValueText(v: IgdbFeedbackValue | null): string {
  if (!v) return "（無）";
  const precision = v.precision ?? "day";
  return precision === "tbd" || !v.date ? "日期未定" : `${v.date}（精度：${PRECISION_TEXT[precision]}）`;
}

const norm = (s: string): string => s.normalize("NFKC").trim().toLowerCase();

// ── 登錄表 ──────────────────────────────────────────────────────────────

export interface FeedbackFieldDef {
  /** 欄位標籤。 */
  label: string;
  /** IGDB 遊戲頁上該欄位的位置（純文字提示）。 */
  igdbLocation: string;
  /** 哪些回報類型核可時會建立這個欄位的項目。 */
  reportTypes: readonly ReportType[];
  /** 「IGDB 已採納」的判斷方式（說明文字；實際比對是 isAdopted）。 */
  adoptionRule: string;
  /** 從核可的回報建立項目內容；資料不足回 null（不建項目）。 */
  build(ctx: FeedbackBuildContext): IgdbFeedbackDraft | null;
  /** 舊值／新值的顯示文字。 */
  formatValue(v: IgdbFeedbackValue | null): string;
  /** 剛寫入的 IGDB 資料是否已含新值。 */
  isAdopted(item: AdoptionTarget, snap: IgdbAdoptionSnapshot): boolean;
  /** true＝只能由管理者手動標記（不自動偵測；封面、截圖、影片）。 */
  manualAdoption?: boolean;
}

function buildDate(field: "release_date" | "region_date", ctx: FeedbackBuildContext): IgdbFeedbackDraft | null {
  const plan = ctx.plan;
  if (!plan) return null;
  return {
    field,
    platformId: plan.platformId,
    regionCode: plan.regionCode,
    stage: plan.stage,
    oldValue: plan.igdbRow ? { date: plan.igdbRow.releaseDate, precision: plan.igdbRow.precision } : null,
    newValue: { date: plan.span.releaseDate, precision: plan.span.precision },
  };
}

function adoptedDate(item: AdoptionTarget, snap: IgdbAdoptionSnapshot): boolean {
  const want = item.newValue;
  return snap.releases.some(
    (r) =>
      r.platformId === item.platformId &&
      r.regionCode === item.regionCode &&
      r.stage === item.stage &&
      r.date === (want.date ?? null) &&
      r.precision === (want.precision ?? "day"),
  );
}

const dateDef = (label: string, igdbLocation: string, reportType: ReportType, field: "release_date" | "region_date"): FeedbackFieldDef => ({
  label,
  igdbLocation,
  reportTypes: [reportType],
  adoptionRule: "IGDB 出現同遊戲、平台、地區、階段的上市列，日期與精度等於新值",
  build: (ctx) => buildDate(field, ctx),
  formatValue: dateValueText,
  isAdopted: adoptedDate,
});

// ── field_correction（D92）：24 個通用欄位 ────────────────────────────────────
// 形狀、允許動作、長度上限在 domain/field-corrections.ts；這裡只有登錄表需要的顯示文字、舊值快照與採納比對。

const OP_TEXT: Record<"add" | "change" | "remove", string> = { add: "新增", change: "修改", remove: "移除" };
const ROLE_TEXT: Record<string, string> = { developer: "開發商", publisher: "發行商", supporting: "協力開發", porting: "移植" };
const RELATION_TEXT: Record<string, string> = { parent: "本傳", version_parent: "版本本體", dlc: "DLC（以本作為本傳）", expansion: "擴充（以本作為本傳）" };
/** 舊值快照最多列幾筆（外部連結、截圖、協力公司可能很多）。 */
const SNAPSHOT_LIST_CAP = 30;

/** 一個欄位值（提案或被取代的舊值）的顯示文字。 */
function valueText(shape: FieldShape, v: FieldCorrectionValue): string {
  switch (shape) {
    case "text":
      return v.text ?? "（無）";
    case "name":
      return v.name ?? "（無）";
    case "altName":
      return v.comment ? `${v.name ?? ""}（${v.comment}）` : (v.name ?? "（無）");
    case "localizedTitle":
      return `${v.name ?? ""}（${v.locale ?? "?"}）`;
    case "company":
      return `${v.name ?? ""}（${ROLE_TEXT[v.role ?? ""] ?? v.role ?? "?"}）`;
    case "link":
      return v.label ? `${v.url ?? ""}（${v.label}）` : (v.url ?? "（無）");
    case "ageRating":
      return `${v.organization ?? ""} ${v.rating ?? ""}`.trim();
    case "relation":
      return `${RELATION_TEXT[v.relation ?? ""] ?? v.relation ?? "?"}：${v.gameName ?? ""}${v.gameSlug ? `（${v.gameSlug}）` : ""}`;
    case "media":
      return v.url ?? "（無）";
  }
}

function formatCorrection(shape: FieldShape, v: IgdbFeedbackValue | null): string {
  if (!v) return "（無）";
  if (v.op) {
    const val = valueText(shape, v);
    return v.op === "change" && v.replaces ? `修改：${valueText(shape, v.replaces)} → ${val}` : `${OP_TEXT[v.op]}：${val}`;
  }
  if (v.list) return v.list.length > 0 ? v.list.join("、") : "（無）";
  return v.text ?? "（無）";
}

const nameOf = (list: ReadonlyArray<{ name: string }>): string[] => list.map((x) => x.name);
const capList = (xs: string[]): IgdbFeedbackValue => ({ list: xs.slice(0, SNAPSHOT_LIST_CAP) });
const textOf = (t: string | null): IgdbFeedbackValue | null => (t ? { text: t } : null);

/** 核可當下我方資料的快照（單值欄位 text、多值欄位 list）。 */
function correctionSnapshot(key: FieldCorrectionKey, f: GameFacts, value: FieldCorrectionValue): IgdbFeedbackValue | null {
  switch (key) {
    case "name": return textOf(f.name);
    case "summary": return textOf(f.summary);
    case "storyline": return textOf(f.storyline);
    case "game_type": return textOf(f.gameType);
    case "game_status": return textOf(f.gameStatus);
    case "alternative_name": return capList(f.alternativeNames.map((a) => (a.comment ? `${a.name}（${a.comment}）` : a.name)));
    case "localized_title_other": return capList([...f.localizationNames]);
    case "cover": return textOf(f.coverUrl);
    case "screenshot": return capList([...f.screenshotUrls]);
    case "video": return textOf(f.trailerUrl);
    case "genre": return capList(nameOf(f.genres));
    case "theme": return capList(nameOf(f.themes));
    case "game_mode": return capList(nameOf(f.gameModes));
    case "player_perspective": return capList(nameOf(f.playerPerspectives));
    case "engine": return capList(nameOf(f.engines));
    case "platform": return capList(nameOf(f.platforms));
    case "franchise": return capList(nameOf(f.franchises));
    case "collection": return capList(nameOf(f.collections));
    case "company_developer": return capList(f.companies.filter((c) => c.role === "developer").map((c) => c.name));
    case "company_publisher": return capList(f.companies.filter((c) => c.role === "publisher").map((c) => c.name));
    case "company_supporting":
      return capList(f.companies.filter((c) => c.role === "supporting" || c.role === "porting").map((c) => `${c.name}（${ROLE_TEXT[c.role] ?? c.role}）`));
    case "external_link": return capList([...f.externalLinks]);
    case "age_rating": return textOf(f.ageRatingLabel);
    case "relation_parent": {
      const r = value.relation;
      if (r === "parent") return capList(f.parent ? [f.parent.name] : []);
      if (r === "version_parent") return capList(f.versionParent ? [f.versionParent.name] : []);
      const type = r === "dlc" ? "dlc_addon" : "expansion";
      return capList(f.children.filter((c) => c.gameType === type).map((c) => c.name));
    }
  }
}

function normUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    return `${x.protocol}//${x.hostname.toLowerCase().replace(/^www\./, "")}${x.port ? `:${x.port}` : ""}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return norm(u);
  }
}

const namedHas = (list: ReadonlyArray<{ name: string; slug: string | null }>, want: string | undefined): boolean => {
  const w = norm(want ?? "");
  return w !== "" && list.some((x) => norm(x.name) === w || (x.slug !== null && norm(x.slug) === w));
};

/** 目前 IGDB 資料是否含這個值（add＝含、remove＝不含、change＝含新值）。封面、截圖、影片不自動偵測，回 false。 */
function presentInFacts(key: FieldCorrectionKey, v: FieldCorrectionValue, f: GameFacts): boolean {
  const eq = (a: string | null | undefined, b: string | undefined) => !!b && norm(a ?? "") === norm(b);
  switch (key) {
    case "name": return eq(f.name, v.text);
    case "summary": return eq(f.summary, v.text);
    case "storyline": return eq(f.storyline, v.text);
    case "game_type": return eq(f.gameType, v.text);
    case "game_status": return eq(f.gameStatus, v.text);
    case "alternative_name":
      return f.alternativeNames.some((a) => eq(a.name, v.name) && (!v.comment || eq(a.comment, v.comment)));
    case "localized_title_other":
      return [...f.localizationNames, ...f.alternativeNames.map((a) => a.name)].some((n) => eq(n, v.name));
    case "cover": case "screenshot": case "video": return false;
    case "genre": return namedHas(f.genres, v.name);
    case "theme": return namedHas(f.themes, v.name);
    case "game_mode": return namedHas(f.gameModes, v.name);
    case "player_perspective": return namedHas(f.playerPerspectives, v.name);
    case "engine": return namedHas(f.engines, v.name);
    case "platform": return namedHas(f.platforms, v.name);
    case "franchise": return namedHas(f.franchises, v.name);
    case "collection": return namedHas(f.collections, v.name);
    case "company_developer": case "company_publisher": case "company_supporting":
      return namedHas(f.companies.filter((c) => c.role === v.role), v.name);
    case "external_link": {
      const want = v.url ? normUrl(v.url) : "";
      return want !== "" && f.externalLinks.some((u) => normUrl(u) === want);
    }
    case "age_rating": {
      const label = norm(f.ageRatingLabel ?? "");
      return label !== "" && !!v.organization && !!v.rating && label.includes(norm(v.organization)) && label.includes(norm(v.rating));
    }
    case "relation_parent": {
      const target = (x: { name: string; slug: string | null } | null) =>
        !!x && (norm(x.name) === norm(v.gameName ?? "") || (!!v.gameSlug && x.slug !== null && norm(x.slug) === norm(v.gameSlug)));
      if (v.relation === "parent") return target(f.parent);
      if (v.relation === "version_parent") return target(f.versionParent);
      const type = v.relation === "dlc" ? "dlc_addon" : "expansion";
      return f.children.some((c) => c.gameType === type && target(c));
    }
  }
}

const correctionDef = (key: FieldCorrectionKey, label: string, igdbLocation: string, adoptionRule: string): FeedbackFieldDef => {
  const spec = FIELD_CORRECTION_SPECS[key];
  const manual = spec.group === "media";
  return {
    label,
    igdbLocation: `${igdbLocation}（推測，待對照 IGDB 編輯頁）`,
    reportTypes: ["field_correction"],
    adoptionRule: manual ? "手動標記（不自動偵測）" : adoptionRule,
    manualAdoption: manual,
    build: (ctx) => {
      const p = ctx.report.proposed;
      if (!p || p.field !== key || !p.op || !p.value || !spec.ops.includes(p.op)) return null;
      return {
        field: key,
        platformId: null,
        regionCode: null,
        stage: null,
        oldValue: ctx.facts ? correctionSnapshot(key, ctx.facts, p.value) : null,
        newValue: { ...p.value, op: p.op, ...(p.oldValue ? { replaces: p.oldValue } : {}) },
      };
    },
    formatValue: (v) => formatCorrection(spec.shape, v),
    isAdopted: (item, snap) => {
      const v = item.newValue;
      if (manual || !v.op) return false;
      if (v.op === "add") return presentInFacts(key, v, snap.facts);
      if (v.op === "remove") return !presentInFacts(key, v, snap.facts);
      return presentInFacts(key, v, snap.facts) && (!v.replaces || !presentInFacts(key, v.replaces, snap.facts));
    },
  };
};

const SAME = "IGDB 現有資料正規化後（NFKC、去頭尾空白、忽略大小寫）等於新值";
const IN_LIST = "新增：IGDB 清單含該名稱（或字典 slug）；移除：清單已不含；修改：含新值且（若提供舊值）舊值已消失";
const CORRECTION_DEFS: Record<FieldCorrectionKey, FeedbackFieldDef> = {
  name: correctionDef("name", "遊戲原名", "遊戲頁 → Edit → Name", SAME),
  summary: correctionDef("summary", "簡介", "遊戲頁 → Edit → Summary", SAME),
  storyline: correctionDef("storyline", "故事簡介", "遊戲頁 → Edit → Storyline", SAME),
  game_type: correctionDef("game_type", "遊戲類型（本傳／DLC／重製…）", "遊戲頁 → Edit → Category／Game type", SAME),
  game_status: correctionDef("game_status", "發售狀態", "遊戲頁 → Edit → Status", SAME),
  alternative_name: correctionDef("alternative_name", "其他稱呼", "遊戲頁 → Edit → Alternative names", "IGDB 的別名含該名稱（有註記時註記也要相同）；移除則為已不含"),
  localized_title_other: correctionDef("localized_title_other", "其他語系標題", "遊戲頁 → Edit → Alternative names 或 Localizations", "IGDB 的在地化名稱或別名含該標題"),
  cover: correctionDef("cover", "封面圖", "遊戲頁 → Edit → Cover", ""),
  screenshot: correctionDef("screenshot", "截圖／美術圖", "遊戲頁 → Edit → Screenshots／Artworks", ""),
  video: correctionDef("video", "預告片", "遊戲頁 → Edit → Videos", ""),
  genre: correctionDef("genre", "類型", "遊戲頁 → Edit → Genres", IN_LIST),
  theme: correctionDef("theme", "主題", "遊戲頁 → Edit → Themes", IN_LIST),
  game_mode: correctionDef("game_mode", "遊戲模式", "遊戲頁 → Edit → Game modes", IN_LIST),
  player_perspective: correctionDef("player_perspective", "玩家視角", "遊戲頁 → Edit → Player perspectives", IN_LIST),
  engine: correctionDef("engine", "遊戲引擎", "遊戲頁 → Edit → Game engines", IN_LIST),
  platform: correctionDef("platform", "發行平台", "遊戲頁 → Edit → Platforms", "遊戲的平台集合含該平台（或 slug）；移除則為已不含"),
  company_developer: correctionDef("company_developer", "開發商", "遊戲頁 → Edit → Companies（Developer）", "遊戲公司列含該公司且角色為開發商；移除則為已不含"),
  company_publisher: correctionDef("company_publisher", "發行商", "遊戲頁 → Edit → Companies（Publisher）", "遊戲公司列含該公司且角色為發行商；移除則為已不含"),
  company_supporting: correctionDef("company_supporting", "協力開發／移植", "遊戲頁 → Edit → Companies（Supporting／Porting）", "遊戲公司列含該公司且角色相同；移除則為已不含"),
  franchise: correctionDef("franchise", "品牌", "遊戲頁 → Edit → Franchises", IN_LIST),
  collection: correctionDef("collection", "系列", "遊戲頁 → Edit → Collections", IN_LIST),
  external_link: correctionDef("external_link", "外部連結", "遊戲頁 → Edit → Websites", "IGDB 的外部連結含相同網址（去 www.、結尾斜線、#fragment 後比對）；移除則為已不含"),
  age_rating: correctionDef("age_rating", "年齡分級", "遊戲頁 → Edit → Age ratings", "age_rating_label 含分級機構與分級（我方目前未同步該欄位，實務上需手動標記）"),
  relation_parent: correctionDef("relation_parent", "本傳／DLC／版本關聯", "遊戲頁 → Edit → Parent game／Version parent／Expansions", "對應關聯（本傳、版本本體，或以本作為本傳的 DLC／擴充）指向同名或同 slug 的遊戲；移除則為已不指向"),
};

export const IGDB_FEEDBACK_REGISTRY: Readonly<Record<IgdbFeedbackField, FeedbackFieldDef>> = {
  ...CORRECTION_DEFS,
  release_date: dateDef("上市日期（修正）", "遊戲頁 → Release dates → 該平台／地區那一列的日期", "wrong_date", "release_date"),
  region_date: dateDef("補充地區上市日", "遊戲頁 → Release dates → 新增該平台／地區的上市日", "missing_region_date", "region_date"),
  stage: {
    label: "上市階段",
    igdbLocation: "遊戲頁 → Release dates → 該平台／地區那一列的階段（Status）",
    reportTypes: ["wrong_stage"],
    adoptionRule: "IGDB 出現同遊戲、平台、地區的上市列，階段等於新階段",
    build: (ctx) => {
      const { event, report } = ctx;
      const stage = report.proposed?.stage;
      if (!event || !stage) return null;
      return {
        field: "stage",
        platformId: event.platformId,
        regionCode: event.regionCode,
        stage: event.stage,
        oldValue: { stage: event.stage },
        newValue: { stage },
      };
    },
    formatValue: (v) => (v?.stage ? stageText(v.stage) : "（無）"),
    isAdopted: (item, snap) =>
      snap.releases.some((r) => r.platformId === item.platformId && r.regionCode === item.regionCode && r.stage === item.newValue.stage),
  },
  language_support: {
    label: "語言支援",
    igdbLocation: "遊戲頁 → Language supports → 新增語言與支援類型",
    reportTypes: ["language_support"],
    adoptionRule: "IGDB 的語言支援含該語言與支援類型",
    build: (ctx) => {
      const p = ctx.report.proposed;
      if (!p?.language || !p.supportType) return null;
      return {
        field: "language_support",
        platformId: null,
        regionCode: null,
        stage: null,
        oldValue: null,
        newValue: { language: p.language, supportType: p.supportType },
      };
    },
    formatValue: (v) => (v?.language && v.supportType ? `${v.language}／${SUPPORT_TEXT[v.supportType]}` : "（無）"),
    isAdopted: (item, snap) =>
      snap.languages.some((l) => l.code === item.newValue.language && l.supportType === item.newValue.supportType),
  },
  cancelled: {
    label: "取消／停止開發",
    igdbLocation: "遊戲頁 → Status（遊戲狀態）；上市事件則是 Release dates 該列的狀態",
    reportTypes: ["cancelled"],
    adoptionRule: "目標是上市事件：IGDB 同平台、地區、階段的列狀態為 cancelled；目標是遊戲：games.gameStatus 為 cancelled",
    build: (ctx) => {
      const { event, game } = ctx;
      const target = ctx.report.targetType === "release_event" ? event : null;
      if (ctx.report.targetType === "release_event" && !event) return null;
      return {
        field: "cancelled",
        platformId: target?.platformId ?? null,
        regionCode: target?.regionCode ?? null,
        stage: target?.stage ?? null,
        oldValue: { status: target ? target.status : game.gameStatus },
        newValue: { status: "cancelled" },
      };
    },
    formatValue: (v) => (v?.status ? (STATUS_TEXT[v.status] ?? v.status) : "（無）"),
    isAdopted: (item, snap) =>
      item.platformId === null
        ? snap.gameStatus === "cancelled"
        : snap.releases.some(
            (r) => r.platformId === item.platformId && r.regionCode === item.regionCode && r.stage === item.stage && r.status === "cancelled",
          ),
  },
  localized_title: {
    label: "繁體中文標題",
    igdbLocation: "遊戲頁 → Alternative names → 新增名稱（註明 Traditional Chinese）",
    reportTypes: ["localized_title"],
    adoptionRule: "IGDB 的別名或在地化名稱有與新標題相同的名稱（NFKC、去頭尾空白、忽略大小寫）",
    build: (ctx) => {
      const title = ctx.report.proposed?.title?.trim();
      if (!title) return null;
      return {
        field: "localized_title",
        platformId: null,
        regionCode: null,
        stage: null,
        oldValue: { title: ctx.game.zhHantTitle },
        newValue: { title },
      };
    },
    formatValue: (v) => v?.title ?? "（無）",
    isAdopted: (item, snap) => {
      const want = item.newValue.title ? norm(item.newValue.title) : "";
      return want !== "" && snap.names.some((n) => norm(n) === want);
    },
  },
};

/** 核可的回報類型 → 要建立的欄位鍵；不建項目的類型（duplicate、takedown、other）回 null。field_correction 的欄位鍵在提案裡，請用 feedbackFieldFor。 */
export function feedbackFieldForReportType(type: ReportType): IgdbFeedbackField | null {
  if (type === "field_correction") return null;
  for (const [field, def] of Object.entries(IGDB_FEEDBACK_REGISTRY) as Array<[IgdbFeedbackField, FeedbackFieldDef]>) {
    if (def.reportTypes.includes(type)) return field;
  }
  return null;
}

/** 回報（含提案）→ 要建立的欄位鍵；field_correction 取提案的欄位鍵。 */
export function feedbackFieldFor(type: ReportType, proposed: ReportProposed | null): IgdbFeedbackField | null {
  if (type === "field_correction") return proposed?.field && (FIELD_CORRECTION_KEYS as readonly string[]).includes(proposed.field) ? proposed.field : null;
  return feedbackFieldForReportType(type);
}

/** 由回報建立項目內容（預覽與寫入同一份計算）；此類型不建項目或資料不足回 null。 */
export function buildFeedbackDraft(ctx: FeedbackBuildContext): IgdbFeedbackDraft | null {
  const field = feedbackFieldFor(ctx.report.reportType, ctx.report.proposed);
  return field ? IGDB_FEEDBACK_REGISTRY[field].build(ctx) : null;
}

/** 這筆項目在剛寫入的 IGDB 資料中是否已被採納。 */
export function isFeedbackAdopted(item: AdoptionTarget, snap: IgdbAdoptionSnapshot): boolean {
  return IGDB_FEEDBACK_REGISTRY[item.field].isAdopted(item, snap);
}

/** 項目的佐證連結：回報的來源網址；媒體欄位（封面、截圖、影片）沒填來源時，值的網址就是來源（D92）。 */
export function feedbackSourceUrl(reportSourceUrl: string | null, draft: Pick<IgdbFeedbackDraft, "field" | "newValue">): string | null {
  if (reportSourceUrl) return reportSourceUrl;
  return FIELD_CORRECTION_SPECS[draft.field as FieldCorrectionKey]?.shape === "media" ? (draft.newValue.url ?? null) : null;
}

/** IGDB 遊戲頁。同步遇 slug 衝突時 games.slug 會加上 `-<igdbId>` 尾綴，這裡去掉才是 IGDB 的 slug。 */
export const igdbGameUrl = (slug: string, igdbId: number): string => {
  const suffix = `-${igdbId}`;
  const igdbSlug = slug.endsWith(suffix) && slug.length > suffix.length ? slug.slice(0, -suffix.length) : slug;
  return `https://www.igdb.com/games/${encodeURIComponent(igdbSlug)}`;
};

export interface FeedbackPasteSource {
  field: IgdbFeedbackField;
  gameName: string;
  gameSlug: string;
  igdbGameId: number;
  platformName: string | null;
  regionCode: string | null;
  stage: ReleaseStage | null;
  oldValue: IgdbFeedbackValue | null;
  newValue: IgdbFeedbackValue;
  sourceUrl: string | null;
  reporterNote: string | null;
}

/** 項目定位文字「平台／地區／階段」；沒有任何定位資料回空字串。 */
export function feedbackLocationText(s: Pick<FeedbackPasteSource, "platformName" | "regionCode" | "stage">): string {
  return [s.platformName, s.regionCode, s.stage ? stageText(s.stage) : null].filter((x): x is string => !!x).join("／");
}

/** 可貼到 IGDB 的整理文字（後台唯讀 textarea 的內容）。 */
export function buildFeedbackPasteText(s: FeedbackPasteSource): string {
  const def = IGDB_FEEDBACK_REGISTRY[s.field];
  const lines = [
    `遊戲：${s.gameName}`,
    `IGDB：${igdbGameUrl(s.gameSlug, s.igdbGameId)}`,
    `欄位：${def.label}（${def.igdbLocation}）`,
  ];
  const where = feedbackLocationText(s);
  if (where) lines.push(`平台／地區／階段：${where}`);
  lines.push(`目前（IGDB）：${def.formatValue(s.oldValue)}`);
  const op = s.newValue.op;
  if (op) {
    // field_correction：清楚說明新增／修改／移除哪一個值
    const shape = FIELD_CORRECTION_SPECS[s.field as FieldCorrectionKey].shape;
    lines.push(`動作：${OP_TEXT[op]}`);
    if (op === "change" && s.newValue.replaces) lines.push(`要修改的舊值：${valueText(shape, s.newValue.replaces)}`);
    lines.push(`${op === "add" ? "要新增的值" : op === "remove" ? "要移除的值" : "修改後的新值"}：${valueText(shape, s.newValue)}`);
  } else lines.push(`建議改為：${def.formatValue(s.newValue)}`);
  if (s.sourceUrl) lines.push(`佐證：${s.sourceUrl}`);
  if (s.reporterNote) lines.push(`回報者備註：${s.reporterNote}`);
  return lines.join("\n");
}
