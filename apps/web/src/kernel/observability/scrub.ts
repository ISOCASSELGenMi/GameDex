/**
 * 錯誤事件清理（16 §營運 §錯誤監控：`beforeSend` 必須清掉的東西）。vendor 無關的純函式：
 * 之後不論接 Sentry、GlitchTip 或只輸出結構化 log，送出前都先過 `scrubEvent()`。
 *
 * 清掉：
 * - `/ical/u/{token}` 路徑段（私人訂閱 feed 的 token，08）
 * - `Authorization`、`Cookie`、`Set-Cookie` 等標頭與同類欄位（依「欄位名稱」整個值換掉）
 * - OAuth token（access_token、refresh_token、id_token、code、client_secret…）：欄位名稱，或網址 query 參數
 * - `INTERNAL_API_SECRET` 的實際值（不論出現在哪個字串裡）
 * - email 位址
 * - 密碼欄位（password、passwd、pwd…）與連線字串裡的密碼（`postgres://user:pass@host`）
 * 原則：寧可多清。不修改輸入物件，回傳新的結構。
 */

export const FILTERED = "[Filtered]";
export const FILTERED_EMAIL = "[email]";

/** 欄位名稱符合就整個值換成 [Filtered]（不分大小寫、含底線／連字號變體）。 */
const SENSITIVE_KEY = /authorization|cookie|passw(or)?d|passphrase|(^|[-_.])pwd($|[-_.])|secret|token|api[-_]?key|credential|session[-_]?id|private[-_]?key|csrf|xsrf/i;

/** 網址 query 參數名稱（OAuth 回呼、API key 等）。 */
const SENSITIVE_QUERY_PARAM =
  /^(code|state|access_token|refresh_token|id_token|token|auth|authorization|password|passwd|pwd|secret|client_secret|api_key|apikey|key|signature|sig)$/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** `/ical/u/{token}`（含 `/ical/u/{token}.ics`、後面接 query／片段）。 */
const ICAL_TOKEN_PATH = /(\/ical\/u\/)[^/?#\s"'<>]+/gi;
/** `Authorization: Bearer xxx`、`Basic xxx` 出現在自由文字裡。 */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** 自由文字裡的 `password=xxx`、`"token": "xxx"`（欄位名稱同 SENSITIVE_KEY 的常見子集）。 */
const KEY_VALUE_TEXT = new RegExp(
  String.raw`(["']?)\b([A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|token|api[-_]?key|credential)[A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;"']+)`,
  "gi",
);
/** `scheme://user:password@host` */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@/]+)@/gi;
/** query 字串裡的 `name=value`。 */
const QUERY_PAIR = /([?&;])([A-Za-z0-9_.-]+)=([^&#\s"'<>]*)/g;
/** JWT 形狀（三段 base64url）。 */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

export interface ScrubOptions {
  /** 額外要從任何字串裡抹掉的實際值（預設會加入環境變數 INTERNAL_API_SECRET）。 */
  secrets?: readonly string[];
  /** 遞迴深度上限（防循環與過大物件）。 */
  maxDepth?: number;
}

function envSecrets(): string[] {
  const v = process.env.INTERNAL_API_SECRET;
  return v && v.length >= 8 ? [v] : [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 清理單一字串（log 訊息、網址、堆疊）。 */
export function scrubString(input: string, opts: ScrubOptions = {}): string {
  let s = input;
  for (const secret of [...(opts.secrets ?? []), ...envSecrets()]) {
    if (secret) s = s.replace(new RegExp(escapeRegExp(secret), "g"), FILTERED);
  }
  s = s.replace(ICAL_TOKEN_PATH, `$1${FILTERED}`);
  s = s.replace(URL_USERINFO, `$1:${FILTERED}@`);
  s = s.replace(QUERY_PAIR, (m, sep: string, name: string) => (SENSITIVE_QUERY_PARAM.test(name) ? `${sep}${name}=${FILTERED}` : m));
  s = s.replace(KEY_VALUE_TEXT, (_m, q1: string, name: string, sep: string) => `${q1}${name}${q1}${sep}${FILTERED}`);
  s = s.replace(AUTH_SCHEME, `$1 ${FILTERED}`);
  s = s.replace(JWT, FILTERED);
  s = s.replace(EMAIL, FILTERED_EMAIL);
  return s;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function scrubValue(value: unknown, opts: ScrubOptions, depth: number, path: WeakSet<object>): unknown {
  if (typeof value === "string") return scrubString(value, opts);
  if (value === null || typeof value !== "object") return value;
  if (depth <= 0) return "[Truncated]";
  if (path.has(value)) return "[Circular]";
  if (value instanceof Date) return value.toISOString();
  path.add(value);
  try {
    if (value instanceof Error) {
      const out: Record<string, unknown> = { name: value.name, message: scrubString(value.message, opts) };
      if (value.stack) out.stack = scrubString(value.stack, opts);
      const digest = (value as { digest?: unknown }).digest;
      if (typeof digest === "string") out.digest = digest;
      if (value.cause !== undefined) out.cause = scrubValue(value.cause, opts, depth - 1, path);
      return out;
    }
    if (Array.isArray(value)) return value.map((item) => scrubValue(item, opts, depth - 1, path));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) && v !== undefined && v !== null ? FILTERED : scrubValue(v, opts, depth - 1, path);
    }
    return out;
  } finally {
    path.delete(value);
  }
}

/** 清理任意事件物件（深層複製）；Error 轉成 `{ name, message, stack, digest, cause }`。 */
export function scrubEvent<T>(event: T, opts: ScrubOptions = {}): T {
  return scrubValue(event, opts, opts.maxDepth ?? 8, new WeakSet()) as T;
}
