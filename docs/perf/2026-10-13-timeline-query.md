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
