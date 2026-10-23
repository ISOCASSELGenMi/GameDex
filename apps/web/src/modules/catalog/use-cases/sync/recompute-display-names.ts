/**
 * recompute_display_names：規則（domain/display-names.ts）改動後全庫重算 games.display_names。
 * 手動：npm run job -- recompute_display_names [--batch-size N]。不打 IGDB、不寫 change_feed、不動 search_text。
 * 分批（預設 1,000 款、id 遞增游標），每批一個 transaction；只更新與現值不同的列。
 */
import { recomputeDisplayNamesBatch } from "../../repository/display-names";

export const DISPLAY_NAMES_BATCH_SIZE = 1000;

type Log = (message: string, extra?: Record<string, unknown>) => void;

export function parseRecomputeDisplayNamesArgs(args: readonly string[]): { batchSize?: number } {
  const out: { batchSize?: number } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--batch-size" || a.startsWith("--batch-size=")) {
      const raw = a.includes("=") ? a.split("=")[1] : args[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--batch-size 需要正整數：${raw ?? ""}`);
      out.batchSize = n;
    } else throw new Error(`未知的參數：${a}（可用：--batch-size N）`);
  }
  return out;
}

export interface RecomputeDisplayNamesResult {
  scanned: number;
  updated: number;
  removedZhHant: number;
}

export async function recomputeDisplayNames(log: Log, opts: { batchSize?: number } = {}): Promise<RecomputeDisplayNamesResult> {
  const batchSize = opts.batchSize ?? DISPLAY_NAMES_BATCH_SIZE;
  const total: RecomputeDisplayNamesResult = { scanned: 0, updated: 0, removedZhHant: 0 };
  let cursor = 0;
  for (;;) {
    const batch = await recomputeDisplayNamesBatch(cursor, batchSize);
    if (batch.lastId === null) break;
    cursor = batch.lastId;
    total.scanned += batch.scanned;
    total.updated += batch.updated;
    total.removedZhHant += batch.removedZhHant;
    log(`display_names 重算進度：已掃描 ${total.scanned}，已更新 ${total.updated}`);
  }
  log(`display_names 重算完成：掃描 ${total.scanned} 款、更新 ${total.updated} 款、移除 zh-Hant ${total.removedZhHant} 款`, { ...total });
  return total;
}
