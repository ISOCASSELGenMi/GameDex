/**
 * 評分顯示規則（05 §顯示規則）：`selectRatings` 的唯一實作（原則五）。
 * 零依賴的純函式：伺服器元件、客戶端元件、JSON-LD、日後的 API 與 App 都呼叫這一份。
 * 三層順序固定：visible（站長硬限制）→ selected（使用者）→ 主分數（站長優先序，只從 critic 類挑）。
 */

/** 評分顯示可處理的來源名稱（唯一定義處）。環境變數與偏好都以此驗證拼字。 */
export const KNOWN_RATING_PROVIDERS = ["igdb", "metacritic_scrape"] as const;
export type KnownRatingProvider = (typeof KNOWN_RATING_PROVIDERS)[number];

/** 預設主分數優先序（16：RATING_DISPLAY_PRIORITY）。 */
export const DEFAULT_RATING_PRIORITY: readonly string[] = ["metacritic_scrape", "igdb"];

/** 訪客未設定偏好時看到的來源（05：預設 `['igdb']`）。 */
export const DEFAULT_SCORE_PROVIDERS: readonly string[] = ["igdb"];

/** 能當主分數的分數類型（user_score 另列）。 */
export const CRITIC_SCORE_TYPES: readonly string[] = ["metascore", "critic_aggregate"];

/** selectRatings 需要的最小欄位；實際的列可以有更多欄位，原樣回傳。 */
export interface RatingLike {
  scoreProvider: string;
  scoreType: string;
  /** NULL＝查過但沒有分數，視為無分數。 */
  score: number | null;
  platformId?: number | null;
  reviewCount?: number | null;
}

export interface RatingSelectionOptions {
  /** 層 1：站長允許的來源；空陣列＝不過濾。 */
  visible: readonly string[];
  /** 層 1 的補充：站長在後台關掉的分數類型（例如 metascore、user_score）；省略＝不隱藏。 */
  hiddenScoreTypes?: readonly string[];
  /** 層 2：使用者選的來源；undefined＝沒有偏好（不再過濾）；空陣列＝什麼都沒選（不顯示）。 */
  selected?: readonly string[];
  /** 層 3：主分數優先序（前面的優先）；不在清單內的來源排最後。 */
  priority: readonly string[];
}

export interface RatingSelection<R extends RatingLike> {
  /** 通過 visible、selected 且有分數的列（含 user_score），依優先序、critic 類先。 */
  shown: R[];
  /** 主分數：只從 critic 類挑；沒有則 null（不退回沒選的來源）。 */
  primary: R | null;
}

export function hasScore(r: Pick<RatingLike, "score">): boolean {
  return r.score != null && Number.isFinite(r.score);
}

export function isCriticScoreType(scoreType: string): boolean {
  return CRITIC_SCORE_TYPES.includes(scoreType);
}

function rank(priority: readonly string[], provider: string): number {
  const i = priority.indexOf(provider);
  return i === -1 ? priority.length : i;
}

/** 層 1 之後的列（有分數、來源允許）。 */
export function visibleRatings<R extends RatingLike>(
  ratings: readonly R[],
  visible: readonly string[],
  hiddenScoreTypes: readonly string[] = [],
): R[] {
  return ratings.filter(
    (r) => hasScore(r) && (visible.length === 0 || visible.includes(r.scoreProvider)) && !hiddenScoreTypes.includes(r.scoreType),
  );
}

/** 可供使用者選擇的來源（層 1 之後實際有分數的來源，去重、依 priority 排序）。 */
export function selectableProviders<R extends RatingLike>(
  ratings: readonly R[],
  visible: readonly string[],
  priority: readonly string[] = DEFAULT_RATING_PRIORITY,
): string[] {
  const set = new Set(visibleRatings(ratings, visible).map((r) => r.scoreProvider));
  return [...set].sort((a, b) => rank(priority, a) - rank(priority, b) || a.localeCompare(b));
}

/** 來源設定 UI 只在可選來源 ≥ 2 時出現（05）。 */
export function shouldShowSourceSettings<R extends RatingLike>(ratings: readonly R[], visible: readonly string[]): boolean {
  return selectableProviders(ratings, visible).length >= 2;
}

/**
 * 沒有偏好時的預設來源：DEFAULT_SCORE_PROVIDERS 與 visible 的交集；交集為空（例如站長把 igdb 隱藏）時
 * 改用 visible 全部——否則預設什麼都看不到。visible 為空＝不過濾，直接用預設。
 */
export function defaultSelectedProviders(visible: readonly string[]): string[] {
  if (visible.length === 0) return [...DEFAULT_SCORE_PROVIDERS];
  const both = DEFAULT_SCORE_PROVIDERS.filter((p) => visible.includes(p));
  return both.length > 0 ? both : [...visible];
}

/** 同一來源有多列時（例如不同平台）的優先順序：不分平台的、評論數多的、輸入順序在前的。 */
function betterSameProvider<R extends RatingLike>(a: R, b: R): boolean {
  const aGlobal = a.platformId == null ? 0 : 1;
  const bGlobal = b.platformId == null ? 0 : 1;
  if (aGlobal !== bGlobal) return aGlobal < bGlobal;
  return (a.reviewCount ?? 0) > (b.reviewCount ?? 0);
}

export function selectRatings<R extends RatingLike>(
  ratings: readonly R[],
  options: RatingSelectionOptions,
): RatingSelection<R> {
  const { visible, selected, priority, hiddenScoreTypes } = options;
  // 1. visible（硬限制）；score=NULL 視為無分數
  let rows = visibleRatings(ratings, visible, hiddenScoreTypes);
  // 2. selected（使用者）：選的來源都沒分數 → 空，不退回沒選的
  if (selected !== undefined) rows = rows.filter((r) => selected.includes(r.scoreProvider));
  // 3. 排序（critic 類先，再依來源優先序；穩定）與主分數
  const indexed = rows.map((r, i) => ({ r, i }));
  indexed.sort(
    (a, b) =>
      Number(!isCriticScoreType(a.r.scoreType)) - Number(!isCriticScoreType(b.r.scoreType)) ||
      rank(priority, a.r.scoreProvider) - rank(priority, b.r.scoreProvider) ||
      a.i - b.i,
  );
  const shown = indexed.map((x) => x.r);
  let primary: R | null = null;
  for (const r of shown) {
    if (!isCriticScoreType(r.scoreType)) continue;
    if (primary === null) {
      primary = r;
      continue;
    }
    if (r.scoreProvider === primary.scoreProvider && betterSameProvider(r, primary)) primary = r;
  }
  return { shown, primary };
}
