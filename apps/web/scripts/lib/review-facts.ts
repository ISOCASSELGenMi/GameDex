// Metacritic 頁面資料（發售日、標題、公司、平台）的補抓：校驗頁每一列都要顯示 Metacritic 那邊的發售日。
// 資料與驗證共用同一份快取 metacritic_pages（模組的頁面快取；TTL 見 spec 05），抓過的頁面驗證時不會再發請求。
// 舊側檔 .local/metacritic-facts.json 只在一次性匯入（metacritic-review.ts import-facts）時讀取。
// 被 scripts/metacritic-review.ts（手動 facts 指令）與 scripts/metacritic-daily.ts（每日最後一步）共用。
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/kernel/db/client";
import {
  MetacriticBlockedError,
  METACRITIC_SOURCE,
  checkCanRun,
  createCachedPages,
  createHttp,
  createMetacriticProvider,
  importPageFacts,
  loadBudget,
  slugsWithoutFreshPage,
  type ImportedFacts,
  type MetacriticHttp,
  type PageResult,
} from "@/modules/metacritic";

/** 舊側檔格式（只供一次性匯入）。key＝Metacritic slug。 */
export type FactsMap = Record<string, ImportedFacts>;

/** 舊側檔路徑：匯入完成後程式不再讀寫它。 */
export const FACTS_FILE = path.resolve(process.cwd(), "../../.local/metacritic-facts.json");

/** 一次性匯入：舊側檔 → metacritic_pages（冪等）。檔案不存在回 null。 */
export async function importFactsFile(file: string = FACTS_FILE): Promise<{ total: number; added: number; skipped: number } | null> {
  if (!fs.existsSync(file)) return null;
  return importPageFacts(JSON.parse(fs.readFileSync(file, "utf8")) as FactsMap);
}

/**
 * 需要補頁面資料的 slug，依優先順序：0＝待校驗（auto2 且待覆核）、1＝已採用或手動確認、2＝已移除的候選（否決表）、3＝尚未重驗的舊配對。
 * maxPriority 之後的不列出（每日自動抓取只補校驗頁需要看的 0、1）。已經有未過期快取的不列。
 */
export async function slugsNeedingFacts(maxPriority = 3, now: Date = new Date()): Promise<string[]> {
  const res = await getDb().execute<{ slug: string }>(sql`
    SELECT slug FROM (
      SELECT external_id AS slug,
        CASE WHEN match_method = 'auto2' AND needs_review = true THEN 0
             WHEN match_method = 'auto2' OR match_method = 'manual' THEN 1
             WHEN needs_review = false THEN 3 ELSE 9 END AS pri
      FROM external_ids WHERE source = ${METACRITIC_SOURCE}
      UNION ALL SELECT external_id, 2 FROM external_id_rejections WHERE source = ${METACRITIC_SOURCE}
    ) x WHERE pri <= ${maxPriority} GROUP BY slug ORDER BY min(pri), slug`);
  return slugsWithoutFreshPage(res.rows.map((r) => r.slug), now);
}

export interface FillFactsOptions {
  slugs: readonly string[];
  /** 快取包裝後的供應者（寫穿：抓到就已寫入 metacritic_pages，中途被打斷也不會白做）。 */
  provider: { getScoreById(slug: string): Promise<PageResult> };
  /** 還有額度可以再發一個請求。 */
  canSpend: () => boolean;
  max: number;
}

/** 依序補抓；回傳處理的頁數（含 404、解析失敗的）。 */
export async function fillFacts(o: FillFactsOptions): Promise<number> {
  let fetched = 0;
  for (const slug of o.slugs) {
    if (fetched >= o.max || !o.canSpend()) break;
    await o.provider.getScoreById(slug);
    fetched += 1;
  }
  return fetched;
}

/** 每日任務的額度分配：任務最多用到「每日上限 − 保留給自己的 − 補頁面資料預留」，補資料步驟可以用到「每日上限 − 保留給自己的」。 */
export function jobBudgetLimit(dailyLimit: number, margin: number, factsReserve: number): number {
  return Math.max(1, dailyLimit - margin - factsReserve);
}

export interface FactsStepResult {
  fetched: number;
  requests: number;
  skipped?: string;
}

/** 補抓一輪：過兩道開關與冷卻、共用每日額度（用完就停）、被擋就停。回傳實際請求數。 */
export async function runFactsStep(opts: { max: number; maxPriority?: number; /** 測試注入 */ http?: MetacriticHttp }): Promise<FactsStepResult> {
  const gate = await checkCanRun();
  if (!gate.run) return { fetched: 0, requests: 0, skipped: gate.reason };
  const budget = await loadBudget();
  const http = opts.http ?? createHttp();
  budget.track(http);
  const provider = createCachedPages(createMetacriticProvider(http));
  let fetched = 0;
  try {
    fetched = await fillFacts({ slugs: await slugsNeedingFacts(opts.maxPriority), provider, canSpend: () => budget.remaining() > 0, max: opts.max });
  } catch (err) {
    if (!(err instanceof MetacriticBlockedError)) throw err; // 被擋：停止（冷卻由正式任務記錄），其他錯誤往外丟
  } finally {
    await budget.flush();
  }
  return { fetched, requests: http.requests };
}
