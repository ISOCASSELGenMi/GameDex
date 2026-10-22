/**
 * header 圖示按鈕用的線條圖示（inline SVG，aria-hidden；可及名稱由按鈕的 aria-label 提供）。
 * 放在 kernel/ui，讓 catalog 的 header 與 accounts 的帳號按鈕共用同一組。
 */
import type { ReactElement, ReactNode } from "react";

function Svg({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="1.25rem"
      height="1.25rem"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** 導覽（四宮格）。 */
export function GridIcon(): ReactElement {
  return (
    <Svg>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </Svg>
  );
}

/** 主題（半亮半暗的圓）。 */
export function ThemeIcon(): ReactElement {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </Svg>
  );
}

/** 語言（地球）。 */
export function GlobeIcon(): ReactElement {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5Z" />
    </Svg>
  );
}

/** 帳號（人像）。 */
export function UserIcon(): ReactElement {
  return (
    <Svg>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.8 20c.6-3.7 3.5-5.8 7.2-5.8s6.6 2.1 7.2 5.8" />
    </Svg>
  );
}

/** 搜尋（放大鏡）。 */
export function SearchIcon(): ReactElement {
  return (
    <Svg>
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="m15.2 15.2 5 5" />
    </Svg>
  );
}

/** 關閉（叉）。 */
export function CloseIcon(): ReactElement {
  return (
    <Svg>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}
