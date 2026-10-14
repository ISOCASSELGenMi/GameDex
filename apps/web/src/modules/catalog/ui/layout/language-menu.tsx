"use client";
/**
 * 語言選單（06 §多語系）：一般 <a> 連結，不需要 JS 也能切換；有 JS 時點選順便以 sendBeacon
 * 呼叫 POST /api/locale 寫入偏好 Cookie（下次從無前綴入口進站時使用）。一般頁面回應不寫 Cookie。
 */
import type { ReactElement } from "react";

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

export function LanguageMenu({ items, label }: { items: readonly LanguageMenuItem[]; label: string }): ReactElement {
  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-1 text-sm">
        {items.map((item) => (
          <li key={item.locale}>
            <a
              href={item.href}
              hrefLang={item.locale}
              lang={item.locale}
              aria-current={item.current ? "true" : undefined}
              className={[
                "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3",
                item.current ? "bg-[var(--surface-strong)] font-semibold" : "link-quiet",
              ].join(" ")}
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
  );
}
