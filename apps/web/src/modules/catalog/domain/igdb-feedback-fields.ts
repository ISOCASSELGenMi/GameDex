/**
 * 待回饋 IGDB 清單的欄位登錄表（12 §待回饋 IGDB 清單，D91）。純函式、零外部依賴。
 * 核可回報時建立項目、後台顯示與整理貼上文字、同步後偵測「IGDB 已採納」都由這份登錄表驅動：
 * 新增一個可回饋的欄位＝IGDB_FEEDBACK_FIELDS 加鍵＋這裡加一筆（build、formatValue、isAdopted）＋對應的回報類型，不必動其他分支。
 * 程式完全不呼叫 IGDB 的寫入；項目只是給管理者手動到 IGDB 網站提交修改的清單。
 */
import type {
  DatePrecision,
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
}

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

export const IGDB_FEEDBACK_REGISTRY: Readonly<Record<IgdbFeedbackField, FeedbackFieldDef>> = {
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

/** 核可的回報類型 → 要建立的欄位鍵；不建項目的類型（duplicate、takedown、other）回 null。 */
export function feedbackFieldForReportType(type: ReportType): IgdbFeedbackField | null {
  for (const [field, def] of Object.entries(IGDB_FEEDBACK_REGISTRY) as Array<[IgdbFeedbackField, FeedbackFieldDef]>) {
    if (def.reportTypes.includes(type)) return field;
  }
  return null;
}

/** 由回報建立項目內容（預覽與寫入同一份計算）；此類型不建項目或資料不足回 null。 */
export function buildFeedbackDraft(ctx: FeedbackBuildContext): IgdbFeedbackDraft | null {
  const field = feedbackFieldForReportType(ctx.report.reportType);
  return field ? IGDB_FEEDBACK_REGISTRY[field].build(ctx) : null;
}

/** 這筆項目在剛寫入的 IGDB 資料中是否已被採納。 */
export function isFeedbackAdopted(item: AdoptionTarget, snap: IgdbAdoptionSnapshot): boolean {
  return IGDB_FEEDBACK_REGISTRY[item.field].isAdopted(item, snap);
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
  lines.push(`目前（IGDB）：${def.formatValue(s.oldValue)}`, `建議改為：${def.formatValue(s.newValue)}`);
  if (s.sourceUrl) lines.push(`佐證：${s.sourceUrl}`);
  if (s.reporterNote) lines.push(`回報者備註：${s.reporterNote}`);
  return lines.join("\n");
}
