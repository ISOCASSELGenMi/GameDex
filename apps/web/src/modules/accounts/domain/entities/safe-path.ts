/**
 * 站內相對路徑檢查（唯一實作）：登入後導向（ui/links.ts 的 safeNextPath）與 Steam 的 callbackURL／errorCallbackURL 共用。
 * 只接受以單一 `/` 開頭的路徑；`//host`、含 `\`、控制字元、含 scheme（`/` 之後出現 `:` 於第一個 `/` 之前不可能，因為必以 `/` 開頭）一律回 fallback。
 */
export function safeRelativePath(path: string | null | undefined, fallback: string): string {
  if (!path) return fallback;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return fallback;
  return path;
}

/** 在站內路徑上附加 query 參數（已有 `?` 時用 `&`）。 */
export function withQueryParam(path: string, key: string, value: string): string {
  const hashAt = path.indexOf("#");
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  return `${base}${base.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`;
}
