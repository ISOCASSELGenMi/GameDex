# iCal 原型驗證操作說明（Phase 5）

目的（spec 08、15 Phase 5）：用真的 Apple 日曆與 Google 日曆，實測四件我們還沒驗證的事：

1. 切換地區偏好（同一個 UID 換地區屬性與日期）：是**更新**原事件，還是**重複建立**？
2. 延期成「日期未定」（tbd）後：事件還在嗎？標題標記與 `STATUS:TENTATIVE` 怎麼顯示？
3. 取消（`STATUS:CANCELLED`）後再復原：怎麼顯示？復原後會回來嗎？
4. SEQUENCE 有沒有被採用？

原型 feed 用的是和正式 feed **同一個產生函式**，只是內容由本機狀態檔決定，不讀寫資料庫。

## 準備

1. 在 `apps/web/.env.local`（或啟動時的環境變數）加上 `ICAL_PROTO_ENABLED=true`，啟動 `npm run dev`（或 build 後 start）。
2. 準備一個**行事曆服務連得到的公開 https 網址**（Google 的伺服器要自己去抓，localhost 不行）。建議用 cloudflared quick tunnel：
   `cloudflared tunnel --url http://localhost:3000`，會給一個 `https://xxxx.trycloudflare.com`。（由負責人與使用者決定用哪個通道；驗證完就關掉。）
3. 想讓日曆裡的連結指向通道網址，啟動伺服器時設 `NEXT_PUBLIC_SITE_URL=https://xxxx.trycloudflare.com`（也會決定事件 UID 的網域；原型用過即丟，不要和正式網域混用）。沒設也能驗證，連結會是請求的網址。
4. 兩個 feed：
   - `https://<通道網址>/ical/_proto/a.ics`：照規則，每次變動 SEQUENCE +1。
   - `https://<通道網址>/ical/_proto/b.ics`：對照組，資料同樣變動，但 SEQUENCE 永遠不動。
   用 `curl -i` 先確認兩個都回 200（回 404 代表還沒 `init` 或 `ICAL_PROTO_ENABLED` 沒開）。

## 訂閱

- **Apple 日曆**（Mac：檔案 → 新增日曆訂閱；iPhone：設定 → 日曆 → 帳號 → 加入帳號 → 其他 → 加入已訂閱的行事曆）：兩個網址各訂閱一次，更新頻率選「每 5 分鐘」（驗證用）。
- **Google 日曆**（只能用電腦網頁版）：「其他日曆」旁的「＋」→「透過網址」，兩個網址各加一次。Google 不能手動重新整理、間隔不固定（數小時到一天），所以每一步之間要**等**，並在記錄表寫下等了多久。

## 步驟

在專案根目錄（`npm -w apps/web run ical:proto -- <步驟>`）依序執行；**每做完一步，先到兩個日曆各自重新整理／等待更新，再照下表觀察並記錄**。每一步也會自動寫進 `.local/ical-proto/log.md`（時間、動作、預期）。

| 順序 | 指令 | 做了什麼 | 觀察重點 |
| --- | --- | --- | --- |
| 1 | `init` | 建立 7 個上市事件（day、month、quarter 各一，另 4 個後面用）＋1 個活動，a、b 相同 | 都出現？month 事件橫跨整個月份（最後一天沒被吃掉）？quarter 在該季最後一天、標題有 [暫定 …]？活動是 1 小時？ |
| 2 | `region` | Proto Region Game：地區 WW→JP、日期延後 3 天，同一個 UID；a 的 SEQUENCE +1 | **不能多出重複事件**；原事件搬到新日期。b（沒有 SEQUENCE）有沒有更新？ |
| 3 | `tbd` | Proto Delay Game 延期成日期未定：留在原日期，標題加延期標記、TENTATIVE | 事件還在嗎？標記與 TENTATIVE 怎麼顯示（淡色、問號、無差別）？ |
| 4 | `cancel` | Proto Cancel Game 取消（CANCELLED＋標記） | 被刪除線、消失、還是沒變？ |
| 5 | `restore` | Proto Cancel Game 復原 | 回來了嗎？若上一步被刪掉，這裡會重新出現嗎？a、b 是否不同？ |
| 6 | `seq-only` | Proto Seq Probe 只改標題為 (rev B)、日期不變；a 的 SEQUENCE +1，b 不動 | 標題有沒有更新？a 與 b 是否不同（不同＝客戶端依 SEQUENCE 決定是否採用新版本） |
| 7 | `no-seq` | Proto Seq Probe 日期延後 7 天，a、b 的 SEQUENCE 都不動 | 日期有沒有跟著變？沒變＝客戶端只認 SEQUENCE，正式 feed 的 SEQUENCE 就必須在每次異動時遞增 |

其他指令：`show [a|b]` 印出目前的 ics；`status` 看目前進度；重新驗證時再 `init`（會覆寫狀態，log.md 接著寫）。

## 記錄表（填完交給負責人，結果會寫回 spec 08 的 ❓）

| 步驟 | 客戶端 | feed | 等了多久才更新 | 實際看到什麼 | 符合預期？ |
| --- | --- | --- | --- | --- | --- |
| 1 init | Apple | a／b | | | |
| 1 init | Google | a／b | | | |
| 2 region | Apple | a | | | |
| 2 region | Apple | b | | | |
| 2 region | Google | a | | | |
| 2 region | Google | b | | | |
| 3 tbd | Apple／Google | a／b | | | |
| 4 cancel | Apple／Google | a／b | | | |
| 5 restore | Apple／Google | a／b | | | |
| 6 seq-only | Apple／Google | a／b | | | |
| 7 no-seq | Apple／Google | a／b | | | |

## 驗證完

關掉通道、把 `ICAL_PROTO_ENABLED` 拿掉（預設 false＝`/ical/_proto/*` 回 404）、在行事曆裡取消訂閱兩個原型日曆。`.local/ical-proto/` 不進 git。
