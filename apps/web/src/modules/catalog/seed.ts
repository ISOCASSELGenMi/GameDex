/**
 * 初始化資料（冪等，可重複執行）：npm run db:seed
 * 目前只有 regions（03 §平台與地區）。
 */
import { closeDb } from "@/kernel/db/client";
import { SEED_REGIONS } from "./domain/entities";
import { upsertRegions } from "./repository/regions";

export async function seedCatalog(): Promise<void> {
  const n = await upsertRegions(SEED_REGIONS);
  console.log(`[seed] regions：${n} 筆`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("modules/catalog/seed.ts");
if (isMain) {
  seedCatalog()
    .then(() => closeDb())
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
