/**
 * BrowseGameCard → GroupCardData（伺服器端：頁面首屏與「顯示更多」API 共用同一個建構函式）。
 */
import { formatReleaseLabel, type Locale, type Translator } from "@sok/i18n";
import type { BrowseGameCard } from "../../../domain/entities";
import { gameHref } from "../../links";
import { gameNameLang } from "../../name-lang";
import type { GroupCardData } from "./group-card";

/** 卡片上最多列幾個平台。 */
export const GROUP_CARD_MAX_PLATFORMS = 3;

export function toGroupCard(game: BrowseGameCard, locale: Locale, t: Translator): GroupCardData {
  const shown = game.platforms.slice(0, GROUP_CARD_MAX_PLATFORMS).map((p) => p.abbreviation ?? p.name);
  const rest = game.platforms.length - shown.length;
  const precision = game.firstReleasePrecision ?? "tbd";
  const out: GroupCardData = {
    h: gameHref(locale, game.slug),
    n: game.name,
    d: formatReleaseLabel(game.firstReleaseDate, precision, locale),
    p: shown.join(" · ") + (rest > 0 ? ` +${rest}` : ""),
  };
  const lang = gameNameLang(game.name, game.name === game.originalName, locale);
  if (lang) out.nl = lang;
  if (game.cover) out.c = game.cover.medium;
  if (precision === "day" && game.firstReleaseDate) out.dt = game.firstReleaseDate;
  if (game.gameStatus === "rumored") out.t = t.t("enums.gameStatus.rumored");
  else if (game.gameType !== "main_game") out.t = t.t(`enums.gameType.${game.gameType}`);
  return out;
}
