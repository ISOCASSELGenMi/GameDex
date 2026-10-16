/**
 * 登入方式（09、03 §帳號，D78）：`connected_accounts.provider` 是 varchar，允許值只在這裡定義一次。
 * credential＝Email＋密碼（Better Auth 的 credential 列）；microsoft 同時服務 Xbox 登入與匯入。
 * psn／nintendo 不做（D18）；epic 待查證。
 */
export const AUTH_PROVIDERS = ["credential", "discord", "google", "twitch", "twitter", "microsoft", "steam"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/** 標準 OAuth 的社群登入（Better Auth 內建 provider）。steam 走自寫 plugin（第 3 波），credential 不是社群登入。 */
export const SOCIAL_PROVIDERS = ["discord", "google", "twitch", "twitter", "microsoft"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isAuthProvider(value: string): value is AuthProvider {
  return (AUTH_PROVIDERS as readonly string[]).includes(value);
}

export function isSocialProvider(value: string): value is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/** 「已綁定的登入方式」清單與遊戲庫匯入對象都排除 credential（密碼不是「外部帳號」）。 */
export function isExternalProvider(value: string): boolean {
  return value !== "credential";
}

/** 使用者角色（03、09 §管理角色）。 */
export const USER_ROLES = ["member", "content_manager", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** 清單與評論可見度（03、09；P37）。schema 以這些值建 pgEnum。 */
export const LIST_VISIBILITIES = ["public", "unlisted", "private"] as const;
export const REVIEW_VISIBILITIES = ["public", "followers", "private"] as const;

/** auth_tokens.purpose：驗證信與重設密碼由 Better Auth 處理（D80），這張表只剩通知雙重確認（7.5）。 */
export const AUTH_TOKEN_PURPOSES = ["confirm_notifications"] as const;
