// 讓 tsx 執行的腳本用和 Next.js 相同的規則載入 .env*（.env.local 優先）。
import { loadEnvConfig } from "@next/env";

const isProd = process.env.NODE_ENV === "production";
loadEnvConfig(process.cwd(), !isProd);
