/**
 * 上市日 diff 與狀態機（04 §上市日 diff 同步、03 §狀態機）。純函式：輸入既有列與來源的完整上市日，輸出要寫的變更。
 * 寫入（history、change_feed、同一 transaction）由 repository 負責。
 */
import type {
  DatePrecision,
  IsoDate,
  ReleaseStage,
  ReleaseStatus,
  SourceStatus,
} from "./entities";

const PRECISION_RANK: Record<DatePrecision, number> = { day: 0, month: 1, quarter: 2, year: 3, tbd: 4 };

/** 日期三元組：代表日期、期間第一天、精度（P24）。 */
export interface DateTriple {
  releaseDate: IsoDate | null;
  periodStart: IsoDate | null;
  precision: DatePrecision;
}

/** 某平台、某地區、某階段的上市列（不含遊戲）。 */
export interface ReleaseSlot {
  platformId: number;
  regionId: number;
  releaseStage: ReleaseStage;
}

export interface ExistingReleaseRow extends ReleaseSlot, DateTriple {
  id: number;
  status: ReleaseStatus;
  sourceStatus: SourceStatus;
  sequence: number;
}

export interface DesiredRelease extends ReleaseSlot, DateTriple {
  /** 來源上市日狀態為 Cancelled。 */
  cancelled: boolean;
}

export interface ReleaseDiffOptions {
  /** 判斷「已過」用的今天（UTC 日期）。 */
  today: IsoDate;
  /** 遊戲層級 game_status = cancelled（P23）。 */
  gameCancelled: boolean;
  /** 既有列這次沒看到 → 標 removed。回填只 upsert，傳 false（04 §回填）。預設 true。 */
  markMissingRemoved?: boolean;
}

export interface ReleaseCreate extends ReleaseSlot, DateTriple {
  status: ReleaseStatus;
}

export interface ReleaseUpdate {
  before: ExistingReleaseRow;
  after: ReleaseSlot & DateTriple & { status: ReleaseStatus; sourceStatus: SourceStatus };
  dateChanged: boolean;
  statusChanged: boolean;
  /** unspecified 改成具體階段（04 §例外）。 */
  stageChanged: boolean;
  sourceStatusChanged: boolean;
}

export interface ReleaseDiffPlan {
  creates: ReleaseCreate[];
  updates: ReleaseUpdate[];
  unchanged: number;
  /** 來源同一 (平台, 地區, 階段) 出現多筆，只採一筆。 */
  duplicatesDropped: number;
}

/** 期間最後一天；tbd → null。month 的代表日期是第一天，要另算月底。 */
export function periodEnd(d: DateTriple): IsoDate | null {
  if (d.precision === "tbd" || d.releaseDate === null) return null;
  if (d.precision !== "month") return d.releaseDate;
  const [y, m] = d.releaseDate.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${d.releaseDate.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

/** 比 periodStart；同一天精度細者較早；tbd 最晚。 */
export function isEarlierSpan(a: DateTriple, b: DateTriple): boolean {
  if (a.periodStart === null) return false;
  if (b.periodStart === null) return true;
  if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart;
  return PRECISION_RANK[a.precision] < PRECISION_RANK[b.precision];
}

/** 延期：新日期落在舊期間之後、變成 tbd，或精度變粗（03 §狀態機）。 */
export function isDelay(prev: DateTriple, next: DateTriple): boolean {
  if (next.periodStart === null) return prev.periodStart !== null;
  if (prev.periodStart === null) return false;
  const prevEnd = periodEnd(prev);
  if (prevEnd !== null && next.periodStart > prevEnd) return true;
  return PRECISION_RANK[next.precision] > PRECISION_RANK[prev.precision];
}

export function isDateChanged(prev: DateTriple, next: DateTriple): boolean {
  return prev.releaseDate !== next.releaseDate || prev.precision !== next.precision;
}

/**
 * 下一個 status：
 * - 取消（來源 Cancelled，或遊戲層級 cancelled 且未過期）→ cancelled；兩者都不成立時從 cancelled 回到 scheduled
 * - 日期變動：延期 → delayed；提前或精確化 → scheduled
 * - 精度 day 且日期已過 → released（與 04 §自動轉 released 同一規則）
 */
export function nextReleaseStatus(
  prev: (DateTriple & { status: ReleaseStatus }) | null,
  next: DateTriple,
  cancelled: boolean,
  today: IsoDate,
): ReleaseStatus {
  if (cancelled) return "cancelled";
  let status: ReleaseStatus = !prev || prev.status === "cancelled" ? "scheduled" : prev.status;
  if (prev && isDateChanged(prev, next)) status = isDelay(prev, next) ? "delayed" : "scheduled";
  if (next.precision === "day" && next.releaseDate !== null && next.releaseDate <= today) status = "released";
  return status;
}

/**
 * 遊戲層級 cancelled 只影響未過期的列（P23）；tbd 視為未過期。
 */
function isCancelled(d: DesiredRelease, opts: ReleaseDiffOptions): boolean {
  if (d.cancelled) return true;
  return opts.gameCancelled && (d.releaseDate === null || d.releaseDate >= opts.today);
}

const slotKey = (s: ReleaseSlot) => `${s.platformId}:${s.regionId}:${s.releaseStage}`;
const placeKey = (s: Pick<ReleaseSlot, "platformId" | "regionId">) => `${s.platformId}:${s.regionId}`;

/** 同一 slot 只留一筆：非取消優先，其次日期最早。 */
function dedupeDesired(desired: readonly DesiredRelease[]): { rows: DesiredRelease[]; dropped: number } {
  const best = new Map<string, DesiredRelease>();
  for (const d of desired) {
    const k = slotKey(d);
    const cur = best.get(k);
    if (!cur) best.set(k, d);
    else if (cur.cancelled && !d.cancelled) best.set(k, d);
    else if (cur.cancelled === d.cancelled && isEarlierSpan(d, cur)) best.set(k, d);
  }
  return { rows: [...best.values()], dropped: desired.length - best.size };
}

/** 例外配對時，具體階段的優先順序。 */
const STAGE_PRIORITY: ReleaseStage[] = ["full", "early_access", "beta", "alpha", "demo", "other"];

/**
 * 對一款遊戲做完整 diff（來源以核心查詢完整展開，所以沒看到的列＝來源拿掉了）。
 * @param existing 這款遊戲 source='igdb' 的既有列（含 removed）
 * @param desired 這次來源給的全部上市日（已轉成我方平台、地區 id）
 */
export function planReleaseEventDiff(
  existing: readonly ExistingReleaseRow[],
  desired: readonly DesiredRelease[],
  opts: ReleaseDiffOptions,
): ReleaseDiffPlan {
  const { rows, dropped } = dedupeDesired(desired);
  const plan: ReleaseDiffPlan = { creates: [], updates: [], unchanged: 0, duplicatesDropped: dropped };

  // 既有列依 slot 分組（不是 unique，重複時取 id 最小者配對，其餘當作沒看到）
  const bySlot = new Map<string, ExistingReleaseRow>();
  for (const e of [...existing].sort((a, b) => a.id - b.id)) if (!bySlot.has(slotKey(e))) bySlot.set(slotKey(e), e);
  const matched = new Set<number>();
  const pairs: Array<[ExistingReleaseRow | null, DesiredRelease]> = [];
  const pending: DesiredRelease[] = [];

  for (const d of rows) {
    const e = bySlot.get(slotKey(d));
    if (e) {
      matched.add(e.id);
      pairs.push([e, d]);
    } else pending.push(d);
  }

  // 例外：同一 (平台, 地區) 原本只有一筆 unspecified，來源改給具體階段 → 視為同一筆更新
  const desiredUnspecified = new Set(rows.filter((d) => d.releaseStage === "unspecified").map(placeKey));
  const existingByPlace = new Map<string, ExistingReleaseRow[]>();
  for (const e of existing) existingByPlace.set(placeKey(e), [...(existingByPlace.get(placeKey(e)) ?? []), e]);
  pending.sort((a, b) => STAGE_PRIORITY.indexOf(a.releaseStage) - STAGE_PRIORITY.indexOf(b.releaseStage));
  for (const d of pending) {
    const place = existingByPlace.get(placeKey(d)) ?? [];
    const only = place.length === 1 ? place[0] : undefined;
    if (
      d.releaseStage !== "unspecified" &&
      only &&
      only.releaseStage === "unspecified" &&
      !matched.has(only.id) &&
      !desiredUnspecified.has(placeKey(d))
    ) {
      matched.add(only.id);
      pairs.push([only, d]);
    } else pairs.push([null, d]);
  }

  for (const [e, d] of pairs) {
    const status = nextReleaseStatus(e, d, isCancelled(d, opts), opts.today);
    const slot = { platformId: d.platformId, regionId: d.regionId, releaseStage: d.releaseStage };
    const dates = { releaseDate: d.releaseDate, periodStart: d.periodStart, precision: d.precision };
    if (!e) {
      plan.creates.push({ ...slot, ...dates, status });
      continue;
    }
    const update: ReleaseUpdate = {
      before: e,
      after: { ...slot, ...dates, status, sourceStatus: "active" },
      dateChanged: isDateChanged(e, d),
      statusChanged: e.status !== status,
      stageChanged: e.releaseStage !== d.releaseStage,
      sourceStatusChanged: e.sourceStatus !== "active",
    };
    if (update.dateChanged || update.statusChanged || update.stageChanged || update.sourceStatusChanged || e.periodStart !== d.periodStart) {
      plan.updates.push(update);
    } else plan.unchanged += 1;
  }

  for (const e of existing) {
    if (matched.has(e.id)) continue;
    if (e.sourceStatus === "removed" || opts.markMissingRemoved === false) {
      plan.unchanged += 1;
      continue;
    }
    plan.updates.push({
      before: e,
      after: { ...e, sourceStatus: "removed" },
      dateChanged: false,
      statusChanged: false,
      stageChanged: false,
      sourceStatusChanged: true,
    });
  }
  return plan;
}
