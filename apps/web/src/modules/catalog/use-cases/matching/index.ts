export { normalizeTitle } from "./normalize-title";
export { levenshteinSimilarity } from "./similarity";
export { findBestMatch, MATCH_THRESHOLDS, type FindBestMatchOptions } from "./find-best-match";
export { verifyExternalMatch, normalizeCompany, platformFamily, supplementaryMarkers, hasForeignSupplementary, VERIFY_THRESHOLDS } from "./verify-external";
export { findTitleMatchCandidates, findGameIdsByExternalIds, getGameBriefsByIds, TITLE_CANDIDATE_LIMIT, type GameBrief } from "./title-candidates";
