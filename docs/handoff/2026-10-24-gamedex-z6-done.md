# 交接：GameDex 第二輪全部合併、Z6 效能完成、開發暫停（2026-10-24）

使用者要重開電腦，開發先暫停。下一個工作階段等使用者說「繼續」再動工，**不要自行開始新工作**。

## 現況

- main 已合併（皆在公開 repo `ISOCASSELGenMi/GameDex`）：
  - `#1` 第二輪 Z1～Z4
  - `#2` Next.js 16.4.1 安全修補
  - `#3` Z6 效能：預先計算分組欄與 `release_picks`、`/games` HTML 瘦身、migration 0015／0016、spec 寫回
  - `#4` 修 `accounts-w7b-u.spec.ts:271` 偶發失敗（本交接檔隨這個 PR 一起進 main）
- **開發 DB 已套到 migration 0016**，`backfill_game_groups` 已跑完（2026-10-24，408 秒、316,955 款、`release_picks` 416,375 列）。詳情欄位（0014）早已回填。
- 開發 DB 實測：`/games` 分組最慢 391 ms，平台頁全部遊戲最慢 308 ms，`/games` 不分組 HTML 166～173 KB。每個查詢的第一次執行（快取還沒熱）大約是中位數的 2～6 倍，最多 1080 ms。
- 最後一次驗收（`fix/flaky-w7b-u`，已含 main）：typecheck、lint、i18n:check 通過，lint:arch 0 違規；`npm test` 1271 個通過；`MODULES=none` 單元 928 個通過；整套 test:a11y 892 個通過、1 個跳過、0 個失敗。
- 本機 worktree：
  - `.local/wt/phase7`（`perf/z2-queries`，已合併，可刪）
  - `.local/wt/flaky`（`fix/flaky-w7b-u`，合併後可刪）
  - 主目錄停在舊的 `main`（3e09821），下次開工先 `git pull`。
- 開發 DB 由主目錄 `npm run db:start` 在背景啟動。重開電腦後要自己重新啟動。

## 這輪定案

- `games_browse_name_idx`、`games_browse_date_idx`：使用者先決定不加，開發 DB 實測平台分組依日期排序要 5.4 秒後，決定在 0016 加回。
- 偶發失敗的根因：點追蹤鈕時 Playwright 捲動頁面，頁首連結被捲到 sticky 標頭底下，axe target-size 誤報。修法是 axe 前 `scrollTo(0,0)`。同類問題還有 header 下拉浮層遮住內容按鈕（`47b53c7`，axe 只檢查 `.site-header`）。
- **全域規則（使用者 2026-10-24 訂）**：每次推送前，spec 與 checklist 都要先更新到最新進度，和程式一起推送。

## 地雷（新增）

- `backfill_game_groups` 不打 IGDB，但 catalog 模組啟動時會檢查 IGDB 環境變數；在 worktree 跑時要從主目錄 `.env.local` 帶入，不要印出值。
- 繞過 `writeGameBatch`／`upsertReleaseEvent` 直接寫 `release_events` 的程式（包括 e2e 直接 insert），要自己補 `release_picks`，否則平台頁全部遊戲會漏列。
- 新增語系時，要補 `games_dname_{locale}_idx`（schema 的 `DISPLAY_NAME_INDEX_LOCALES`）。
- 用自訂 `E2E_DIST_DIR`（例如 `.next-e2e-x`）建置後，`npm run lint` 會掃到產物而誤報；先刪掉 `apps/web/.next-e2e-*`。之後可以把它加進 eslint 的忽略清單。
- 這台機器沒有 `python3`；寫腳本用 node 或 PowerShell。用工具產生 PR 說明時，先確認檔案不是空的再 `gh pr edit`（曾經把 #3 的說明清空，已恢復）。
- 整台機器 CPU 滿載時，整套 a11y 可能有零星失敗，單獨重跑會過。驗收要在機器空閒時跑。
- 其他舊地雷仍見 `docs/handoff/2026-10-23-gamedex-v2.md`。

## 剩下的任務

### 需要使用者處理

1. 把 `docs/spec/` 匯入 claude.ai Project 正本（v2.1 以後的改動，含 D82～D87、Z6 寫回）。
2. 隱私權政策（含帳號段落）請律師審閱；過目 ja 用語（クリア／全クリア／挫折 等）。
3. Phase 7 第 2 波：申請 Discord／Google／Twitch／Microsoft 的 OAuth app（建議正式網域定了再申請）。
4. Phase 7.5：選寄信服務商（正式開放註冊前必須完成）。
5. 提供 `STEAM_WEB_API_KEY`，做 Steam 真實連線實測。
6. Phase 9 部署決定（VM、網域、Cloudflare 實設、搜尋主控台）。
7. 決定是否刪除備份資料庫 `sok_studio_bak_20261013`（破壞性）。
8. 決定是否刪除舊的單一檔規格 v1.2（破壞性）。
9. 規格書 v2.0 審閱與 3 項待定事項：依篩選的公開 iCal、用戶追蹤名單是否公開、新帳號評論是否先不公開。
10. 查證 Twitter/X OAuth 的開發者帳號條件與費用。

### 開發待辦（使用者說繼續後才做）

1. Phase 7 第 2 波社群登入、第 4 波 Xbox 匯入（依賴第 2 波）、7.5 寄信：都卡在使用者。
2. Phase 9 部署（spec 15、16）：上線前要處理 PPR 錯誤頁回 200 會被 `s-maxage` 快取的問題，並設定 `NEXT_PUBLIC_SITE_URL`。
3. 第二輪留下的待決：
   - 評分排名頁篩選只列常用平台。根因是篩選面板平台清單同時出現在 HTML 和 flight 資料，可以用 Z6 的核取方塊 HTML 字串做法推廣到所有頁，例如 `/trending` 約 301 KB。
   - 廠商分組在多個開發商都在名單內時，取名單排序最後者（沒存 IGDB 順序）；使用者原本定的是取 IGDB 列出的第一個。
   - 日期分組在預設排序下，從最遠的未來月份開始。
   - 搜尋候選改兩段式候選池。
4. CI：Actions Node 20 淘汰警告；ubuntu-latest 改 Ubuntu 26 後，留意 Linux 字型較寬造成的版面問題。
5. 舊待決（詳見 `docs/checklist.md` 未勾選項目）：W3B／W3C 程式整理、SEO 待決、Phase 4 待決（缺金鑰行為等）、spec 91 補 Phase 1 實測、`.gitattributes` 統一 LF、IGDB 資料刪除行為驗證、Metacritic／Discord spike、IGDB events 覆蓋率。
6. 本機清理：刪掉已合併的 worktree `.local/wt/phase7`、`.local/wt/flaky`。主目錄 `.claude/launch.json` 有未提交的 3300 預覽設定，要不要提交由使用者決定。
