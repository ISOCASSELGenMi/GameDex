// accounts 的頁面內容與 slot 元件（只給 src/app 的薄路由與 module.ts 使用）。
export { HeaderRightSlot } from "./header-slot";
export { gateAccountsPage } from "./gate";
export { AccountPageView, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage, accountPageTitle } from "./pages";
export { ACCOUNT_PAGES, accountPageHref, safeNextPath, type AccountPage } from "./links";
