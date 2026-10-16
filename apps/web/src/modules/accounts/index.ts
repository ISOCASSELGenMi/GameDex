// accounts 的公開 API。其他模組只能從這裡 import；只有 modules/registry.ts 與 app/ 可以 import 可選模組（02 §邊界規則 3）。
export { accountsModule } from "./module";
export { getAuth, getCurrentUser, getAccountsPublicConfig, listLinkedAccounts, setAccountMailer } from "./use-cases";
export { isPlaceholderEmail, placeholderEmail, AUTH_PROVIDERS, SOCIAL_PROVIDERS, isAuthProvider, isExternalProvider } from "./domain/entities";
export type { CurrentUser, LinkedAccountView, AuthProvider, SocialProvider, UserRole } from "./domain/entities";
export type { AccountMailer, AccountMailMessage } from "./providers/auth";
