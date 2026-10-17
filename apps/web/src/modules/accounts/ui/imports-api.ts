/** 客戶端呼叫 `/api/v1/imports/steam`（遊戲庫匯入；非 Better Auth 端點）。 */
import type { GameMiniCard } from "@/modules/catalog";
import type { ApiResult } from "./auth-api";
import { apiCall, jsonBody } from "./api-call";
import type { OwnedGamesPage, OwnedGamesSummary, OwnedGameStatus, OwnedGameView } from "../domain/entities/owned-game";

const BASE = "/api/v1/imports/steam";

export interface SteamLibraryResponse extends OwnedGamesPage {
  importAvailable: boolean;
  /** 還要等幾秒才能再次匯入（0＝可以）。 */
  cooldownSec: number;
}

export const getSteamLibrary = (offset = 0, limit = 50, status?: OwnedGameStatus): Promise<ApiResult<SteamLibraryResponse>> =>
  apiCall<SteamLibraryResponse>(`${BASE}?limit=${limit}&offset=${offset}${status ? `&status=${status}` : ""}`);
export const startSteamImport = () => apiCall<{ imported: number; total: number }>(BASE, { method: "POST" });

/** 手動指定的三種變更（對應 PATCH body）。 */
export type ManualMatchBody = { gameId: number } | { gameId: null } | { reset: true };
export const patchOwnedGame = (ownedGameId: number, body: ManualMatchBody) =>
  apiCall<{ item: OwnedGameView; summary: OwnedGamesSummary }>(`${BASE}/games/${ownedGameId}`, jsonBody("PATCH", body));

export interface MatchCandidate {
  game: GameMiniCard;
  confidencePct: number;
}
export const getMatchCandidates = (ownedGameId: number, locale: string) =>
  apiCall<{ items: MatchCandidate[] }>(`${BASE}/games/${ownedGameId}/candidates?locale=${encodeURIComponent(locale)}`);

export const searchGames = (q: string, locale: string, limit = 10) =>
  apiCall<{ items: GameMiniCard[] }>(`/api/v1/games/search?q=${encodeURIComponent(q)}&limit=${limit}&locale=${encodeURIComponent(locale)}`);
