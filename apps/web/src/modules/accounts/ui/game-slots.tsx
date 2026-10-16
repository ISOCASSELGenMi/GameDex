import type { ReactElement } from "react";
import type { Locale } from "@sok/i18n";
import { GameActions } from "./game-actions";
import { PlayerRating } from "./player-rating";
import { accountStrings } from "./strings";

/** `game.actions` slot：伺服器端只送靜態外殼與字串，使用者資訊由客戶端元件取得（詳情頁是 ISR，HTML 與使用者無關）。 */
export function GameActionsSlot({ locale, gameId }: { locale: Locale; gameId: number }): ReactElement {
  return <GameActions locale={locale} gameId={gameId} strings={accountStrings(locale, ["game.", "list.", "play.", "error.", "common.", "account.error."])} />;
}

/** `game.sections` slot：玩家平均區（客戶端取公開的 /api/v1/player-ratings/{gameId}）。 */
export function PlayerRatingSlot({ locale, gameId }: { locale: Locale; gameId: number }): ReactElement {
  return <PlayerRating locale={locale} gameId={gameId} strings={accountStrings(locale, ["playerRating.", "play.duration."])} />;
}
