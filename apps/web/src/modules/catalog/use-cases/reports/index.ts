// 資料更正回報（Phase 4 Slice 2，12）。
export { submitReport, type SubmitReportInput, type SubmitReportResult, type SubmitReportDeps } from "./submit-report";
export { resolveReport, type ResolveReportResult } from "./resolve-report";
export { listReportQueue, getReportQueueItem, type ReportQueue } from "./list-reports";
export { clearOldReporterIpHashes, REPORT_IP_RETENTION_DAYS } from "./cleanup-report-ips";
export { getReportFormContext, type ReportFormContext, type ReportTargetRef } from "./get-report-form-context";
export { hashReporterIp, normalizeClientIp } from "./ip-hash";
