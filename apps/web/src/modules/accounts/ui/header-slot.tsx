import type { ReactElement } from "react";
import type { Locale } from "@sok/i18n";
import { HeaderAccount } from "./header-account";
import { accountStrings } from "./strings";

/** `header.right` slot（02）：伺服器端只送靜態的外殼與幾個字串，登入狀態由客戶端元件取得。 */
export function HeaderRightSlot({ locale }: { locale: Locale }): ReactElement {
  return <HeaderAccount locale={locale} strings={accountStrings(locale, ["header."])} />;
}
