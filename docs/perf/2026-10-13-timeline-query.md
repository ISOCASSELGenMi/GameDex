# 時間軸／瀏覽查詢效能（2026-10-13，Phase 3b）

本機開發 DB（embedded-postgres 16，Windows 11，真實資料：遊戲 314,606、上市事件 461,410、其中 tbd 32,931、
`release_date_history` 0 筆），全部**唯讀**量測（`withReadTimeout` 唯讀交易內 `EXPLAIN (ANALYZE, BUFFERS)`）。熱快取數字。

目標（任務書）：熱門月份（2024-10）時間軸一頁 < 300 ms。**達標，不需要新索引。**

## 查詢形狀

`repository/timeline.ts` 的 `buildTimelineWindowQuery`：

1. `cards`：`release-aggregate.ts` 的 `buildAggregateCardsQuery`（聚合規則唯一實作），`rangeColumn = period_start`，
   區間是一段 period_start 視窗。候選鍵走 `release_events_period_start_idx`，挑選走 `release_events_diff_key_idx`。
2. `ranked`：排序鍵 `(sk, pr, np, game_id, st)`、`row_number()`／`count(*)` OVER (PARTITION BY period_start, precision)。
3. 只留每組前 10 筆 → keyset（row value 比較）→ ORDER BY 排序鍵 → LIMIT 頁大小＋1。

視窗：從 cursor 的 period_start 起先查 14 天，不夠一頁再往同方向查下一段（每段 ×4：56 天、224 天…），直到湊滿或超過
全庫 period_start 範圍（`min/max(period_start)` 走索引，< 1 ms）；往後到底再查「未定」組。2024-10 一天約 50~300 筆上市列，
第一段 14 天就湊滿 60 張卡（每天前 10 筆）。

## 量測結果

| 情境 | EXPLAIN ANALYZE 執行時間 | use case 實測 | 備註 |
| --- | --- | --- | --- |
| 2024-10-01 起往後，14 天視窗（一頁 60 張） | 54 ms（planning 1 ms） | `getTimeline({ at: "2024-10-01" })` 52 / 49 / 46 / 50 ms | 8 組（Q4、10 月、10/1~10/6） |
| 2024-10 往前（14 天視窗） | 59 ms | `getTimeline({ cursor: prevCursor })` 49 / 48 / 47 / 50 ms | |
| 2024-10 整月視窗（參考：最壞的單段） | 83~85 ms | — | |
| 展開 2024-10-25（186 張卡，取第 11~110 張） | 4 ms | — | |
| 今天（2026-10-13）起往後 | — | 14 / 9 / 9 / 9 ms | 未來資料少（period_start ≥ 今天 3,729 筆） |
| 「未定」組（tbd，23,817 張卡取前 10） | **502~644 ms** | — | 見下 |
| 月曆 2024-10（`buildAggregateQuery`，3a 對照） | 77~83 ms | — | 3a 為 71 ms；多了 `has_date_history` 欄位與外層排序 |
| 瀏覽：預設（popularity，24 筆） | 176~182 ms | — | `popularity_score` 目前全為 0，退化成依名稱排序 |
| 瀏覽：`q=zelda`（word_similarity，GIN trigram） | 4 ms | — | |
| 瀏覽：`q=龍`（單一中文字 → ILIKE，全表掃描） | 179~206 ms | — | |

## 已知限制

- **「未定」組約 0.5~0.65 s**：tbd 沒有日期可切視窗，必須聚合全部 3 萬筆 tbd 上市列（挑選＋合併）才能取組內前 10 筆與總數。
  只有捲到時間軸最後（或往前時從 tbd 開始）才會查，仍在 3 秒 statement_timeout 內。之後若要壓低：快取（3.5）、
  或把 tbd 卡片物化（每小時同步後重算）。
- 瀏覽預設排序 176 ms 主要是 `popularity_score` 全 0 時要依名稱排序整個白名單類型集合；熱度計算（refresh_popularity）上線後
  `games_type_popularity_idx` 可直接取前 N 筆，屆時再量。
- `release_date_history` 目前 0 筆；延期篩選與 `has_date_history` 的成本（走 `release_date_history_event_idx`）在有資料後要再量。

## 2026-10-14 稀疏條件

**問題**（R 審查中-1）：條件在挑選之後才套用（`status=delayed`／`released` 往後／`upcoming` 往前…）時，視窗 14 → 56 → 224 → 896 → 3584 → 14336 天一路擴張，
每段都要完整聚合；一次請求最壞串 6 段、最後幾段約聚合整庫（46 萬筆上市列），結果還可能是空的。

**修法**：單次請求最多掃 4 段視窗，單段上限 896 天（`TIMELINE_MAX_SCAN_WINDOWS`、`TIMELINE_MAX_WINDOW_DAYS`；14+56+224+896 = 1190 天≈3.3 年）。
湊不滿一頁就回傳已取得的組＋邊界 cursor（`boundaryKey`，cursor 格式不變、舊 cursor 照常解析），回應標示 `nextPartial`／`prevPartial`（與 cursor＝null 的「確定到盡頭」區分）；
UI 顯示「繼續往前／往後找」。上限選 4 段的理由：第 4 段（896 天）已涵蓋 3.3 年，其後每多一段成本再 ×4；實測 4 段在開發 DB 最壞約 1.3 s，低於 3 s 的每句限制且遠低於原本的 4~6.4 s。
（未做 `release_date_history` 預篩：不改變結果的前提下收益有限，且該表目前 0 筆，無法驗證。）

**實測**（開發 DB，warm，`.local/agents/scratch/tl-sparse.mts`，每項跑兩次；前＝HEAD 78b312b、後＝本次）

| 情境 | 前（ms／組數） | 後（ms／組數／是否 partial） |
| --- | --- | --- |
| delayed 往後 | 1637、580 ／ 0 | 160、164 ／ 0 ／ partial |
| delayed 往前 | 4837、4031 ／ 0 | 1273、1264 ／ 0 ／ partial |
| released 往後 | 333、319 ／ 0 | 80、85 ／ 0 ／ partial |
| released 往前 | 52、51 ／ 7 | 49、50 ／ 7 |
| upcoming 往後 | 11、11 ／ 8 | 10、10 ／ 8 |
| upcoming 往前 | 2261、2329 ／ 3 | 748、758 ／ 3 |

不稀疏的情境結果與耗時不變。代價：delayed 往前要連點才到最早（每次約 1.2 s、涵蓋 3.3 年），不再一次卡 4~6 s。
dev server 逐步載入 `/api/timeline?status=delayed` 往前：第 1 次（冷）2.0 s，之後 1.1 s → 0.73 → 0.45 → 0.25 s…（越往前越稀疏越快）；往後 61／25／32／393 ms，第 4 次 `nextPartial=false`、cursor＝null。
