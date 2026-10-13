"use client";
/**
 * 折疊區（「＋N」與大量未定日）的精簡卡片清單。
 * 熱門月份有數千張卡片：若以伺服器元件渲染，每張卡片的元素樹會同時出現在 HTML 與 RSC payload。
 * 這裡改由客戶端元件依 key 從預覽資料（CalendarInteractive 提供的 context，RSC 中只出現一次）組出連結，
 * 伺服器端照樣 SSR 成 HTML（沒有 JS 時是一般連結），RSC payload 只多一串 key。
 */
import { createContext, useContext, type ReactElement } from "react";
import type { PreviewCardData } from "./types";

export const PreviewDataContext = createContext<Record<string, PreviewCardData>>({});

export function FoldedCards({ keys, className = "fold-list" }: { keys: readonly string[]; className?: string }): ReactElement {
  const previews = useContext(PreviewDataContext);
  return (
    <ul className={className}>
      {keys.map((key) => {
        const p = previews[key];
        if (!p) return null;
        return (
          <li key={key}>
            <a className="fc" href={p.h} data-card={key}>
              {p.n}
              {p.a ? <span className="fc-p"> {p.a}</span> : null}
              {p.x ? <span className="fc-p"> {p.x}</span> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
