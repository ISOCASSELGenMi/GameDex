/**
 * 資料更正回報的審核（12 §流程、§核可）：
 * - buildReportQueueItem：審核佇列一筆（目標現況、核可後會寫入的內容、同目標其他回報）。
 * - resolveReportAtomically：核可／駁回／標重複。核可日期類回報時，manual 上市列、release_date_history、change_feed
 *   與回報狀態在同一個 transaction（03 §change_feed 規則）。
 * 上市列的寫入重用 release-events.ts 的 upsertReleaseEvent；要寫什麼由 domain/report-resolution.ts 的 planManualRelease 決定
 * （預覽與實際寫入同一個計算）。
 */
import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/kernel/db/client";
import type {
  DataReport,
  IsoDate,
  ReleaseEvent,
  ReportAction,
  ReportQueueItem,
  ReportReleasePlanView,
  ReportReleaseView,
  ReportStatus,
  ReportTargetView,
} from "../domain/entities";
import { DATE_REPORT_TYPES } from "../domain/report-validation";
import { buildFeedbackDraft, type FeedbackBuildContext } from "../domain/igdb-feedback-fields";
import { planManualRelease, type ManualReleasePlan, type ManualReleasePlanInput } from "../domain/report-resolution";
import { dataReports, releaseDateHistory } from "../schema";
import { appendChange } from "./change-feed";
import { applyManualZhHantTitle } from "./display-names";
import { getFeedbackByReportIds, getFeedbackGameInfo, insertFeedbackItem } from "./igdb-feedback";
import { getRegionByCode, listRegions } from "./regions";
import { upsertReleaseEvent } from "./release-events";
import {
  findEventRef,
  findGameRef,
  findPlatformRef,
  findReleaseEventRow,
  getPlatformNames,
  isReportablePlatform,
  listReleaseRowsForPlatform,
  listReportsForTarget,
} from "./reports";

const OTHERS_LIMIT = 20;

/** wrong_date／missing_region_date 核可前要讀的資料（預覽與核可共用）。 */
interface PlanInputs {
  input: ManualReleasePlanInput;
  /** 無法產生計畫的原因（目標不存在、提案的平台不屬於該遊戲、地區不存在…）。 */
  problem: "target_missing" | "invalid_proposal" | null;
}

async function loadPlanInputs(report: DataReport, today: IsoDate, db: DbOrTx): Promise<PlanInputs> {
  const base = { reportType: report.reportType, proposed: report.proposed, event: null, gameId: null, platformRows: [], regionId: null, today };
  if (report.reportType === "wrong_date") {
    const event = report.targetType === "release_event" && report.targetId ? await findReleaseEventRow(report.targetId, db) : null;
    if (!event) return { input: base, problem: "target_missing" };
    const platformRows = await listReleaseRowsForPlatform(event.gameId, event.platformId, db);
    return { input: { ...base, event, gameId: event.gameId, platformRows }, problem: null };
  }
  if (report.reportType === "missing_region_date") {
    const gameId = report.targetType === "game" ? report.targetId : null;
    const game = gameId ? await findGameRef({ id: gameId }, db) : null;
    if (!game) return { input: base, problem: "target_missing" };
    const platformId = report.proposed?.platformId;
    const code = report.proposed?.regionCode;
    if (!platformId || !code) return { input: base, problem: "invalid_proposal" };
    const region = await getRegionByCode(code, db);
    if (!region || !(await isReportablePlatform(game.id, platformId, db))) return { input: base, problem: "invalid_proposal" };
    const platformRows = await listReleaseRowsForPlatform(game.id, platformId, db);
    return { input: { ...base, gameId: game.id, platformRows, regionId: region.id }, problem: null };
  }
  return { input: base, problem: null };
}

function toReleaseView(r: ReleaseEvent, platformName: string, regionCode: string): ReportReleaseView {
  return {
    releaseEventId: r.id,
    platformId: r.platformId,
    platformName,
    regionCode,
    stage: r.releaseStage,
    date: r.releaseDate,
    precision: r.precision,
    status: r.status,
    source: r.source ?? "igdb",
    sequence: r.sequence,
  };
}

async function regionCodes(db: DbOrTx): Promise<Map<number, string>> {
  return new Map((await listRegions(db)).map((r) => [r.id, r.code]));
}

async function targetView(report: DataReport, db: DbOrTx): Promise<ReportTargetView> {
  const view: ReportTargetView = {
    targetType: report.targetType,
    targetId: report.targetId,
    name: null,
    path: null,
    gameId: null,
    gameSlug: null,
    platformName: null,
    currentReleases: [],
    currentTitle: null,
  };
  const id = report.targetId;
  if (id === null) return view;
  if (report.targetType === "platform") {
    const p = await findPlatformRef({ id }, db);
    if (p) Object.assign(view, { name: p.name, path: `/platforms/${encodeURIComponent(p.slug)}`, platformName: p.name });
  } else if (report.targetType === "event") {
    const e = await findEventRef({ id }, db);
    if (e) Object.assign(view, { name: e.name, path: `/events/${encodeURIComponent(e.slug)}` });
  } else if (report.targetType === "game" || report.targetType === "release_event") {
    const event = report.targetType === "release_event" ? await findReleaseEventRow(id, db) : null;
    const gameId = report.targetType === "game" ? id : (event?.gameId ?? null);
    const game = gameId ? await findGameRef({ id: gameId }, db) : null;
    if (game) Object.assign(view, { name: game.name, path: `/games/${encodeURIComponent(game.slug)}`, gameId: game.id, gameSlug: game.slug });
    if (game && report.reportType === "localized_title") view.currentTitle = (await getFeedbackGameInfo(game.id, db))?.zhHantTitle ?? null;
    // 現況：release_event＝同平台的全部列；missing_region_date＝提案平台、提案地區的列
    const platformId = event?.platformId ?? report.proposed?.platformId ?? null;
    if (game && platformId) {
      const [rows, codes, names] = await Promise.all([
        listReleaseRowsForPlatform(game.id, platformId, db),
        regionCodes(db),
        getPlatformNames([platformId], db),
      ]);
      const pname = names.get(platformId) ?? String(platformId);
      view.platformName = pname;
      const wantCode = report.targetType === "game" ? report.proposed?.regionCode : null;
      view.currentReleases = rows
        .filter((r) => (wantCode ? codes.get(r.regionId) === wantCode : true))
        .map((r) => toReleaseView(r, pname, codes.get(r.regionId) ?? String(r.regionId)));
    }
  }
  return view;
}

async function planView(plan: ManualReleasePlan, db: DbOrTx): Promise<ReportReleasePlanView> {
  const [codes, names] = await Promise.all([regionCodes(db), getPlatformNames([plan.platformId], db)]);
  const platformName = names.get(plan.platformId) ?? String(plan.platformId);
  const code = codes.get(plan.regionId) ?? String(plan.regionId);
  return {
    gameId: plan.gameId,
    platformId: plan.platformId,
    platformName,
    regionCode: code,
    stage: plan.stage,
    releaseDate: plan.span.releaseDate,
    periodStart: plan.span.periodStart,
    precision: plan.span.precision,
    status: plan.status,
    replaces: plan.replaces ? toReleaseView(plan.replaces, platformName, codes.get(plan.replaces.regionId) ?? "?") : null,
  };
}

/** 審核佇列的一筆。唯讀。 */
export async function buildReportQueueItem(report: DataReport, today: IsoDate, db: DbOrTx = getDb()): Promise<ReportQueueItem> {
  const inputs = DATE_REPORT_TYPES.includes(report.reportType) ? await loadPlanInputs(report, today, db) : null;
  const [target, others, feedback] = await Promise.all([
    targetView(report, db),
    report.targetId === null ? Promise.resolve([]) : listReportsForTarget(report.targetType, report.targetId, report.id, OTHERS_LIMIT, db),
    report.status === "accepted" ? getFeedbackByReportIds([report.id], db) : Promise.resolve(new Map<number, { id: number; status: string }>()),
  ]);
  let plan: ReportReleasePlanView | null = null;
  if (inputs && inputs.problem === null) {
    const res = planManualRelease(inputs.input);
    if (res.ok) plan = await planView(res.plan, db);
  }
  return { report, target, plan, others, feedbackItem: feedback.get(report.id) ?? null };
}

// ── 核可 ────────────────────────────────────────────────────────────────

export interface AppliedRelease {
  releaseEventId: number;
  gameId: number;
  gameSlug: string | null;
  result: "created" | "updated" | "unchanged";
  sequence: number;
}

/** 核可 localized_title 時被改動的遊戲（詳情頁快取要重建）。 */
export interface AppliedTitle {
  gameId: number;
  gameSlug: string;
}

export type ResolveReportOutcome =
  | { kind: "not_found" }
  | { kind: "already_resolved"; report: DataReport }
  | { kind: "cannot_apply"; reason: "target_missing" | "invalid_proposal" | "not_a_date_report" }
  | {
      kind: "resolved";
      report: DataReport;
      applied: AppliedRelease | null;
      titleApplied: AppliedTitle | null;
      /** 核可時建立的待回饋 IGDB 項目 id；此類型不建項目為 null。 */
      feedbackItemId: number | null;
    };

const ACTION_STATUS: Record<ReportAction, ReportStatus> = { accept: "accepted", reject: "rejected", duplicate: "duplicate" };

/**
 * 審核一筆 open 的回報。核可 wrong_date／missing_region_date 時同一個 transaction 內寫入 manual 上市列。
 * localized_title 核可時同一個 transaction 寫入 manual 的 zh-Hant 標題並重算 display_names／search_text。
 * 其他回報類型核可只改狀態與 resolutionNote（不自動改資料）。
 * 核可時（會建項目的類型）同一個 transaction 建立一筆待回饋 IGDB 項目（D91；內容由 domain/igdb-feedback-fields.ts 決定）。
 */
export async function resolveReportAtomically(
  id: number,
  action: ReportAction,
  note: string | null,
  today: IsoDate,
  db: DbOrTx = getDb(),
): Promise<ResolveReportOutcome> {
  return db.transaction(async (tx) => {
    // 鎖住這筆回報，避免兩個管理者同時核可
    const locked = await tx.select().from(dataReports).where(eq(dataReports.id, id)).for("update").limit(1);
    const report = locked[0];
    if (!report) return { kind: "not_found" } as const;
    if (report.status !== "open") return { kind: "already_resolved", report } as const;

    let applied: AppliedRelease | null = null;
    let titleApplied: AppliedTitle | null = null;
    let feedbackItemId: number | null = null;
    if (action === "accept") {
      let plan: ManualReleasePlan | null = null;
      if (DATE_REPORT_TYPES.includes(report.reportType)) {
        const inputs = await loadPlanInputs(report, today, tx);
        if (inputs.problem) return { kind: "cannot_apply", reason: inputs.problem } as const;
        const res = planManualRelease(inputs.input);
        if (!res.ok) return { kind: "cannot_apply", reason: res.reason } as const;
        plan = res.plan;
      }
      // 先讀好建立項目需要的現況（localized_title 要在覆蓋標題之前取舊值）
      const feedbackCtx = await loadFeedbackContext(tx, report, plan);
      const title = report.proposed?.title?.trim();
      if (report.reportType === "localized_title") {
        if (!feedbackCtx) return { kind: "cannot_apply", reason: "target_missing" } as const;
        if (report.targetType !== "game" || !title) return { kind: "cannot_apply", reason: "invalid_proposal" } as const;
      }
      if (plan) applied = await applyPlan(tx, report, plan);
      if (report.reportType === "localized_title" && feedbackCtx && title) {
        await applyManualZhHantTitle(tx, feedbackCtx.game.id, title);
        titleApplied = { gameId: feedbackCtx.game.id, gameSlug: feedbackCtx.game.slug };
      }
      const draft = feedbackCtx ? buildFeedbackDraft(feedbackCtx) : null;
      if (feedbackCtx && draft) {
        const item = await insertFeedbackItem(
          { reportId: report.id, game: feedbackCtx.game, draft, sourceUrl: report.sourceUrl, reporterNote: report.note },
          tx,
        );
        feedbackItemId = item?.id ?? null;
      }
    }

    const [updated] = await tx
      .update(dataReports)
      .set({ status: ACTION_STATUS[action], resolutionNote: note, resolvedAt: new Date() })
      .where(eq(dataReports.id, id))
      .returning();
    return { kind: "resolved", report: updated, applied, titleApplied, feedbackItemId } as const;
  });
}

/** 建立待回饋項目需要的現況（遊戲、目標上市列、日期計畫）；找不到遊戲回 null（不建項目）。 */
async function loadFeedbackContext(tx: DbOrTx, report: DataReport, plan: ManualReleasePlan | null): Promise<FeedbackBuildContext | null> {
  const event = report.targetType === "release_event" && report.targetId ? await findReleaseEventRow(report.targetId, tx) : null;
  const gameId = plan?.gameId ?? event?.gameId ?? (report.targetType === "game" ? report.targetId : null);
  const game = gameId ? await getFeedbackGameInfo(gameId, tx) : null;
  if (!game) return null;
  const codes = event || plan ? await regionCodes(tx) : new Map<number, string>();
  const codeOf = (regionId: number) => codes.get(regionId) ?? String(regionId);
  return {
    report: {
      id: report.id,
      reportType: report.reportType,
      targetType: report.targetType,
      targetId: report.targetId,
      proposed: report.proposed,
      sourceUrl: report.sourceUrl,
      note: report.note,
    },
    game,
    event: event ? { platformId: event.platformId, regionCode: codeOf(event.regionId), stage: event.releaseStage, status: event.status } : null,
    plan: plan
      ? {
          platformId: plan.platformId,
          regionCode: codeOf(plan.regionId),
          stage: plan.stage,
          span: plan.span,
          igdbRow: plan.igdbSame ? { releaseDate: plan.igdbSame.releaseDate, precision: plan.igdbSame.precision } : null,
        }
      : null,
  };
}

async function applyPlan(tx: DbOrTx, report: DataReport, plan: ManualReleasePlan): Promise<AppliedRelease> {
  const res = await upsertReleaseEvent(
    {
      gameId: plan.gameId,
      platformId: plan.platformId,
      regionId: plan.regionId,
      releaseStage: plan.stage,
      releaseDate: plan.span.releaseDate,
      periodStart: plan.span.periodStart,
      precision: plan.span.precision,
      status: plan.status,
      source: "manual",
      sourceStatus: "active",
      minSequence: plan.minSequence,
    },
    tx,
  );
  // 新增的 manual 列取代顯示 igdb 列：upsertReleaseEvent 只會寫 created，這裡補上「從舊日期改成新日期」的紀錄，
  // 讓詳情頁的改期紀錄與 change_feed 的訂閱者（通知、Discord）都看得到日期變動（更新既有 manual 列時 upsert 自己已寫）。
  const prev = plan.replaces;
  if (
    res.kind === "created" &&
    prev &&
    (prev.releaseDate !== plan.span.releaseDate || prev.precision !== plan.span.precision)
  ) {
    await tx.insert(releaseDateHistory).values({
      releaseEventId: res.event.id,
      oldDate: prev.releaseDate,
      oldPrecision: prev.precision,
      newDate: plan.span.releaseDate,
      newPrecision: plan.span.precision,
    });
    await appendChange(tx, {
      entityType: "release_event",
      entityId: res.event.id,
      changeType: "date_changed",
      payload: {
        old: { releaseDate: prev.releaseDate, precision: prev.precision },
        new: { releaseDate: plan.span.releaseDate, precision: plan.span.precision },
        source: "manual",
        reportId: report.id,
      },
    });
  }
  const game = await findGameRef({ id: plan.gameId }, tx);
  return { releaseEventId: res.event.id, gameId: plan.gameId, gameSlug: game?.slug ?? null, result: res.kind, sequence: res.event.sequence };
}
