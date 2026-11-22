# Metacritic 配對人工校驗循環（2026-11-08）

使用者在一張網頁表上校驗 Metacritic 與 IGDB 的配對，校驗完通知 Claude，Claude 套用結果、跑下一輪抓取、更新表格，反覆進行。

## 校驗頁

- Artifact：<https://claude.ai/artifact/27vMHvpeuxPveVpd6U13Vv>（私人；勾選存在它的 `db`，集合 `decisions`，文件 id＝列 id，內容 `{checked, at}`）
- 來源檔（都在 `.local/`，git 忽略）：`review-template.html`（版面與腳本）、`review-rows.json`（資料）、`review-page.html`（產出，用 Artifact 工具以同一路徑重發佈）
- 勾選語意：**勾＝與 IGDB 是同一部作品；不勾＝不是**。沒有 `decisions` 文件的列用預設（`checked` 欄）。
- 區塊：不須校驗（`skip`，預設勾）、已完成（`done`）、未完成：待你校驗（`todo`，預設不勾）、待下一輪抓取（`wait`，不給勾）。

## 工具

`apps/web/scripts/metacritic-review.ts`（用法：`npx tsx --import ./scripts/load-env.ts scripts/metacritic-review.ts <cmd>`，在 `apps/web` 下執行）：

| 指令 | 作用 |
|---|---|
| `facts [最多頁數]` | 補抓還沒有頁面資料的 Metacritic 頁（發售日、標題、公司、平台），存進資料庫 `metacritic_pages`（與驗證共用的頁面快取，TTL 見 spec 05）；與排程共用每日請求額度 |
| `import-facts` | 一次性把舊側檔 `.local/metacritic-facts.json` 匯入 `metacritic_pages`（冪等；已存在的列不覆蓋）。**先套 migration 0022**（`npm run db:migrate`）再執行；之後程式不再讀寫該 JSON |
| `export` | 依資料庫目前狀態輸出 `.local/review-rows.json` |
| `apply <decisions.json>` | 套用勾選：勾＝`confirmExternalMatch`（manual、不再被排程覆寫）、沒勾＝`rejectExternalMatch`（寫否決表、刪分數） |

`node .local/build-review-page.mjs` 把 rows 嵌進模板產生 `review-page.html`。

## 一輪的流程

1. 使用者說校驗完成 → 用 `ArtifactData` list `decisions`，轉成 `{ "<列 id>": true|false }` 存成 JSON。**不要在 apply 之前重新 export**（列 id 要和使用者看到的那次 export 一致）。
2. `apply`：`skip` 區沒被推翻的維持；`todo` 區勾→確認、沒勾→拒絕；`wait`、`done` 不動。
3. 新一輪抓取（受每日額度 500 限制，額度用完就停）：`npm run job -- reverify_matches_metacritic`、必要時 `repair_matches_metacritic`、`sync_ratings`、`refresh_metacritic_index`。
4. `facts` → `export` → `node .local/build-review-page.mjs` → 用 Artifact 工具重發佈 `.local/review-page.html`（同一路徑，網址不變）。
5. 清空 `decisions` 集合（`ArtifactData` delete 各文件），避免舊勾選套到新一輪的同 id 列。
6. 告訴使用者可以開始下一輪校驗。

## 注意

- 本機 DB 要先 `npm run db:start`（前景執行，用背景模式跑）。
- Metacritic 抓取受兩道開關與每日額度限制；`facts` 也走同一個 http 出口與額度。
- `todo`／`skip` 的列 id 是 `external_ids.id`；已移除的列 id 為 `r<gameId>-<slug>`，只顯示不處理。

## 每日自動抓取（2026-11-21）

- Claude 在這個專案啟動或續接時，`.claude/settings.local.json`（git 忽略）的 SessionStart hook 執行 `apps/web/scripts/metacritic-daily-launch.mjs`：當天（UTC，和請求額度同一天）還沒抓過就在背景啟動 `apps/web/scripts/metacritic-daily.ts`，立刻返回、不輸出任何東西。
- 工作腳本：必要時在背景啟動資料庫 → 依序 `sync_ratings`、`reverify_matches_metacritic`、`repair_matches_metacritic`（重複到額度剩不到 10 個，或一輪用掉不到 15 個請求就視為見底）、每週一次 `refresh_metacritic_index`、最後再 `sync_ratings`；這些任務的額度上限＝每日上限 − 20（保留）− 60（補頁面資料預留）。
- **最後一步補頁面資料**：用預留的額度（上限放寬到 − 20）補校驗頁要顯示的 Metacritic 頁面資料（發售日、標題、公司、平台），只補待校驗、已採用、手動確認的（`slugsNeedingFacts(1)`；已有未過期快取的不補），最多 120 頁；存進 `metacritic_pages`（程式在 `apps/web/scripts/lib/review-facts.ts`，`metacritic-review.ts facts` 手動指令共用同一份）。repair／reverify 抓過的頁面也在同一份快取裡，驗證剛抓過的頁面不再發請求；用量即時記帳（每 5 個請求寫一次），行程被殺不會整個任務都沒算。所以每天額度重置後第一次啟動 Claude，校驗頁需要的日期就會自動備好，重建頁面（`export`→`build-review-page.mjs`→發佈）時直接用。
- 狀態 `.local/metacritic-daily.json`（done 當天不重跑；running 4 小時內不重跑；failed 一小時內不重試）、紀錄 `.local/metacritic-daily.log`。要手動重跑：刪掉狀態檔或執行 `npx tsx --import ./scripts/load-env.ts scripts/metacritic-daily.ts`（在 `apps/web`）。
- 自動抓取只會**自動採用**（高信心）或**新增待校驗**的配對，不會替你做人工確認／拒絕；待校驗的新項目會在下一次 `export`／重建校驗頁時出現。
- 只在這個專案資料夾的工作階段有效（project-level hook）；要在任何資料夾啟動 Claude 時都觸發，要改放使用者層級設定。
