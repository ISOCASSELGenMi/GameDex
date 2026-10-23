"use client";
/**
 * 語言下拉（06 §多語系）：一般 <a> 連結，不需要 JS 也能切換；有 JS 時點選順便以 sendBeacon
 * 呼叫 POST /api/locale 寫入偏好 Cookie（下次從無前綴入口進站時使用）。一般頁面回應不寫 Cookie。
 * 外殼是共用的 Dropdown（header 的導覽、主題、語言、帳號共用同一個）。
 */
import type { ReactElement } from "react";
import { Dropdown } from "@/kernel/ui/dropdown";
import { GlobeIcon } from "@/kernel/ui/header-icons";

export interface LanguageMenuItem {
  locale: string;
  href: string;
  label: string;
  current: boolean;
}

export const LOCALE_ENDPOINT = "/api/locale";

function rememberLocale(locale: string): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(LOCALE_ENDPOINT, new Blob([locale], { type: "text/plain" }));
    }
  } catch {
    // 寫不進 Cookie 不影響切換：語言由網址決定
  }
}

/** items 的連結；`label` 是 <nav> 的名稱，`triggerLabel` 是下拉按鈕的名稱。 */
export function LanguageMenu({ items, label, triggerLabel }: { items: readonly LanguageMenuItem[]; label: string; triggerLabel: string }): ReactElement {
  return (
    <Dropdown name="language" label={triggerLabel} icon={<GlobeIcon />} align="end">
      <nav aria-label={label}>
        <ul className="dd-list">
          {items.map((item) => (
            <li key={item.locale}>
              <a
                href={item.href}
                hrefLang={item.locale}
                lang={item.locale}
                aria-current={item.current ? "true" : undefined}
                className="dd-item"
                onClick={() => {
                  if (!item.current) rememberLocale(item.locale);
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </Dropdown>
  );
}
