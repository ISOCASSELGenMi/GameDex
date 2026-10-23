/**
 * 分組檢視的遊戲卡片（封面為主角）。**沒有 hooks、不讀字典**：伺服器端渲染（首屏）與客戶端（「顯示更多」）共用同一個元件，
 * 資料是已格式化的字串（GroupCardData，欄位名稱縮短以減少 HTML／RSC 大小）。
 *
 * 封面用原生 <img>（不經 next/image）：Provider 已解析成 CDN 的縮圖網址，不需要最佳化器；
 * 一頁最多上百張卡，next/image 每張多出的屬性與 style 會讓 HTML 多出數十 KB（頁面預算 200 KB）。
 * 版面由 CSS（aspect-ratio）決定，不會因圖片載入而位移。
 */
import type { ReactElement } from "react";

export interface GroupCardData {
  /** 詳情頁網址 */
  h: string;
  /** 顯示名稱 */
  n: string;
  /** 名稱的 lang（顯示的是外文原名時才有） */
  nl?: string;
  /** 封面網址 */
  c?: string;
  /** 首發日（YYYY-MM-DD，只有日精度才有）與文字 */
  dt?: string;
  d: string;
  /** 平台（縮寫 · 縮寫 +N） */
  p: string;
  /** 標籤（DLC、傳聞…；最多一個） */
  t?: string;
}

/** 「顯示更多」API 的回應。 */
export interface GroupMoreResponse {
  key: string;
  total: number;
  cards: GroupCardData[];
}

export function GroupCard({ data, eager = false, appended = false }: { data: GroupCardData; eager?: boolean; appended?: boolean }): ReactElement {
  return (
    <li className="rc-card" data-rc-new={appended ? "" : undefined}>
      <a className="rc-card-link" href={data.h}>
        {data.c ? (
          // eslint-disable-next-line @next/next/no-img-element -- 見檔頭：HTML 大小預算
          <img className="rc-cover" src={data.c} alt="" loading={eager ? "eager" : "lazy"} decoding="async" />
        ) : (
          <span className="rc-cover rc-cover-empty" aria-hidden="true" />
        )}
        <span className="rc-info">
          <span className="rc-name" lang={data.nl}>
            {data.n}
          </span>
          {data.dt ? (
            <time className="rc-meta" dateTime={data.dt}>
              {data.d}
            </time>
          ) : (
            <span className="rc-meta">{data.d}</span>
          )}
          {data.p ? <span className="rc-meta">{data.p}</span> : null}
          {data.t ? <span className="rc-tag">{data.t}</span> : null}
        </span>
      </a>
    </li>
  );
}
