/**
 * 遊戲瀏覽頁 `/games` 的分組檢視（`?by=none|date|platform|publisher`）的讀取模型。零外部依賴。
 * 分組只在 repository 的 SQL 做（篩選條件與瀏覽共用 buildBrowseConditions），這裡只有型別與常數。
 */
import type { PlatformKind } from "./enums";
import type { BrowseGameCard } from "./browse";

export const GAME_GROUP_BYS = ["none", "date", "platform", "publisher"] as const;
export type GameGroupBy = (typeof GAME_GROUP_BYS)[number];
export const DEFAULT_GAME_GROUP_BY: GameGroupBy = "none";
/** 真正分組的方式（不含 none）。 */
export type GroupedBy = Exclude<GameGroupBy, "none">;

/** 一頁幾組（以 `page` 翻組；不是翻遊戲）。 */
export const GAME_GROUPS_PER_PAGE = 6;
/** 每組首屏先送幾張卡（其餘「顯示更多」按需載入）。頁面 HTML 預算 200 KB（含 RSC payload）。 */
export const GAME_GROUP_INITIAL = 6;
/** 「顯示更多」一次載入幾張。 */
export const GAME_GROUP_MORE = 24;
/** API 單次上限。 */
export const GAME_GROUP_MAX_LIMIT = 60;
/** 組頁碼上限（日期分組最多約幾百個月）。 */
export const GAME_GROUP_MAX_PAGE = 200;

/**
 * 一組。key：
 * - date：`YYYY-MM`（日／月精度）、`YYYY-Qn`（季精度）、`YYYY`（年精度）、`tbd`（日期未定，永遠最後）；
 * - platform：平台 slug；publisher：廠商欄 key（含 other）。
 */
export interface GameGroup {
  key: string;
  /** 這一組符合條件的總張數（平台分組：同一款遊戲在它每個平台組各算一次）。 */
  total: number;
  /** 前 limit 張（組內排序）。 */
  cards: BrowseGameCard[];
  /** 只有 by=platform：組頭用的平台資料。 */
  platform?: { slug: string; name: string; kind: PlatformKind };
}

// ── 分組檢視的「組排序」與「日期分組的起算月」（2026-10-29） ───────────────────────────────

/**
 * 組排序（只有依平台／依廠商分組有；依日期分組固定時間順序）：
 * latest＝組內最新遊戲的發售日（組內 max first_release_date，含尚未發售的；沒有日期的組排最後）、count＝組內遊戲數、name＝組名稱。
 * 「獨立／其他」永遠排最後。組內遊戲永遠是發售日由新到舊（不受排序參數影響）。
 */
export const GROUP_SORTS = ["latest", "count", "name"] as const;
export type GroupSort = (typeof GROUP_SORTS)[number];
export const GROUP_DIRS = ["asc", "desc"] as const;
export type GroupDir = (typeof GROUP_DIRS)[number];
export const DEFAULT_GROUP_SORT: GroupSort = "latest";
export const DEFAULT_GROUP_DIR: GroupDir = "desc";

export interface GroupOrder {
  sort: GroupSort;
  dir: GroupDir;
}

/** 日期分組可選起算月的範圍（含）。 */
export const GROUP_MONTH_MIN = "1950-01";
export const GROUP_MONTH_MAX = "2200-12";

/** `YYYY-MM`（月 01~12），且在 GROUP_MONTH_MIN~GROUP_MONTH_MAX 內。 */
export function isGroupMonth(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && value >= GROUP_MONTH_MIN && value <= GROUP_MONTH_MAX;
}

/** `YYYY-MM` 加減 delta 個月（結果夾在 GROUP_MONTH_MIN~GROUP_MONTH_MAX）。 */
export function shiftGroupMonth(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + Math.trunc(delta);
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const out = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  return out < GROUP_MONTH_MIN ? GROUP_MONTH_MIN : out > GROUP_MONTH_MAX ? GROUP_MONTH_MAX : out;
}
