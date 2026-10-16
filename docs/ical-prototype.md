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

## 實測結果（2026-10-15～16）

以下為負責人逐步記錄（Google 日曆網頁版由負責人操作；Apple 日曆由使用者以 iPadOS 26.6.1 操作）。


## 第 1 步 init（2026-10-15 06:14Z 建立；Google 06:2x 首次抓取，訂閱後立即）
| 項目 | Google a | Google b | 符合？ |
| --- | --- | --- | --- |
| day（11/4、11/9、11/14、11/19、11/24） | 皆出現、全天 | 同 a | ✅ |
| month（12 月） | 「12月1日 – 31日」整月，最後一天未被吃掉 | 同 | ✅ |
| quarter（2026 Q4） | 12/31 單日，標題「[暫定 2026 年第 4 季]」 | 同 | ✅ |
| 活動 17:00Z | 台北 10/26 01:00–02:00（1 小時） | 同 | ✅ |
Apple：未測（需使用者裝置）。

## 第 2 步 region（2026-10-15 06:27:54Z）
Proto Region Game：11/14 → 11/17，地區 WW → JP；a SEQUENCE 0→1，b 維持 0。
等待 Google 下一次抓取（`.local/ical-proto/access.log` 記錄 UA 與時間）。
- Google 抓取 b：07:31:02Z（第 2 步後約 63 分鐘）。b 的 Proto Region Game 從 11/14 搬到 11/17、**沒有重複事件**；b 的 SEQUENCE 沒變也更新了 → Google 依內容更新，不依賴 SEQUENCE。
- a 尚未被重新抓取（仍在 11/14）。
- Google 抓取 a：08:00:32Z（第 2 步後約 93 分鐘）。a 也搬到 11/17、無重複。**第 2 步結論：聚合 UID 換地區＝更新原事件，不重複建立 ✅（D26）；SEQUENCE 有無不影響 Google 更新。**
- 第 3 步 tbd：08:01Z 推出；第 4 步 cancel：08:58Z 推出（Google 期間未重抓，3、4 步一起觀察）
- Google 抓取：b 13:31:02Z、a 14:00:33Z（距上一輪正好 6 小時；第一次重抓是訂閱後約 1 小時，之後每 6 小時：b 於 :31、a 於 :00）。
- **第 3 步 tbd（Google）**：a、b 都留在 11/9，標題「[延期・日期未定] Proto Delay Game（PC1）」✅；TENTATIVE 在此介面無明顯樣式差異（只能靠標題標記）。
- **第 4 步 cancel（Google）**：a、b 的 Proto Cancel Game **從日曆消失**（不是刪除線）。→ 取消在 Google 等同移除；30 天保留期對 Google 使用者只是讓它「被移除」而非「停在原樣」。
- 第 5 步 restore：14:01Z 推出
- 第 6 步 seq-only：14:02Z 推出（與第 5 步不同遊戲，下一輪一起觀察）
- Google 抓取：a 19:00:32Z、b 19:31:02Z（a 這輪間隔 5 小時、b 6 小時）。
- **第 5 步 restore（Google）**：a、b 的 Proto Cancel Game 回到 11/19 ✅（取消時被移除、復原後重新出現，同一 UID）。
- **第 6 步 seq-only（Google）**：a、b 標題都更新為「(rev B)」✅；b 的 SEQUENCE 從未變動也更新 → **Google 不依賴 SEQUENCE，依內容更新**。
- 第 7 步 no-seq：19:32Z 推出
- Google 抓取：a 00:00:32Z、b 01:31:02Z（2026-10-16）。
- **第 7 步 no-seq（Google）**：a、b 的 Proto Seq Probe 都搬到 12/1 ✅（兩個 feed 的 SEQUENCE 都沒變）。

## Google 結論
1. 聚合 UID（遊戲×平台×階段）換地區屬性與日期 → 更新原事件，不重複（D26 成立）。
2. **Google 不依賴 SEQUENCE**：只改標題、只改日期、SEQUENCE 不變都會更新（依內容比對）。SEQUENCE 規則保留給 Apple／Outlook。
3. 延期成 tbd：事件留在原日期，標題標記可見；TENTATIVE 無明顯樣式。
4. **取消（STATUS:CANCELLED）→ 事件從 Google 日曆消失**；復原後同一 UID 重新出現。
5. 月精度整月、季精度單日、活動 1 小時皆正確。
6. 抓取間隔：訂閱後約 1 小時首次重抓，之後約每 5～6 小時（a、b 各自排程）。

## Apple（iPad）— 2026-10-16 重新 init 開始
- init：01:32Z
- **第 1 步 init（Apple iPad）**：全部正確（日期依 init 當天計算，較 Google 輪晚一天：11/5、10、15、20、25；12 月整月含 31 日；12/31 季度；活動台北 10/27 01:00–02:00）✅
- 第 2 步 region：11:25Z
- **第 2 步 region（Apple）**：a、b 都搬到 11/18、說明的地區為日本 ✅；b（SEQUENCE 未變）也更新 → Apple 也依內容更新
- 第 3 步 tbd：11:28Z
- **第 3 步 tbd（Apple）**：a、b 都留在 11/10、標題有延期標記 ✅；TENTATIVE 外觀與一般事件相同
- 第 4 步 cancel：11:32Z
- **第 4 步 cancel（Apple）**：a、b 事件仍在 11/20，以刪除線／灰色顯示 ✅（與 Google 直接移除不同）
- 第 5 步 restore：11:33Z
- **第 5 步 restore（Apple）**：a、b 回到一般樣式、標題無取消標記 ✅
- 第 6 步 seq-only：11:35Z
- **第 6 步 seq-only（Apple）**：a、b 標題都更新為 (rev B) ✅；b 的 SEQUENCE 未變也更新
- 第 7 步 no-seq：11:37Z
- **第 7 步 no-seq（Apple）**：a、b 都搬到 12/2、11/25 無殘留 ✅

## Apple（iPadOS 26.6.1）結論
1. 聚合 UID 換地區＝更新原事件，不重複 ✅。
2. **Apple 也不依賴 SEQUENCE**：只改標題、只改日期都會更新。
3. TENTATIVE 無視覺差異；延期標記靠標題。
4. **取消 → 事件保留並以刪除線／灰色顯示**（Google 是移除）；復原後恢復一般樣式。
5. 手動下拉即重新抓取（UA `iOS/… dataaccessd/1.0`）。

## 總結（寫回 spec 08）
D26 聚合 UID 成立；SEQUENCE 兩個客戶端都不依賴，但維持遞增（RFC 5545、Outlook 未測）；取消在 Google 移除、Apple 刪除線，兩者都符合「不停在原樣」；TENTATIVE 不可依賴，標題標記必要；Google 間隔約 1 小時首抓、之後 5~6 小時。
