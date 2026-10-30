"use client";
/**
 * 篩選連結（已套用條件的 chip、時間軸的平台種類快速篩選）：伺服器算好的 href 只對「渲染當下的位置」正確，
 * 有 JS 時改用目前網址的位置參數（時間軸切週不重新渲染伺服器元件）並以 router.replace 就地更新（不跳回頂端）。
 * 沒有 JS、或按住修飾鍵／中鍵開新分頁時，就是一般連結。
 */
import { useRouter } from "next/navigation";
import { useTransition, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { EXTERNAL_FILTER_EVENT, keepPositionHref, sameLocation } from "./live-filter";
import { holdScroll } from "./hold-scroll";

export interface LiveLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "true" | "page";
}

export function LiveLink({ href, children, ...rest }: LiveLinkProps): ReactElement {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const next = keepPositionHref(href, window.location.search);
    if (sameLocation(next, window.location.pathname + window.location.search)) return;
    holdScroll();
    window.dispatchEvent(new Event(EXTERNAL_FILTER_EVENT));
    startTransition(() => router.replace(next, { scroll: false }));
  };
  return (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
