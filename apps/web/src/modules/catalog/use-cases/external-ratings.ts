/**
 * 外部評分來源（Metacritic）的資料存取入口（05、12）：來源模組只能經 catalog 的公開 API 讀寫 ratings／external_ids。
 * 這裡是 Use Case 層的薄封裝：負向快取的寫法與下次更新時間的計算集中在這一份（原則五）。
 */
import type { DatePrecision } from "../domain/entities";
import { nextRefreshAt } from "../domain/rating-refresh";
import { upsertRating } from "../repository/ratings";

export interface ExternalScore {
  scoreType: string;
  /** 0~100（來源若是 10 分制，呼叫端先換算）。 */
  score: number;
  scoreMax: number;
  reviewCount: number | null;
}

export interface SaveExternalRatingsInput {
  gameId: number;
  scoreProvider: "metacritic_scrape";
  scoreOrigin: string;
  sourceUrl: string | null;
  /** 這個來源會產生的分數類型；沒有對應結果的類型寫負向快取（score=NULL＋nextRefreshAt），避免同一批遊戲永遠被重選。 */
  expectedTypes: readonly string[];
  scores: readonly ExternalScore[];
  releaseDate: string | null;
  precision: string | null;
  now?: Date;
}

export async function saveExternalRatings(input: SaveExternalRatingsInput): Promise<{ written: number; negative: number }> {
  const now = input.now ?? new Date();
  const next = nextRefreshAt(input.releaseDate, (input.precision as DatePrecision | null) ?? null, now);
  let written = 0;
  let negative = 0;
  for (const type of input.expectedTypes) {
    const s = input.scores.find((x) => x.scoreType === type);
    await upsertRating({
      gameId: input.gameId,
      platformId: null,
      scoreProvider: input.scoreProvider,
      scoreOrigin: input.scoreOrigin,
      scoreType: type,
      score: s ? s.score : null,
      scoreMax: s ? s.scoreMax : 100,
      reviewCount: s ? s.reviewCount : null,
      sourceUrl: input.sourceUrl,
      nextRefreshAt: next,
    });
    if (s) written += 1;
    else negative += 1;
  }
  return { written, negative };
}
