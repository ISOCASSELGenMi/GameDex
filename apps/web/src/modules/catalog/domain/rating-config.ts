import { DEFAULT_RATING_PRIORITY, KNOWN_RATING_PROVIDERS } from "./rating-display";

/** 站長層的評分顯示設定（VISIBLE_SCORE_PROVIDERS、RATING_DISPLAY_PRIORITY 解析後）。 */
export interface RatingDisplayConfig {
  /** 空＝不過濾。 */
  visible: readonly string[];
  priority: readonly string[];
}

export const DEFAULT_RATING_DISPLAY_CONFIG: RatingDisplayConfig = {
  visible: [],
  priority: DEFAULT_RATING_PRIORITY,
};

export class RatingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatingConfigError";
  }
}

function checkNames(variable: string, names: readonly string[], problems: string[]): string[] {
  const unique = [...new Set(names)];
  const unknown = unique.filter((n) => !(KNOWN_RATING_PROVIDERS as readonly string[]).includes(n));
  if (unknown.length > 0) {
    problems.push(`${variable} 含未知的評分來源：${unknown.join(", ")}（可用：${KNOWN_RATING_PROVIDERS.join(", ")}）`);
  }
  return unique;
}

/**
 * 驗證並整理兩個環境變數（名稱已由 kernel 依逗號切好）。未知名稱 → 丟 RatingConfigError（啟動時拒絕，05）。
 * priority 留空 → 預設；visible 留空 → 不過濾。
 */
export function resolveRatingDisplayConfig(raw: {
  VISIBLE_SCORE_PROVIDERS: readonly string[];
  RATING_DISPLAY_PRIORITY: readonly string[];
}): RatingDisplayConfig {
  const problems: string[] = [];
  const visible = checkNames("VISIBLE_SCORE_PROVIDERS", raw.VISIBLE_SCORE_PROVIDERS, problems);
  const priority = checkNames("RATING_DISPLAY_PRIORITY", raw.RATING_DISPLAY_PRIORITY, problems);
  if (problems.length > 0) throw new RatingConfigError(problems.join("；"));
  return { visible, priority: priority.length > 0 ? priority : DEFAULT_RATING_PRIORITY };
}
