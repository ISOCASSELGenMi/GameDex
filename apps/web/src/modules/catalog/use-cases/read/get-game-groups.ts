import {
  DEFAULT_GROUP_DIR,
  DEFAULT_GROUP_SORT,
  GAME_GROUPS_PER_PAGE,
  GAME_GROUP_MAX_LIMIT,
  GAME_GROUP_MAX_PAGE,
  GROUP_DIRS,
  GROUP_SORTS,
  isGroupMonth,
  type GameGroup,
  type GroupDir,
  type GroupedBy,
  type GroupOrder,
  type GroupSort,
  type IgnoredFilterValue,
  type ReleaseFilter,
} from "../../domain/entities";
import { isPublisherColumnKey } from "../../domain/publisher-groups";
import { tokenizeForSearch } from "../../domain/search-text";
import { resolveImageRef } from "../../providers/image-ref";
import { isDateGroupKey, readGameGroupPage, readGameGroups } from "../../repository/browse-groups";
import { utcToday } from "../../repository/release-aggregate";
import { resolveFilterSlugs } from "./resolve-filter";

export interface GameGroupsFilterInput {
  /** 遊戲層級維度（同 browseGames）。 */
  filter?: ReleaseFilter;
  yearFrom?: number;
  yearTo?: number;
  /** 搜尋字串（原樣；這裡經 tokenizeForSearch）。 */
  q?: string | null;
  locale: string;
  now?: Date;
}

export interface GetGameGroupsInput extends GameGroupsFilterInput {
  by: GroupedBy;
  /** 第幾頁的組（1 起算，預設 1；超過 GAME_GROUP_MAX_PAGE 回空）。 */
  page?: number;
  /** 每組先取幾張（1 ~ GAME_GROUP_MAX_LIMIT）。 */
  perGroup: number;
  /** by=platform／publisher 的組排序（預設 latest／desc；by=date 不適用）。不合法的值退回預設。 */
  groupSort?: GroupSort;
  groupDir?: GroupDir;
  /** by=date：起算月 `YYYY-MM`（不合法或未給＝預設的「當月起」順序；其他 by 忽略）。 */
  groupFrom?: string | null;
}

export interface GameGroups {
  by: GroupedBy;
  /** 實際使用的組排序（by=date 固定時間順序，這兩個欄位仍回預設值，UI 不顯示）。 */
  groupOrder: GroupOrder;
  /** by=date 實際使用的起算月（null＝預設順序）。 */
  groupFrom: string | null;
  page: number;
  /** 本頁的組（已排序）。 */
  groups: GameGroup[];
  hasMoreGroups: boolean;
  ignored: IgnoredFilterValue[];
}

function clampLimit(n: number): number {
  return Math.min(GAME_GROUP_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

function validYear(y: number | undefined): number | undefined {
  return y !== undefined && Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : undefined;
}

function normalized(input: GameGroupsFilterInput) {
  let yearFrom = validYear(input.yearFrom);
  let yearTo = validYear(input.yearTo);
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  const searchTokens = input.q ? tokenizeForSearch(input.q).slice(0, 200) || null : null;
  return { yearFrom, yearTo, searchTokens };
}

/** 組排序參數的正規化（不合法退回預設）。 */
export function normalizeGroupOrder(sort: string | null | undefined, dir: string | null | undefined): GroupOrder {
  return {
    sort: (GROUP_SORTS as readonly string[]).includes(sort ?? "") ? (sort as GroupSort) : DEFAULT_GROUP_SORT,
    dir: (GROUP_DIRS as readonly string[]).includes(dir ?? "") ? (dir as GroupDir) : DEFAULT_GROUP_DIR,
  };
}

/** 組 key 的格式是否合法（API 驗證用；平台 slug 的存在與否由查詢決定）。 */
export function isGroupKey(by: GroupedBy, key: string): boolean {
  if (by === "date") return isDateGroupKey(key);
  if (by === "publisher") return isPublisherColumnKey(key);
  return /^[a-z0-9]+(?:-+[a-z0-9]+)*$/.test(key) && key.length <= 100;
}

/**
 * 瀏覽頁分組檢視（`/games?by=…`）：篩選與瀏覽同一份條件（buildBrowseConditions），這裡只決定組怎麼排、一頁幾組。
 * 組內遊戲永遠是發售日由新到舊（不受瀏覽的 sort 影響）；組的順序：date 固定時間順序（可指定起算月）、platform／publisher 依組排序。
 * 逾時丟 CatalogQueryTimeoutError。
 */
export async function getGameGroups(input: GetGameGroupsInput): Promise<GameGroups> {
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const n = normalized(input);
  const page = Math.min(GAME_GROUP_MAX_PAGE, Math.max(1, Math.floor(input.page ?? 1)));
  const groupOrder = normalizeGroupOrder(input.groupSort, input.groupDir);
  const groupFrom = input.by === "date" && isGroupMonth(input.groupFrom) ? input.groupFrom : null;
  const found = await readGameGroups({
    by: input.by,
    filter,
    ...n,
    locale: input.locale,
    today: utcToday(input.now),
    groupOffset: (page - 1) * GAME_GROUPS_PER_PAGE,
    groupLimit: GAME_GROUPS_PER_PAGE,
    groupOrder,
    groupFrom,
    perGroup: clampLimit(input.perGroup),
    resolveImage: resolveImageRef,
  });
  return { by: input.by, groupOrder, groupFrom, page, ...found, ignored };
}

export interface GetGameGroupPageInput extends GameGroupsFilterInput {
  by: GroupedBy;
  key: string;
  offset: number;
  limit: number;
}

/** 某一組的一段卡片（「顯示更多」）。組內順序固定（發售日由新到舊）。組 key 不合法或沒有資料回 null。 */
export async function getGameGroupPage(input: GetGameGroupPageInput): Promise<GameGroup | null> {
  if (!isGroupKey(input.by, input.key)) return null;
  const { filter } = await resolveFilterSlugs(input.filter);
  return readGameGroupPage({
    by: input.by,
    key: input.key,
    filter,
    ...normalized(input),
    locale: input.locale,
    today: utcToday(input.now),
    offset: Math.max(0, Math.floor(input.offset)),
    limit: clampLimit(input.limit),
    resolveImage: resolveImageRef,
  });
}
