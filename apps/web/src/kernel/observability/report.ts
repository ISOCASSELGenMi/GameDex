/**
 * 結構化錯誤輸出（16 §營運 §錯誤監控）。錯誤監控選型（Sentry／GlitchTip）未定，先不裝 SDK：
 * 這裡把錯誤清理後輸出成一行 JSON（`event: "error"`），帶 `module`、`job` 標籤；日後接 SDK 時只要在 `emit` 旁多送一份。
 * 輸出的內容一律先過 scrubEvent()。
 */
import { scrubEvent, scrubString } from "./scrub";

export interface ErrorReportInput {
  error: unknown;
  /** 發生錯誤的模組（catalog、admin、kernel…）。 */
  module?: string;
  /** 排程任務名稱（任務失敗時）。 */
  job?: string;
  request?: { path?: string; method?: string; headers?: Record<string, string | string[] | undefined> };
  context?: Record<string, unknown>;
}

export interface ErrorLogLine {
  event: "error";
  ts: string;
  level: "error" | "warn";
  module: string;
  job?: string;
  message: string;
  digest?: string;
  error: unknown;
  request?: { path?: string; method?: string; headers?: unknown };
  context?: unknown;
}

/** 查詢逾時是預期內的保護（頁面會提示縮小範圍），記 warn 而非 error。 */
const WARN_DIGESTS = new Set(["SOK_QUERY_TIMEOUT"]);

/** 依 Next 的 routePath（`/[locale]/calendar/[month]`、`/ical/...`、`/internal/...`）推出模組標籤。 */
export function moduleFromRoutePath(routePath: string | undefined): string {
  if (!routePath) return "kernel";
  if (routePath.startsWith("/internal")) return "admin";
  if (routePath.startsWith("/healthz") || routePath.startsWith("/readyz")) return "kernel";
  return "catalog";
}

export function buildErrorLogLine(input: ErrorReportInput, now: Date = new Date()): ErrorLogLine {
  const err = input.error;
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  const message = scrubString(err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 2000);
  const line: ErrorLogLine = {
    event: "error",
    ts: now.toISOString(),
    level: digest && WARN_DIGESTS.has(digest) ? "warn" : "error",
    module: input.module ?? "kernel",
    message,
    error: scrubEvent(err),
  };
  if (input.job) line.job = input.job;
  if (digest) line.digest = digest;
  if (input.request) line.request = scrubEvent(input.request);
  if (input.context) line.context = scrubEvent(input.context);
  return line;
}

/** 輸出一行結構化錯誤 log（stderr）。不丟例外。 */
export function reportError(input: ErrorReportInput): void {
  try {
    const line = buildErrorLogLine(input);
    console.error(JSON.stringify(line));
  } catch (e) {
    console.error(`[kernel] 錯誤回報失敗：${e instanceof Error ? e.message : String(e)}`);
  }
}
