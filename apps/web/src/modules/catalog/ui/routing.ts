// catalog 給 src/proxy.ts 的輕量入口（.dependency-cruiser.cjs 的 app-no-deep-import 允許清單之一）。
// proxy 每個請求都會執行：這裡只能匯出純函式（字串判斷、404 HTML），不可經由 ui/index.ts——
// 那邊會帶進 React 頁面元件與連 DB 的 Use Case。新增匯出前確認其依賴鏈不含 DB／React。
export { decideLocalizedRoute, renderNotFoundHtml, type LocalizedRouteDecision } from "./request-routing";
