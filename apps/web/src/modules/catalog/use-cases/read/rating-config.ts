import { ConfigError, getCoreEnv, type CoreEnv } from "@/kernel/config/env";
import { getSettings } from "@/kernel/settings";
import {
  applyRatingSettings,
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

/** 環境變數層（不含後台設定）；單元測試與啟動檢查用。 */
export function getRatingDisplayConfig(env: RatingEnv = getCoreEnv()): RatingDisplayConfig {
  return validateRatingDisplayEnv(env);
}

/**
 * 詳情頁、JSON-LD、日後的 API 讀同一份站長層設定：環境變數是預設值，後台設定（DB，短 TTL 快取）有值就覆蓋（12 §設定頁）。
 */
export async function getEffectiveRatingDisplayConfig(env: RatingEnv = getCoreEnv()): Promise<RatingDisplayConfig> {
  const base = validateRatingDisplayEnv(env);
  const s = await getSettings();
  const list = (k: "ratings.visibleProviders" | "ratings.priority") => {
    const v = s.get(k);
    return Array.isArray(v) ? v : undefined;
  };
  const flag = (k: "ratings.showMetascore" | "ratings.showUserscore") => {
    const v = s.get(k);
    return typeof v === "boolean" ? v : undefined;
  };
  return applyRatingSettings(base, {
    visibleProviders: list("ratings.visibleProviders"),
    priority: list("ratings.priority"),
    showMetascore: flag("ratings.showMetascore"),
    showUserscore: flag("ratings.showUserscore"),
  });
}
