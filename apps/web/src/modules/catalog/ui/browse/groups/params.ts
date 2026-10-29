/**
 * 瀏覽頁分組檢視的非篩選參數（純函式）：`by=none|date|platform|publisher`（預設 none，不寫進網址）、組頁碼 `page`。
 * 網址正規形式（proxy 的 filterRedirectSearch）：篩選參數在前，其餘依名稱排序（by 在 page 前）。
 */
import {
  DEFAULT_GAME_GROUP_BY,
  DEFAULT_GROUP_DIR,
  DEFAULT_GROUP_SORT,
  GAME_GROUP_BYS,
  GAME_GROUP_MAX_PAGE,
  GAME_GROUPS_PER_PAGE,
  GROUP_DIRS,
  GROUP_SORTS,
  isGroupMonth,
  type GameGroupBy,
  type GroupDir,
  type GroupedBy,
  type GroupSort,
} from "../../../domain/entities";

/** 分組檢視的檢視參數：組排序（依平台／依廠商）與日期分組的起算月（依日期）。 */
export interface GroupViewParams {
  sort: GroupSort;
  dir: GroupDir;
  /** 依日期分組的起算月 `YYYY-MM`；null＝預設（當月起）。 */
  from: string | null;
}

export const DEFAULT_GROUP_VIEW: GroupViewParams = { sort: DEFAULT_GROUP_SORT, dir: DEFAULT_GROUP_DIR, from: null };

/** `gsort`：不合法一律預設（latest）。 */
export function parseGroupSort(value: string | null | undefined): GroupSort {
  return (GROUP_SORTS as readonly string[]).includes(value ?? "") ? (value as GroupSort) : DEFAULT_GROUP_SORT;
}

/** `gdir`：不合法一律預設（desc）。 */
export function parseGroupDir(value: string | null | undefined): GroupDir {
  return (GROUP_DIRS as readonly string[]).includes(value ?? "") ? (value as GroupDir) : DEFAULT_GROUP_DIR;
}

/**
 * 起算月：`gfrom=YYYY-MM`；沒有 JS 時「跳到年／月」是 GET 表單（`gyear`＋`gmonth` 兩個下拉），這裡把它組成同一個值。
 * 頁面產生的連結一律用 `gfrom`（網址的正規形式）。
 */
export function parseGroupFrom(from: string | null | undefined, year?: string | null, month?: string | null): string | null {
  if (isGroupMonth(from)) return from;
  if (year && month && /^\d{4}$/.test(year) && /^\d{1,2}$/.test(month)) {
    const m = `${year}-${month.padStart(2, "0")}`;
    return isGroupMonth(m) ? m : null;
  }
  return null;
}

/**
 * 分組檢視非篩選參數在網址上的寫法（依 `by` 只留有意義的，預設值不寫）。**順序＝參數名稱排序**（by、gdir、gfrom、gsort、page），
 * 與 proxy 的正規形式（api-contract filterRedirectSearch：非篩選參數依名稱排序）一致，所以這裡產生的網址不會被 308。
 * `page` 由呼叫端決定（>1 才寫）。
 */
export function groupQueryParts(by: GameGroupBy, view: Partial<GroupViewParams> = {}, page = 1): string[] {
  const parts: string[] = [];
  if (by !== "none") parts.push(`by=${by}`);
  if (by === "platform" || by === "publisher") {
    if (view.dir && view.dir !== DEFAULT_GROUP_DIR) parts.push(`gdir=${view.dir}`);
    if (view.sort && view.sort !== DEFAULT_GROUP_SORT) parts.push(`gsort=${view.sort}`);
  } else if (by === "date" && view.from) {
    parts.push(`gfrom=${view.from}`);
  }
  if (page > 1) parts.push(`page=${Math.floor(page)}`);
  return parts;
}

export function parseGameGroupBy(value: string | null | undefined): GameGroupBy {
  return (GAME_GROUP_BYS as readonly string[]).includes(value ?? "") ? (value as GameGroupBy) : DEFAULT_GAME_GROUP_BY;
}

export function isGrouped(by: GameGroupBy): by is GroupedBy {
  return by !== "none";
}

/** 分組檢視的組頁碼：1~GAME_GROUP_MAX_PAGE 的整數，其他一律第 1 頁。 */
export function parseGroupPage(value: string | null | undefined): number {
  if (!value || !/^\d{1,4}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 && n <= GAME_GROUP_MAX_PAGE ? n : 1;
}

export interface GroupPagination {
  prev: number | null;
  next: number | null;
  /** 已到組頁碼上限但後面還有組。 */
  limitReached: boolean;
}

export function groupPagination(page: number, hasMoreGroups: boolean): GroupPagination {
  const atLimit = page >= GAME_GROUP_MAX_PAGE;
  return { prev: page > 1 ? page - 1 : null, next: hasMoreGroups && !atLimit ? page + 1 : null, limitReached: hasMoreGroups && atLimit };
}

/** 本頁是第幾組到第幾組（1 起算）；沒有組回 null。 */
export function groupRange(page: number, count: number): { from: number; to: number } | null {
  return count > 0 ? { from: (page - 1) * GAME_GROUPS_PER_PAGE + 1, to: (page - 1) * GAME_GROUPS_PER_PAGE + count } : null;
}
