// 套用 drizzle/ 底下的 migration：npm run db:migrate
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "../src/kernel/db/client";

migrate(getDb(), { migrationsFolder: "./drizzle" })
  .then(async () => {
    console.log("[migrate] 完成");
    await closeDb();
  })
  .catch(async (err) => {
    console.error("[migrate] 失敗：", err);
    await closeDb();
    process.exit(1);
  });
