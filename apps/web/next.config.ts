import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 預設 .next；在 dev server 執行中另外驗證 build 時用 NEXT_DIST_DIR=build（apps/web/.gitignore 已忽略 /build）
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // workspace 套件直接匯出 TS 原始碼（Turbopack 會自動轉譯 workspace 套件，明列以防改用 webpack 時漏掉）
  transpilePackages: ["@sok/i18n", "@sok/api-contract"],
  partialPrefetching: true,
  // 快取生命週期（06 §SEO 與快取：詳情頁 ISR 1~24 小時；Cloudflare 以 s-maxage 為準，見 infra/cloudflare/cache-rules.md）
  cacheLife: {
    // 遊戲／活動詳情：伺服器端 1 小時背景重建、24 小時內仍可先送舊版（stale-while-revalidate）
    catalogDetail: { stale: 300, revalidate: 3600, expire: 86400 },
    // 查無此項（軟 404）與 sitemap 之類的短快取：1 分鐘後重建
    catalogMiss: { stale: 300, revalidate: 60, expire: 3600 },
    // sitemap 分片：產生成本高（單片數萬列），1 小時重建
    catalogSitemap: { stale: 300, revalidate: 3600, expire: 86400 },
  },
  // 根版面在 app/[locale]：對不上任何路由（含不支援的語系）時用 app/global-not-found.tsx
  experimental: {
    globalNotFound: true,
  },
  // 遊戲封面（IGDB 圖片 CDN；06 §遊戲詳情頁：依 viewport 換尺寸 token）
  images: {
    remotePatterns: [new URL("https://images.igdb.com/igdb/image/upload/**")],
  },
  // 動態頁面（讀 searchParams，無法預渲染）的 CDN 快取標頭（06 §SEO 與快取、16 §Cloudflare）。
  // Next 對動態頁預設送 `private, no-store`，Cloudflare 因此不會快取；這些頁面沒有使用者專屬內容（3a 起無登入），
  // 以路徑設 `s-maxage` 讓 CDN 能快取。快取鍵是完整網址（含 query），所以篩選變體各自獨立。
  // 詳情頁（games/[slug]、events/[slug]）不在這裡：它們是 ISR，由 Next 依 cacheLife 產生標頭。
  // 之後若 accounts 讓頁面出現登入狀態（header.right），這裡必須移除對應路徑或改走 ESI／客戶端取得。
  async headers() {
    const short = [{ key: "Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=300" }];
    const medium = [{ key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=3600" }];
    return [
      // 篩選驅動的頁面（組合多、變動快）：60 秒
      { source: "/:locale/calendar/:month", headers: short },
      { source: "/:locale/timeline", headers: short },
      { source: "/:locale/trending", headers: short },
      { source: "/:locale/games", headers: short },
      // 實體頁與列表：5 分鐘
      { source: "/:locale/platforms", headers: medium },
      { source: "/:locale/platforms/:slug", headers: medium },
      { source: "/:locale/companies/:slug", headers: medium },
      { source: "/:locale/franchises/:slug", headers: medium },
      { source: "/:locale/events", headers: medium },
      // 法務與說明頁（靜態內容）：Next 預設的一年太長（改文字要等 CDN 過期），改 1 小時；改動後部署即生效
      { source: "/:locale/about/:page", headers: [{ key: "Cache-Control", value: "public, s-maxage=3600, stale-while-revalidate=86400" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
