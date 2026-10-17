"use client";
/**
 * 大量未定日（單組超過 UNDATED_OPEN_MAX 款）的精簡清單：名稱＋平台縮寫＋附註，連到詳情頁。
 * 熱門月份有數百張卡片：若以伺服器元件渲染，每張卡片的元素樹會同時出現在 HTML 與 RSC payload。
 * 這裡由客戶端元件吃緊湊的列（陣列，RSC 中每筆約 100 位元組）；伺服器端照樣 SSR 成 HTML（沒有 JS 時是一般連結）。
 * 這份清單沒有側邊預覽卡（點了直接進詳情頁）：預覽資料只有「數量少」的完整卡片才帶（見 view-model）。
 */
import type { ReactElement } from "react";
import type { FoldRow } from "./types";

export function FoldedCards({ rows, className = "fold-list" }: { rows: readonly FoldRow[]; className?: string }): ReactElement {
  return (
    <ul className={className}>
      {rows.map(([href, name, abbr, note]) => (
        <li key={href}>
          <a className="fc" href={href}>
            {name}
            {abbr ? <span className="fc-p"> {abbr}</span> : null}
            {note ? <span className="fc-p"> {note}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
