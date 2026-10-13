/**
 * 上一頁／目前頁／下一頁的導覽列（唯一實作）：瀏覽頁、平台／公司／系列頁（`Pager`）、熱門榜共用。
 * 文字由呼叫端傳入（各頁沿用自己的字典 key）。目前頁的 `aria-current="page"` 保留在 li 上（e2e 以它定位；ARIA 允許任何元素）。
 */
import type { ReactElement, ReactNode } from "react";

export interface PageNavProps {
  /** nav 的 aria-label。 */
  label: string;
  prevHref: string | null;
  nextHref: string | null;
  prevText: string;
  nextText: string;
  /** 目前頁的文字（例如「第 2 頁」）。 */
  pageText: string;
  /** 導覽列底下的補充說明（例如瀏覽頁的深度上限）。 */
  children?: ReactNode;
}

export function PageNav({ label, prevHref, nextHref, prevText, nextText, pageText, children }: PageNavProps): ReactElement {
  return (
    <nav aria-label={label} className="mt-4">
      <ul className="flex flex-wrap items-center gap-3">
        {prevHref ? (
          <li>
            <a className="btn-secondary" rel="prev" href={prevHref}>
              {prevText}
            </a>
          </li>
        ) : null}
        <li aria-current="page">{pageText}</li>
        {nextHref ? (
          <li>
            <a className="btn-secondary" rel="next" href={nextHref}>
              {nextText}
            </a>
          </li>
        ) : null}
      </ul>
      {children}
    </nav>
  );
}
