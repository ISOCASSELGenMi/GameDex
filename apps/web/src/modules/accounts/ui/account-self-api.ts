/** 客戶端呼叫 /api/v1/account（偏好、匯出、刪除；第 7 波）。契約見 T 報告與 07。 */
import type { AccountPreferences, AccountPreferencesPatch, ExportCsvPart } from "../domain/entities/account-self";
import { apiCall, jsonBody } from "./api-call";

/** 帳號狀態（D83）：停權中的帳號只能看說明、匯出與刪除。 */
export const getAccountStatus = () => apiCall<{ suspended: boolean }>("/api/v1/account");
/** 帳號頁摘要：清單數、遊玩紀錄數、追蹤數（停權帳號回 403）。 */
export const getAccountSummary = () => apiCall<{ lists: number; playRecords: number; follows: number }>("/api/v1/account/summary");
export const getPreferences = () => apiCall<{ preferences: AccountPreferences }>("/api/v1/account/preferences");
export const patchPreferences = (body: AccountPreferencesPatch) =>
  apiCall<{ preferences: AccountPreferences; changed: boolean }>("/api/v1/account/preferences", jsonBody("PATCH", body));

/** 刪除帳號。有密碼的帳號帶 password；沒有密碼的帳號傳 null（伺服器檢查 session 是否夠新）。 */
export const deleteAccount = (password: string | null) => apiCall<{ ok: true }>("/api/v1/account", jsonBody("DELETE", password === null ? {} : { password }));

export type ExportRequest = { format: "json" } | { format: "csv"; part: ExportCsvPart };

export function exportUrl(req: ExportRequest): string {
  return req.format === "json" ? "/api/v1/account/export?format=json" : `/api/v1/account/export?format=csv&part=${req.part}`;
}

export type DownloadResult = { ok: true; filename: string } | { ok: false; status: number; code?: string; network?: boolean };

/** Content-Disposition 的 filename（只接受簡單的 ASCII 檔名）。 */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const m = header ? /filename="?([A-Za-z0-9._-]+)"?/.exec(header) : null;
  return m?.[1] ?? fallback;
}

/** 用 fetch 下載（失敗時可以顯示錯誤，而不是讓瀏覽器顯示一頁 JSON），成功後以 blob 觸發儲存。 */
export async function downloadExport(req: ExportRequest): Promise<DownloadResult> {
  try {
    const res = await fetch(exportUrl(req), { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) {
      let code: string | undefined;
      try {
        const j = (await res.json()) as { code?: unknown };
        code = typeof j.code === "string" ? j.code : undefined;
      } catch {
        code = undefined;
      }
      return { ok: false, status: res.status, code };
    }
    const blob = await res.blob();
    const filename = filenameFromDisposition(res.headers.get("content-disposition"), req.format === "json" ? "sok-export.json" : `sok-${req.part}.csv`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, filename };
  } catch {
    return { ok: false, status: 0, network: true };
  }
}
