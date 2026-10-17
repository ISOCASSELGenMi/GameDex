/**
 * 帳號本人的設定、匯出與刪除 Use Case（第 7 波；09 §隱私、匯出、刪除）與管理員停權（12）。
 * - 重新驗證沿用 Better Auth 的密碼驗證函式（`$context.password.verify`，與登入同一份，不重做第二套）。
 * - 刪除直接刪 users 列（FK cascade）；Better Auth 的 deleteUser 端點不啟用（K 報告 §5）。
 */
import { getLocaleConfig, isSupportedLocale } from "@/kernel/locale";
import {
  KNOWN_RATING_PROVIDERS,
  filterExistingFollowTargets,
  followTargetKey,
  getFollowTargetViewMap,
  getGameBriefsByIds,
  regionPrefIssue,
} from "@/modules/catalog";
import {
  REAUTH_WINDOW_SECONDS,
  EXPORT_VERSION,
  validatePreferencesPatch,
  type AccountExport,
  type AccountPreferences,
  type AccountPreferencesPatch,
} from "../domain/entities/account-self";
import { isPlaceholderEmail } from "../domain/entities/email";
import type { FieldErrors } from "../domain/entities/lists";
import { ownedGameStatus } from "../domain/entities/owned-game";
import {
  deleteSessionsOfUser,
  deleteUserRow,
  findCredentialPasswordHash,
  findPreferences,
  findUserForAdmin,
  readExportActiveFeed,
  readExportConnections,
  readExportFollows,
  readExportListGames,
  readExportLists,
  readExportOwnedGames,
  readExportPlayRecords,
  readExportProfile,
  searchUsersForAdmin,
  setSuspendedAt,
  updatePreferences,
  type AdminUserRow,
} from "../repository/account-self";
import { countFollowsOfUser } from "../repository/follows";
import { countUserLists } from "../repository/lists";
import { countPlayRecords } from "../repository/play-records";
import { getAuth } from "./auth-instance";

/** 稽核 log：只有 userId 與時間，沒有任何個資。 */
export type AuditLog = (event: string, data: { userId: number; at: string }) => void;
const defaultAudit: AuditLog = (event, data) => console.info(`[accounts] ${event}`, data);
let audit: AuditLog = defaultAudit;
/** 測試用：攔截稽核 log。傳 undefined 還原。 */
export function setAuditLogForTests(fn: AuditLog | undefined): void {
  audit = fn ?? defaultAudit;
}

// ── 帳號頁摘要 ──────────────────────────────────────────────────────────────

export interface AccountSummary {
  lists: number;
  playRecords: number;
  follows: number;
}

/** 帳號頁上方的統計摘要（清單數、遊玩紀錄數、追蹤數）。三個 COUNT，各自走 user_id 索引。 */
export async function getAccountSummary(userId: number): Promise<AccountSummary> {
  const [lists, playRecords, follows] = await Promise.all([countUserLists(userId), countPlayRecords(userId), countFollowsOfUser(userId)]);
  return { lists, playRecords, follows };
}

// ── 偏好 ──────────────────────────────────────────────────────────────────

export const getPreferences = (userId: number): Promise<AccountPreferences | null> => findPreferences(userId);

/** 驗證 PATCH body（純欄位規則；平台是否存在由 patchPreferences 檢查）。 */
export function parsePreferencesPatch(body: unknown) {
  const config = getLocaleConfig();
  return validatePreferencesPatch(body, {
    isSupportedLocale: (v) => isSupportedLocale(v, config),
    normalizeRegion: (v) => (v.trim() !== "" && regionPrefIssue(v) === null ? v.trim().toUpperCase() : null),
    isKnownScoreProvider: (v) => (KNOWN_RATING_PROVIDERS as readonly string[]).includes(v),
  });
}

export type PatchPreferencesResult =
  | { ok: true; preferences: AccountPreferences; changed: boolean }
  | { ok: false; code: "validation_failed"; fields: FieldErrors }
  | { ok: false; code: "user_not_found" };

export async function patchPreferences(userId: number, patch: AccountPreferencesPatch): Promise<PatchPreferencesResult> {
  if (patch.preferredPlatformIds && patch.preferredPlatformIds.length > 0) {
    const existing = await filterExistingFollowTargets("platform", patch.preferredPlatformIds);
    if (patch.preferredPlatformIds.some((id) => !existing.has(id))) return { ok: false, code: "validation_failed", fields: { preferredPlatformIds: "invalid" } };
  }
  const res = await updatePreferences(userId, patch);
  if (!res) return { ok: false, code: "user_not_found" };
  return { ok: true, ...res };
}

// ── 刪除帳號 ───────────────────────────────────────────────────────────────

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; code: "password_required" | "invalid_password" | "reauth_required" | "user_not_found" };

/**
 * 重新驗證後刪除。
 * - 有密碼：必須帶正確密碼（沒帶 → password_required；錯 → invalid_password）。
 * - 沒密碼：session 建立時間必須在 REAUTH_WINDOW_SECONDS 內，否則 reauth_required。
 * `sessionCreatedAt` 由呼叫端從目前 session 取得。
 */
export async function deleteAccount(input: { userId: number; password: string | null; sessionCreatedAt: Date; now?: Date }): Promise<DeleteAccountResult> {
  const now = input.now ?? new Date();
  const hash = await findCredentialPasswordHash(input.userId);
  if (hash) {
    if (input.password === null || input.password === "") return { ok: false, code: "password_required" };
    const ctx = await getAuth().$context;
    const valid = await ctx.password.verify({ hash, password: input.password });
    if (!valid) return { ok: false, code: "invalid_password" };
  } else if (now.getTime() - input.sessionCreatedAt.getTime() > REAUTH_WINDOW_SECONDS * 1000) {
    return { ok: false, code: "reauth_required" };
  }
  const deleted = await deleteUserRow(input.userId);
  if (!deleted) return { ok: false, code: "user_not_found" };
  audit("account_deleted", { userId: input.userId, at: now.toISOString() });
  return { ok: true };
}

// ── 匯出 ──────────────────────────────────────────────────────────────────

const iso = (d: Date): string => d.toISOString();

/** 組出完整匯出內容。JSON 直接輸出；CSV 各段從同一份資料展開（domain/entities/account-export-csv.ts）。 */
export async function buildAccountExport(userId: number, now: Date = new Date()): Promise<AccountExport | null> {
  const profile = await readExportProfile(userId);
  if (!profile) return null;
  const [prefs, connections, lists, plays, followRows, owned, feed] = await Promise.all([
    findPreferences(userId),
    readExportConnections(userId),
    readExportLists(userId),
    readExportPlayRecords(userId),
    readExportFollows(userId),
    readExportOwnedGames(userId),
    readExportActiveFeed(userId),
  ]);
  if (!prefs) return null;
  const listGames = await readExportListGames(lists.map((l) => l.id));

  // 遊戲名稱與 slug 經 catalog 的公開 API（accounts 不碰 catalog 的表）
  const gameIds = [...listGames.map((g) => g.gameId), ...plays.map((p) => p.gameId), ...owned.flatMap((o) => (o.matchedGameId === null ? [] : [o.matchedGameId]))];
  const briefs = await getGameBriefsByIds(gameIds);
  const targets = await getFollowTargetViewMap(followRows.map((f) => ({ targetType: f.targetType, targetId: f.targetId })), null);
  const gameInfo = (id: number) => ({ gameSlug: briefs.get(id)?.slug ?? null, gameName: briefs.get(id)?.name ?? null });

  const byList = new Map<number, AccountExport["lists"][number]["games"]>();
  for (const g of listGames) {
    const arr = byList.get(g.listId) ?? [];
    arr.push({ gameId: g.gameId, ...gameInfo(g.gameId), position: g.position, note: g.note, addedAt: iso(g.addedAt) });
    byList.set(g.listId, arr);
  }
  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: iso(now),
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      email: profile.email,
      emailIsPlaceholder: isPlaceholderEmail(profile.email),
      emailVerified: profile.emailVerified,
      handle: profile.handle,
      avatarUrl: profile.avatarUrl,
      role: profile.role,
      createdAt: iso(profile.createdAt),
    },
    preferences: {
      locale: prefs.locale,
      timezone: prefs.timezone,
      preferredRegion: prefs.preferredRegion,
      scoreProviders: prefs.scoreProviders,
      preferredPlatformIds: prefs.preferredPlatformIds,
      defaultListVisibility: prefs.defaultListVisibility,
      defaultReviewVisibility: prefs.defaultReviewVisibility,
    },
    connections: connections.map((c) => ({ provider: c.provider, connectedAt: iso(c.connectedAt) })),
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      visibility: l.visibility,
      sortOrder: l.sortOrder,
      createdAt: iso(l.createdAt),
      updatedAt: iso(l.updatedAt),
      games: byList.get(l.id) ?? [],
    })),
    playRecords: plays.map((r) => ({
      id: r.id,
      gameId: r.gameId,
      ...gameInfo(r.gameId),
      platformId: r.platformId,
      status: r.status,
      startedOn: r.startedOn,
      finishedOn: r.finishedOn,
      playMinutes: r.playMinutes,
      rating: r.ratingHalfSteps === null ? null : r.ratingHalfSteps / 2,
      review: r.review,
      reviewHasSpoilers: r.reviewHasSpoilers,
      reviewVisibility: r.reviewVisibility,
      privateNote: r.privateNote,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    })),
    follows: followRows.map((f) => {
      const view = targets.get(followTargetKey(f.targetType, f.targetId));
      return { targetType: f.targetType, targetId: f.targetId, targetSlug: view?.slug ?? null, targetName: view?.originalName ?? null, followedAt: iso(f.createdAt) };
    }),
    ownedGames: owned.map((o) => ({
      provider: o.provider,
      externalGameId: o.externalGameId,
      externalTitle: o.externalTitle,
      status: ownedGameStatus(o),
      matchedGameId: o.matchedGameId,
      matchedGameSlug: o.matchedGameId === null ? null : (briefs.get(o.matchedGameId)?.slug ?? null),
      matchedGameName: o.matchedGameId === null ? null : (briefs.get(o.matchedGameId)?.name ?? null),
      matchConfidencePct: o.matchConfidencePct,
      matchMethod: o.matchMethod,
      importedAt: iso(o.importedAt),
    })),
    privateCalendar: feed
      ? {
          name: feed.name,
          locale: feed.locale,
          feedType: feed.feedType,
          includeReleases: feed.includeReleases,
          includeEvents: feed.includeEvents,
          filterPlatforms: feed.filterPlatforms,
          filterRegions: feed.filterRegions,
          filterGenres: feed.filterGenres,
          filterStages: feed.filterStages,
          createdAt: iso(feed.createdAt),
          lastAccessedAt: feed.lastAccessedAt ? iso(feed.lastAccessedAt) : null,
        }
      : null,
  };
}

// ── 管理員：使用者查詢與停權 ─────────────────────────────────────────────────

export const ADMIN_USER_SEARCH_LIMIT = 50;

export interface AdminUserView {
  id: number;
  email: string;
  emailIsPlaceholder: boolean;
  displayName: string;
  role: string;
  createdAt: string;
  suspendedAt: string | null;
  activeSessions: number;
}

const toAdminView = (r: AdminUserRow): AdminUserView => ({
  id: r.id,
  email: r.email,
  emailIsPlaceholder: isPlaceholderEmail(r.email),
  displayName: r.displayName,
  role: r.role,
  createdAt: r.createdAt.toISOString(),
  suspendedAt: r.suspendedAt ? r.suspendedAt.toISOString() : null,
  activeSessions: r.sessionCount,
});

/** 依 id 或信箱片段查；沒給查詢就列最近停權的。 */
export async function adminSearchUsers(query: string | null): Promise<AdminUserView[]> {
  return (await searchUsersForAdmin(query, ADMIN_USER_SEARCH_LIMIT)).map(toAdminView);
}

export type AdminSuspendResult =
  | { ok: true; changed: boolean; revokedSessions: number }
  | { ok: false; code: "user_not_found" };

/**
 * 停權／解除。停權時撤銷其所有 session（強制登出；**仍可重新登入**——待決，見 T 報告）。
 * 冪等：已停權再停權不改時間、不重複寫稽核 log，但仍會撤銷殘留的 session。
 */
export async function adminSetSuspended(userId: number, suspended: boolean, now: Date = new Date()): Promise<AdminSuspendResult> {
  const res = await setSuspendedAt(userId, suspended ? now : null);
  if (!res.found) return { ok: false, code: "user_not_found" };
  const revokedSessions = suspended ? await deleteSessionsOfUser(userId) : 0;
  if (res.changed) audit(suspended ? "user_suspended" : "user_unsuspended", { userId, at: now.toISOString() });
  return { ok: true, changed: res.changed, revokedSessions };
}

export const adminFindUser = async (userId: number): Promise<AdminUserView | null> => {
  const r = await findUserForAdmin(userId);
  return r ? toAdminView(r) : null;
};
