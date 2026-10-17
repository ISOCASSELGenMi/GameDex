// 唯一會 import 可選模組的地方（02 §邊界規則 3）。新增模組：import 後加進 ALL。
import type { EnvLike } from "@/kernel/config/env";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { accountsModule } from "./accounts";
import { adminModule } from "./admin";
import { catalogModule, setCatalogExtensions, type CatalogExtensionSet, type ModuleManifest } from "./catalog";

const ALL: readonly ModuleManifest[] = [catalogModule, accountsModule, adminModule];

export function allModules(): readonly ModuleManifest[] {
  return ALL;
}

export function enabledModules(env: EnvLike = process.env): ModuleManifest[] {
  return ALL.filter((m) => m.kind === "core" || isModuleEnabled(m.name, env));
}

/** 已啟用模組提供給 catalog 的擴充點（PopularitySignal、GameFilterProvider）。純函式，供測試。 */
export function collectCatalogExtensions(modules: readonly ModuleManifest[]): CatalogExtensionSet {
  return {
    popularitySignals: modules.flatMap((m) => m.popularitySignals ?? []),
    gameFilters: modules.flatMap((m) => m.gameFilters ?? []),
  };
}

/**
 * 把已啟用模組的擴充點注入 catalog（catalog 不 import 可選模組；extensions.ts 放在 globalThis，各 bundle 共用）。
 * 載入本檔時自動執行一次（排程的 bootstrap、run-job 腳本、頁面與 route 都會 import registry）；測試可用不同的 env 再呼叫。
 */
export function installCatalogExtensions(env: EnvLike = process.env): CatalogExtensionSet {
  const ext = collectCatalogExtensions(enabledModules(env));
  setCatalogExtensions(ext);
  return ext;
}

installCatalogExtensions();
