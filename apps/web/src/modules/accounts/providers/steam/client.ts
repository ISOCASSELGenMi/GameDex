/**
 * Steam Web API 用戶端（Provider 層；外部格式只存在這裡）。
 * - fetch 可注入（測試用假回應）；逾時 10 秒。
 * - API key 在查詢字串裡：錯誤訊息與 log 一律不含 URL、不含 key。
 * - GetOwnedGames：個人檔案非公開時 Steam 回 `{"response":{}}`（HTTP 200）→ steam_profile_private。
 */
import type { ExternalOwnedGame } from "../../domain/entities/owned-game";

export const STEAM_API_TIMEOUT_MS = 10_000;
const API = "https://api.steampowered.com";

export type SteamApiErrorCode =
  | "steam_profile_private" // 個人檔案或遊戲詳細資料非公開
  | "steam_key_rejected" // 401／403：金鑰無效或被停用（站台設定問題）
  | "steam_upstream_error"; // 逾時、網路、429、5xx、格式錯誤

export class SteamApiError extends Error {
  constructor(
    readonly code: SteamApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SteamApiError";
  }
}

export interface SteamPlayerProfile {
  name: string;
  image?: string;
}

export interface SteamClient {
  getOwnedGames(steamId: string): Promise<ExternalOwnedGame[]>;
  getPlayerSummary(steamId: string): Promise<SteamPlayerProfile | null>;
}

export interface SteamClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

async function getJson(doFetch: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await doFetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch {
    // 不帶原始錯誤：undici 的錯誤訊息可能含完整網址
    throw new SteamApiError("steam_upstream_error", "Steam API 連線失敗或逾時");
  }
  if (res.status === 401 || res.status === 403) throw new SteamApiError("steam_key_rejected", `Steam API 拒絕金鑰（HTTP ${res.status}）`);
  if (!res.ok) throw new SteamApiError("steam_upstream_error", `Steam API 回應 HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new SteamApiError("steam_upstream_error", "Steam API 回應不是 JSON");
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 純函式（可測）：GetOwnedGames 的回應 → 我方型別。 */
export function parseOwnedGames(json: unknown): ExternalOwnedGame[] {
  const response = isRecord(json) ? json.response : undefined;
  if (!isRecord(response)) throw new SteamApiError("steam_upstream_error", "Steam API 回應格式錯誤");
  // 非公開：response 是空物件。公開但沒有遊戲：有 game_count: 0
  if (response.games === undefined && response.game_count === undefined) throw new SteamApiError("steam_profile_private", "遊戲庫非公開");
  const games = response.games;
  if (games === undefined) return [];
  if (!Array.isArray(games)) throw new SteamApiError("steam_upstream_error", "Steam API 回應格式錯誤");
  const out = new Map<string, ExternalOwnedGame>();
  for (const g of games) {
    if (!isRecord(g) || typeof g.appid !== "number" || !Number.isInteger(g.appid) || g.appid <= 0) continue;
    const id = String(g.appid);
    const name = typeof g.name === "string" && g.name.trim() ? g.name.trim() : `App ${id}`;
    out.set(id, { externalGameId: id, title: name });
  }
  return [...out.values()];
}

export function parsePlayerSummary(json: unknown): SteamPlayerProfile | null {
  const response = isRecord(json) ? json.response : undefined;
  const players = isRecord(response) ? response.players : undefined;
  const p = Array.isArray(players) ? players[0] : undefined;
  if (!isRecord(p) || typeof p.personaname !== "string" || !p.personaname.trim()) return null;
  const avatar = typeof p.avatarfull === "string" && p.avatarfull.startsWith("https://") ? p.avatarfull : undefined;
  return { name: p.personaname.trim().slice(0, 100), image: avatar };
}

export function createSteamClient(opts: SteamClientOptions): SteamClient {
  const doFetch: typeof fetch = (...args) => (opts.fetch ?? fetch)(...args);
  const timeout = opts.timeoutMs ?? STEAM_API_TIMEOUT_MS;
  const key = encodeURIComponent(opts.apiKey);
  return {
    async getOwnedGames(steamId) {
      const url = `${API}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${encodeURIComponent(steamId)}&include_appinfo=1&include_played_free_games=1&format=json`;
      return parseOwnedGames(await getJson(doFetch, url, timeout));
    },
    async getPlayerSummary(steamId) {
      const url = `${API}/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${encodeURIComponent(steamId)}&format=json`;
      return parsePlayerSummary(await getJson(doFetch, url, timeout));
    },
  };
}
