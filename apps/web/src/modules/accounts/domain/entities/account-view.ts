import type { AuthProvider, UserRole } from "./providers";

/** 目前登入者（給 RequestContext 與伺服器端使用；id 已由 Better Auth 的字串轉成 number，D1）。 */
export interface CurrentUser {
  id: number;
  role: UserRole;
  displayName: string;
  /** placeholder 信箱時為 null（不顯示、不寄信）。 */
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
}

/** 帳號頁的「已綁定登入方式」一列（排除 credential）。 */
export interface LinkedAccountView {
  /** connected_accounts.id（Better Auth unlinkAccount 的 accountId）。 */
  id: number;
  provider: AuthProvider;
  connectedAt: Date;
}
