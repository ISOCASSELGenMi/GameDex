/**
 * 字典註冊表：messages/{locale}/{namespace}.json 以靜態 import 載入（Next、tsx、vitest 都能直接吃）。
 * 新增語系或命名空間時在這裡加一行；`i18n:check` 會比對磁碟上的檔案與各語系 key 集合。
 */
import enA11y from "../messages/en/a11y.json";
import enAbout from "../messages/en/about.json";
import enEnums from "../messages/en/enums.json";
import enErrors from "../messages/en/errors.json";
import enFilters from "../messages/en/filters.json";
import enGenres from "../messages/en/genres.json";
import enIcal from "../messages/en/ical.json";
import enThemes from "../messages/en/themes.json";
import enUi from "../messages/en/ui.json";
import jaA11y from "../messages/ja/a11y.json";
import jaAbout from "../messages/ja/about.json";
import jaEnums from "../messages/ja/enums.json";
import jaErrors from "../messages/ja/errors.json";
import jaFilters from "../messages/ja/filters.json";
import jaGenres from "../messages/ja/genres.json";
import jaIcal from "../messages/ja/ical.json";
import jaThemes from "../messages/ja/themes.json";
import jaUi from "../messages/ja/ui.json";
import zhA11y from "../messages/zh-Hant/a11y.json";
import zhAbout from "../messages/zh-Hant/about.json";
import zhEnums from "../messages/zh-Hant/enums.json";
import zhErrors from "../messages/zh-Hant/errors.json";
import zhFilters from "../messages/zh-Hant/filters.json";
import zhGenres from "../messages/zh-Hant/genres.json";
import zhIcal from "../messages/zh-Hant/ical.json";
import zhThemes from "../messages/zh-Hant/themes.json";
import zhUi from "../messages/zh-Hant/ui.json";
import type { Locale } from "./locales";

/** 各語系 key 集合必須一致，缺 key 讓 i18n:check 失敗（spec 06：UI、錯誤訊息、enum）。 */
export const CORE_NAMESPACES = ["ui", "enums", "filters", "a11y", "errors", "ical", "about"] as const;
/** 以 slug 為 key；缺翻譯 fallback 英文，只列入缺漏報告。 */
export const LABEL_NAMESPACES = ["genres", "themes"] as const;
export const NAMESPACES = [...CORE_NAMESPACES, ...LABEL_NAMESPACES] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** 巢狀字典：葉節點是字串。 */
export interface Messages {
  [key: string]: string | Messages;
}

export type LocaleMessages = Record<Namespace, Messages>;

export const MESSAGES: Readonly<Record<Locale, LocaleMessages>> = {
  "zh-Hant": {
    ui: zhUi,
    enums: zhEnums,
    filters: zhFilters,
    a11y: zhA11y,
    about: zhAbout,
    errors: zhErrors,
    ical: zhIcal,
    genres: zhGenres,
    themes: zhThemes,
  },
  en: {
    ui: enUi,
    enums: enEnums,
    filters: enFilters,
    a11y: enA11y,
    about: enAbout,
    errors: enErrors,
    ical: enIcal,
    genres: enGenres,
    themes: enThemes,
  },
  ja: {
    ui: jaUi,
    enums: jaEnums,
    filters: jaFilters,
    a11y: jaA11y,
    about: jaAbout,
    errors: jaErrors,
    ical: jaIcal,
    genres: jaGenres,
    themes: jaThemes,
  },
};

/** 缺翻譯時改用這個語系（genres／themes）。 */
export const FALLBACK_LOCALE: Locale = "en";

export function isNamespace(value: string): value is Namespace {
  return (NAMESPACES as readonly string[]).includes(value);
}

/** 依點分隔路徑取葉節點字串；不存在或不是字串 → undefined。 */
export function lookupMessage(messages: Messages | undefined, path: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of path.split(".")) {
    if (node == null || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** 攤平成 `a.b.c` → 字串（i18n:check 與測試用）。 */
export function flattenMessages(messages: Messages, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(messages)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flattenMessages(v, key)) out.set(kk, vv);
  }
  return out;
}
