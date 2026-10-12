import { isEnvSet, type EnvLike } from "../config/env";
import { unknownModuleNames } from "./enabled";
import type { ModuleManifestBase } from "./types";

export class ModuleStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleStartupError";
  }
}

/**
 * 啟動檢查（02 §Manifest）：依序檢查每個已啟用模組的 requires 與 requiredEnv。
 * 任何問題都彙整後一次丟出，拒絕啟動。
 */
export function validateModules(enabled: readonly ModuleManifestBase[], env: EnvLike = process.env): void {
  const problems: string[] = [];
  const names = new Set(enabled.map((m) => m.name));

  const unknown = unknownModuleNames(env);
  if (unknown.length > 0) {
    problems.push(`MODULES 含未知或不可由此控制的名稱：${unknown.join(", ")}（metacritic 只認 METACRITIC_SCRAPE_ENABLED）`);
  }
  for (const m of enabled) {
    for (const dep of m.requires) {
      if (!names.has(dep)) problems.push(`模組 ${m.name} 需要 ${dep}，但 ${dep} 未啟用`);
    }
    for (const key of m.requiredEnv) {
      if (!isEnvSet(key, env)) problems.push(`模組 ${m.name} 需要環境變數 ${key}`);
    }
  }
  const jobNames = enabled.flatMap((m) => (m.jobs ?? []).map((j) => j.name));
  const dup = jobNames.filter((n, i) => jobNames.indexOf(n) !== i);
  if (dup.length > 0) problems.push(`排程任務名稱重複（鎖名必須唯一）：${[...new Set(dup)].join(", ")}`);

  if (problems.length > 0) {
    throw new ModuleStartupError(`拒絕啟動：\n- ${problems.join("\n- ")}`);
  }
}

export function describeModules(enabled: readonly ModuleManifestBase[]): string {
  return `[kernel] 已啟用模組：${enabled.map((m) => `${m.name}(${m.kind})`).join(", ")}`;
}
