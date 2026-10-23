# CLAUDE.md — SoK Game Calendar

遊戲資料庫＋上市月曆／時間軸。使用者以繁體中文溝通：回覆簡明、照實說、沒把握不要亂做；不需要使用者介入的步驟直接做，進度與下一步寫在同一則訊息；只有缺少使用者指示、或要做破壞性操作（刪資料、git 強制推送、改本專案以外的檔案）時才停下來問。

## 規格在哪裡

規格書 v2.0 的副本在 **`docs/spec/`**（00~16、90、91、CHANGELOG；2026-10-12 從 claude.ai Project「SoK-Game_Calendar」的 `spec/` 匯出）。
正本仍在 Project；兩邊不一致時以 Project 為準，請使用者重新匯出。動工前讀對應章節；實作與規格衝突時先問使用者，不要自行改規格。關鍵章節：
- 02 架構與模組（分層、模組邊界、manifest、排程）／03 資料模型／04 IGDB 同步／15 路線圖（每個 Phase 的完成標準）／16 部署與環境變數
- **UI／UX 設計方向**：`docs/design/ui-direction.md`（Motion-Driven、Micro-interactions、Spatial UI、Feature-Rich Showcase；月曆一日一格左右切換、時間軸左右交錯）。**正式規劃或改版頁面設計時必讀並照做**，參考截圖在 `docs/design/references/`。
- 進度 checklist：repo 副本 **`docs/checklist.md`**（正本在 Project 的 `claude/checklist.md`）。開工前先讀；做完打勾、新工作加進對應區塊並標日期。

## 五個硬性原則（摘自 spec/00）

1. 分層依賴方向不可逆：Presentation → Use Case → Repository／Provider → Domain。
2. 外部格式（IGDB unix timestamp、數字 enum…）只存在 Provider 層，進 Repository／Domain 前轉成我方型別。
3. 有法律或授權風險的整合（Metacritic）做成可獨立關閉、預設關閉的模組。
4. 功能以模組為單位，邊界由 CI 強制；`catalog` 永遠不 import 可選模組。
5. 同一份邏輯只實作一次（評分顯示、聚合、篩選、日期格式化）。

## 目前進度

- ✅ Phase 0 環境、✅ Phase 1 kernel／catalog schema／lint:arch／core-only CI（2026-10-12）
- ✅ **Phase 2a IGDB 同步**（2026-10-13）：sync_platforms、sync_games（每小時增量）、Tier 1 回填，真實資料已寫入本機 DB
- ✅ **Phase 2b**（2026-10-13）：resolve_relations、Tier 2 回填（真實資料已跑完）、sync_events、rolling_refresh、字典漂移偵測
- GitHub：private repo `ISOCASSELGenMi/SoK-GameDB`（remote `origin`）
- ✅ **Phase 3a 網站**（2026-10-13，分支 `feat/phase3a`）：月曆＋詳情＋聚合＋基本篩選＋i18n（zh-Hant、en）＋test:a11y
  - **接手先讀 `docs/handoff/2026-10-13-phase3a-done.md`**（3a 程式地圖、已定案判斷、待使用者處理、地雷）；資料量／排程／Phase 2 程式地圖仍見 `2026-10-13-phase3.md`
- ✅ **Phase 3b 完成**（2026-10-14，分支 `feat/phase3b`，尚未合併 main）：時間軸、完整篩選、瀏覽、平台／公司／系列／活動頁、熱度與熱門榜、語言支援、test:a11y 195；**接手先讀 `docs/handoff/2026-10-14-phase3b-done.md`**（待決、地雷、下一步）
- ✅ **Phase 3.5 本機部分完成**（2026-10-14，分支 `feat/phase3.5`）：ja 語系、displayNames、i18n:report、sitemap／canonical／hreflang／JSON-LD／快取；Cloudflare 實設與搜尋主控台移到 Phase 9；**接手先讀 `docs/handoff/2026-10-14-phase3.5-done.md`**
- ✅ PR `ISOCASSELGenMi/SoK-GameDB#1`（phase3b → main，含 3a）2026-10-14 已合併；PR `#2`（`feat/phase3.5` → main）2026-10-14 已合併
- ✅ **Phase 4 完成**（2026-10-15，分支 `feat/phase4`）：評分顯示（selectRatings、訪客來源選擇）、標題比對、資料更正回報＋admin `/internal/reports`；**接手先讀 `docs/handoff/2026-10-15-phase4-done.md`**
- ✅ PR `#3`（`feat/phase4` → main）2026-10-15 已合併
- ✅ **Phase 5 iCal 完成**（2026-10-16，分支 `feat/phase5`）：公開 feed、訂閱頁、Google／Apple 原型實測通過；**接手先讀 `docs/handoff/2026-10-16-phase5-done.md`**
- ✅ PR `#4`（phase5）、`#5`（phase9-prep：Docker／Caddy／備份／心跳告警）、`#6`（Phase 7 第 1 波）2026-10-16 合併；`#7`～`#13`（Phase 7 第 3、5、6、7 波、D82、D83、spec 寫回）2026-10-17 合併；**開發 DB 已套到 migration 0013**（2026-10-23）
- 🚧 **Phase 7 帳號**（Better Auth，D76～D83；worktree `.local/wt/phase7`，任務書與報告在 `.local/agents/7/`）：第 1、3、5、6、7 波＋D83 完成；第 2 波（社群登入）等 OAuth app、第 4 波（Xbox）依賴第 2 波、7.5 寄信服務等使用者選服務商；**接手先讀 `docs/handoff/2026-10-17-phase7-progress.md`**；進度見 `docs/checklist.md`
- ⏭ Phase 9（見 spec 15）
  - 任務註冊在 `catalog/module.ts` 的 `jobs`；長任務用 `lockMode: "session"`；遊戲寫入一律經 `writeGameBatch`

## 工作方式（使用者指示，跨電腦／雲端都適用）

- 負責人只規劃與驗收；寫碼派子代理（`model: sonnet`、`effort: medium`、背景、各自 `TEST_DATABASE_NAME=sok_<x>_test`）。子代理報告沒有指令與數字就退回；驗收時自己重跑「提交前必過」全部項目並讀 diff。動開發 DB 先問使用者。
- 雲端或別台電腦沒有 `.local/`（開發 DB、子代理任務書）與 `apps/web/.env.local`（IGDB 金鑰）；需要真實資料的工作只能在本機做。換手前先 commit 並推送。

## 本機開發

```bash
npm run db:start        # 本機 PG 16（embedded-postgres，資料在 .local/pgdata），前景執行
npm run db:migrate && npm run db:seed
npm run dev             # /healthz、/readyz
```
停止資料庫：在 db:start 的終端機按 Ctrl+C；或 `node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe stop -D .local\pgdata -m fast`。
環境變數在 `apps/web/.env.local`（git 忽略）；完整清單見 `infra/.env.example`。**不要把 Secret 印到輸出或寫進其他檔案。**

## 提交前必過

```bash
npm run typecheck   # next typegen && tsc --noEmit
npm run lint
npm run lint:arch   # 0 violations
npm test            # 單元＋整合（整合測試用 TEST_DATABASE_URL，資料庫名必須以 _test 結尾，每次重建）
npm run i18n:check
npm -w apps/web run test:a11y   # Playwright＋axe；本機一律 PW_CHANNEL=chromium（自帶無頭 chromium，需先 npx playwright install chromium；msedge 會在 Alt+Tab 留空白視窗）；與 npm test 共用測試 DB，不可同時跑
```

## 慣例與地雷

- `db.select()`／drizzle／`getDb()` 只能出現在 `repository/` 與 `kernel/db/`；schema.ts 只給自己模組的 repository 用（`lint:arch` 會擋）。
- 跨模組只能 import 對方的 `index.ts`；`kernel` 不 import 任何模組；只有 `modules/registry.ts` 與 `app/` 可 import 可選模組。
- Domain 型別在 `domain/entities/`，零外部依賴；enum 值陣列也放這裡，schema 用它建 pgEnum。
- `change_feed` 必須與變更在同一個 transaction 寫入（見 `repository/release-events.ts`）。
- Next.js 16.4（`cacheComponents` 開啟）：讀 DB 的 GET route handler 先 `await connection()`。寫 Next 相關程式前先讀 `node_modules/next/dist/docs/`。
- TypeScript 鎖 6.0.3（dependency-cruiser 需 < 7），不要升級。
- npm 11 預設不跑 postinstall；新套件需要時用 `npm approve-scripts <pkg>`。
- 新 migration：改 schema 後 `npm run db:generate`，檢查產生的 SQL 再 commit。
