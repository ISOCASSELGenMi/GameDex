/**
 * @sok/i18n — 網站與 Bot 共用（D38）；只依賴 Intl，零 Next／React 依賴。
 */
export {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  intlLocale,
  isLocale,
  localeSelfName,
  resolveDefaultLocale,
  resolveSupportedLocales,
  type Locale,
} from "./locales";
export { mapLanguageTag, negotiateLocale } from "./negotiate";
export {
  CORE_NAMESPACES,
  LABEL_NAMESPACES,
  NAMESPACES,
  isNamespace,
  type Messages,
  type Namespace,
} from "./messages";
export {
  createTranslator,
  interpolate,
  translateLabel,
  type TranslationValues,
  type Translator,
} from "./translator";
export {
  RELEASE_DATE_PRECISIONS,
  formatDateTime,
  formatIsoDate,
  formatNumber,
  formatReleaseLabel,
  formatYearMonth,
  parseIsoDate,
  weekdayNames,
  type ReleaseDatePrecision,
} from "./format";
