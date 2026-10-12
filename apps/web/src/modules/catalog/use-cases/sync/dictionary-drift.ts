/**
 * 外部連結字典漂移偵測（04 §外部連結）：每晚同步（rolling_refresh）前抓字典比對，出現新 id 就記警告 log。
 * 新 id 的連結在對照表更新前歸 other（不會遺失），所以只警告、不中斷同步；檢查本身失敗也只記 log。
 */
import type { DictionaryDrift } from "../../domain/entities";
import type { GameDataProvider } from "../../providers/game-data-provider.interface";

type Log = (message: string, extra?: Record<string, unknown>) => void;

export async function checkDictionaryDrift(provider: GameDataProvider, log: Log): Promise<DictionaryDrift[]> {
  if (!provider.checkDictionaryDrift) return [];
  try {
    const drift = (await provider.checkDictionaryDrift()).filter((d) => d.newEntries.length > 0);
    for (const d of drift) {
      log(`警告：${d.dictionary} 出現對照表沒有的 id，連結暫歸 other，請更新 link-map.ts`, { newEntries: d.newEntries });
    }
    return drift;
  } catch (err) {
    log("字典漂移檢查失敗（不影響同步）", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
