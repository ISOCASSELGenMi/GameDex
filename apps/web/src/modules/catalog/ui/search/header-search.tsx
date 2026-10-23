"use client";
/**
 * header 中間的搜尋框。≥ 640px 直接顯示；窄螢幕縮成搜尋圖示按鈕，點了展開成覆蓋整個 header 的搜尋列
 * （Esc 或關閉鈕收回，焦點回到圖示按鈕）。沒有 JS 時搜尋列一律顯示（CSS 以 data-hydrated 區分）。
 * 表單送到遊戲瀏覽頁（現有搜尋結果頁）：GET /{locale}/games?q=…
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { Locale } from "@sok/i18n";
import { CloseIcon, SearchIcon } from "@/kernel/ui/header-icons";
import { useHydrated } from "../calendar/use-day-cards";
import type { SearchBoxLabels } from "./labels";
import { SearchCombobox } from "./search-combobox";

export interface HeaderSearchProps {
  locale: Locale;
  action: string;
  labels: SearchBoxLabels;
  placeholder: string;
  ariaLabel: string;
  /** 搜尋表單（landmark）的名稱；要與頁面上其他搜尋表單不同。 */
  formLabel: string;
  submitLabel: string;
  openLabel: string;
  closeLabel: string;
}

export function HeaderSearch({ locale, action, labels, placeholder, ariaLabel, formLabel, submitLabel, openLabel, closeLabel }: HeaderSearchProps): ReactElement {
  const hydrated = useHydrated();
  const [expanded, setExpanded] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);

  useEffect(() => {
    if (expanded) document.getElementById("header-search")?.focus();
    else if (wasExpanded.current) openRef.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    // 搜尋框自己已處理的 Esc（關清單、清空）會 preventDefault；剩下的才收起搜尋列
    if (e.key === "Escape" && !e.defaultPrevented && expanded) {
      e.preventDefault();
      setExpanded(false);
    }
  };

  return (
    <div className="hs-root" data-hydrated={hydrated ? "true" : undefined} data-expanded={expanded ? "true" : undefined} data-header-search="">
      <button ref={openRef} type="button" className="dd-trigger hs-open" aria-label={openLabel} aria-expanded={expanded} aria-controls="header-search-form" onClick={() => setExpanded(true)}>
        <SearchIcon />
      </button>
      <form id="header-search-form" role="search" action={action} method="get" className="hs-form" aria-label={formLabel} onKeyDown={onKeyDown}>
        <SearchCombobox locale={locale} id="header-search" ariaLabel={ariaLabel} placeholder={placeholder} labels={labels} maxLength={200} className="hs-box" inputClassName="hs-input" />
        <button type="submit" className="dd-trigger hs-submit" aria-label={submitLabel}>
          <SearchIcon />
        </button>
        <button type="button" className="dd-trigger hs-close" aria-label={closeLabel} onClick={() => setExpanded(false)}>
          <CloseIcon />
        </button>
      </form>
    </div>
  );
}
