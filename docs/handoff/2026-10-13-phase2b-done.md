# 交接：Phase 2b 實作紀錄（2026-10-13）

開工前的狀態與地雷見 `docs/handoff/2026-10-13-phase2b.md`（仍有效）。這份記錄 2b 做了什麼、使用者的決定、實跑數字。

## 使用者決定（2026-10-13，定案）

| 問題 | 決定 |
| --- | --- |
| 相似清單改變時舊配對 | **同步刪除**（同一 transaction：先 INSERT 新配對再 DELETE 不在清單內的）；`event_games` 只刪 `source='igdb'` 活動的 |
| 回填每批後的 resolve_relations | **每批只解析該批遊戲自己的清單，整輪結束跑一次全量**（補「別的遊戲指向這批」的配對） |
| `ROLLING_REFRESH_PER_NIGHT` | **10000**（約 20 個請求；全庫約 43 天輪一遍） |
| 滾動校對以 id 查不到的遊戲 | **保留遊戲；尚未上市（status ≠ released）的 igdb 上市列標 removed**（history／change_feed 照 diff），id 記進 meta |

## 我自己定的（請使用者確認）

- **`rolling_refresh_misses` 的「不在最近增量名單內」**：來源 `updated_at` ≤ 增量同步進度（`sync_state[igdb_games].lastSyncedAt`）。
  意思是「增量理應已抓過這個版本卻仍有差異」→ IGDB 改了上市日但沒推進 `games.updated_at`。
  來源 `updated_at` 晚於增量進度的只是增量還沒跑到，不算。沒有增量進度時記 `null`。
  「差異」＝新增、日期／階段改變、removed／restored；**只有狀態推進（自動轉 released）不算**。
  注意：回填寫入時不標 removed，所以第一輪校對碰到「回填後 IGDB 刪掉的上市日」也會算進 misses。
- **活動的 change_feed**：新活動寫 `created`、`start_time` 改變寫 `date_changed`（entity_type='event'）。規格 03 只列了 release 相關的觸發點，但 `entity_type` 有 'event'；通知模組之後可能要用。
- **活動同步用增量**（`updated_at > 上次`，sync_state `igdb_events`）：實測舊活動加遊戲時 `updated_at` 會推進（id 298、631 最近被更新）。第一次執行抓全部。
- **字典漂移檢查放在 `rolling_refresh` 開頭**（「每晚同步前」）；只記警告、檢查失敗也不中斷。已知 id 清單在 `link-map.ts` 的 `KNOWN_*_IDS`（website_types 23 個全收錄；external_game_sources 22 個，其中 13 個刻意歸 other）。
- **回填前備份**：embedded-postgres 沒有 `pg_dump`，用 `CREATE DATABASE sok_studio_bak_20261013 TEMPLATE sok_studio` 在同一個 cluster 複製（478 MB）。確認不需要後可以 `DROP DATABASE sok_studio_bak_20261013`（要先問使用者）。

## 程式地圖（2b 新增）

| 層 | 檔案 | 內容 |
| --- | --- | --- |
| Domain | `domain/entities/event-record.ts` | `EventRecord`、`FetchEventsQuery`、`DictionaryDrift` |
| Provider | `providers/igdb.ts` | `EVENT_FIELDS`、`toEventRecord`、`fetchEvents`、`checkDictionaryDrift` |
| | `providers/igdb/link-map.ts` | `KNOWN_WEBSITE_TYPE_IDS`、`KNOWN_EXTERNAL_GAME_SOURCE_IDS`、`findNewDictionaryIds` |
| Repository | `repository/relations.ts` | `resolveSimilarGames({ igdbIds? })`、`resolveEventGames({ eventIds? })`（同一把 advisory xact lock 排隊） |
| | `repository/events.ts` | `syncIgdbEvent`（人工活動略過、slug 撞名加 `-{igdbId}`、change_feed） |
| | `repository/game-sync.ts` | `markIgdbGameMissing`；`syncIgdbGame` 結果多了 `releases.sourceChanges` |
| | `repository/games.ts` | `listGamesForRefresh`、`touchLastFullSync` |
| Use Case | `use-cases/sync/resolve-relations.ts` | 全量 `resolveRelations`、回填用 `resolveBatchRelations` |
| | `use-cases/sync/backfill-games.ts` | `--tier 2`（phase `all`，sync_state `igdb_backfill_tier2`） |
| | `use-cases/sync/sync-events.ts` | `syncEvents` |
| | `use-cases/sync/rolling-refresh.ts` | `rollingRefresh`、`isRefreshMiss` |
| | `use-cases/sync/dictionary-drift.ts` | `checkDictionaryDrift` |
| | `use-cases/sync/sync-games.ts` | `WriteContext.onWritten`（每款寫入後的回呼） |
| 任務 | `module.ts` | `sync_events`（`25 */6 * * *`）、`resolve_relations`（`40 4 * * *`）、`rolling_refresh`（`30 3 * * *`，session lock） |
| 工具 | `scripts/probe-igdb.ts` | `npx tsx --import ./scripts/load-env.ts scripts/probe-igdb.ts <endpoint> "<body>"` |

env：`ROLLING_REFRESH_PER_NIGHT`（預設 10000；`infra/.env.example` 已更新）。

## 實跑紀錄（本機開發 DB）

依序執行，全部成功：

1. `resolve_relations`（Tier 1 資料）：相似配對 +334,829，5.6 秒（全量解析的 SELECT 約 0.4 秒）。
2. `sync_events` 第一次（全量）：960 筆活動、event_games 24,035 筆，3.7 秒；第二次（增量）抓到 0 筆，0.7 秒。開始時間為 NULL 的有 4 筆；slug 沒有撞名。
3. 備份 → `backfill_games --tier 2`：**27.5 分鐘**（約 25 批／分鐘），650 批。
   fetched 330,134、inserted 208,885、updated 103,957、只上手機略過 17,292、**failed 0**；
   上市事件新增 287,526、來源重複丟棄 2,575；未知平台 0。結束的全量解析：相似 +589,891、event_games +8,390。
4. `rolling_refresh` 試跑（`ROLLING_REFRESH_PER_NIGHT=1000`）：1000 款 9.5 秒（10000 款估 1.5～2 分鐘）；
   changedGames 0、**rolling_refresh_misses 0**、查不到 0；字典漂移無。

完成後資料庫：遊戲 314,606、上市事件 461,410、相似配對 2,529,496（271,819 款有相似遊戲）、活動 960、event_games 32,425、
公司 58,950、連結 1,033,869、external_ids 155,694；資料庫 1,413 MB。

Phase 2 完成標準（15）的兩項缺口已補：相似遊戲有資料、活動同步。

檢查：typecheck、lint、lint:arch（69 modules，0 violations）、test（11 檔、98 個）全綠。

## 待辦／待使用者處理

- 規格正本（Project）待更新：04 §滾動校對補上 misses 定義與「查不到的遊戲」處理；16 的 `ROLLING_REFRESH_PER_NIGHT` 改 10000；03 §相似遊戲補上刪除舊配對；04 §活動同步補上增量與 change_feed。
- Project 的 `claude/checklist.md` 打勾（2a、2b）。
- 備份資料庫 `sok_studio_bak_20261013` 要不要刪。
