// 首頁儀表板的讀取模型（GameDex 改版第 2 段）。Domain 型別，零外部依賴。
import type { DatePrecision, IsoDate } from "./enums";
import type { EventListItem } from "./events-read";
import type { ImageRef } from "./image-ref";
import type { TrendingCard } from "./popularity";
import type { PlatformChip } from "./read-models";

/** 首頁「即將上市」「最新上市」的精簡卡片：只含首屏需要的欄位。 */
export interface HomeGameCard {
  gameId: number;
  slug: string;
  /** 依 locale 取的顯示名稱。 */
  name: string;
  originalName: string;
  cover: ImageRef | null;
  /** 代表日期（首頁只取 day 精度，所以一定有值）。 */
  date: IsoDate;
  precision: DatePrecision;
  /** 最多 HOME_CARD_PLATFORM_LIMIT 個平台 chip；其餘數量在 platformMore。 */
  platforms: PlatformChip[];
  platformMore: number;
  heatLevel: number;
  gameType: string;
}

export interface HomeDashboard {
  /** 計算用的「今天」（UTC）。 */
  today: IsoDate;
  upcoming: HomeGameCard[];
  recent: HomeGameCard[];
  /** 進行中的活動＋今天起 HOME_EVENT_DAYS 天內開始的活動（進行中在前，再依開始時間近到遠；D86）。 */
  events: EventListItem[];
  /** 熱門榜兩群各自排名（熱度百分位只在群內可比；D86）。 */
  trending: { upcoming: TrendingCard[]; released: TrendingCard[] };
  /** 熱門榜實際使用的排序依據（accounts 啟用時 site_follows_7d）。 */
  trendingRankedBy: "popularity" | "site_follows_7d";
}
