"use client";
/**
 * 詳情頁「玩家平均」區（slot `game.sections`；05 §玩家平均、D68）。公開、可 CDN 快取的端點（s-maxage=300），不帶使用者資訊。
 * - avg 非 null：「8.5／10（123 人）」＋平均耗時。
 * - 有人評分但人數未達門檻（avg 為 null）：顯示說明（不顯示平均與人數，避免用小樣本辨識個人）。
 * - 沒有任何評分也沒有耗時資料：整區不顯示（這個區塊不是 D74 的主分數區，沒資料時留白只是雜訊）。
 */
import { useEffect, useState, type ReactElement } from "react";
import type { PlayerRatingView } from "../domain/entities/player-rating";
import { getPlayerRating } from "./data-api";
import { formatPlayTime, formatScore } from "./play-format";
import { str } from "./str";
import type { AccountStrings } from "./strings";

export function PlayerRating({ strings, locale, gameId }: { strings: AccountStrings; locale: string; gameId: number }): ReactElement | null {
  const [data, setData] = useState<PlayerRatingView | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await getPlayerRating(gameId);
      if (alive && res.ok && res.data) setData(res.data);
    })();
    return () => {
      alive = false;
    };
  }, [gameId]);

  if (!data || (data.ratingCount === 0 && data.avgPlayMinutes === null)) return null;
  const nf = new Intl.NumberFormat(locale);
  return (
    <section aria-labelledby="sec-player-rating" className="detail-section" data-player-rating="">
      <h2 id="sec-player-rating" className="text-xl font-semibold">
        {str(strings, "playerRating.title")}
      </h2>
      {data.avg !== null ? (
        <p data-testid="player-rating-avg">{str(strings, "playerRating.avg", { avg: formatScore(data.avg, locale), scale: nf.format(10), count: nf.format(data.ratingCount) })}</p>
      ) : data.ratingCount > 0 ? (
        <p className="text-[var(--muted)]">{str(strings, "playerRating.notEnough")}</p>
      ) : null}
      {data.avgPlayMinutes !== null ? <p data-testid="player-rating-time">{str(strings, "playerRating.avgTime", { time: formatPlayTime(strings, data.avgPlayMinutes) })}</p> : null}
      <p className="text-sm text-[var(--muted)]">{str(strings, "playerRating.note")}</p>
    </section>
  );
}
