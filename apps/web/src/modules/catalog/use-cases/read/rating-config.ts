import { ConfigError, getCoreEnv, type CoreEnv } from "@/kernel/config/env";
import {
  RatingConfigError,
  resolveRatingDisplayConfig,
  type RatingDisplayConfig,
} from "../../domain/rating-config";

type RatingEnv = Pick<CoreEnv, "VISIBLE_SCORE_PROVIDERS" | "RATING_DISPLAY_PRIORITY">;

/**
 * 啟動時驗證 VISIBLE_SCORE_PROVIDERS／RATING_DISPLAY_PRIORITY 的來源名稱（05）。
 * 未知名稱丟 ConfigError → bootstrap 拒絕啟動。回傳整理後的設定。
 */
export function validateRatingDisplayEnv(env: RatingEnv = getCoreEnv()): RatingDisplayConfig {
  try {
    return resolveRatingDisplayConfig(env);
  } catch (err) {
    if (err instanceof RatingConfigError) throw new ConfigError(`環境變數驗證失敗：${err.message}`);
    throw err;
  }
}

/** 詳情頁、JSON-LD、日後的 API 讀同一份站長層設定。 */
export function getRatingDisplayConfig(env: RatingEnv = getCoreEnv()): RatingDisplayConfig {
  return validateRatingDisplayEnv(env);
}
