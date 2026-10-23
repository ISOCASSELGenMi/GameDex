/**
 * 遊戲詳情頁補資訊的讀取模型（GameDex 第二輪 Z4；docs/design/ui-direction.md「追加指示（二）」）。
 * Z4A（後端）負責填值，Z4B（UI）只讀這個型別；兩邊的唯一合約。GameDetail 以 `extra` 欄位帶出。
 */
import type { GameSummary, TaxonomyItem } from "./read-models";

/** 相關內容的分組，依 IGDB 關係；顯示順序即陣列順序。 */
export const RELATED_GROUP_KEYS = [
  "editions", // 版本（version_parent 指向本作的其他版本）
  "expanded_games", // 擴充版（game_type expanded_game）
  "dlcs", // DLC／追加內容（dlc_addon）
  "expansions", // 資料片（expansion）
  "standalone_expansions", // 獨立資料片
  "remakes", // 重製
  "remasters", // 高畫質重製
  "ports", // 移植
  "bundles", // 合輯（本作被包含在內的合輯）
  "episodes", // 章節／季（episode、season）
  "packs", // 追加包、更新、Mod、分支（pack、update、mod、fork）
] as const;
export type RelatedGroupKey = (typeof RELATED_GROUP_KEYS)[number];

export interface RelatedGroup {
  key: RelatedGroupKey;
  /** 依首發日期由舊到新；每組上限 24（超過時 total 大於 games.length）。 */
  games: GameSummary[];
  total: number;
}

export interface LocalizedTitle {
  /** 地區／語系代碼（game_localizations.locale_code，例如 ja、ko、zh-Hant）；UI 用字典轉成地區名稱。 */
  localeCode: string;
  name: string;
}

export interface AlternativeTitle {
  name: string;
  /** IGDB 的註記原文（例如 "Acronym"、"Chinese title - traditional"）；沒有時為 null。UI 原樣或簡單對照顯示。 */
  comment: string | null;
}

/** 本作在版本／衍生關係中的位置（本身是 DLC、衍生版本時用）。 */
export interface EditionInfo {
  /** IGDB version_title（例如 "Nintendo Switch 2 Edition"）；本身不是某作的版本時為 null。 */
  versionTitle: string | null;
  /** 本作是哪一款的版本（version_parent）；不是版本或對方尚未同步時為 null。 */
  versionParent: GameSummary | null;
}

export interface GameDetailExtra {
  /** IGDB storyline（英文原文）；沒有時為 null。 */
  storyline: string | null;
  gameModes: TaxonomyItem[];
  playerPerspectives: TaxonomyItem[];
  engines: TaxonomyItem[];
  /** 全部地區名稱（含 ko、人工 zh-Hant），依 localeCode 排序。 */
  localizedTitles: LocalizedTitle[];
  /** 依 IGDB 原順序。 */
  alternativeTitles: AlternativeTitle[];
  edition: EditionInfo;
  /** 只含有內容的組，依 RELATED_GROUP_KEYS 順序。 */
  related: RelatedGroup[];
  /** 相關內容總數（「查看另外 N 個版本」的 N）。 */
  relatedTotal: number;
}
