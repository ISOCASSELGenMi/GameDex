/**
 * Better Auth 的 lazy 單例（02 §可移除性）。第一次被呼叫才讀環境變數、才建立實例：
 * MODULES 不含 accounts、或 core-only build／測試都不會碰到 AUTH_SECRET。
 * 掛在 globalThis：開發模式 HMR 重新載入模組時不重複建立（也保住記憶體中的限流計數）。
 */
import { createAuthDatabaseAdapter } from "../repository/auth-database";
import { createAuth, createLogMailer, parseAccountsEnv, type AccountMailer, type AccountsAuth } from "../providers/auth";

type Holder = { auth?: AccountsAuth; mailer?: AccountMailer; steamFetch?: typeof fetch };
const g = globalThis as typeof globalThis & { __sokAccounts?: Holder };
const holder: Holder = (g.__sokAccounts ??= {});

/** 目前使用的寄信實作；預設只寫 server log（7.5 換成真實 provider）。 */
export function getAccountMailer(): AccountMailer {
  return (holder.mailer ??= createLogMailer());
}

/** 換寄信實作（7.5 的 provider、測試的收件匣）。會使既有實例失效。 */
export function setAccountMailer(mailer: AccountMailer | undefined): void {
  holder.mailer = mailer;
  holder.auth = undefined;
}

/** Steam 相關呼叫（OpenID 驗證、Web API）使用的 fetch；預設全域 fetch。測試注入假回應，絕不連 Steam。 */
export function getSteamFetch(): typeof fetch {
  return (...args) => (holder.steamFetch ?? fetch)(...args);
}

/** 測試用：換 Steam 的 fetch。會使既有實例失效。 */
export function setSteamFetch(f: typeof fetch | undefined): void {
  holder.steamFetch = f;
  holder.auth = undefined;
}

export function getAuth(): AccountsAuth {
  if (!holder.auth) {
    holder.auth = createAuth({
      env: parseAccountsEnv(),
      database: createAuthDatabaseAdapter(),
      steamFetch: getSteamFetch(),
      // 包一層：寄信實作可在建立後替換（setAccountMailer 也會重建，這裡保持最新）
      mailer: {
        sendVerification: (m) => getAccountMailer().sendVerification(m),
        sendPasswordReset: (m) => getAccountMailer().sendPasswordReset(m),
      },
    });
  }
  return holder.auth;
}

/** 測試用：丟掉實例（環境變數改變後重建）。 */
export function resetAuthForTests(): void {
  holder.auth = undefined;
  holder.mailer = undefined;
  holder.steamFetch = undefined;
}
