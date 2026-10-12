import type { DatePrecision, IsoDate } from "./enums";

export interface Game {
  id: number;
  igdbId: number;
  slug: string;
  name: string;
  summary: string | null;
  coverUrl: string | null;
  /** 排序用冗餘欄位；規則同 ReleaseEvent.releaseDate。 */
  firstReleaseDate: IsoDate | null;
  firstReleasePrecision: DatePrecision | null;
  gameType: string | null;
  /** DLC／重製連回本體；可能指向尚未同步的遊戲。 */
  parentGameId: number | null;
  gameStatus: string | null;
  popularityScore: number;
  heatLevel: number;
  displayNames: Record<string, string> | null;
  searchText: string | null;
  similarIgdbIds: number[] | null;
  alternativeNames: { name: string; comment: string | null }[] | null;
  screenshotUrls: string[] | null;
  trailerUrl: string | null;
  ageRatingLabel: string | null;
  lastFullSyncAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** upsert 輸入：以 igdbId 為自然鍵；id、時間戳由資料庫產生。 */
export type GameInput = Pick<Game, "igdbId" | "slug" | "name"> &
  Partial<Omit<Game, "id" | "igdbId" | "slug" | "name" | "createdAt" | "updatedAt">>;
