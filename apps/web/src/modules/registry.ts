// 唯一會 import 可選模組的地方（02 §邊界規則 3）。新增模組：import 後加進 ALL。
import type { EnvLike } from "@/kernel/config/env";
import { isModuleEnabled } from "@/kernel/modules/enabled";
import { catalogModule, type ModuleManifest } from "./catalog";

const ALL: readonly ModuleManifest[] = [catalogModule];

export function allModules(): readonly ModuleManifest[] {
  return ALL;
}

export function enabledModules(env: EnvLike = process.env): ModuleManifest[] {
  return ALL.filter((m) => m.kind === "core" || isModuleEnabled(m.name, env));
}
