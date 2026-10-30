// metacritic 的公開 API。只有 modules/registry.ts 與 app/ 可以 import 可選模組（02 §邊界規則 3）。
export { metacriticModule, metascoreColumn, userscoreColumn } from "./module";
export { createMatchesPost, type AdminCsrfDeps } from "./api/matches";
