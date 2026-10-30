"use client";
/**
 * 核取方塊清單（一個 dangerouslySetInnerHTML，見 filter-panel.tsx 的 checkGridHtml 說明）。
 *
 * 即時篩選（live-filter-form.tsx）每次勾選都會讓伺服器重新渲染面板，新的 HTML 字串只差在 `checked` 屬性；
 * 若 React 每次都重設 innerHTML，使用者正在操作的核取方塊會被換掉、焦點跑掉。
 * 所以這裡只用「第一次收到的 HTML」，之後使用者的勾選狀態就是 DOM 本身（與網址一致）；
 * 上一頁／下一頁造成的外部變更，由 LiveFilterForm 以 key 重新掛載整個面板處理。
 */
import { useState, type ReactElement } from "react";

export function CheckGrid({ html }: { html: string }): ReactElement {
  const [initial] = useState(html);
  return <div className="check-grid" dangerouslySetInnerHTML={{ __html: initial }} />;
}
