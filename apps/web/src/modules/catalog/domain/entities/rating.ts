import type { ScoreProvider } from "./enums";

/** 三個維度分開記（D8）：scoreOrigin／scoreProvider／scoreType。玩家評分不在這裡（D68）。 */
export interface Rating {
  id: number;
  gameId: number;
  /** NULL＝來源本來就不分平台。 */
  platformId: number | null;
  scoreOrigin: string;
  scoreProvider: ScoreProvider;
  scoreType: string;
  /** NULL＝查過但沒有分數（負向快取），顯示層忽略。 */
  score: number | null;
  scoreMax: number | null;
  reviewCount: number | null;
  sourceUrl: string | null;
  fetchedAt: Date | null;
  nextRefreshAt: Date | null;
}

export type RatingInput = Pick<Rating, "gameId" | "scoreOrigin" | "scoreProvider"> &
  Partial<Pick<Rating, "platformId" | "scoreType" | "score" | "scoreMax" | "reviewCount" | "sourceUrl" | "nextRefreshAt">>;
