// accounts 的頁面內容與 slot 元件（只給 src/app 的薄路由與 module.ts 使用）。
export { HeaderRightSlot } from "./header-slot";
export { GameActionsSlot, PlayerRatingSlot } from "./game-slots";
export { gateAccountsPage } from "./gate";
export {
  AccountPageView,
  AccountListsPageView,
  AccountListDetailPageView,
  AccountPlaysPageView,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  accountPageTitle,
  accountSubPageTitle,
  type AccountSubPage,
} from "./pages";
export { PublicListView, loadPublicList, publicListTitle, PUBLIC_LIST_PAGE_SIZE } from "./public-list-page";
export { ACCOUNT_PAGES, accountPageHref, safeNextPath, type AccountPage } from "./links";
export { parseIdParam } from "../domain/entities/lists";
