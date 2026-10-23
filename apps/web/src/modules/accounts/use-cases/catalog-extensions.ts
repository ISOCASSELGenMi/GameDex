/**
 * accounts 提供給 catalog 的擴充點（02 §擴充點；經 module.ts 的 popularitySignals／gameFilters，由 registry 收集後注入 catalog）。
 * - PopularitySignal：site_follows（目前追蹤人數）、site_follows_7d（近 7 天新增追蹤數）；停權帳號不計。
 * - GameFilterProvider：mine＝followed｜owned｜collected｜list:<id>。
 * - RatingColumn：players（評分排名頁的「站內玩家平均」欄；資料由排程 publish_player_ratings 寫進 ratings）。
 */
import {
  parseMineListValue,
  SITE_FOLLOWS_7D_SIGNAL,
  SITE_FOLLOWS_SIGNAL,
  type GameFilterProvider,
  type PopularitySignal,
  type RatingColumn,
} from "@/modules/catalog";
import { resolvePlayerRatingMinCount } from "../domain/entities/player-rating";
import { countGameFollowsBySignal, listFollowedIds } from "../repository/follows";
import { allListedGameIds, findOwnedList, listGameIds } from "../repository/lists";
import { matchedOwnedGameIds } from "../repository/owned-games";

export const siteFollowsSignal: PopularitySignal = {
  name: SITE_FOLLOWS_SIGNAL,
  fetch: (q) => countGameFollowsBySignal({ gameIds: q.gameIds }),
};

export const siteFollows7dSignal: PopularitySignal = {
  name: SITE_FOLLOWS_7D_SIGNAL,
  fetch: (q) => countGameFollowsBySignal({ sinceDays: 7, gameIds: q.gameIds }),
};

/** 排名頁的玩家平均欄：ratings 的 (site_players, user_average)，0~100 整數（顯示 ÷10 一位小數）；預設門檻沿用 PLAYER_RATING_MIN_COUNT。 */
export const playersRatingColumn: RatingColumn = {
  id: "players",
  scoreProvider: "site_players",
  scoreType: "user_average",
  labelKey: "ui.ratings.col.players",
  countLabelKey: "ui.ratings.count.players",
  scale: "ten",
  defaultMinVotes: () => resolvePlayerRatingMinCount(process.env.PLAYER_RATING_MIN_COUNT),
};

const MINE_KEYWORDS = new Set(["followed", "owned", "collected"]);

/** `mine` 篩選值是否合法（不查資料庫）。 */
export function isMineValue(value: string): boolean {
  return MINE_KEYWORDS.has(value) || parseMineListValue(value) !== null;
}

/**
 * followed＝直接追蹤的遊戲（追蹤的平台／系列／公司旗下遊戲的展開列為待決）；
 * owned＝owned_games 已比對到的遊戲；collected＝任一清單內的遊戲；list:<id>＝本人的某個清單（不是本人的／不存在 → null）。
 */
export const mineGameFilter: GameFilterProvider = {
  dimension: "mine",
  handles: isMineValue,
  async resolve(userId, value) {
    if (value === "followed") return (await listFollowedIds(userId)).game;
    if (value === "owned") return matchedOwnedGameIds(userId);
    if (value === "collected") return allListedGameIds(userId);
    const listId = parseMineListValue(value);
    if (listId === null) return null;
    if (!(await findOwnedList(userId, listId))) return null;
    return listGameIds(listId);
  },
};
