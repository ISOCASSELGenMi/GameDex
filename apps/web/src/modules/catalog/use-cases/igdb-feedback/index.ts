/**
 * 待回饋 IGDB 清單（12 §待回饋 IGDB 清單，D91）：後台列出項目、標已提交／略過／改回待回饋。
 * 程式完全不呼叫 IGDB 的寫入；項目只是給管理者手動到 IGDB 網站提交修改的清單。
 * 欄位標籤、IGDB 頁面位置、舊新值文字與整理貼上文字都來自 domain/igdb-feedback-fields.ts 的登錄表。
 */
import {
  IGDB_FEEDBACK_STATUSES,
  type IgdbFeedbackAction,
  type IgdbFeedbackListItem,
  type IgdbFeedbackStatus,
} from "../../domain/entities";
import { IGDB_FEEDBACK_REGISTRY, buildFeedbackPasteText, feedbackLocationText, igdbGameUrl } from "../../domain/igdb-feedback-fields";
import { REPORT_NOTE_MAX } from "../../domain/report-validation";
import { countFeedbackByStatus, listFeedbackRows, setFeedbackStatus, type FeedbackRow } from "../../repository/igdb-feedback";

export { IGDB_FEEDBACK_STATUSES };

const ACTION_STATUS: Record<IgdbFeedbackAction, Exclude<IgdbFeedbackStatus, "adopted">> = {
  submit: "submitted",
  skip: "skipped",
  reopen: "pending",
};

export interface IgdbFeedbackQueue {
  items: IgdbFeedbackListItem[];
  counts: Record<IgdbFeedbackStatus, number>;
}

function toListItem({ item, gameName, platformName }: FeedbackRow): IgdbFeedbackListItem {
  const def = IGDB_FEEDBACK_REGISTRY[item.field];
  return {
    ...item,
    gameName,
    platformName,
    locationText: feedbackLocationText({ platformName, regionCode: item.regionCode, stage: item.stage }),
    fieldLabel: def.label,
    igdbLocation: def.igdbLocation,
    igdbUrl: igdbGameUrl(item.gameSlug, item.igdbGameId),
    oldText: def.formatValue(item.oldValue),
    newText: def.formatValue(item.newValue),
    pasteText: buildFeedbackPasteText({ ...item, gameName, platformName }),
  };
}

export async function listIgdbFeedback(opts: { status?: IgdbFeedbackStatus; limit?: number; offset?: number } = {}): Promise<IgdbFeedbackQueue> {
  const [rows, counts] = await Promise.all([
    listFeedbackRows(opts.status ?? "pending", { limit: Math.min(Math.max(opts.limit ?? 50, 1), 200), offset: opts.offset }),
    countFeedbackByStatus(),
  ]);
  return { items: rows.map(toListItem), counts };
}

export type UpdateIgdbFeedbackResult = { ok: true; updated: number } | { ok: false; error: "no_selection" | "invalid_note" };

/** 標為已提交／略過／改回待回饋（已被 IGDB 採納的不動）。ids 去重；處理備註選填，最長 REPORT_NOTE_MAX 字。 */
export async function updateIgdbFeedback(ids: readonly number[], action: IgdbFeedbackAction, note?: string | null): Promise<UpdateIgdbFeedbackResult> {
  const unique = [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (unique.length === 0) return { ok: false, error: "no_selection" };
  const text = (note ?? "").trim();
  if (text.length > REPORT_NOTE_MAX) return { ok: false, error: "invalid_note" };
  return { ok: true, updated: await setFeedbackStatus(unique, ACTION_STATUS[action], text === "" ? null : text) };
}
