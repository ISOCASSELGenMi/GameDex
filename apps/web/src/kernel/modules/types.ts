import type { ComponentType } from "react";

/** UI slot 名稱（02 §Manifest 與擴充點）。 */
export type UiSlotName = "header.right" | "game.actions" | "game.sections" | "entity.actions" | "subscribe.private" | "filter.links" | "card.actions";

export interface JobContext {
  /** 任務開始時間；增量同步把它寫回 sync_state.lastSyncedAt。 */
  startedAt: Date;
  /** 手動執行（npm run job -- <name> ...args）時的額外參數；排程觸發時為空陣列。 */
  args: readonly string[];
  log: (message: string, extra?: Record<string, unknown>) => void;
}

export interface ScheduledJob {
  /** 同時是 advisory lock 名稱與 sync_state.job_name。 */
  name: string;
  /** 省略＝只能手動執行（例如回填），不註冊排程。 */
  cron?: string;
  /** 長任務用 session（04 §併發保護）；預設 tx。 */
  lockMode?: "tx" | "session";
  run(ctx: JobContext): Promise<void>;
}

/**
 * 模組 manifest 的 kernel 部分。
 * catalog 擴充點（RatingProvider、PopularitySignal、GameFilterProvider）由 catalog 以交集型別擴充，
 * 因為 kernel 不得 import 任何模組（02 §邊界規則 1）。
 */
export interface ModuleManifestBase {
  name: string;
  kind: "core" | "optional";
  /** 依賴模組；未啟用 → 拒絕啟動。 */
  requires: string[];
  /** 模組啟用時才驗證；缺少 → 拒絕啟動。 */
  requiredEnv: string[];
  /** 移除模組時 drop。 */
  ownedTables: string[];
  jobs?: ScheduledJob[];
  uiSlots?: Partial<Record<UiSlotName, ComponentType>>;
  i18nNamespaces?: string[];
}
