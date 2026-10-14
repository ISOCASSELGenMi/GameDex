/**
 * FilterSpec（spec 06 §篩選）：月曆、時間軸、瀏覽、熱門榜、API、Discord 公告共用的篩選條件。
 *
 * 語意（實際查詢由 catalog 實作）：
 * - **同一維度內 OR**：`platform=ps5,switch` → 在 ps5 或 switch 上市。
 * - **不同維度之間 AND**：`platform=ps5&genre=indie` → 在 ps5 上市且類型含 indie。
 * - 維度不存在（undefined）= 不限制；由呼叫端套用預設值（例如 `stage` 預設 CALENDAR_VISIBLE_RELEASE_STAGES）。
 *
 * 兩種參數：
 * - **多值維度**（FILTER_DIMENSIONS）：`?platform=ps5,switch&genre=role-playing-rpg`，值一律 slug（enum 維度用 enum 值），
 *   逗號分隔；同一參數重複出現（`platform=a&platform=b`）視同合併。
 * - **單值參數**（FILTER_SCALAR_PARAMS）：`region`、`from`／`to`、`year`／`yearFrom`／`yearTo`、`minHeat`、`rumored`、`q`、`sort`。
 *   不拆逗號；重複出現時取第一個非空值，其餘記 issue `duplicate`。非法值忽略並記 issue。
 *
 * 3b 不做的維度：`minScore`（Phase 4）、`age`（對照表 ❓）、`mine`（accounts 模組）。
 * 加維度：在 FILTER_PARAMS（＋FILTER_DIMENSIONS 或 FILTER_SCALAR_PARAMS）、DIMENSION_DEFS／SCALAR_DEFS、FilterSpec 各加一項。
 */
import { z } from "zod";

/** 單一參數最多幾個值（spec 06 §篩選、14）；超過整個參數被拒。 */
export const FILTER_MAX_VALUES = 20;
/** slug 最長長度（DB 欄位 varchar(100)／(255)；URL 一律限制 100）。 */
export const FILTER_SLUG_MAX_LENGTH = 100;
/** 搜尋字串 `q` 最長長度（正規化後；超過整個參數被忽略並回報）。 */
export const FILTER_QUERY_MAX_LENGTH = 100;
/** 年份與日期的合法範圍（與 catalog monthBounds 一致）。 */
export const FILTER_YEAR_MIN = 1900;
export const FILTER_YEAR_MAX = 2200;
/** 熱度（games.heat_level）門檻範圍；0＝不顯示，所以門檻從 1 起。 */
export const FILTER_MIN_HEAT_MIN = 1;
export const FILTER_MIN_HEAT_MAX = 5;

/**
 * slug 格式：小寫英數，以連字號分隔。允許連續連字號——IGDB 的實際 slug 有 `ps4--1`、`pdp-7--1`
 * （2026-10-13 對本機 DB 的 platforms／genres 核對）。parse 會先轉小寫。
 */
export const FILTER_SLUG_PATTERN = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/;
/** 地區代碼（regions.code：WW、US、EU、JP、ASIA…）。parse 轉大寫；是否存在由 catalog 判斷。 */
export const FILTER_REGION_PATTERN = /^[A-Z]{2,8}$/;

/**
 * 平台類型合法值。必須與 catalog domain 的 `PLATFORM_KINDS`
 * （apps/web/src/modules/catalog/domain/entities/enums.ts）相同；套件不能 import apps，
 * 由 apps/web 端做型別相等斷言（ui/contract-assertions.ts）。`mobile` 合法但手機平台不寫上市日（P35），篩它會是空結果。
 */
export const FILTER_PLATFORM_KINDS = ["console", "handheld", "hybrid", "pc", "arcade", "mobile", "other"] as const;
export type FilterPlatformKind = (typeof FILTER_PLATFORM_KINDS)[number];

/** 上市階段合法值。必須與 catalog domain 的 `RELEASE_STAGES` 相同（同上，apps/web 端斷言）。 */
export const FILTER_RELEASE_STAGES = ["unspecified", "full", "early_access", "beta", "alpha", "demo", "other"] as const;
export type FilterReleaseStage = (typeof FILTER_RELEASE_STAGES)[number];

/** 遊戲類型（`type`）合法值。必須與 catalog domain 的 `GAME_TYPES` 相同（apps/web 端斷言）。 */
export const FILTER_GAME_TYPES = [
  "main_game", "dlc_addon", "expansion", "bundle", "standalone_expansion", "mod", "episode", "season",
  "remake", "remaster", "expanded_game", "port", "fork", "pack", "update", "other",
] as const;
export type FilterGameType = (typeof FILTER_GAME_TYPES)[number];

/** 上市狀態（`status`）。必須與 catalog domain 的 `RELEASE_STATE_FILTERS` 相同（apps/web 端斷言）。 */
export const FILTER_RELEASE_STATES = ["upcoming", "released", "delayed"] as const;
export type FilterReleaseState = (typeof FILTER_RELEASE_STATES)[number];

/** 項目種類（`show`）。未指定＝兩者都顯示。 */
export const FILTER_SHOW_KINDS = ["releases", "events"] as const;
export type FilterShowKind = (typeof FILTER_SHOW_KINDS)[number];

/** 排序（`sort`，瀏覽用；MVP 不開放依評分，D27）。必須與 catalog domain 的 `BROWSE_SORTS` 相同（apps/web 端斷言）。 */
export const FILTER_SORTS = ["popularity", "release_date", "name"] as const;
export type FilterSort = (typeof FILTER_SORTS)[number];

/** 多值維度（逗號分隔、同維度 OR）。順序即 serialize 的相對順序。 */
export const FILTER_DIMENSIONS = [
  "platform", "platformKind", "genre", "theme", "type", "stage", "status", "show", "company", "franchise",
] as const;
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

/** 單值參數。 */
export const FILTER_SCALAR_PARAMS = ["region", "from", "to", "year", "yearFrom", "yearTo", "minHeat", "rumored", "q", "sort"] as const;
export type FilterScalarParam = (typeof FILTER_SCALAR_PARAMS)[number];

/** 全部參數；順序即 serialize 的輸出順序（固定，快取鍵穩定）。 */
export const FILTER_PARAMS = [
  "platform", "platformKind", "genre", "theme", "type", "stage", "status",
  "region", "from", "to", "year", "yearFrom", "yearTo", "minHeat", "show", "rumored",
  "company", "franchise", "q", "sort",
] as const;
export type FilterParam = (typeof FILTER_PARAMS)[number];

export interface FilterSpec {
  /** 平台 slug（`platforms.slug`）。同維度 OR。 */
  readonly platform?: readonly string[];
  /** 平台類型（`platforms.kind`）。同維度 OR。 */
  readonly platformKind?: readonly FilterPlatformKind[];
  /** 類型 slug（`genres.slug`）。同維度 OR。 */
  readonly genre?: readonly string[];
  /** 主題 slug（`themes.slug`）。同維度 OR。 */
  readonly theme?: readonly string[];
  /** 遊戲類型（`games.game_type`）。未指定時呼叫端套用 CALENDAR_VISIBLE_GAME_TYPES。 */
  readonly type?: readonly FilterGameType[];
  /** 上市階段（`release_events.stage`）。同維度 OR；未指定時呼叫端套用 CALENDAR_VISIBLE_RELEASE_STAGES。 */
  readonly stage?: readonly FilterReleaseStage[];
  /** 上市狀態 upcoming／released／delayed。同維度 OR；未指定＝不限。 */
  readonly status?: readonly FilterReleaseState[];
  /** 項目種類（月曆／時間軸）；未指定＝releases＋events。 */
  readonly show?: readonly FilterShowKind[];
  /** 公司 slug（`companies.slug`，任何角色）。瀏覽用。 */
  readonly company?: readonly string[];
  /** 系列 slug（`franchises.slug`，franchise 與 collection 同 slug 時都算）。瀏覽用。 */
  readonly franchise?: readonly string[];

  /** 地區偏好（regions.code，大寫）。影響聚合挑哪一筆上市日，不只是過濾。 */
  readonly region?: string;
  /** 代表日期下限／上限（`YYYY-MM-DD`，含），月曆以外使用。 */
  readonly from?: string;
  readonly to?: string;
  /** 瀏覽：首發年份。`year` 等同 yearFrom＝yearTo＝year（同時給時 `year` 優先，見 catalog filter-mapping）。 */
  readonly year?: number;
  readonly yearFrom?: number;
  readonly yearTo?: number;
  /** 熱度門檻 1~5（games.heat_level ≥ minHeat）。 */
  readonly minHeat?: number;
  /** `rumored=1`：顯示傳聞遊戲（預設隱藏）。 */
  readonly rumored?: true;
  /** 搜尋字串（瀏覽）：trim＋連續空白合併；比對前由 catalog 經 tokenizeForSearch 正規化。 */
  readonly q?: string;
  /** 排序（瀏覽）；未指定＝popularity。 */
  readonly sort?: FilterSort;
}

/** 某多值維度的值型別。 */
export type FilterValue<D extends FilterDimension> = NonNullable<FilterSpec[D]>[number];
/** 某單值參數的值型別。 */
export type FilterScalarValue<P extends FilterScalarParam> = NonNullable<FilterSpec[P]>;

type DimensionDef = { kind: "slug" } | { kind: "enum"; values: readonly string[] };

const DIMENSION_DEFS: Readonly<Record<FilterDimension, DimensionDef>> = {
  platform: { kind: "slug" },
  platformKind: { kind: "enum", values: FILTER_PLATFORM_KINDS },
  genre: { kind: "slug" },
  theme: { kind: "slug" },
  type: { kind: "enum", values: FILTER_GAME_TYPES },
  stage: { kind: "enum", values: FILTER_RELEASE_STAGES },
  status: { kind: "enum", values: FILTER_RELEASE_STATES },
  show: { kind: "enum", values: FILTER_SHOW_KINDS },
  company: { kind: "slug" },
  franchise: { kind: "slug" },
};

export type FilterIssueReason = "invalid_format" | "invalid_value" | "too_many_values" | "duplicate";

export interface FilterIssue {
  /** URL 參數名稱。 */
  param: FilterParam;
  /** 被忽略的原始值；too_many_values 時不帶（整個參數被拒）。 */
  value?: string;
  /**
   * invalid_format：格式錯誤（slug 不符、日期不合法、q 過長…）；invalid_value：enum 未知值或數值超出範圍；
   * too_many_values：多值參數超過 FILTER_MAX_VALUES；duplicate：單值參數重複出現，多出的值被忽略。
   */
  reason: FilterIssueReason;
}

export interface ParseFilterResult {
  /** 正規化後的條件：去重、小寫、排序；空維度省略。 */
  filter: FilterSpec;
  /** 被忽略的值與原因（UI 用來「忽略並提示」）。 */
  issues: FilterIssue[];
}

export type FilterSearchInput = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

// ── 單值參數的解析規則 ────────────────────────────────────────────────

type ScalarResult = { ok: true; value: string | number | true } | { ok: false; reason: "invalid_format" | "invalid_value" } | { ok: "skip" };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` 且是真實存在的日期（UTC 曆法），年份在 FILTER_YEAR_MIN~MAX。 */
export function isValidIsoDate(v: string): boolean {
  const m = ISO_DATE.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < FILTER_YEAR_MIN || y > FILTER_YEAR_MAX || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function parseIntParam(v: string, min: number, max: number): ScalarResult {
  if (!/^\d{1,4}$/.test(v)) return { ok: false, reason: "invalid_format" };
  const n = Number(v);
  return n >= min && n <= max ? { ok: true, value: n } : { ok: false, reason: "invalid_value" };
}

/** 搜尋字串正規化（URL 層）：trim、連續空白合併成一個。大小寫與全半形交給 catalog 的 tokenizeForSearch。 */
export function normalizeFilterQuery(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

const SCALAR_DEFS: Readonly<Record<FilterScalarParam, (raw: string) => ScalarResult>> = {
  region: (raw) => {
    const v = raw.trim().toUpperCase();
    return FILTER_REGION_PATTERN.test(v) ? { ok: true, value: v } : { ok: false, reason: "invalid_format" };
  },
  from: (raw) => (isValidIsoDate(raw.trim()) ? { ok: true, value: raw.trim() } : { ok: false, reason: "invalid_format" }),
  to: (raw) => (isValidIsoDate(raw.trim()) ? { ok: true, value: raw.trim() } : { ok: false, reason: "invalid_format" }),
  year: (raw) => parseIntParam(raw.trim(), FILTER_YEAR_MIN, FILTER_YEAR_MAX),
  yearFrom: (raw) => parseIntParam(raw.trim(), FILTER_YEAR_MIN, FILTER_YEAR_MAX),
  yearTo: (raw) => parseIntParam(raw.trim(), FILTER_YEAR_MIN, FILTER_YEAR_MAX),
  minHeat: (raw) => parseIntParam(raw.trim(), FILTER_MIN_HEAT_MIN, FILTER_MIN_HEAT_MAX),
  rumored: (raw) => {
    const v = raw.trim().toLowerCase();
    if (v === "1" || v === "true") return { ok: true, value: true };
    if (v === "0" || v === "false") return { ok: "skip" }; // 明確關閉＝預設，不算錯
    return { ok: false, reason: "invalid_value" };
  },
  q: (raw) => {
    const v = normalizeFilterQuery(raw);
    if (v === "") return { ok: "skip" };
    return [...v].length <= FILTER_QUERY_MAX_LENGTH ? { ok: true, value: v } : { ok: false, reason: "invalid_format" };
  },
  sort: (raw) => {
    const v = raw.trim().toLowerCase();
    return (FILTER_SORTS as readonly string[]).includes(v) ? { ok: true, value: v } : { ok: false, reason: "invalid_value" };
  },
};

// ── zod（API handler 驗證 JSON 用；URL 用 parseFilterSpec 的寬鬆版） ──────────────
const slugSchema = z.string().max(FILTER_SLUG_MAX_LENGTH).regex(FILTER_SLUG_PATTERN);
const listOf = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(1).max(FILTER_MAX_VALUES).optional();
const isoDateSchema = z.string().refine(isValidIsoDate, { message: "invalid date" });
const yearSchema = z.number().int().min(FILTER_YEAR_MIN).max(FILTER_YEAR_MAX);

export const FilterSpecSchema = z.object({
  platform: listOf(slugSchema),
  platformKind: listOf(z.enum(FILTER_PLATFORM_KINDS)),
  genre: listOf(slugSchema),
  theme: listOf(slugSchema),
  type: listOf(z.enum(FILTER_GAME_TYPES)),
  stage: listOf(z.enum(FILTER_RELEASE_STAGES)),
  status: listOf(z.enum(FILTER_RELEASE_STATES)),
  show: listOf(z.enum(FILTER_SHOW_KINDS)),
  company: listOf(slugSchema),
  franchise: listOf(slugSchema),
  region: z.string().regex(FILTER_REGION_PATTERN).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  year: yearSchema.optional(),
  yearFrom: yearSchema.optional(),
  yearTo: yearSchema.optional(),
  minHeat: z.number().int().min(FILTER_MIN_HEAT_MIN).max(FILTER_MIN_HEAT_MAX).optional(),
  rumored: z.literal(true).optional(),
  q: z.string().min(1).max(FILTER_QUERY_MAX_LENGTH).optional(),
  sort: z.enum(FILTER_SORTS).optional(),
});

// 型別一致性：zod 推導出的型別要能指派給 FilterSpec
type _SchemaMatches = z.infer<typeof FilterSpecSchema> extends FilterSpec ? true : never;
const _schemaMatches: _SchemaMatches = true;
void _schemaMatches;

// ── 工具 ─────────────────────────────────────────────────────────────

function rawValues(input: FilterSearchInput, param: string): string[] {
  if (input instanceof URLSearchParams) return input.getAll(param);
  const v = (input as Record<string, string | readonly string[] | undefined>)[param];
  if (v === undefined) return [];
  return typeof v === "string" ? [v] : [...v];
}

/** 正規化：去重＋排序（字典序，與語系無關）。 */
function canonical(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function setDimension(filter: FilterSpec, dim: FilterDimension, values: readonly string[]): FilterSpec {
  const next: Record<string, unknown> = { ...(filter as Record<string, unknown>) };
  if (values.length === 0) delete next[dim];
  else next[dim] = canonical(values);
  return next as FilterSpec;
}

export function isFilterDimension(p: string): p is FilterDimension {
  return (FILTER_DIMENSIONS as readonly string[]).includes(p);
}

export function isFilterScalarParam(p: string): p is FilterScalarParam {
  return (FILTER_SCALAR_PARAMS as readonly string[]).includes(p);
}

export function isFilterParam(p: string): p is FilterParam {
  return (FILTER_PARAMS as readonly string[]).includes(p);
}

/**
 * 解析 URL 參數。不 throw：
 * - 多值維度：格式錯誤（slug 不符、過長）→ 忽略該值，issue `invalid_format`；enum 未知值 → `invalid_value`；
 *   不重複的值超過 FILTER_MAX_VALUES → 整個參數被拒，issue `too_many_values`；空字串、多餘逗號靜默略過。
 * - 單值參數：非法值 → 忽略，issue `invalid_format`／`invalid_value`；重複出現取第一個非空值，其餘 issue `duplicate`；
 *   `rumored=0`、`q=` 視同未指定（不記 issue）。
 * - 未知參數（例如 `month`、`cursor`）不理會。
 * 只檢查格式；slug／地區在資料庫是否存在由 catalog 判斷（未知值也要「忽略並提示」，見 spec 06）。
 */
export function parseFilterSpec(input: FilterSearchInput): ParseFilterResult {
  let filter: FilterSpec = {};
  const issues: FilterIssue[] = [];

  for (const param of FILTER_PARAMS) {
    if (isFilterDimension(param)) {
      const dim = param;
      const tokens = canonical(
        rawValues(input, dim)
          .flatMap((v) => v.split(","))
          .map((v) => v.trim().toLowerCase())
          .filter((v) => v !== ""),
      );
      if (tokens.length === 0) continue;
      if (tokens.length > FILTER_MAX_VALUES) {
        issues.push({ param: dim, reason: "too_many_values" });
        continue;
      }
      const def = DIMENSION_DEFS[dim];
      const ok: string[] = [];
      for (const t of tokens) {
        if (def.kind === "enum") {
          if (def.values.includes(t)) ok.push(t);
          else issues.push({ param: dim, value: t.slice(0, FILTER_SLUG_MAX_LENGTH), reason: "invalid_value" });
        } else if (t.length <= FILTER_SLUG_MAX_LENGTH && FILTER_SLUG_PATTERN.test(t)) {
          ok.push(t);
        } else {
          issues.push({ param: dim, value: t.slice(0, FILTER_SLUG_MAX_LENGTH), reason: "invalid_format" });
        }
      }
      filter = setDimension(filter, dim, ok);
      continue;
    }

    const raws = rawValues(input, param).filter((v) => v.trim() !== "");
    let taken = false;
    for (const raw of raws) {
      const shown = raw.slice(0, FILTER_SLUG_MAX_LENGTH);
      if (taken) {
        issues.push({ param, value: shown, reason: "duplicate" });
        continue;
      }
      const r = SCALAR_DEFS[param](raw);
      if (r.ok === "skip") continue;
      if (r.ok === false) {
        issues.push({ param, value: shown, reason: r.reason });
        continue;
      }
      filter = { ...filter, [param]: r.value } as FilterSpec;
      taken = true;
    }
  }
  return { filter, issues };
}

/** 單一參數的字串形式（不編碼）；未設定或空陣列回傳 undefined。 */
function paramString(filter: FilterSpec, param: FilterParam): string | undefined {
  const v = filter[param];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.length > 0 ? canonical(v as readonly string[]).join(",") : undefined;
  if (v === true) return "1";
  return String(v);
}

/**
 * 序列化：參數順序固定（FILTER_PARAMS）、值排序去重、空維度省略。
 * 同一組條件一定產生同一個 query string（快取鍵穩定）。
 * 注意 `URLSearchParams#toString()` 會把逗號編成 `%2C`、空白編成 `+`；要產生 `?platform=ps5,switch` 這種易讀網址用
 * `filterSpecToQueryString`。
 */
export function serializeFilterSpec(filter: FilterSpec): URLSearchParams {
  const params = new URLSearchParams();
  for (const param of FILTER_PARAMS) {
    const s = paramString(filter, param);
    if (s !== undefined) params.set(param, s);
  }
  return params;
}

/** 易讀的 query string（不含 `?`；多值的逗號不編碼，值以 encodeURIComponent 編碼）。空條件回傳空字串。 */
export function filterSpecToQueryString(filter: FilterSpec): string {
  const parts: string[] = [];
  for (const param of FILTER_PARAMS) {
    const v = filter[param];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) parts.push(`${param}=${canonical(v as readonly string[]).map(encodeURIComponent).join(",")}`);
    } else {
      parts.push(`${param}=${encodeURIComponent(v === true ? "1" : String(v))}`);
    }
  }
  return parts.join("&");
}

/** 「沒有任何篩選條件」：多值維度都空，且沒有單值參數（`sort` 不算篩選）。 */
export function isEmptyFilter(filter: FilterSpec): boolean {
  return countFilterValues(filter) === 0;
}

/** 所有條件的數量（「篩選（n）」用）：多值維度的值總數＋已設定的單值參數數（`sort` 不算）。 */
export function countFilterValues(filter: FilterSpec): number {
  const list = FILTER_DIMENSIONS.reduce((n, dim) => n + (filter[dim]?.length ?? 0), 0);
  const scalars = FILTER_SCALAR_PARAMS.filter((p) => p !== "sort" && filter[p] !== undefined).length;
  return list + scalars;
}

export function hasFilterValue<D extends FilterDimension>(filter: FilterSpec, dim: D, value: FilterValue<D>): boolean {
  return (filter[dim] as readonly string[] | undefined)?.includes(value) ?? false;
}

/** 有就移除、沒有就加入；回傳新的正規化 FilterSpec（不改原物件）。 */
export function toggleFilterValue<D extends FilterDimension>(filter: FilterSpec, dim: D, value: FilterValue<D>): FilterSpec {
  const current = (filter[dim] as readonly string[] | undefined) ?? [];
  return setDimension(filter, dim, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
}

/** 移除某個值；value 省略 → 清掉整個維度。 */
export function removeFilterValue<D extends FilterDimension>(filter: FilterSpec, dim: D, value?: FilterValue<D>): FilterSpec {
  const current = (filter[dim] as readonly string[] | undefined) ?? [];
  return setDimension(filter, dim, value === undefined ? [] : current.filter((v) => v !== value));
}

/** 設定或清除（value＝undefined）單值參數；回傳新物件（不改原物件、不驗證值，值請先經 parse 或型別保證）。 */
export function setFilterParam<P extends FilterScalarParam>(filter: FilterSpec, param: P, value: FilterScalarValue<P> | undefined): FilterSpec {
  const next: Record<string, unknown> = { ...(filter as Record<string, unknown>) };
  if (value === undefined) delete next[param];
  else next[param] = value;
  return next as FilterSpec;
}
