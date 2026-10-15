/**
 * 請求層的語系工具（06 §多語系）：proxy、語言 Cookie 端點、[locale] 版面共用。
 * 只依賴 @sok/i18n（純 Intl），不 import 任何模組。
 *
 * 原則：語言只由 URL 前綴決定（D36）。這裡的 Cookie／Accept-Language 只用在「無前綴入口」的 302 導向。
 */
import {
  negotiateLocale,
  resolveDefaultLocale,
  resolveSupportedLocales,
  type Locale,
} from "@sok/i18n";

/** 語系偏好 Cookie 名稱（功能性 Cookie）。 */
export const LOCALE_COOKIE = "sok_locale";
/** 1 年（秒）。 */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface LocaleConfig {
  supported: readonly Locale[];
  defaultLocale: Locale;
}

/** 從環境變數讀支援語系與預設語系（SUPPORTED_LOCALES、DEFAULT_LOCALE；16 §環境變數）。 */
export function getLocaleConfig(env: Readonly<Record<string, string | undefined>> = process.env): LocaleConfig {
  const supported = resolveSupportedLocales(env.SUPPORTED_LOCALES);
  return { supported, defaultLocale: resolveDefaultLocale(env.DEFAULT_LOCALE, supported) };
}

/** URL 的 locale 區段是否為支援語系（大小寫須完全相符）。 */
export function isSupportedLocale(value: string, config: LocaleConfig = getLocaleConfig()): value is Locale {
  return (config.supported as readonly string[]).includes(value);
}

/**
 * 無前綴入口的語系決定順序：Cookie `sok_locale` → （accounts 的 users.locale，3a 無）→ Accept-Language → DEFAULT_LOCALE。
 */
export function pickRequestLocale(
  input: { cookie?: string | null; acceptLanguage?: string | null },
  config: LocaleConfig = getLocaleConfig(),
): Locale {
  const fromCookie = input.cookie?.trim();
  if (fromCookie && isSupportedLocale(fromCookie, config)) return fromCookie;
  return negotiateLocale(input.acceptLanguage, config.supported, config.defaultLocale);
}

/**
 * 「沒有語系前綴」的路徑判斷：第一段是已知的網站路由名稱，或不像語系代碼（例如 `/calendar`、`/games/x`）。
 * 像語系代碼但不支援的（例如 `/fr/...`、`/ja/...` 在 ja 未開放時）不導向，交給 [locale] 版面回 404。
 */
const SITE_ROUTE_ROOTS = new Set([
  "about",
  "calendar",
  "timeline",
  "games",
  "platforms",
  "companies",
  "franchises",
  "events",
  "awards",
  "trending",
  "subscribe",
  "me",
  "u",
  "lists",
  "feed",
]);
const LOCALE_SHAPED = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function needsLocalePrefix(pathname: string, config: LocaleConfig = getLocaleConfig()): boolean {
  const first = pathname.split("/")[1] ?? "";
  if (first === "") return true; // "/"
  if (isSupportedLocale(first, config)) return false;
  if (SITE_ROUTE_ROOTS.has(first)) return true;
  return !LOCALE_SHAPED.test(first);
}

/** 語言 Cookie 的 Set-Cookie 值（只由 POST /api/locale 送出；一般頁面不寫 Cookie）。 */
export function buildLocaleCookie(locale: Locale, opts: { secure?: boolean } = {}): string {
  const parts = [`${LOCALE_COOKIE}=${locale}`, "Path=/", `Max-Age=${LOCALE_COOKIE_MAX_AGE}`, "SameSite=Lax"];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}
