/**
 * 客戶端呼叫 Better Auth 端點（`/api/v1/auth/*`，D81）。只用 fetch：不載入 Better Auth 客戶端（header 在每一頁都有，要保持很小）。
 * 回傳統一的 ApiResult；錯誤碼是 Better Auth 的 `code`（例如 INVALID_EMAIL_OR_PASSWORD）。
 */
export const AUTH_API = "/api/v1/auth";

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  code?: string;
  data?: T;
  /** 連線失敗（沒有取得回應）。 */
  network?: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${AUTH_API}${path}`, {
      credentials: "same-origin",
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
      const code = json && typeof json === "object" && "code" in json && typeof json.code === "string" ? json.code : undefined;
      return { ok: false, status: res.status, code };
    }
    return { ok: true, status: res.status, data: json as T };
  } catch {
    return { ok: false, status: 0, network: true };
  }
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
}

/** 目前 session；`data` 為 null＝未登入。404＝accounts 在這個部署沒有啟用。 */
export const getSession = () => call<{ user: SessionUser } | null>("/get-session", { cache: "no-store" });
export const signInEmail = (email: string, password: string) => post<{ user: SessionUser }>("/sign-in/email", { email, password });
export const signUpEmail = (name: string, email: string, password: string) => post<{ user: SessionUser }>("/sign-up/email", { name, email, password });
export const signOut = () => post<{ success: boolean }>("/sign-out", {});
export const requestPasswordReset = (email: string, redirectTo: string) => post<{ status: boolean }>("/request-password-reset", { email, redirectTo });
export const resetPassword = (token: string, newPassword: string) => post<{ status: boolean }>("/reset-password", { token, newPassword });
export const signInSocial = (provider: string, callbackURL: string, errorCallbackURL: string) =>
  post<{ url?: string; redirect?: boolean }>("/sign-in/social", { provider, callbackURL, errorCallbackURL });

export interface LinkedAccountRow {
  id: string;
  providerId: string;
}
export const listAccounts = () => call<LinkedAccountRow[]>("/list-accounts", { cache: "no-store" });
export const unlinkAccount = (accountId: string) => post<{ status: boolean }>("/unlink-account", { accountId });

/** Steam 登入／綁定：取得 Steam 的授權網址（有 session ＝ 綁定）。成功後前端 location.assign(url)。 */
export const signInSteam = (callbackURL: string, errorCallbackURL: string) =>
  post<{ url?: string }>("/steam/sign-in", { callbackURL, errorCallbackURL });
