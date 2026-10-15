# UI／UX 設計方向（使用者指示，2026-10-15）

> 尚未執行。**正式規劃／改版網站頁面設計時，依本文件設計**；與規格書（`docs/spec/`）衝突時先問使用者。

## 整體風格

| 面向 | 指示 |
|---|---|
| 互動 | **Motion-Driven**：轉場、換月／換週、篩選結果變化都以動態呈現，不是瞬間跳換 |
| 細節 | **Micro-interactions**：hover、收藏、切換、篩選開關等都要有回饋動畫 |
| 美術 | **Spatial UI**：景深、層次、半透明玻璃質感、陰影與視差，元素有空間前後關係 |
| 排版 | **Feature-Rich Showcase**：以封面圖為主角、資訊密度高的展示型版面 |

仍須遵守的限制：
- 使用者全域規則：不用米色／奶油色背景、標題斜體強調字、01／02／03 編號段落標籤、等寬字體小標籤、膠囊形按鈕。
- 動畫要尊重 `prefers-reduced-motion`，且不能讓 `test:a11y` 退步。

## 發售月曆

參考 <https://gamecalendar.app/> 與 [`references/calendar-gamecalendar-app.webp`](references/calendar-gamecalendar-app.webp)：
- 月份網格，**每個日期一格只顯示一款遊戲**（封面滿版、遊戲名、平台圖示、標籤如 Early Access／DLC）。
- 同日有多款時，**在格內左右切換**同日的其他遊戲（格底用點點指示目前第幾款）。
- 沒遊戲的日期顯示空格；今天要有明顯標示；上方左右切換上／下個月。

## 時間軸

參考 <https://www.igdb.com/timeline> 與 [`references/timeline-igdb.png`](references/timeline-igdb.png)：
- 垂直中軸、以「週」為單位，上下按鈕切換上一週／下一週，可跳到指定日期、回到今天。
- 每個發售日一張封面卡片，**左右交錯**掛在中軸上，以橫線連到對應日期節點；卡片頂端顯示當日發售數量（如「24 RELEASES」）。
- 卡片可帶標籤（Early Access、Port、Remaster 等）；上方有平台篩選。
