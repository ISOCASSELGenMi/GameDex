import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // lint:arch 的刻意違規 fixture
    "test/arch-fixtures/**",
    ".dependency-cruiser.cjs",
    // 自訂 E2E 建置目錄（E2E_DIST_DIR=.next-e2e-*），內容是產生的程式碼
    ".next-e2e-*/**",
  ]),
]);

export default eslintConfig;
