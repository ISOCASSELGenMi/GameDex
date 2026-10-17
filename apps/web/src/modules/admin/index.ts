// admin 模組的公開 API（只給 modules/registry.ts 與 app/ 的薄路由使用）。
export { adminModule } from "./module";
// CSRF 與同源檢查：內部管理介面的 POST 共用（其他模組的 /internal 頁面經 app/ 薄路由注入，不直接 import admin）。
export { createCsrfToken, verifyCsrfToken, isSameOrigin } from "./csrf";
