/**
 * 審核一筆資料更正回報（12 §流程、§核可）。
 * accept：wrong_date／missing_region_date 在同一個 transaction 寫入 manual 上市列（含 history、change_feed、sequence）；
 *         其他回報類型只改狀態與 resolutionNote，不自動改資料（由管理者依 note 手動處理）。
 * reject／duplicate：只改狀態與 resolutionNote。
 */
import { utcToday } from "../../domain/utc-date";
import { REPORT_NOTE_MAX } from "../../domain/report-validation";
import type { DataReport, ReportAction } from "../../domain/entities";
import { resolveReportAtomically, type AppliedRelease } from "../../repository/report-resolution";

export type ResolveReportResult =
  | { ok: true; report: DataReport; applied: AppliedRelease | null }
  | { ok: false; error: "not_found" | "already_resolved" | "invalid_note" | "cannot_apply"; detail?: string };

export async function resolveReport(
  id: number,
  action: ReportAction,
  note?: string | null,
  deps: { today?: string } = {},
): Promise<ResolveReportResult> {
  const text = (note ?? "").trim();
  if (text.length > REPORT_NOTE_MAX) return { ok: false, error: "invalid_note" };
  const out = await resolveReportAtomically(id, action, text === "" ? null : text, deps.today ?? utcToday());
  switch (out.kind) {
    case "not_found":
      return { ok: false, error: "not_found" };
    case "already_resolved":
      return { ok: false, error: "already_resolved" };
    case "cannot_apply":
      return { ok: false, error: "cannot_apply", detail: out.reason };
    case "resolved":
      return { ok: true, report: out.report, applied: out.applied };
  }
}
