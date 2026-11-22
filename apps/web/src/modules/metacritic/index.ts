// metacritic 的公開 API。只有 modules/registry.ts 與 app/ 可以 import 可選模組（02 §邊界規則 3）。
export { metacriticModule, metascoreColumn, userscoreColumn } from "./module";
export { createMatchesPost, type AdminCsrfDeps } from "./api/matches";
// 頁面快取（scripts 與外部呼叫只經這裡；repository 不外露）
export { createCachedPages, slugsWithoutFreshPage, loadPageFacts, pageExpiresAt, PAGE_TTL_DAYS, type CachedPages, type PageFacts } from "./use-cases/pages";
export { importPageFacts, type ImportedFacts } from "./use-cases/import-facts";
export { loadBudget, checkCanRun, createHttp, dailyRequestLimit, type Budget } from "./use-cases/runtime";
export { createMetacriticProvider, METACRITIC_SOURCE, type PageResult } from "./provider/provider";
export { MetacriticBlockedError, type MetacriticHttp } from "./provider/http";
