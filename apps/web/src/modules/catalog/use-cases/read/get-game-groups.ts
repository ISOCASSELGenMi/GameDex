import {
  BROWSE_SORTS,
  GAME_GROUPS_PER_PAGE,
  GAME_GROUP_MAX_LIMIT,
  GAME_GROUP_MAX_PAGE,
  type BrowseSort,
  type GameGroup,
  type GroupedBy,
  type IgnoredFilterValue,
  type PlatformKindGroup,
  type ReleaseFilter,
} from "../../domain/entities";
import { isPublisherColumnKey } from "../../domain/publisher-groups";
import { tokenizeForSearch } from "../../domain/search-text";
import { resolveImageRef } from "../../providers/image-ref";
import { isDateGroupKey, readGameGroupPage, readGameGroups } from "../../repository/browse-groups";
import { utcToday } from "../../repository/release-aggregate";
import { listPlatforms } from "./list-platforms";
import { resolveFilterSlugs } from "./resolve-filter";

export interface GameGroupsFilterInput {
  /** 遊戲層級維度（同 browseGames）。 */
  filter?: ReleaseFilter;
  yearFrom?: number;
  yearTo?: number;
  /** 搜尋字串（原樣；這裡經 tokenizeForSearch）。 */
  q?: string | null;
  /** 預設 popularity；同時決定日期組的順序（release_date 由舊到新，其餘由新到舊）與組內排序。 */
  sort?: BrowseSort;
  locale: string;
  now?: Date;
}

export interface GetGameGroupsInput extends GameGroupsFilterInput {
  by: GroupedBy;
  /** 第幾頁的組（1 起算，預設 1；超過 GAME_GROUP_MAX_PAGE 回空）。 */
  page?: number;
  /** 每組先取幾張（1 ~ GAME_GROUP_MAX_LIMIT）。 */
  perGroup: number;
}

export interface GameGroups {
  by: GroupedBy;
  sort: BrowseSort;
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
  const sort: BrowseSort = input.sort && (BROWSE_SORTS as readonly string[]).includes(input.sort) ? input.sort : "popularity";
  let yearFrom = validYear(input.yearFrom);
  let yearTo = validYear(input.yearTo);
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  const searchTokens = input.q ? tokenizeForSearch(input.q).slice(0, 200) || null : null;
  return { sort, yearFrom, yearTo, searchTokens };
}

/**
 * 平台組的順序＝平台總覽的順序（分組 console → handheld → pc → arcade → other，組內常用平台在前）。
 * hybrid（Switch 系列）同時在 console 與 handheld 兩組，只取第一次出現的位置。
 */
export function platformColumnRanks(groups: readonly PlatformKindGroup[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const g of groups) for (const p of g.platforms) if (!ranks.has(p.slug)) ranks.set(p.slug, ranks.size);
  return ranks;
}

/** 組 key 的格式是否合法（API 驗證用；平台 slug 的存在與否由查詢決定）。 */
export function isGroupKey(by: GroupedBy, key: string): boolean {
  if (by === "date") return isDateGroupKey(key);
  if (by === "publisher") return isPublisherColumnKey(key);
  return /^[a-z0-9]+(?:-+[a-z0-9]+)*$/.test(key) && key.length <= 100;
}

/**
 * 瀏覽頁分組檢視（`/games?by=…`）：篩選與瀏覽同一份條件（buildBrowseConditions），這裡只決定組怎麼排、一頁幾組。
 * 逾時丟 CatalogQueryTimeoutError。
 */
export async function getGameGroups(input: GetGameGroupsInput): Promise<GameGroups> {
  const { filter, ignored } = await resolveFilterSlugs(input.filter);
  const n = normalized(input);
  const page = Math.min(GAME_GROUP_MAX_PAGE, Math.max(1, Math.floor(input.page ?? 1)));
  const platformOrder =
    input.by === "platform" ? [...platformColumnRanks(await listPlatforms({ locale: input.locale })).keys()] : undefined;
  const found = await readGameGroups({
    by: input.by,
    filter,
    ...n,
    locale: input.locale,
    today: utcToday(input.now),
    groupOffset: (page - 1) * GAME_GROUPS_PER_PAGE,
    groupLimit: GAME_GROUPS_PER_PAGE,
    ...(platformOrder ? { platformOrder } : {}),
    perGroup: clampLimit(input.perGroup),
    resolveImage: resolveImageRef,
  });
  return { by: input.by, sort: n.sort, page, ...found, ignored };
}

export interface GetGameGroupPageInput extends GameGroupsFilterInput {
  by: GroupedBy;
  key: string;
  offset: number;
  limit: number;
}

/** 某一組的一段卡片（「顯示更多」）。組 key 不合法或沒有資料回 null。 */
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
