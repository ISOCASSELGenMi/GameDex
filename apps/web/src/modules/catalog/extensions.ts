/**
 * catalog 的執行期擴充點（02 §Manifest 與擴充點）：已啟用的可選模組提供的 PopularitySignal、GameFilterProvider。
 * catalog 不 import 可選模組；由 `modules/registry.ts` 在載入時呼叫 `setCatalogExtensions()` 注入。
 * 放在 globalThis：Next 的 instrumentation（排程）與各 route 是不同的 bundle，要共用同一份。
 * 沒有注入（模組全停用、或測試沒設）＝沒有任何提供者，行為與擴充點不存在時完全相同。
 */
import type { GameFilterProvider, PopularitySignal } from "./domain/entities";

export interface CatalogExtensionSet {
  popularitySignals: readonly PopularitySignal[];
  gameFilters: readonly GameFilterProvider[];
}

const EMPTY: CatalogExtensionSet = { popularitySignals: [], gameFilters: [] };

const g = globalThis as typeof globalThis & { __sokCatalogExtensions?: CatalogExtensionSet };

export function setCatalogExtensions(ext: Partial<CatalogExtensionSet>): void {
  g.__sokCatalogExtensions = { popularitySignals: ext.popularitySignals ?? [], gameFilters: ext.gameFilters ?? [] };
}

export function getCatalogExtensions(): CatalogExtensionSet {
  return g.__sokCatalogExtensions ?? EMPTY;
}

/** 有沒有已啟用的提供者提供這個熱度訊號（例如 accounts 的 site_follows）。 */
export function hasPopularitySignal(name: string): boolean {
  return getCatalogExtensions().popularitySignals.some((s) => s.name === name);
}

/**
 * 解析 FilterSpec 的 `mine` 值（例 "followed"、"list:12"）→ 遊戲 id。
 * 沒有提供者處理、或提供者回 null（無效／不可存取）→ null（呼叫端忽略該篩選並提示）。
 */
export async function resolveMineGameIds(userId: number, value: string): Promise<number[] | null> {
  const provider = getCatalogExtensions().gameFilters.find((p) => p.dimension === "mine" && p.handles(value));
  return provider ? provider.resolve(userId, value) : null;
}
