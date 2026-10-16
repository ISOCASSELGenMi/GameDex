/** 客戶端呼叫 `/api/v1/imports/steam`（遊戲庫匯入；非 Better Auth 端點）。 */
import type { ApiResult } from "./auth-api";
import type { OwnedGamesPage } from "../domain/entities/owned-game";

const BASE = "/api/v1/imports/steam";

export interface SteamLibraryResponse extends OwnedGamesPage {
  importAvailable: boolean;
  /** 還要等幾秒才能再次匯入（0＝可以）。 */
  cooldownSec: number;
}

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const code = json && typeof json === "object" && "code" in json && typeof (json as { code: unknown }).code === "string" ? (json as { code: string }).code : undefined;
    if (!res.ok) return { ok: false, status: res.status, code };
    return { ok: true, status: res.status, data: json as T };
  } catch {
    return { ok: false, status: 0, network: true };
  }
}

export const getSteamLibrary = (offset = 0, limit = 50) => call<SteamLibraryResponse>(`${BASE}?limit=${limit}&offset=${offset}`);
export const startSteamImport = () => call<{ imported: number; total: number }>(BASE, { method: "POST" });
