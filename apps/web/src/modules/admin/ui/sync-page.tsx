/**
 * /internal/sync：同步監控（唯讀；12 §同步監控）。伺服器元件；內部使用，介面文字固定 zh-Hant。
 * 各排程任務最後執行時間／結果、回填進度（cursor／meta）、最近失敗。資料只來自 sync_state 與已註冊的任務清單。
 */
import type { ReactElement } from "react";
import { AdminNav } from "@/kernel/ui/admin-nav";
import { loadSyncMonitor, type JobDefinitionInfo, type JobHealth, type SyncMonitorRow } from "../use-cases/sync-monitor";

export interface SyncAdminPageProps {
  jobs: readonly JobDefinitionInfo[];
}

const HEALTH_LABEL: Record<JobHealth, string> = { ok: "正常", failing: "失敗中", never: "尚未執行", manual: "手動任務（未執行）" };
const when = (d: Date | null) => (d ? `${d.toISOString().slice(0, 19).replace("T", " ")} UTC` : "—");

function JobsTable({ rows }: { rows: readonly SyncMonitorRow[] }): ReactElement {
  return (
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="任務狀態">
      <table className="release-table" data-sync-table="jobs">
        <thead>
          <tr>
            <th scope="col">任務</th>
            <th scope="col">排程</th>
            <th scope="col">狀態</th>
            <th scope="col">最後成功</th>
            <th scope="col">最後失敗</th>
            <th scope="col">連續失敗</th>
            <th scope="col">進度</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} data-job={r.name} data-health={r.health}>
              <th scope="row" className="[overflow-wrap:anywhere]">
                {r.name}
              </th>
              <td>{r.definition ? (r.definition.cron ?? "僅手動") : "—"}</td>
              <td>{HEALTH_LABEL[r.health]}</td>
              <td>{when(r.lastSuccessAt)}</td>
              <td>{when(r.lastFailureAt)}</td>
              <td>{r.consecutiveFailures}</td>
              <td className="max-w-80 text-sm [overflow-wrap:anywhere]">{r.progress ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function SyncAdminPage({ jobs }: SyncAdminPageProps): Promise<ReactElement> {
  const view = await loadSyncMonitor(jobs);
  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-bold">同步監控</h1>
      <AdminNav current="sync" />
      <p className="text-sm text-[var(--muted)]">
        唯讀。資料來自 sync_state（任務每次執行後寫入）與目前啟用模組註冊的排程任務；回填類任務的進度存在 cursor／meta。
      </p>
      <section aria-labelledby="sync-failures" className="flex flex-col gap-2">
        <h2 id="sync-failures" className="text-xl font-semibold">
          最近失敗
        </h2>
        {view.recentFailures.length === 0 ? (
          <p data-sync-failures="none">沒有失敗紀錄。</p>
        ) : (
          <ul className="flex flex-col gap-2" data-sync-failures="list">
            {view.recentFailures.map((r) => (
              <li key={r.name} className="rounded-md border border-[var(--border)] p-3" data-failure={r.name}>
                <p className="font-semibold">
                  {r.name}
                  <span className="chip ml-2">{HEALTH_LABEL[r.health]}</span>
                </p>
                <p className="text-sm">
                  {when(r.lastFailureAt)}・連續失敗 {r.consecutiveFailures} 次
                </p>
                <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{r.lastError ?? "（無錯誤訊息）"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="sync-jobs" className="flex flex-col gap-2">
        <h2 id="sync-jobs" className="text-xl font-semibold">
          所有任務（{view.rows.length}）
        </h2>
        <JobsTable rows={view.rows} />
      </section>
    </main>
  );
}
