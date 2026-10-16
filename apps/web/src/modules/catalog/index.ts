// catalog 的公開 API。其他模組只能從這裡 import（02 §邊界規則 2）。
export * from "./domain/entities";
export { catalogModule, type ModuleManifest, type CatalogExtensions } from "./module";
export { getGameBySlug, getGameByIgdbId, upsertGame } from "./repository/games";
export { getReleaseEventsByMonth, upsertReleaseEvent } from "./repository/release-events";
export { getRatingsByGame, upsertRating } from "./repository/ratings";
export { listRegions, getRegionByCode } from "./repository/regions";

// ── 讀取（Phase 3a：月曆、詳情、篩選）─────────────────────────────────
export * from "./use-cases/read";
export {
  normalizeReleaseFilter,
  normalizeRegionPref,
  monthBounds,
  MAX_FILTER_VALUES,
  DEFAULT_RELEASE_STATUSES,
  type NormalizedReleaseFilter,
  type ReleaseFilterDefaults,
} from "./domain/release-filter";
export { regionPrefIssue } from "./domain/release-filter";

// ── Phase 4：評分顯示規則與標題比對 ───────────────────────────────────
export {
  selectRatings,
  selectableProviders,
  shouldShowSourceSettings,
  defaultSelectedProviders,
  visibleRatings,
  hasScore,
  isCriticScoreType,
  KNOWN_RATING_PROVIDERS,
  DEFAULT_RATING_PRIORITY,
  DEFAULT_SCORE_PROVIDERS,
  CRITIC_SCORE_TYPES,
  type KnownRatingProvider,
  type RatingLike,
  type RatingSelection,
  type RatingSelectionOptions,
} from "./domain/rating-display";
export {
  resolveRatingDisplayConfig,
  RatingConfigError,
  DEFAULT_RATING_DISPLAY_CONFIG,
  type RatingDisplayConfig,
} from "./domain/rating-config";
export { normalizeTitle, levenshteinSimilarity, findBestMatch, MATCH_THRESHOLDS, type FindBestMatchOptions } from "./use-cases/matching";

// ── Phase 4：資料更正回報（12）──────────────────────────────────────────
export {
  submitReport,
  resolveReport,
  listReportQueue,
  getReportQueueItem,
  clearOldReporterIpHashes,
  getReportFormContext,
  hashReporterIp,
  normalizeClientIp,
  REPORT_IP_RETENTION_DAYS,
  type SubmitReportInput,
  type SubmitReportResult,
  type ResolveReportResult,
  type ReportQueue,
  type ReportFormContext,
  type ReportTargetRef,
} from "./use-cases/reports";
export {
  validateReportRequest,
  reportTypesForTarget,
  parseHttpUrl,
  isValidIsoDate,
  spanFromProposed,
  REPORT_TYPE_RULES,
  DATE_REPORT_TYPES,
  REPORT_NOTE_MAX,
  REPORT_URL_MAX,
  type ReportFieldErrors,
  type ReportValidation,
  type ValidatedReport,
} from "./domain/report-validation";
export { CATALOG_TAG, gameDetailTag } from "./ui/seo/cache-tags";

// ── Phase 7 第 3 波：外部遊戲庫（Steam）比對用的唯讀查詢 ─────────────────
export { findTitleMatchCandidates, findGameIdsByExternalIds, getGameBriefsByIds, TITLE_CANDIDATE_LIMIT, type GameBrief } from "./use-cases/matching";

// ── Phase 7 第 5 波：清單、遊玩紀錄、手動比對用的唯讀查詢 ─────────────────
export { getGameCardsByIds, getGamePlatformOptions, searchGameCards, gameExists, gameHasPlatform } from "./use-cases/game-cards";
