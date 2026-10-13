/**
 * 平台／公司／系列頁的純函式（網址參數解析、分頁、日期文字）。不依賴 React，可單元測試。
 */
import { formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import {
  ENTITY_PAGE_DEFAULT_LIMIT,
  ENTITY_PAGE_MAX_OFFSET,
  FRANCHISE_KINDS,
  GAME_COMPANY_ROLES,
  PLATFORM_GAMES_SECTIONS,
  PLATFORM_GAMES_SORTS,
  type FranchiseKind,
  type GameCompanyRole,
  type GameListItem,
  type PlatformGamesSection,
  type PlatformGamesSort,
} from "../../domain/entities";

/** 每頁筆數（與 use case 預設一致）。 */
export const ENTITY_PAGE_SIZE = ENTITY_PAGE_DEFAULT_LIMIT;
/** 頁碼上限：offset 不可超過 ENTITY_PAGE_MAX_OFFSET（use case 會夾到上限，頁碼先擋掉避免重複內容）。 */
export const ENTITY_PAGE_MAX = Math.floor(ENTITY_PAGE_MAX_OFFSET / ENTITY_PAGE_SIZE) + 1;

export type RawParam = string | string[] | undefined;

export function firstParam(v: RawParam): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 路由 slug 的解碼（壞的百分比編碼原樣回傳，之後自然查不到而軟 404）。 */
export function safeDecode(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/** `page` 參數：1~ENTITY_PAGE_MAX 的整數；其他一律第 1 頁。 */
export function parsePageParam(value: string | null | undefined): number {
  if (!value || !/^\d{1,4}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 && n <= ENTITY_PAGE_MAX ? n : 1;
}

export function pagingForPage(page: number): { limit: number; offset: number } {
  return { limit: ENTITY_PAGE_SIZE, offset: (page - 1) * ENTITY_PAGE_SIZE };
}

export function parsePlatformSection(value: string | null | undefined): PlatformGamesSection {
  return (PLATFORM_GAMES_SECTIONS as readonly string[]).includes(value ?? "") ? (value as PlatformGamesSection) : "upcoming";
}

export function parsePlatformSort(value: string | null | undefined): PlatformGamesSort {
  return (PLATFORM_GAMES_SORTS as readonly string[]).includes(value ?? "") ? (value as PlatformGamesSort) : "date";
}

/** 未知或缺少＝null（全部角色）。 */
export function parseCompanyRole(value: string | null | undefined): GameCompanyRole | null {
  return (GAME_COMPANY_ROLES as readonly string[]).includes(value ?? "") ? (value as GameCompanyRole) : null;
}

/** 未知或缺少＝null（交給 use case：franchise 優先）。 */
export function parseFranchiseKind(value: string | null | undefined): FranchiseKind | null {
  return (FRANCHISE_KINDS as readonly string[]).includes(value ?? "") ? (value as FranchiseKind) : null;
}

/** 列表中遊戲的首發日期文字（未定＝TBA）。 */
export function gameDateText(item: Pick<GameListItem, "firstReleaseDate" | "firstReleasePrecision">, locale: Locale): string {
  return formatReleaseLabel(item.firstReleaseDate, item.firstReleasePrecision ?? "tbd", locale);
}

/** 遊戲層級狀態標籤（NULL／released＝不標示；其餘用 enums.gameStatus）。 */
export function gameStatusBadge(t: Translator, status: string | null): string | null {
  if (!status || status === "released") return null;
  const key = `enums.gameStatus.${status}`;
  return t.has(key) ? t.t(key) : null;
}

export interface PagerLinks {
  prev: string | null;
  next: string | null;
  page: number;
}

/** 上一頁／下一頁連結；hrefFor(page) 由頁面提供（page=1 時不寫入網址由 links.ts 處理）。 */
export function buildPager(page: number, hasMore: boolean, hrefFor: (page: number) => string): PagerLinks {
  return {
    page,
    prev: page > 1 ? hrefFor(page - 1) : null,
    next: hasMore && page < ENTITY_PAGE_MAX ? hrefFor(page + 1) : null,
  };
}

/** 角色數量 > 0 的角色（依固定順序），公司頁的篩選連結用。 */
export function rolesWithCounts(counts: Readonly<Record<GameCompanyRole, number>>): GameCompanyRole[] {
  return GAME_COMPANY_ROLES.filter((r) => (counts[r] ?? 0) > 0);
}
