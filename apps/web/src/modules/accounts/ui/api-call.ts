/**
 * 客戶端呼叫 `/api/v1/*` 資料端點（清單、遊玩紀錄、玩家平均、匯入；非 Better Auth）的唯一 fetch 實作。
 * 回傳統一的 ApiResult：錯誤時帶 `code`（API 的 `{ code }`）與欄位錯誤 `fields`（validation_failed）。
 * 寫入請求由瀏覽器自動附 Origin（伺服器端要求 Origin 在信任清單內）。
 */
import type { ApiResult } from "./auth-api";

export async function apiCall<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      const code = typeof rec.code === "string" ? rec.code : undefined;
      const fields = rec.fields && typeof rec.fields === "object" ? (rec.fields as Record<string, string>) : undefined;
      return { ok: false, status: res.status, code, fields };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch {
    return { ok: false, status: 0, network: true };
  }
}

export const jsonBody = (method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
