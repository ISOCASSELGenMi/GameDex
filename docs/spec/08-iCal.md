# 08 iCal

**核心交付物**：使用者訂閱一次，之後的異動（尤其延期）都透過同一個網址反映。公開 feed 屬 `catalog`；私人 feed 屬 `accounts`，呼叫 `catalog` 公開 API 的同一個 ics 產生函式（D46）。用 `ical-generator` 處理格式（🧪 11.1.2），升級版本時重跑 iCal 測試。

## 更新延遲要誠實

能保證的是「我方資料立即更新」，不能保證「使用者的行事曆立即反映」——訂閱是客戶端定期來拉。

| 客戶端 | 間隔 | 可自訂 |
| --- | --- | --- |
| Google 日曆 | 實測（2026-10-15）：訂閱後約 1 小時首次重抓，之後約每 5~6 小時（每個 feed 各自排程）；無手動重新整理；忽略 feed 內的更新間隔提示 🧪 | 否 |
| Outlook | 數小時 🔶 | 否 |
| Apple 日曆 | 使用者設定（iPadOS 最短每 15 分鐘）；行事曆清單下拉可立即重新抓取 🧪 | 是 |

- UI 文案寫「可能需要數小時到一天」，不寫死數字、不宣稱即時。
- `REFRESH-INTERVAL`／`X-PUBLISHED-TTL` 照加，但別指望 Google。
- 訂閱頁提供 `webcal://` 連結、複製網址按鈕、各客戶端步驟。**Google 要在網頁版「從網址新增」，行動版 App 無法用網址新增** 🔶。Google `cid=` 一鍵訂閱沒找到可靠來源 ❓，不做。
- 想要即時通知的使用者，引導到 Email／Discord 私訊（11）。

## RFC 5545 規則

做錯任何一條，訂閱者的行事曆會開始累積重複或錯亂的事件。

1. **UID 永久不變，不從日期或標題算出**。
   - 單一上市事件：`release-{release_events.id}@{網域}`；活動：`event-{events.id}@{網域}`。
   - **聚合 feed**（公開 feed、私人 feed 都套 06 的聚合規則）：UID 粒度 = (遊戲, 平台, 階段)，`release-g{gameId}-p{platformId}-s{stage}@{網域}`，地區只是屬性；`SEQUENCE` 取該組所有上市事件 sequence 的總和（單調不減）。**原型實測通過** 🧪（2026-10-15～16，Google 日曆網頁版、Apple 日曆 iPadOS 26.6.1）：同一 UID 換地區屬性與日期 → 兩個客戶端都更新原事件、不重複（D26）。
2. **日期或 status 變動時 `SEQUENCE` 遞增**（含取消與復原）。實測 🧪：Google 與 Apple **都不依賴 SEQUENCE**（SEQUENCE 不變時只改標題或日期也會更新，依內容比對）；仍照 RFC 5545 遞增，保留給 Outlook 等未測客戶端。
3. **事件不憑空消失**（D33、D-Bug15）：
   - 取消 → `STATUS:CANCELLED`，保留 30 天再移除（實測 🧪：**Google 直接從日曆移除**；**Apple 保留並以刪除線／灰色顯示**；復原後兩者都以同一 UID 恢復。訂閱頁文案要寫明這個差異）；
   - 延期成 `tbd` → 保留 30 天，`SUMMARY` 加 `[延期・日期未定]`、`STATUS:TENTATIVE`（實測 🧪：Google、Apple 都沒有 TENTATIVE 的視覺差異，**只能靠標題標記**，標記不可省略）；
   - 移出公開 feed 視窗 → 見 §公開 feed。
4. **`DTSTAMP`／`LAST-MODIFIED` 取事件的 `updatedAt`**，不取產生當下，否則每次內容都不同、ETag 全失效。

## 日期精度 → 事件

| 精度 | 事件 | 標題 |
| --- | --- | --- |
| `day` | 單日全天 | 遊戲名 |
| `month` | 整月多日全天：`DTSTART` = 當月 1 日、`DTEND` = 下月 1 日 | `[暫定] 遊戲名` |
| `quarter`／`year` | `releaseDate`（期間最後一天）的單日全天 | `[暫定 2027 Q2] 遊戲名` |
| `tbd` | 原本有事件 → 保留 30 天並標記；從未有日期 → 不產生 | `[延期・日期未定]` |

- **全天事件的 `DTEND` 是排他的** ✅：整月事件的 `DTEND` 要寫下月 1 日，否則最後一天被吃掉（D-Bug16）。
- 季／年不做整季整年的橫幅：會在行事曆頂端佔好幾個月，訂閱者容易嫌吵退訂。精度從 `quarter` 收斂成 `day` 時，同一 UID 搬位置、`SEQUENCE + 1`。
- 標記文字來自 `ical.*` 字典，依 feed 的語系；季／年標籤由 `formatReleaseLabel()` 產生。程式碼不得寫死中文。

**活動**：`SEQUENCE` 讀 `events.sequence`；IGDB 同步只在欄位實際變動時更新 `updated_at`，開始或結束時間變動時 `sequence + 1` 並寫 `change_feed.date_changed`（同一 transaction），其餘欄位變動只更新 `updated_at`。輸出絕對時間點，不用 `TZID=`，讓各客戶端換算成使用者當地時間。`endTime` 為 NULL 時 `DTEND = startTime + 1 小時`；`startTime` 為 NULL 不輸出。

## 公開 feed

```
/ical/{locale}/releases.ics
/ical/{locale}/events.ics
/ical/{locale}/platform/{slug}.ics
```

需求書 FR-ICAL-02 提到「依篩選條件產生公開訂閱網址」；這與 P13（不做匿名自訂 feed）有衝突，**待產品擁有者決定**，目前只做上面三種。

- 依語系分開，標題、描述、標記都用該語系。UID 與語系無關，各語系是各自獨立的日曆。
- **視窗**：`periodStart <= 今天 + 90 天 AND releaseDate >= 今天`（季／年在期間結束前都留著；月精度過了月初就不在）。
- **視窗離開**：輸出條件為「在視窗內，**或**近 60 天內有改期紀錄」，否則延期到視窗外的遊戲會從訂閱中消失。
- 套用 `CALENDAR_VISIBLE_GAME_TYPES`、可見階段、排除 rumored、聚合規則。
- 每 feed 上限：`releases.ics` 加 `popularityScore` 門檻或事件數上限 `ICAL_PUBLIC_MAX_EVENTS`；要看更多請用平台別 feed 或網站。
- 單一項目的「下載 .ics」也用同一產生函式。

## 私人 feed

```
/ical/u/{token}.ics
```

- 每位登入用戶恰好一個有效的 `following` feed（partial unique，03），第一次到訂閱頁時自動建立。內容**即時查詢**用戶當下的 `follows`：
  - 追蹤的**遊戲** → 其上市事件；
  - 追蹤的**活動** → 該活動；
  - 追蹤的**平台**、**系列**、**公司** → 旗下遊戲的上市事件（套用 feed 的篩選與可見類型，避免平台追蹤一次帶進數千筆：同樣受 `ICAL_PUBLIC_MAX_EVENTS` 上限與 90 天視窗限制）；
  - `includeEvents=true` 時另含與追蹤遊戲相關的活動（`event_games`）。
- 追蹤的遊戲：不受 90 天視窗限制；過去的上市保留近 30 天。
- `filterPlatforms`／`filterRegions`／`filterGenres`／`filterStages` 取交集。
- 改語系 = 設定變更：`settingsVersion + 1`，ETag 一併改變。

**Token 安全**

- 256-bit 亂數；資料庫存 SHA-256 供查驗，另以 `TOKEN_ENCRYPTION_KEY` 加密保存，頁面可再次顯示（P9、D34：否則使用者換裝置只能重新產生，舊訂閱全部失效）。金鑰與資料庫分開保管。
- 「重新產生」保留作外洩補救：舊網址 30 天內回傳空的 ics（讓客戶端清掉舊事件），之後回 410 Gone（客戶端反應 ❓ 原型驗證）。
- token 在路徑裡：`/ical/u/*` 關閉或遮罩 Caddy／Cloudflare access log，錯誤監控 scrub 掉。
- 帳號刪除時 feed 隨 cascade 刪除，下次拉取回 404（預期行為）。
- 不做匿名自訂 feed（P13）；建立 feed 的端點仍設 rate limit。

## HTTP 快取

- `ETag = hash(max(updated_at), count, settingsVersion, locale)`，**用一個聚合查詢算**，不先產生整份再 hash。`count` 必須納入（刪除或撤銷不會改變 `max(updated_at)`）。依賴 `updatedAt` 確實會更新（03）。
- 資料沒變回 `304 Not Modified`。
- 公開 feed `Cache-Control: public, max-age=300`；私人 feed `private, max-age=300`，不進 CDN。
- `Content-Type: text/calendar; charset=utf-8`。
