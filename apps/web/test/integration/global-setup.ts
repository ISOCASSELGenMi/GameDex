/**
 * 整合測試前：重建測試資料庫 → 套用 migration → seed regions。
 * 只在 TEST_DATABASE_URL 有設定時執行；資料庫名稱必須以 _test 結尾（防止誤刪開發資料庫）。
 */
import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { SEED_REGIONS } from "../../src/modules/catalog/domain/entities/region";

export default async function setup(): Promise<void> {
  // NODE_ENV=test 時 Next 的載入器刻意略過 .env.local，所以這裡直接讀
  loadDotenv({ path: [".env.test.local", ".env.local", ".env"], quiet: true });
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    console.log("[integration] 未設定 TEST_DATABASE_URL，跳過整合測試");
    return;
  }
  const url = new URL(raw);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`TEST_DATABASE_URL 的資料庫名稱必須以 _test 結尾：${dbName}`);

  const admin = new URL(raw);
  admin.pathname = "/postgres";
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`);
  await c.end();

  const pool = new pg.Pool({ connectionString: raw });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  for (const r of SEED_REGIONS) {
    await pool.query("INSERT INTO regions (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING", [r.code, r.name]);
  }
  await pool.end();
}
