import { config as loadDotenv } from "dotenv";

// NODE_ENV=test 時 Next 的載入器刻意略過 .env.local，所以這裡直接讀
loadDotenv({ path: [".env.test.local", ".env.local", ".env"], quiet: true });
// 整合測試一律連測試資料庫，絕不碰開發資料庫
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
