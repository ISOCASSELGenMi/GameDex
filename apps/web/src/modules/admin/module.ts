import type { ModuleManifestBase } from "@/kernel/modules/types";

/**
 * admin 模組（02、12）：`/internal/*` 覆核與審核。透過 catalog 的公開 API 修改資料，catalog 不知道它存在。
 * 帳密（ADMIN_BASIC_AUTH_USER／_PASS）不列為 requiredEnv：MODULES 預設清單含 admin，
 * 缺帳密時啟動失敗會擋住所有開發者；改採「未設＝/internal 整個回 404」（kernel/http/admin-gate.ts）。
 */
export const adminModule: ModuleManifestBase = {
  name: "admin",
  kind: "optional",
  requires: [],
  requiredEnv: [],
  ownedTables: [],
};
