/**
 * 瀏覽頁分組檢視的非篩選參數（純函式）：`by=none|date|platform|publisher`（預設 none，不寫進網址）、組頁碼 `page`。
 * 網址正規形式（proxy 的 filterRedirectSearch）：篩選參數在前，其餘依名稱排序（by 在 page 前）。
 */
import { DEFAULT_GAME_GROUP_BY, GAME_GROUP_BYS, GAME_GROUP_MAX_PAGE, GAME_GROUPS_PER_PAGE, type GameGroupBy, type GroupedBy } from "../../../domain/entities";

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
