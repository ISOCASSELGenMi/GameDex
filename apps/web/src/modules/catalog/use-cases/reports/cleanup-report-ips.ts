/** IP 雜湊保留期限（12：保留 90 天）。 */
import { clearReporterIpHashBefore } from "../../repository/reports";

export const REPORT_IP_RETENTION_DAYS = 90;

/** 把 90 天前建立的回報的 reporterIpHash 設為 NULL；回傳清除筆數。 */
export async function clearOldReporterIpHashes(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REPORT_IP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return clearReporterIpHashBefore(cutoff);
}
