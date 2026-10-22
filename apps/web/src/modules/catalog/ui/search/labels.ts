/** 搜尋框（combobox）的字串：伺服器端組好以 props 傳給客戶端元件（客戶端拿不到字典）。 */
import type { Translator } from "@sok/i18n";

export interface SearchBoxLabels {
  /** 候選清單 listbox 的可及名稱。 */
  listLabel: string;
  /** 最後一列「查看全部結果」。 */
  viewAll: string;
  /** 沒有候選。 */
  empty: string;
  /** 結果數宣告，含 `{n}`。 */
  count: string;
  /** 候選載入失敗。 */
  error: string;
}

export function searchBoxLabels(t: Translator): SearchBoxLabels {
  return {
    listLabel: t.t("ui.search.listLabel"),
    viewAll: t.t("ui.search.viewAll"),
    empty: t.t("ui.search.empty"),
    count: t.t("ui.search.count", { n: "{n}" }),
    error: t.t("ui.search.error"),
  };
}
