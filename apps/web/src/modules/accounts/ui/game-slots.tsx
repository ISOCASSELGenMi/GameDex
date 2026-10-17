import type { ReactElement } from "react";
import type { Locale } from "@sok/i18n";
import type { FollowTarget } from "../domain/entities/follows";
import { CardFollowLayer } from "./card-follow-layer";
import { FollowButton } from "./follow-button";
import { FollowCount } from "./follow-count";
import { GameActions } from "./game-actions";
import { PlayerRating } from "./player-rating";
import { accountGamesHref } from "./links";
import { str } from "./str";
import { SubscribePrivateLink } from "./subscribe-private-link";
import { accountStrings } from "./strings";

/** `game.actions` slot：伺服器端只送靜態外殼與字串，使用者資訊由客戶端元件取得（詳情頁是 ISR，HTML 與使用者無關）。 */
export function GameActionsSlot({ locale, gameId }: { locale: Locale; gameId: number }): ReactElement {
  return <GameActions locale={locale} gameId={gameId} strings={accountStrings(locale, ["game.", "follow.", "list.", "play.", "error.", "common.", "account.error."])} />;
}

/** `game.sections` slot：玩家平均區（客戶端取公開的 /api/v1/player-ratings/{gameId}）。 */
export function PlayerRatingSlot({ locale, gameId }: { locale: Locale; gameId: number }): ReactElement {
  return <PlayerRating locale={locale} gameId={gameId} strings={accountStrings(locale, ["playerRating.", "play.duration."])} />;
}

/**
 * `entity.actions` slot：活動、平台、系列、公司頁的追蹤按鈕。props 由 catalog 頁面在知道目標 id 之後帶入；
 * 伺服器 HTML 與使用者無關（按鈕先停用）。
 */
export function EntityActionsSlot({ locale, targetType, targetId }: { locale: Locale; targetType: FollowTarget; targetId: number }): ReactElement {
  const strings = accountStrings(locale, ["follow.", "error.", "common.", "account.error."]);
  return (
    <>
      <FollowButton strings={strings} locale={locale} targetType={targetType} targetId={targetId} hint={str(strings, targetType === "event" ? "follow.hint.event" : "follow.hint.group")} />
      <FollowCount strings={strings} locale={locale} targetType={targetType} targetId={targetId} />
    </>
  );
}

/**
 * `card.actions` slot：月曆與時間軸卡片的追蹤按鈕（整頁一個元件，登入後批次查詢狀態）。
 * 伺服器 HTML 只含字串屬性，不含使用者資訊；按鈕在掛載後才用 portal 放進 catalog 的卡片掛載點。
 */
export function CardActionsSlot({ locale }: { locale: Locale }): ReactElement {
  return <CardFollowLayer locale={locale} strings={accountStrings(locale, ["follow.card", "follow.button", "error.", "common.", "account.error."])} />;
}

/** `filter.links` slot：月曆、時間軸、瀏覽頁篩選區旁的「我的遊戲」連結。連結本身與使用者無關（未登入點進去會看到登入提示）。 */
export function FilterLinksSlot({ locale }: { locale: Locale }): ReactElement {
  const strings = accountStrings(locale, ["mygames.filterLink"]);
  return (
    <p className="filter-links">
      <a className="link inline-flex min-h-11 items-center" href={accountGamesHref(locale)} data-filter-link="my-games">
        {str(strings, "mygames.filterLink")}
      </a>
    </p>
  );
}

/** `subscribe.private` slot：公開訂閱頁的私人行事曆入口（已登入才顯示，由客戶端元件判斷）。 */
export function SubscribePrivateSlot({ locale }: { locale: Locale }): ReactElement {
  return <SubscribePrivateLink locale={locale} strings={accountStrings(locale, ["follow.private."])} />;
}
