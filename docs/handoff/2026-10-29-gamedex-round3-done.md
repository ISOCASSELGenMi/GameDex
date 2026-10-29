# 交接：GameDex 第三輪完成、開發暫停（2026-10-29）

使用者要暫停開發。下一個工作階段等使用者說「繼續」再動工，**不要自行開始新工作**。上一份交接檔 `2026-10-24-gamedex-z6-done.md` 的「需要使用者處理」清單仍然有效，下面只列這一輪的變化與完整的剩餘任務。

## 現況

- main 已合併（皆在公開 repo `ISOCASSELGenMi/GameDex`，CI 全綠後自動合併）：
  - `#5` 小清理：eslint 忽略 `apps/web/.next-e2e-*/**`；CI actions（checkout／setup-node／upload-artifact）升到 v7（Node 24）。
  - `#6` e2e 不依賴實際時間：夜貓子彩蛋在本地 02:00～03:59 自動解鎖 `night-owl` 主題，Playwright 時區是 UTC，所以每天 UTC 02～03 點（台灣 10:00～12:00）整套 e2e 與 CI 會有 9 個失敗。共用 fixture `fixedClock`（`e2e/support/helpers.ts`）在該時段把瀏覽器 `Date` 位移到同日 01:00，其他時間不動。
  - `#7` 全站 HTML 瘦身：`/trending` 251→163 KB（榜單改客戶端元件吃緊湊列、共用熱度 sprite）；`/ratings` 移除 `commonPlatformsOnly`，改列完整平台（168 KB）；`scripts/html-size.mjs` 量真實資料；並修 `accounts-w7b-u.spec.ts:171` 的捲動誤報。
  - `#8` 搜尋候選兩段式：去空白後 ≤ 3 字元先在熱度最高 3000 筆找，找滿 120 筆才用，不足退回全表（`the` 467→10 ms）。窗口內排序（熱度、名稱、id）與全表（熱度、id）在同熱度邊界可能差一筆，已寫進 spec 06。
  - `#9` 月曆未定日：摺起來的大組（> 24 款）伺服器端只送熱度前 24 款，加「查看全部 N 款」連到 `/games?by=date&year=…`（2026-12 681→189 KB）。
  - `#10` 分組細節 D88：廠商取 IGDB 第一個（`game_companies.igdb_position`、migration 0017、任務 `backfill_company_positions`）；日期分組預設排序從當月起算。
- **開發 DB 已套到 migration 0017**（使用者批准，2026-10-29）。`igdb_position` 可為空，323,454 筆目前全是 NULL，所以**廠商分組目前仍是舊規則**（取名單欄位順序最後者）。
- 最後一次驗收（B，合併 main 前）：`npm test` 1283、`MODULES=none` 單元 935、整套 test:a11y 911 通過／1 跳過／0 失敗、lint:arch 0 違規。
- 本機 worktree 已全部清掉，只剩主目錄；本機分支未刪（可 `git branch --merged` 後清理）。備份分支 `backup/b-wip-on-main` 可刪。

## 使用者常設授權

- **PR 驗收通過且 CI 全綠就直接合併，不用再問**（2026-10-29）。仍須自己重跑提交前必過並讀 diff；動開發 DB（migrate、跑回填任務、寫入）、破壞性操作、改 spec 既定決定仍要先問。
- 記憶檔：`C:\Users\illus\.claude\projects\C--Users-illus-Project-SoK-GameDB\memory\merge-when-ci-green.md`。
- 全域規則（`C:\Users\illus\.claude\CLAUDE.md`）：**推送前 spec 與 checklist 要更新到最新，和程式一起 commit 再推**；PR 說明用 `gh pr edit --body-file`／`gh pr create --body-file`（先確認檔案非空）；不用 python3；用量每波行動前檢查、context ≥ 60% 或 ≥ 600k 或超過 8 小時就寫交接。

## 剩餘任務

### 需要使用者處理

1. **跑 `backfill_company_positions`**：需要 IGDB 金鑰、會呼叫 IGDB 重抓約 32 萬款的公司順序（可續跑，`--max-batches N`、`--restart`）。在主目錄 `npm run job -- backfill_company_positions`（`SCHEDULER_ENABLED=false`）。跑完廠商分組才變成「取 IGDB 第一個」。要跑時告訴我，我會帶金鑰環境變數但不印出。
2. **月曆預算決定**：2026-08（256～264 KB）、2026-09（254～262 KB）、2027-01（252～259 KB）略超 spec「約 250 KB」，原因是 17～21 款的月精度組以完整卡片展開。要壓進預算得把「展開成完整卡片」門檻從 24 降到約 12（估省 40～50 KB，未實測），會改變預覽卡體驗。可以接受現況，或下令降門檻。
3. 把 `docs/spec/` 匯入 claude.ai Project 正本（v2.1 之後的改動，含 D82～D88 與 Z6、第三輪寫回）。
4. 隱私權政策（含帳號段落）請律師審閱；過目 ja 用語（クリア／全クリア／挫折 等）。
5. Phase 7 第 2 波：申請 Discord／Google／Twitch／Microsoft 的 OAuth app（建議正式網域定了再申請）。
6. Phase 7.5：選寄信服務商（正式開放註冊前必須完成）。
7. 提供 `STEAM_WEB_API_KEY`，做 Steam 真實連線實測。
8. Phase 9 部署決定（VM、網域、Cloudflare 實設、搜尋主控台）。
9. 破壞性決定：是否刪除備份資料庫 `sok_studio_bak_20261013`；是否刪除舊單一檔規格 v1.2；規格書 v2.0 審閱與 3 項待定事項（依篩選的公開 iCal、用戶追蹤名單是否公開、新帳號評論是否先不公開）；查證 Twitter/X OAuth 條件與費用。
10. 主目錄 `.claude/launch.json` 有未提交的 3300 預覽設定（指向已刪除的 `.local/wt/phase7`），要提交、改指向或還原由使用者決定。

### 開發待辦（使用者說繼續後才做）

1. 夜貓子／彩蛋 toast 淡入過程中文字對比不足（axe 量到 `.egg-toast-kind` 3.82、`button[data-egg-apply]` 2.95，低於 4.5）：真實使用者在淡入那幾百毫秒看到偏淡的字；可從不透明度 0.6 以上開始淡入，或淡入完成後才套用文字色。
2. 觀察偶發失敗：`behavior-3b.spec.ts:94`（/games 分頁：下一頁 → 上一頁）整套中失敗過 1 次，單檔重複 192 次全過，疑似 hydration 前取樣的競爭；再出現時再查。
3. Phase 7 第 2 波社群登入、第 4 波 Xbox 匯入、7.5 寄信：都卡在使用者（上面 5、6）。
4. Phase 9 部署（spec 15、16）：上線前要處理 PPR 錯誤頁回 200 會被 `s-maxage` 快取的問題，設定 `NEXT_PUBLIC_SITE_URL`；`ubuntu-latest` 改 Ubuntu 26 後留意 Linux 字型較寬造成的版面溢出（CI 上最容易先出現）。
5. 舊待決（詳見 `docs/checklist.md` 未勾選項目）：W3B／W3C 程式整理、SEO 待決、Phase 4 待決（缺金鑰行為等）、spec 91 補 Phase 1 實測、`.gitattributes` 統一 LF、IGDB 資料刪除行為驗證、Metacritic／Discord spike、IGDB events 覆蓋率。
6. `domain/publisher-groups.ts` 檔頭註解提到已不存在的 `release-columns.ts`（過時註解，無害），動到該檔時順手修。

## 地雷（新增）

- **子代理續用**：換工作階段後，舊子代理的 ID 無法 `SendMessage` 續用（"No transcript found"）；改派新子代理，把進度檔位置與任務書給它。子代理偶爾持續重送同一份最終報告（因為它自己的背景測試還沒結束），用 `TaskStop` 停掉。
- **子代理 git**：曾有子代理把 WIP commit 提交到**主目錄的 main**而不是自己的 worktree（已搬回，備份在 `backup/b-wip-on-main`）。任務書要寫明「只在自己的 worktree 工作，commit 前 `git branch --show-current` 確認分支」。
- **整合測試 igdb id**：各測試檔用固定的 igdb id 號段，同一個測試資料庫內重疊會撞唯一鍵（C 的測試曾和 `ratings-rank-z2b` 都用 887000）。新增測試前先 `grep` 確認號段沒人用（893000 起目前已被搜尋兩段式測試用）。
- **並行 PR 的文件衝突**：多個分支同時改 `docs/spec/CHANGELOG.md`、`docs/checklist.md`、spec 06 一定衝突；做法是依序合併，每合併一個就把 main 合進下一個、解衝突（兩邊都保留）。
- **e2e 時間**：e2e 的時間由 `fixedClock` fixture 處理，不要改用 `clock.install`（假造計時器會讓客戶端導覽測試失敗）；要指定時間的測試用 `page.clock.setFixedTime`。
- **驗收**：子代理回報「測試全過」不可信，兩次與我的重跑不一致（igdb id 撞號、整套失敗沒看出是時鐘問題）。一律自己重跑；機器上同時有多個子代理時整套 e2e 會有零星失敗，先單檔重複跑再判斷是負載還是真的壞了。
- **CRLF／LF**：專案混用，用腳本改檔前先正規化行尾。
- 其他舊地雷仍見 `docs/handoff/2026-10-24-gamedex-z6-done.md` 與 `2026-10-23-gamedex-v2.md`。
