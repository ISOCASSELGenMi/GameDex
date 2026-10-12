# 月曆／詳情查詢效能（2026-10-13，Phase 3a）

本機開發 DB（embedded-postgres 16，Windows 11，真實資料：遊戲 314,606、上市事件 461,410），全部唯讀量測。
資料全在 shared buffers（`Buffers: shared hit` 無 read），代表的是**熱快取**數字。

目標（任務書）：月曆查詢 < 300 ms、詳情 < 150 ms（本機）。**全部達標，不需要新索引。**

## 查詢形狀

`repository/release-aggregate.ts` 的 `aggregateReleases`（聚合規則唯一實作），一條 SQL：

1. `keys`：區間內（`release_date BETWEEN 月初 AND 月底`）、通過鍵層級篩選（階段、遊戲類型、傳聞、平台、平台種類、類型標籤、status、removed）的 `(game_id, platform_id, release_stage)`。走 `release_events_date_platform_idx`。
2. `picked`：對每個鍵取**全部**候選列，`DISTINCT ON` 依 manual → 偏好地區 → WW → 最早日期 → id 挑一筆。走 `release_events_diff_key_idx (game_id, platform_id, region_id, release_stage)`。
3. 挑完再套一次區間（偏好地區的日期在區間外時不會被 WW 補進來），`GROUP BY (game, 代表日期, 精度, 階段)` 合併成卡片，`jsonb_agg` 平台 chip。

整個讀取包在 `withReadTimeout`：唯讀 transaction＋`SET LOCAL statement_timeout = 3000`，逾時丟 `CatalogQueryTimeoutError`（UI 回 503）。

## 量測結果

熱門月份：近年事件最多的月份是 2024-10（3,788 筆上市事件）；另量 2026-12（3,567 筆，且含大量年精度「2026」→ 本月未定日 2,386 張卡）。

| 情境 | EXPLAIN ANALYZE 執行時間 | use case 實測（4 次，第 1 次含連線池建立） | 結果筆數 |
| --- | --- | --- | --- |
| 2024-10 無篩選 | 71.4 ms（planning 2.7 ms） | 148 / 83 / 83 / 87 ms | 2,493 張卡（2,489 有日＋4 未定日）、活動 15 |
| 2024-10 `platform=ps5` | 5.2 ms | 8 / 7 / 6 / 6 ms | 231 張卡 |
| 2024-10 `platform=ps5&genre=role-playing-rpg` | 2.6 ms | 6 / 4 / 4 / 4 ms | 46 張卡 |
| 2026-12 無篩選 | 68.5 ms | 128 / 81 / 79 / 78 ms | 97 有日＋2,386 未定日 |
| 詳情 `elden-ring`（約 12 段查詢，同一唯讀交易） | — | 11 / 4 / 4 / 4 ms | 6 平台、16 連結、10 相似 |
| 詳情 `super-mario-odyssey`（系列 Mario 547 款） | 同系列 LATERAL 段 2.4 ms | 71 / 7 / 6 / 6 ms | 2 個系列各 20 款 |
| 篩選選項（平台＋近期事件數、genres） | — | 65 / 5 / 5 / 5 ms | 213 平台、23 類型 |

use case 實測比 EXPLAIN 多出的部分是 JSON 傳輸與 TS 對應（2,500 張卡約 10~15 ms）。

### 無篩選（2024-10）計畫摘要

```
Sort (rows=2493)                                                    actual 70.8..71.0 ms
  GroupAggregate  Group Key: p.game_id, p.release_date, p.precision, p.release_stage
    Incremental Sort  Presorted Key: p.game_id
      Nested Loop → games_pkey、platforms_pkey（每張卡一次）
        Subquery Scan on p (rows=3490)  Filter: 區間＋精度（Rows Removed by Filter: 5）
          Unique ← Incremental Sort（DISTINCT ON；Presorted Key: game_id, platform_id, release_stage）
            Nested Loop
              Unique ← Gather Merge（Workers Launched: 2）              actual 34.7..35.7 ms
                Parallel Bitmap Heap Scan on release_events r_1
                  Bitmap Index Scan on release_events_date_platform_idx   (4,092 列估計；Buffers hit=8)
                Hash Join platforms（kind <> 'mobile'）
                Index Scan games_pkey（type／rumored 篩選）
              Index Scan using release_events_diff_key_idx on release_events r  (game_id, platform_id, release_stage)
              Index Scan regions_pkey
Buffers: shared hit=58,282   Execution Time: 71.4 ms
```

觀察：

- 時間最大的一段是 **Gather Merge 的平行 worker 啟動**（約 30 ms；worker 本身只做 4.5 ms）。同查詢加 `SET LOCAL max_parallel_workers_per_gather = 0` 實測 **48~50 ms**（vs 71~73 ms）。Windows 上啟動 worker 特別貴，Linux 正式環境差距應較小。目前已達標，**沒有改**；若之後要再壓，可在 `withReadTimeout` 加這一行（只影響讀取交易）。
- 規劃器對 `GROUP BY` 結果估 1 列（實際 2,493），所以全程用 nested loop；在這個資料量下是對的選擇，暫無需調整統計。
- 有篩選時候選鍵少，整條查詢 < 6 ms；最壞情況就是「無篩選的熱門月份」。

### 有平台篩選（2024-10，ps5）

`release_events_date_platform_idx` 的 Bitmap Index Scan 直接帶 `platform_id = ANY(...)`（估 90 列、實際 232 鍵），沒有平行；Execution 5.2 ms。加 genre 時多一個 `Nested Loop Semi Join` → `game_genres_game_id_genre_id_pk` Index Only Scan，2.6 ms。

## 索引

spec 03 §索引總表列的都已存在且被用到：`release_events (release_date, platform_id)`、`(game_id, platform_id, region_id, release_stage)`、`game_genres` PK、`game_franchises (franchise_id, game_id)`、`event_games (game_id, event_id)`、`games` PK／`parent_game_id`。

**已加（2026-10-13 使用者同意，migration `0002_complex_the_hood.sql`，已套到本機開發 DB）**：

- `release_date_history (release_event_id)`：詳情頁以 `release_event_id = ANY(...)` 讀改期紀錄；目前表是 0 列所以無感，但它會隨同步持續成長，沒有索引就是全表掃描。spec 03 §索引總表沒有列這張表（spec 正本由使用者更新）。
  ```sql
  CREATE INDEX release_date_history_event_idx ON release_date_history (release_event_id);
  ```
- 其餘不需要。`events`（960 列）沒有 `start_time` 索引，全表掃描 < 1 ms。

## 重現

腳本在 `.local/agents/scratch/`（git 忽略）：

```bash
cd apps/web
npx tsx --import ./scripts/load-env.ts ../../.local/agents/scratch/b-run.ts            # use case 計時
npx tsx --import ./scripts/load-env.ts ../../.local/agents/scratch/b-explain.ts none 2024-10   # none | ps5 | ps5rpg | detail <slug>
NOPAR=1 npx tsx --import ./scripts/load-env.ts ../../.local/agents/scratch/b-explain.ts none 2024-10   # 關平行
```

EXPLAIN 用 `BEGIN READ ONLY … ROLLBACK`，查詢文字由 `buildAggregateQuery`（匯出供量測）經 drizzle `PgDialect.sqlToQuery` 產生，與正式執行的 SQL 相同。
