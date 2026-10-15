/**
 * 送出資料更正回報（12；POST /api/v1/reports 的本體）。
 * 順序：欄位驗證 → 目標與提案值是否存在 → 每 IP 每日上限 → Turnstile → 寫入 →（takedown）通知站長。
 * 設定缺漏的處理（負責人暫定，見 B-report 待決）：
 * - TURNSTILE_SECRET_KEY 未設：非 production 跳過驗證並記 warn；production 回 not_configured（503）。
 * - REPORT_IP_HASH_SECRET 未設：非 production 用開發金鑰；production 回 not_configured（503）。
 */
import { getCoreEnv, type CoreEnv } from "@/kernel/config/env";
import type { DataReport } from "../../domain/entities";
import { validateReportRequest, type ReportFieldErrors, type ValidatedReport } from "../../domain/report-validation";
import { sendAlertWebhook } from "../../providers/alert-webhook";
import { verifyTurnstileToken, type TurnstileResult } from "../../providers/turnstile";
import { getRegionByCode } from "../../repository/regions";
import {
  countReportsByIpHashSince,
  findEventRef,
  findGameRef,
  findPlatformRef,
  findReleaseEventRow,
  insertReport,
  isReportablePlatform,
  languageCodeExists,
} from "../../repository/reports";
import { DEV_IP_HASH_SECRET, hashReporterIp } from "./ip-hash";

export type SubmitReportInput = {
  /** 請求本體（JSON 解析後，尚未驗證）。 */
  body: unknown;
  /** Turnstile widget 產生的 token；未設定金鑰的非 production 環境可省略。 */
  turnstileToken: string | null;
  /** 客戶端 IP（由路由從 CF-Connecting-IP／X-Forwarded-For 取出）；null＝取不到。 */
  clientIp: string | null;
  reporterUserId?: number | null;
};

export type SubmitReportResult =
  | { ok: true; id: number; status: "open" }
  | { ok: false; error: "validation_failed"; fields: ReportFieldErrors }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; error: "captcha_failed" }
  | { ok: false; error: "captcha_unavailable" }
  | { ok: false; error: "not_configured"; missing: string };

export interface SubmitReportDeps {
  env?: CoreEnv;
  now?: () => Date;
  verifyTurnstile?: (token: string, opts: { secret: string; verifyUrl?: string; remoteIp?: string | null }) => Promise<TurnstileResult>;
  alert?: (url: string, message: string) => Promise<boolean>;
  warn?: (message: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 提案值與目標是否存在（需要查資料庫的部分）。 */
async function checkReferences(v: ValidatedReport): Promise<ReportFieldErrors> {
  const errors: ReportFieldErrors = {};
  if (v.targetId !== null) {
    let found = false;
    switch (v.targetType) {
      case "game":
        found = (await findGameRef({ id: v.targetId })) !== null;
        break;
      case "platform":
        found = (await findPlatformRef({ id: v.targetId })) !== null;
        break;
      case "event":
        found = (await findEventRef({ id: v.targetId })) !== null;
        break;
      case "release_event":
        found = (await findReleaseEventRow(v.targetId)) !== null;
        break;
    }
    if (!found) errors.targetId = "invalid";
  }
  if (v.reportType === "missing_region_date" && v.targetId !== null && !errors.targetId) {
    const code = v.proposed?.regionCode;
    const platformId = v.proposed?.platformId;
    if (code && !(await getRegionByCode(code))) errors["proposed.regionCode"] = "invalid";
    if (platformId && !(await isReportablePlatform(v.targetId, platformId))) errors["proposed.platformId"] = "invalid";
  }
  if (v.reportType === "language_support" && v.proposed?.language && !(await languageCodeExists(v.proposed.language))) {
    errors["proposed.language"] = "invalid";
  }
  return errors;
}

export async function submitReport(input: SubmitReportInput, deps: SubmitReportDeps = {}): Promise<SubmitReportResult> {
  const env = deps.env ?? getCoreEnv();
  const now = (deps.now ?? (() => new Date()))();
  const isProduction = env.NODE_ENV === "production";
  const warn = deps.warn ?? ((m: string) => console.warn(m));

  const validation = validateReportRequest(input.body);
  if (!validation.ok) return { ok: false, error: "validation_failed", fields: validation.fields };
  const report = validation.value;
  const refErrors = await checkReferences(report);
  if (Object.keys(refErrors).length > 0) return { ok: false, error: "validation_failed", fields: refErrors };

  const hashSecret = env.REPORT_IP_HASH_SECRET ?? (isProduction ? null : DEV_IP_HASH_SECRET);
  if (!hashSecret) return { ok: false, error: "not_configured", missing: "REPORT_IP_HASH_SECRET" };
  const turnstileSecret = env.TURNSTILE_SECRET_KEY ?? null;
  if (!turnstileSecret && isProduction) return { ok: false, error: "not_configured", missing: "TURNSTILE_SECRET_KEY" };

  const ipHash = hashReporterIp(input.clientIp, hashSecret);
  const since = new Date(now.getTime() - DAY_MS);
  if ((await countReportsByIpHashSince(ipHash, since)) >= env.REPORT_MAX_PER_IP_PER_DAY) {
    return { ok: false, error: "rate_limited", retryAfterSeconds: 3600 };
  }

  if (turnstileSecret) {
    const verify = deps.verifyTurnstile ?? ((token, opts) => verifyTurnstileToken(token, opts));
    const res = await verify(input.turnstileToken ?? "", {
      secret: turnstileSecret,
      verifyUrl: env.TURNSTILE_VERIFY_URL,
      remoteIp: input.clientIp,
    });
    if (!res.ok) return { ok: false, error: res.reason === "rejected" ? "captcha_failed" : "captcha_unavailable" };
  } else {
    warn("[reports] TURNSTILE_SECRET_KEY 未設定，非 production 環境跳過人機驗證");
  }

  const saved: DataReport = await insertReport({ ...report, reporterUserId: input.reporterUserId ?? null, reporterIpHash: ipHash });

  // takedown 不進公開流程：只通知站長（失敗不影響回應；結果記在審核時的 resolutionNote）
  if (saved.reportType === "takedown" && env.ALERT_WEBHOOK_URL) {
    const target = saved.targetId === null ? saved.targetType : `${saved.targetType}#${saved.targetId}`;
    const message = `[SoK] 下架／版權請求 #${saved.id}（${target}）。請到 /internal/reports 處理。`;
    try {
      await (deps.alert ?? sendAlertWebhook)(env.ALERT_WEBHOOK_URL, message);
    } catch (err) {
      warn(`[reports] 下架通知失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: true, id: saved.id, status: "open" };
}
