import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // workspace 套件直接匯出 TS 原始碼（Turbopack 會自動轉譯 workspace 套件，明列以防改用 webpack 時漏掉）
  transpilePackages: ["@sok/i18n", "@sok/api-contract"],
  partialPrefetching: true,
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
