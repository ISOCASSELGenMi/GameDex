import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 預設 .next；在 dev server 執行中另外驗證 build 時用 NEXT_DIST_DIR=build（apps/web/.gitignore 已忽略 /build）
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // workspace 套件直接匯出 TS 原始碼（Turbopack 會自動轉譯 workspace 套件，明列以防改用 webpack 時漏掉）
  transpilePackages: ["@sok/i18n", "@sok/api-contract"],
  partialPrefetching: true,
  // 根版面在 app/[locale]：對不上任何路由（含不支援的語系）時用 app/global-not-found.tsx
  experimental: {
    globalNotFound: true,
  },
  // 遊戲封面（IGDB 圖片 CDN；06 §遊戲詳情頁：依 viewport 換尺寸 token）
  images: {
    remotePatterns: [new URL("https://images.igdb.com/igdb/image/upload/**")],
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
