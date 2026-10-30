import { DEFAULT_RATING_PRIORITY, KNOWN_RATING_PROVIDERS } from "./rating-display";

/** 站長層的評分顯示設定（VISIBLE_SCORE_PROVIDERS、RATING_DISPLAY_PRIORITY 解析後）。 */
export interface RatingDisplayConfig {
  /** 空＝不過濾。 */
  visible: readonly string[];
  priority: readonly string[];
  /** 後台關掉的分數類型（Metascore＝metascore、Userscore＝user_score）；環境變數沒有對應設定，預設都不隱藏。 */
  hiddenScoreTypes: readonly string[];
}

export const DEFAULT_RATING_DISPLAY_CONFIG: RatingDisplayConfig = {
  visible: [],
  priority: DEFAULT_RATING_PRIORITY,
  hiddenScoreTypes: [],
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
  return { visible, priority: priority.length > 0 ? priority : DEFAULT_RATING_PRIORITY, hiddenScoreTypes: [] };
}

/** 後台設定（DB）覆蓋環境變數的輸入：有值就用（含「空清單＝不過濾」）；未知的來源名稱直接丟掉。 */
export interface RatingSettingsOverride {
  visibleProviders?: readonly string[];
  priority?: readonly string[];
  showMetascore?: boolean;
  showUserscore?: boolean;
}

const known = (names: readonly string[]) => [...new Set(names)].filter((n) => (KNOWN_RATING_PROVIDERS as readonly string[]).includes(n));

export function applyRatingSettings(base: RatingDisplayConfig, o: RatingSettingsOverride): RatingDisplayConfig {
  const hidden = new Set(base.hiddenScoreTypes);
  if (o.showMetascore !== undefined) {
    if (o.showMetascore) hidden.delete("metascore");
    else hidden.add("metascore");
  }
  if (o.showUserscore !== undefined) {
    if (o.showUserscore) hidden.delete("user_score");
    else hidden.add("user_score");
  }
  const priority = o.priority !== undefined ? known(o.priority) : [];
  return {
    visible: o.visibleProviders !== undefined ? known(o.visibleProviders) : base.visible,
    priority: priority.length > 0 ? priority : base.priority,
    hiddenScoreTypes: [...hidden],
  };
}
