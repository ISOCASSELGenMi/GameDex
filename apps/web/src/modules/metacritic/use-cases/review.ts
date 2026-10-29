/**
 * /internal/matches 的 Use Case（12 §比對覆核）：needs_review 佇列、確認、清除（寫否決表）、手動輸入外部 ID。
 * 確認與手動輸入標 matchMethod='manual'（排程不再覆寫）；清除同時寫 external_id_rejections 並刪除該遊戲的 Metacritic 分數列。
 */
import {
  confirmExternalMatch,
  countMatchReviewQueue,
  listMatchReviewQueue,
  rejectExternalMatch,
  setManualExternalMatch,
  type MatchReviewItem,
} from "@/modules/catalog";
import { METACRITIC_SOURCE, SLUG_PATTERN, gameUrl } from "../provider/provider";

/** 遊戲頁網址（覆核頁的連結用）。 */
export const reviewGameUrl = gameUrl;

export interface ReviewQueue {
  items: MatchReviewItem[];
  total: number;
}

export async function loadReviewQueue(limit = 100): Promise<ReviewQueue> {
  const [items, total] = await Promise.all([listMatchReviewQueue(METACRITIC_SOURCE, limit), countMatchReviewQueue(METACRITIC_SOURCE)]);
  return { items, total };
}

export type ReviewAction = { action: "confirm" | "reject"; id: number } | { action: "manual"; gameId: number; slug: string };
export type ReviewResult = { ok: true } | { ok: false; error: "not_found" | "invalid_slug" };

export async function applyReviewAction(a: ReviewAction): Promise<ReviewResult> {
  if (a.action !== "manual") {
    const done = a.action === "confirm" ? await confirmExternalMatch(a.id, METACRITIC_SOURCE) : await rejectExternalMatch(a.id, METACRITIC_SOURCE, METACRITIC_SOURCE);
    return done ? { ok: true } : { ok: false, error: "not_found" };
  }
  const slug = a.slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return { ok: false, error: "invalid_slug" };
  return (await setManualExternalMatch(a.gameId, METACRITIC_SOURCE, slug, gameUrl(slug))) ? { ok: true } : { ok: false, error: "not_found" };
}
