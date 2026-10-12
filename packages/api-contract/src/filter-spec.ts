/**
 * FilterSpec（spec 06 §篩選）：月曆、時間軸、瀏覽、熱門榜、API、Discord 公告共用的篩選條件。
 *
 * 語意（實際查詢由 catalog 實作）：
 * - **同一維度內 OR**：`platform=ps5,switch` → 在 ps5 或 switch 上市。
 * - **不同維度之間 AND**：`platform=ps5&genre=indie` → 在 ps5 上市且類型含 indie。
 * - 維度不存在（undefined）= 不限制；由呼叫端套用預設值（例如 `stage` 預設 CALENDAR_VISIBLE_RELEASE_STAGES）。
 *
 * URL 形式：`?platform=ps5,switch&genre=role-playing-rpg&stage=full`，值一律 slug（enum 維度用 enum 值），
 * 逗號分隔；同一參數重複出現（`platform=a&platform=b`）視同合併。
 *
 * 3a 維度：platform、platformKind、genre、stage。3b 加維度：在 FILTER_DIMENSIONS 與 DIMENSION_DEFS 加一項、
 * FilterSpec 加欄位即可（parse／serialize／工具函式都由 DIMENSION_DEFS 驅動）。
 */
import { z } from "zod";

/** 單一參數最多幾個值（spec 06 §篩選、14）；超過整個參數被拒。 */
export const FILTER_MAX_VALUES = 20;
/** slug 最長長度（DB 欄位 varchar(100)）。 */
export const FILTER_SLUG_MAX_LENGTH = 100;

/**
 * slug 格式：小寫英數，以連字號分隔。允許連續連字號——IGDB 的實際 slug 有 `ps4--1`、`pdp-7--1`
 * （2026-10-13 對本機 DB 的 platforms／genres 核對）。parse 會先轉小寫。
 */
export const FILTER_SLUG_PATTERN = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/;

/**
 * 平台類型合法值。必須與 catalog domain 的 `PLATFORM_KINDS`
 * （apps/web/src/modules/catalog/domain/entities/enums.ts）相同；套件不能 import apps，
 * 由 apps/web 端做型別相等斷言。`mobile` 合法但手機平台不寫上市日（P35），篩它會是空結果。
 */
export const FILTER_PLATFORM_KINDS = ["console", "handheld", "hybrid", "pc", "arcade", "mobile", "other"] as const;
export type FilterPlatformKind = (typeof FILTER_PLATFORM_KINDS)[number];

/** 上市階段合法值。必須與 catalog domain 的 `RELEASE_STAGES` 相同（同上，apps/web 端斷言）。 */
export const FILTER_RELEASE_STAGES = ["unspecified", "full", "early_access", "beta", "alpha", "demo", "other"] as const;
export type FilterReleaseStage = (typeof FILTER_RELEASE_STAGES)[number];

/** 參數順序即 serialize 的輸出順序（固定，快取鍵穩定）。 */
export const FILTER_DIMENSIONS = ["platform", "platformKind", "genre", "stage"] as const;
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

export interface FilterSpec {
  /** 平台 slug（`platforms.slug`）。同維度 OR。 */
  readonly platform?: readonly string[];
  /** 平台類型（`platforms.kind`）。同維度 OR。 */
  readonly platformKind?: readonly FilterPlatformKind[];
  /** 類型 slug（`genres.slug`）。同維度 OR。 */
  readonly genre?: readonly string[];
  /** 上市階段（`release_events.stage`）。同維度 OR；未指定時呼叫端套用 CALENDAR_VISIBLE_RELEASE_STAGES。 */
  readonly stage?: readonly FilterReleaseStage[];
}

/** 某維度的值型別。 */
export type FilterValue<D extends FilterDimension> = NonNullable<FilterSpec[D]>[number];

type DimensionDef = { kind: "slug" } | { kind: "enum"; values: readonly string[] };

const DIMENSION_DEFS: Readonly<Record<FilterDimension, DimensionDef>> = {
  platform: { kind: "slug" },
  platformKind: { kind: "enum", values: FILTER_PLATFORM_KINDS },
  genre: { kind: "slug" },
  stage: { kind: "enum", values: FILTER_RELEASE_STAGES },
};

export type FilterIssueReason = "invalid_format" | "invalid_value" | "too_many_values";

export interface FilterIssue {
  /** URL 參數名稱（= 維度名稱）。 */
  param: FilterDimension;
  /** 被忽略的原始值；too_many_values 時不帶（整個參數被拒）。 */
  value?: string;
  reason: FilterIssueReason;
}

export interface ParseFilterResult {
  /** 正規化後的條件：去重、小寫、排序；空維度省略。 */
  filter: FilterSpec;
  /** 被忽略的值與原因（UI 用來「忽略並提示」）。 */
  issues: FilterIssue[];
}

export type FilterSearchInput = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

// ── zod（API handler 驗證 JSON 用；URL 用 parseFilterSpec 的寬鬆版） ──────────────
const slugSchema = z.string().max(FILTER_SLUG_MAX_LENGTH).regex(FILTER_SLUG_PATTERN);

export const FilterSpecSchema = z.object({
  platform: z.array(slugSchema).min(1).max(FILTER_MAX_VALUES).optional(),
  platformKind: z.array(z.enum(FILTER_PLATFORM_KINDS)).min(1).max(FILTER_MAX_VALUES).optional(),
  genre: z.array(slugSchema).min(1).max(FILTER_MAX_VALUES).optional(),
  stage: z.array(z.enum(FILTER_RELEASE_STAGES)).min(1).max(FILTER_MAX_VALUES).optional(),
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
  const next: Record<string, readonly string[]> = { ...(filter as Record<string, readonly string[]>) };
  if (values.length === 0) delete next[dim];
  else next[dim] = canonical(values);
  return next as FilterSpec;
}

/**
 * 解析 URL 參數。不 throw：
 * - 格式錯誤（slug 不符、過長）→ 忽略該值，issue `invalid_format`
 * - enum 維度的未知值 → 忽略該值，issue `invalid_value`
 * - 單一參數不重複的值超過 FILTER_MAX_VALUES → 整個參數被拒，issue `too_many_values`
 * - 空字串、多餘逗號 → 靜默略過；未知參數（例如 `month`）不理會
 * 只檢查格式；slug 在資料庫是否存在由 catalog 判斷（未知 slug 也要「忽略並提示」，見 spec 06）。
 */
export function parseFilterSpec(input: FilterSearchInput): ParseFilterResult {
  let filter: FilterSpec = {};
  const issues: FilterIssue[] = [];

  for (const dim of FILTER_DIMENSIONS) {
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
        else issues.push({ param: dim, value: t, reason: "invalid_value" });
      } else if (t.length <= FILTER_SLUG_MAX_LENGTH && FILTER_SLUG_PATTERN.test(t)) {
        ok.push(t);
      } else {
        issues.push({ param: dim, value: t.slice(0, FILTER_SLUG_MAX_LENGTH), reason: "invalid_format" });
      }
    }
    filter = setDimension(filter, dim, ok);
  }
  return { filter, issues };
}

/**
 * 序列化：參數順序固定（FILTER_DIMENSIONS）、值排序去重、空維度省略。
 * 同一組條件一定產生同一個 query string（快取鍵穩定）。
 * 注意 `URLSearchParams#toString()` 會把逗號編成 `%2C`；要產生 `?platform=ps5,switch` 這種易讀網址用
 * `filterSpecToQueryString`。
 */
export function serializeFilterSpec(filter: FilterSpec): URLSearchParams {
  const params = new URLSearchParams();
  for (const dim of FILTER_DIMENSIONS) {
    const values = filter[dim];
    if (values && values.length > 0) params.set(dim, canonical(values).join(","));
  }
  return params;
}

/** 易讀的 query string（不含 `?`；逗號不編碼）。空條件回傳空字串。 */
export function filterSpecToQueryString(filter: FilterSpec): string {
  const parts: string[] = [];
  for (const dim of FILTER_DIMENSIONS) {
    const values = filter[dim];
    if (values && values.length > 0) parts.push(`${dim}=${canonical(values).map(encodeURIComponent).join(",")}`);
  }
  return parts.join("&");
}

export function isEmptyFilter(filter: FilterSpec): boolean {
  return FILTER_DIMENSIONS.every((dim) => (filter[dim]?.length ?? 0) === 0);
}

/** 所有維度的值總數（「篩選（n）」用）。 */
export function countFilterValues(filter: FilterSpec): number {
  return FILTER_DIMENSIONS.reduce((n, dim) => n + (filter[dim]?.length ?? 0), 0);
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
