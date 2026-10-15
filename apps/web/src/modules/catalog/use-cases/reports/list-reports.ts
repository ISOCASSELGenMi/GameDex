/** 審核佇列（12）：open 的回報依建立時間舊到新，每筆附目標現況、核可後會寫入的內容、同目標其他回報。 */
import { utcToday } from "../../domain/utc-date";
import type { ReportQueueItem, ReportStatus } from "../../domain/entities";
import { buildReportQueueItem } from "../../repository/report-resolution";
import { countReportsByStatus, getReport, listReportsByStatus } from "../../repository/reports";

export interface ReportQueue {
  items: ReportQueueItem[];
  counts: Record<ReportStatus, number>;
}

export async function listReportQueue(opts: { status?: ReportStatus; limit?: number; offset?: number } = {}): Promise<ReportQueue> {
  const today = utcToday();
  const reports = await listReportsByStatus(opts.status ?? "open", { limit: Math.min(Math.max(opts.limit ?? 50, 1), 200), offset: opts.offset });
  const [items, counts] = await Promise.all([
    Promise.all(reports.map((r) => buildReportQueueItem(r, today))),
    countReportsByStatus(),
  ]);
  return { items, counts };
}

export async function getReportQueueItem(id: number): Promise<ReportQueueItem | null> {
  const report = await getReport(id);
  return report ? buildReportQueueItem(report, utcToday()) : null;
}
