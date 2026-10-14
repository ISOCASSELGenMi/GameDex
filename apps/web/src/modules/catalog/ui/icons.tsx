/**
 * 小圖示（inline SVG，aria-hidden）。圖示一律搭配文字，不單靠圖示或顏色傳達意思（06 §無障礙）。
 */
import type { ReactElement, ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      className={["inline-block shrink-0 align-[-0.125em]", className].filter(Boolean).join(" ")}
      fill="currentColor"
    >
      {children}
    </svg>
  );
}

/** 上市（遊戲盒）。 */
export function ReleaseIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h7A1.5 1.5 0 0 1 13 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-11Zm2 .5v10h6V3H5Z" />
    </Svg>
  );
}

/** 活動（星形）。 */
export function EventIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="m8 1 2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 11.8 3.8 14l.8-4.7L1.2 6l4.7-.7L8 1Z" />
    </Svg>
  );
}

/** 上市階段圖示：正式版實心圓、搶先體驗半圓、測試三角、試玩播放、其他空心。 */
export function StageIcon({ stage, className }: IconProps & { stage: string }): ReactElement {
  switch (stage) {
    case "full":
      return (
        <Svg className={className}>
          <circle cx="8" cy="8" r="5.5" />
        </Svg>
      );
    case "early_access":
      return (
        <Svg className={className}>
          <path d="M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 1.5v8a4 4 0 0 0 0-8Z" />
        </Svg>
      );
    case "alpha":
    case "beta":
      return (
        <Svg className={className}>
          <path d="M8 2.5 14 13H2L8 2.5Zm0 3L4.6 11.5h6.8L8 5.5Z" />
        </Svg>
      );
    case "demo":
      return (
        <Svg className={className}>
          <path d="M4.5 2.5v11l9-5.5-9-5.5Z" />
        </Svg>
      );
    default:
      return (
        <Svg className={className}>
          <path d="M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        </Svg>
      );
  }
}

/** 狀態圖示：延期（時鐘）、取消（叉）、已上市（勾）、預定（日曆）。 */
export function StatusIcon({ status, className }: IconProps & { status: string }): ReactElement {
  switch (status) {
    case "delayed":
      return (
        <Svg className={className}>
          <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 1.5a5 5 0 1 0 0 10A5 5 0 0 0 8 3Zm.75 1.5v3.2l2.2 1.3-.75 1.3-2.95-1.75V4.5h1.5Z" />
        </Svg>
      );
    case "cancelled":
      return (
        <Svg className={className}>
          <path d="m3.5 2.4 4.5 4.5 4.5-4.5 1.1 1.1L9.1 8l4.5 4.5-1.1 1.1L8 9.1l-4.5 4.5-1.1-1.1L6.9 8 2.4 3.5l1.1-1.1Z" />
        </Svg>
      );
    case "released":
      return (
        <Svg className={className}>
          <path d="m13.3 3.9 1.1 1.1-7.9 7.9-4.4-4.4 1.1-1.1 3.3 3.3 6.8-6.8Z" />
        </Svg>
      );
    default:
      return (
        <Svg className={className}>
          <path d="M5 1h1.5v1.5h3V1H11v1.5h2.5A1.5 1.5 0 0 1 15 4v9.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5V4a1.5 1.5 0 0 1 1.5-1.5H5V1ZM2.5 6.5v7h11v-7h-11Z" />
        </Svg>
      );
  }
}

/** 注意（資料來源待確認）。 */
export function WarningIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M8 1.5 15 14H1L8 1.5Zm-.75 4.5v4h1.5V6h-1.5Zm0 5v1.5h1.5V11h-1.5Z" />
    </Svg>
  );
}

/** 外部連結。 */
export function ExternalIcon(props: IconProps): ReactElement {
  return (
    <Svg {...props}>
      <path d="M9 1.5h5.5V7H13V4.06L7.53 9.53 6.47 8.47 11.94 3H9V1.5ZM2.5 4A1.5 1.5 0 0 1 4 2.5h3V4H4v8h8V9h1.5v3a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4Z" />
    </Svg>
  );
}
