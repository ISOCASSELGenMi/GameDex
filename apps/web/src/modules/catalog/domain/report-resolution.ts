/**
 * 核可日期類回報時，要寫入哪一筆 manual 上市列（12 §核可）。純函式；預覽（審核佇列）與實際寫入共用。
 *
 * - wrong_date（目標是上市事件）：沿用該事件的 (遊戲, 平台, 地區, 階段)，改成提案日期。
 * - missing_region_date（目標是遊戲）：提案的平台與地區；階段取該平台現有列的階段（見 chooseSlotStage）。
 * - 同一個 (遊戲, 平台, 地區, 階段) 已有 manual 列就更新它（含被 IGDB 日期更新覆蓋成 removed 的：改回 active），否則新增；igdb 列原樣保留。
 *   詳情頁同鍵 active manual 時隱藏 igdb 列；IGDB 之後對同鍵有日期更新則覆蓋 manual（planManualSupersedes，使用者 2026-10-15）。
 * - sequence 下限：高於同 (遊戲, 平台, 階段) 全部 igdb 列的最大 sequence（iCal 以聚合結果輸出，manual 優先，sequence 不可倒退）。
 */
import type { IsoDate, ReleaseEvent, ReleaseStage, ReleaseStatus, ReportProposed, ReportType } from "./entities";
import { RELEASE_STAGES } from "./entities";
import { nextReleaseStatus } from "./release-diff";
import { spanFromProposed, type ProposedSpan } from "./report-validation";

export interface ManualReleasePlan {
  gameId: number;
  platformId: number;
  regionId: number;
  stage: ReleaseStage;
  span: ProposedSpan;
  status: ReleaseStatus;
  /** 同鍵既有的 manual 列（會被更新）；沒有則新增。 */
  existingManual: ReleaseEvent | null;
  /** 寫入後取代顯示的現有列（既有 manual，否則同鍵的 igdb 列）；用來寫改期紀錄與預覽。 */
  replaces: ReleaseEvent | null;
  /** 寫入列的 sequence 至少要有這個值。 */
  minSequence: number;
}

export interface ManualReleasePlanInput {
  reportType: ReportType;
  proposed: ReportProposed | null;
  /** wrong_date 的目標列。 */
  event: ReleaseEvent | null;
  /** missing_region_date 的目標遊戲；wrong_date 由 event 決定。 */
  gameId: number | null;
  /** 這款遊戲在該平台的全部上市列（任何地區、任何來源）。 */
  platformRows: readonly ReleaseEvent[];
  /** 提案地區的 id（missing_region_date）；wrong_date 由 event 決定。 */
  regionId: number | null;
  today: IsoDate;
}

export type ManualReleasePlanResult =
  | { ok: true; plan: ManualReleasePlan }
  | { ok: false; reason: "not_a_date_report" | "target_missing" | "invalid_proposal" };

const isManual = (r: ReleaseEvent) => r.source === "manual";

/**
 * 補登時沒指定階段：沿用該平台現有列的階段，才會和同平台的 igdb 列落在同一張月曆卡的挑選範圍
 * （聚合鍵含階段，階段不同會變成兩張卡）。偏好 full → unspecified → 其餘依宣告順序；沒有現有列＝unspecified。
 */
export function chooseSlotStage(rows: readonly Pick<ReleaseEvent, "releaseStage">[]): ReleaseStage {
  const stages = new Set(rows.map((r) => r.releaseStage));
  if (stages.has("full")) return "full";
  if (stages.has("unspecified")) return "unspecified";
  return RELEASE_STAGES.find((s) => stages.has(s)) ?? "unspecified";
}

export function planManualRelease(input: ManualReleasePlanInput): ManualReleasePlanResult {
  const { reportType, proposed } = input;
  if (reportType !== "wrong_date" && reportType !== "missing_region_date") return { ok: false, reason: "not_a_date_report" };
  if (!proposed) return { ok: false, reason: "invalid_proposal" };
  if (proposed.precision !== "tbd" && !proposed.date) return { ok: false, reason: "invalid_proposal" };
  const span = spanFromProposed(proposed.date, proposed.precision ?? "day");

  let gameId: number;
  let platformId: number;
  let regionId: number;
  let stage: ReleaseStage;
  if (reportType === "wrong_date") {
    if (!input.event) return { ok: false, reason: "target_missing" };
    ({ gameId, platformId, regionId } = input.event);
    stage = input.event.releaseStage;
  } else {
    if (input.gameId === null || input.regionId === null || !proposed.platformId) return { ok: false, reason: "invalid_proposal" };
    gameId = input.gameId;
    platformId = proposed.platformId;
    regionId = input.regionId;
    stage = proposed.stage ?? chooseSlotStage(input.platformRows);
  }

  const slotRows = input.platformRows.filter((r) => r.regionId === regionId && r.releaseStage === stage);
  // 同鍵可能有多筆（diff 鍵刻意非 unique）：取 id 最小者
  const byId = [...slotRows].sort((a, b) => a.id - b.id);
  const existingManual = byId.find(isManual) ?? null;
  const igdbSame = byId.find((r) => !isManual(r)) ?? null;
  const replaces = existingManual ?? igdbSame;

  const igdbMax = input.platformRows
    .filter((r) => !isManual(r) && r.releaseStage === stage)
    .reduce((m, r) => Math.max(m, r.sequence), -1);

  // 狀態：沿用 diff 的狀態機（延期／提前／已過日期）；取消的列因為有人提供了日期而回到 scheduled
  const prev = replaces ? { releaseDate: replaces.releaseDate, periodStart: replaces.periodStart, precision: replaces.precision, status: replaces.status } : null;
  const status = nextReleaseStatus(prev, span, false, input.today);

  return {
    ok: true,
    plan: { gameId, platformId, regionId, stage, span, status, existingManual, replaces, minSequence: Math.max(0, igdbMax + 1) },
  };
}
