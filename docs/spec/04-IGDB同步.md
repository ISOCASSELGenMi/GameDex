# 04 IGDB 同步

IGDB 是唯一的主資料來源（D1），負責同步：遊戲、平台與家族、硬體上市日、上市事件、活動、公司、系列、類型與主題、相似遊戲、外部連結、在地化名稱、語言支援、IGDB 分數。屬 `catalog`：Provider 在 `providers/igdb.ts`，Use Case 在 `use-cases/sync/`。各數字的實測證據見 91。

## 認證與節流

- OAuth2 Client Credentials：向 `https://id.twitch.tv/oauth2/token` 取 token，有效期內快取。
- 查詢一律 `POST https://api.igdb.com/v4/{endpoint}`，帶 `Client-ID` 與 `Authorization: Bearer`。
- **每秒 4 次、同時最多 8 個未完成請求** ✅，額度綁在憑證上、全應用共用。節流器 = token bucket（4/s）＋ semaphore（8），逾時要釋放名額。回填另限 `BACKFILL_MAX_REQ_PER_SEC`（預設 2），額度留給增量同步。
- **只在伺服器端呼叫**：IGDB 不開 CORS，瀏覽器呼叫也會洩漏 Client Secret。
- Provider 直接用 `fetch`（spike 已驗證），不引入 `igdb-api-node`。
- 頁尾署名「Data from IGDB.com」並連回。
- **授權**：免費僅限非商業（P4）。商業化、開放公開 API、上架 App 前必須重新處理授權；保留「可清除全部 IGDB 衍生資料並重新回填」的能力。風險記錄見 91 §授權。

## 核心查詢

Apicalypse 可用點記法展開巢狀欄位，一個 `games` 請求就帶出公司、系列、連結、上市日，不必逐項另發請求。

```
fields
  name, slug, summary, cover.image_id, first_release_date,
  genres.name, themes.name,
  aggregated_rating, aggregated_rating_count,
  game_type, game_status, parent_game, hypes,
  storyline, version_parent, version_title,
  game_modes.name, game_modes.slug, player_perspectives.name, player_perspectives.slug,
  game_engines.name, game_engines.slug,
  screenshots.image_id, videos.video_id,
  alternative_names.name, alternative_names.comment,
  age_ratings.*, game_localizations.*,
  language_supports.language.locale, language_supports.language.name,
  language_supports.language.native_name, language_supports.language_support_type,
  release_dates.date, release_dates.date_format, release_dates.human,
  release_dates.platform, release_dates.release_region, release_dates.status,
  platforms.id, platforms.name, platforms.slug,
  involved_companies.company.id, involved_companies.company.name, involved_companies.company.slug,
  involved_companies.developer, involved_companies.publisher,
  involved_companies.porting, involved_companies.supporting,
  franchises.id, franchises.name, franchises.slug,
  collections.id, collections.name, collections.slug,
  similar_games,
  websites.url, websites.type, websites.trusted,
  external_games.url, external_games.external_game_source, external_games.uid;
where updated_at > {上次同步的 unix timestamp};
limit 500;
```

🧪 **不可用的欄位**：`category`（games／websites／external_games／release_dates）與 `release_dates.region` 仍可查但全空；單數 `franchise`／`collection` 全空；`follows` 全空。回應太慢時可拆成「核心欄位」與「展開關聯」兩個查詢。

## 各類資料的寫入規則

**公司**：`involved_companies` 每筆看 `developer`／`publisher`／`porting`／`supporting` 四個布林，同一公司兼兩角色就寫兩列。`companies` 以 `igdbId` upsert。

**系列**：`franchises` 與 `collections` 都寫進 `franchises` 表，以 `kind` 區分；詳情頁的「同系列作品」兩種都列。兩者語意差異以官方文件為準 ❓。

**相似遊戲、活動關聯**：只存原始 id（`games.similarIgdbIds`、`events.gameIgdbIds`），再批次解析（03 §相似遊戲）。

**媒體**：截圖取前 6 張、影片取第一支。

**詳情頁補充欄位**（第二輪，03 §詳情頁補充欄位）：`storyline`（字串）→ `games.storyline`；`version_parent`（整數 IGDB id）、`version_title`（字串）→ `games.version_parent_id`／`version_title`；`game_modes`、`player_perspectives`、`game_engines` 展開 `name`／`slug` → 各自的分類表 upsert（以 `igdb_id`）與關聯表整組取代（寫入邏輯唯一在 `replaceDetailRelations`，完整同步與只更新模式共用）。部分遊戲沒有 `game_engines`、`storyline`，視為空。這些欄位**不寫 `change_feed`**，也不推進 `updated_at`／`last_full_sync_at`（只更新模式見 §詳情欄位回填）。增量同步、既有回填與滾動校對的 `GAME_FIELDS` 都自動帶新欄位。

**在地化名稱**：`alternative_names` 用於**搜尋**（寫進 `searchText`）；顯示名稱的解析鏈見 06 §多語系。

**IGDB 分數**：見 05。

**外部連結**：`websites`（官網、社群、媒體，也含部分商店）與 `external_games`（商店）都轉成 `game_external_links`。對照表放 `providers/igdb/link-map.ts`，以字典 id 為鍵：

| 來源 | id → `categoryLabel`（`linkType`） |
| --- | --- |
| `websites.type` | 1 `official_website`（official）；2 `community_wiki`、3 `wikipedia`、6 `twitch`、9 `youtube`（media）；4 `facebook`、5 `twitter`、8 `instagram`、14 `subreddit`、18 `discord`、19 `bluesky`（social）；13 `steam`、16 `epic`、17 `gog`、22 `xbox_store`、23 `playstation_store`、24 `nintendo_eshop`、12 `google_play`、10／11 `app_store`、15 `itch`、25 `meta`、26 `gamejolt`（store） |
| `external_games.external_game_source` | 1 `steam`、5 `gog`、26 `epic`、36 `playstation_store`、31 `xbox_store`、11 `microsoft_store`（store）；3 `giantbomb`、10 `youtube`、14 `twitch`（media）；121（IGDB 自己）略過 |

- **商店在兩個陣列會重複，網址不一定相同**（`websites` 的網址常多帶 slug）。去重鍵是 `(gameId, categoryLabel)`，`websites` 的網址優先。
- **Steam 的 `external_games.uid` 就是 AppID**：寫進 `external_ids`（`source='steam'`、`confidencePct=100`），供 Steam 遊戲庫匯入精確比對（09）。
- Nintendo eShop 只在 `websites`（24）。
- 手機商店（`google_play`、`app_store`）照存，但因不收手機平台，前台預設不顯示。
- 未收錄的 id → `categoryLabel='other'`、`linkType` 依來源陣列（`websites` → official、`external_games` → store），記警告 log。
- **漂移偵測**：每晚同步前抓 `website_types` 與 `external_game_sources` 字典比對，出現新 id 就寫警告 log。

## 上市日 diff 同步

逐筆 upsert 收到的資料，抓不到「來源把某筆拿掉了」：用 `date` 範圍條件查 `/release_dates` 時，被拿掉的列根本不會出現（D6、D-Bug2）。所以**依遊戲分組，對每款遊戲做完整 diff**：

```
1. 拿到這次同步的遊戲（含展開的 release_dates）
2. 對每款遊戲：
   a. 查出既有、source='igdb' 的 release_events（人工列不動）
   b. 以 (platform, region, stage) 比對：
      - 資料庫沒有 → 新增
      - 日期或精度不同 → 更新、寫 release_date_history、依狀態機更新 status、sequence + 1
   c. 既有但這次沒看到：
      - 這款遊戲這次是以核心查詢完整展開 → 標 source_status = 'removed'
      - 否則（例如只用日期窗口查詢）→ 只在「日期原本落在這次查詢窗口內」時標 removed，窗口外不動
3. 同一 transaction 內寫 change_feed
```

- 🧪 展開 `release_dates` 會帶回 `date` 為空（TBD）的列，且不截斷（單款最多 22 筆）。所以 `tbd` 列也納入 removed 判斷；單款展開超過 22 筆時記警告 log（不停止）。
- **例外**：同一 (platform, region) 原本只有一筆 `unspecified`，來源之後給了具體階段 → 視為同一筆更新，不是新增＋removed。
- `removed` 不等於取消（D7）：網站繼續顯示並加註「資料來源待確認」，不從訂閱消失。
- 這個 diff 只涵蓋未來；歷史日期被修正由 §滾動校對 負責。

### 日期正規化

`date` 一律當 **UTC** 日期（🧪 day 格式是 UTC 午夜，轉時區會差一天）。Provider **依 `date_format` 與 UTC 年／月自己算期間**，不照抄 IGDB 的 `date`；月底天數與閏年用曆法函式算。

| `date_format` | 精度 | `releaseDate`（代表日期，P24） | `periodStart` |
| --- | --- | --- | --- |
| 0 YYYYMMDD | `day` | 當日 | 當日 |
| 1 YYYYMM | `month` | 當月第一天 | 當月第一天 |
| 2 YYYY | `year` | 當年 12-31 | 當年 01-01 |
| 3／4／5／6 YYYYQ1~Q4 | `quarter` | 該季最後一天 | 該季第一天 |
| 7 TBD | `tbd` | NULL | NULL |
| 其他 | `tbd` | NULL（記警告） | NULL |

- **為什麼月取第一天、季／年取最後一天**：月精度的遊戲通常月初前就會公布確切日期；季、年不會，取最後一天才不會在期間結束前就從「今天以後」的查詢（公開 iCal、Discord）消失。
- **預期行為**：月精度過了月初還沒確切日期，會從「今天以後」的查詢消失；網站詳情頁與月曆「本月未定日」區仍會列出。
- 人類可讀標籤（「2026 Q4」）由我方依語系產生，不用 IGDB 的 `human`。

### 地區對照

來源欄位是 `release_dates.release_region`（`release_date_regions` 字典）：

```typescript
const IGDB_RELEASE_REGION_TO_CODE: Record<number, string> = {
  1: "EU", 2: "US", 3: "AU", 4: "AU",   // 4 紐西蘭併入 AU
  5: "JP", 6: "CN", 7: "ASIA", 8: "WW", 9: "KR", 10: "BR",
};
```

沒對到 → `WW`。IGDB 沒有 `TW`，由管理介面人工補登。⚠️ `game_localizations.region` 用的是**另一個** id 空間（`regions` 字典），同一個數字意義不同，不可混用。

### 上市階段對照

| IGDB `release_dates.status` | 我方 |
| --- | --- |
| 6 Full Release | `full` |
| 3 Early Access | `early_access` |
| 2 Beta | `beta` |
| 1 Alpha | `alpha` |
| 34 Advanced Access、35 Digital Compatibility Release、36 Next-Gen Optimization Patch Release、4 Offline | `other`（我方判斷，預設隱藏） |
| 5 Cancelled | `unspecified`＋`status='cancelled'`（P22）；改回非 5 視為復原 |
| 空值、未知值 | `unspecified`（不預設 `full`） |

- 過半上市日沒有狀態，預設可見清單必須包含 `unspecified`（`CALENDAR_VISIBLE_RELEASE_STAGES`，預設 `unspecified,full,early_access`）。
- `demo` 沒有 IGDB 對應，只來自人工補登或回報。

### 遊戲層級狀態 `game_status`

| IGDB | 我方 `gameStatus` | 處理（P23） |
| --- | --- | --- |
| 0 Released | `released` | 不用來判斷已上市（筆數極少），已上市以 `release_events` 為準 |
| 2 Alpha、3 Beta、4 Early Access | 同名 | 不另處理 |
| 5 Offline、8 Delisted | `offline`、`delisted` | 不影響月曆 |
| 6 Cancelled | `cancelled` | 該遊戲 `releaseDate >= 今天` 的上市列標 `cancelled`、`sequence + 1`、寫 `change_feed`；已過期的不動 |
| 7 Rumored | `rumored` | 月曆、時間軸、公開 iCal、Discord 預設不顯示（`gameStatus IS DISTINCT FROM 'rumored'`）；詳情頁可進入並標「傳聞」 |
| 空值 | NULL | 一般狀態 |

### 遊戲類型

`games.gameType` 存我方名稱。月曆、公開 iCal、Discord `/upcoming` **預設只顯示** `CALENDAR_VISIBLE_GAME_TYPES`（預設 `main_game,standalone_expansion,remake,remaster,port`），其餘照存但不出現在預設檢視；DLC 類改列在本體遊戲詳情頁。

| IGDB id | 我方名稱 | 預設 |
| --- | --- | --- |
| 0 | `main_game` | 顯示 |
| 4 | `standalone_expansion` | 顯示 |
| 8 | `remake` | 顯示 |
| 9 | `remaster` | 顯示 |
| 11 | `port` | 顯示 |
| 1 | `dlc_addon` | 隱藏 |
| 2 | `expansion` | 隱藏 |
| 3 | `bundle` | 隱藏 |
| 5 | `mod` | 隱藏 |
| 6 | `episode` | 隱藏 |
| 7 | `season` | 隱藏 |
| 10 | `expanded_game` | 隱藏（語意 ❓） |
| 12 | `fork` | 隱藏 |
| 13 | `pack` | 隱藏 |
| 14 | `update` | 隱藏 |
| 其他 | `other` | 隱藏 |

### 自動轉 released

不另設排程，每次 `sync-games` 順便執行；不寫 history、不加 sequence（日期沒變）。模糊日期不自動轉。

```sql
UPDATE release_events SET status = 'released', updated_at = now()
WHERE status IN ('scheduled', 'delayed') AND precision = 'day' AND release_date <= CURRENT_DATE;
```

## 增量同步

- 查 `games.updated_at > {上次}`，進度存 `sync_state`（`jobName='igdb_games'`），寫回**任務開始時間**，避免漏掉執行期間的變動。回填用獨立的 `igdb_backfill`。
- 🧪 編輯上市日會推進 `games.updated_at`（證據一致但非證明，見 91），所以不必另外輪詢 `release_dates.updated_at`。**刪除**上市日是否推進未驗證，由滾動校對兜底。
- **webhook 只當觸發器**（D64）：通知內容的關聯欄位只有 id 陣列，收到後累積 id、批次重抓（每批最多 500）再 diff；以 `(id, updated_at)` 去重；驗證 `X-Secret`（常數時間比對，不符回 401），事件類型看 `X-Operation`。**第一版用輪詢**，webhook 是優化項。

## 回填

以 500 筆／請求計，全量回填是分鐘到小時級的工作（實際速度以實測為準）。

| 階段 | 範圍 | 時機 |
| --- | --- | --- |
| Tier 1 | (a) `first_release_date >= 今天往前 BACKFILL_LOOKBACK_YEARS 年`（預設 3）；(b) `first_release_date = null & release_dates != null & game_type = (白名單)` | Phase 2a |
| Tier 2 | 歷史全量，限白名單類型；`where id > {cursor} & game_type = (…); sort id asc; limit 500;` | Phase 2b |
| Tier 3 | DLC、合集、mod 等其餘類型 | 後置；完成前詳情頁 DLC 區顯示空 |

- Tier 1 的 (b) 刻意排除「連一筆上市日都沒有」的遊戲（D62），它們由 Tier 2 補上。
- 每批在一個 transaction 寫完才更新 `cursor`，中斷可續傳。
- 回填只 upsert，不做 removed 判斷。
- 以一次性 container 執行（`docker compose run --rm`，不對外開 5432），先備份。
- 手機平台（`platformKind='mobile'`）的上市日不寫入 `release_events`；只上手機的遊戲不收（P35）。

### 詳情欄位回填 `backfill_detail_fields`

新欄位上線時資料庫裡已有約 31.7 萬款遊戲，不能等增量同步慢慢補，所以有一個**只補這 9 個欄位**的手動任務（Z4，2026-10-23）：

- 執行：`npm run job -- backfill_detail_fields [--max-batches N] [--restart]`；`lockMode: "session"`、手動、無 cron；速率沿用 `BACKFILL_MAX_REQ_PER_SEC`（預設 2）。
- 分批：依 `games.igdb_id` 升冪、每批 500 款：`SELECT igdb_id FROM games WHERE igdb_id > {cursor} ORDER BY igdb_id LIMIT 500` → `fetchGames({ ids, fieldSet: "detail", limit: 500 })`（`where id = (...)`，只取 `GAME_DETAIL_FIELDS`）→ `writeGameBatch(..., { detailOnly: true })`。來源沒回的 id 略過；資料庫沒有的遊戲不會被請求。`detailOnly` 沒有另開寫入路徑，也不套用手機平台過濾（既有遊戲在首次寫入時已過濾，且此欄位集不含平台）。
- 只更新模式（`syncGameDetailFields`）：只寫上述欄位與三個關聯表；`updated_at` 與 `last_full_sync_at` 保持不變（`updated_at` 有 `$onUpdate`，所以明確寫回自身值），不寫 `change_feed`。
- 續跑：進度存 `sync_state[igdb_backfill_detail].cursor`（JSON `{ afterId, done, startedAt }`），`meta.totals` 累計；每批寫完才推進，中斷後再執行即從 cursor 續跑；`--restart` 從頭；`--max-batches` 分段。單款失敗記在 `meta.totals.failedIgdbIds`（上限 500），有失敗時任務結尾丟錯，但 cursor 已推進。
- **實測**（開發 DB，2026-10-23）：316,955 款 → 634 批，16.5 分鐘，0 失敗；結果 storyline 31,208 款、遊戲人數關聯 315,710 筆、引擎關聯 89,153 筆。瓶頸在資料庫寫入（每款一個 transaction），不是速率限制。事前估計 20～45 分鐘，實際較快。

### 顯示名稱重算 `recompute_display_names`

`games.display_names` 只在同步時計算（06 §遊戲名稱解析鏈），名稱規則改動後舊資料不會自動更新。手動任務：`npm run job -- recompute_display_names [--batch-size N]`（預設 1,000；`lockMode: "session"`、無 cron）。依 id 遞增掃全庫，用與同步相同的 `resolveDisplayNames` 重算，**只更新與現值不同的列、只寫 `display_names`**（不碰 `search_text`、`updated_at`、`change_feed`，不打 IGDB）；每批一個 transaction，結束 log 掃描／更新／移除 zh-Hant 的數量；冪等。2026-10-18 以同一邏輯的腳本對開發 DB 重算過一次（1,693 款補上 zh-Hant）；任務本身尚未在開發 DB 執行過。

### 分組欄與代表上市列 `backfill_game_groups`（Z6）

`games.release_group`、`games.publisher_group` 與 `release_picks`（03）都是預先計算的資料，由寫入路徑在同一個 transaction 內維護：
- `upsertGame`／`syncIgdbGame` 寫入首發日期或精度時重算 `release_group`；`syncIgdbGame` 寫完公司後重算 `publisher_group`。
- `applyReleaseDiffPlan`（有新增或更新時）與 `upsertReleaseEvent` 呼叫 `refreshReleasePicks`，重算該遊戲的代表上市列。
- 直接寫 `release_events`、繞過上面兩個路徑的程式要自己補 `release_picks`。

全庫補值用手動任務：`npm run job -- backfill_game_groups [--max-batches N] [--batch-size N] [--restart]`（`lockMode: "session"`、無 cron、不打 IGDB，但 catalog 模組啟動時仍檢查 IGDB 環境變數）。依 id 遞增分批，進度存在 `sync_state`，可續跑，結束時對 `games` 與 `release_picks` 跑 VACUUM ANALYZE。migration 0015 之後必須跑一次；跑完之前 `/games?by=date｜publisher` 會把所有遊戲歸成一組，平台頁「全部遊戲」會偵測到回填未完成，自動退回即時聚合。2026-10-24 在開發 DB 實測：316,955 款、317 批、408 秒，更新 239,208 款，`release_picks` 寫入 416,375 列。

### 公司順序 `backfill_company_positions`（D88）

`game_companies.igdb_position`（03）記錄公司在 IGDB `involved_companies` 陣列中的位置（0 起算）：`syncIgdbGame` 寫入公司時一併寫入，`publisher_group` 重算時同角色取位置最小者。migration 0017 前的既有列位置是 NULL，這時整款退回「名單欄位順序最後者」，所以未回填前行為與以前相同。

全庫補值用手動任務：`npm run job -- backfill_company_positions [--max-batches N] [--restart]`（`lockMode: "session"`、無 cron、**會打 IGDB**，需要 IGDB 金鑰）。依 id 遞增，每批 500 款只抓 `involved_companies`，一個 transaction 內補位置並重算 `publisher_group`；進度存在 `sync_state`（`igdb_backfill_company_positions`），可續跑，`--restart` 從頭來；重跑冪等。

## 平台同步

每日一次，整表重抓 `platforms`、`platform_families` 與平台版本上市日（`platform_versions` → `platform_release_dates`，同平台同地區取最早）。`platform_type` 轉 `platformKind`，未知 → `other`。`source='manual'` 不覆蓋。

## 滾動校對

每晚挑 `games.lastFullSyncAt` 最舊的 `ROLLING_REFRESH_PER_NIGHT` 款，以 id 清單（每請求 500 個）重抓並更新 `lastFullSyncAt`，可做 removed 判斷（條件同 diff）。不依賴任何 IGDB 行為假設。

**監控**：記錄「日期與資料庫不同、且不在最近增量名單內」的筆數（`rolling_refresh_misses`，寫入 `sync_state.meta`）。長期為 0 → 輪詢夠用；不為 0 → 加 `release_dates.updated_at` 輪詢。

## 活動同步

`events` endpoint，欄位 `name, description, start_time, end_time, time_zone, event_logo.image_id, live_stream_url, games`。

- `time_zone` 是縮寫（PST、JST…），有歧義，**只存供顯示，不可計算時間**；時間以 `start_time`／`end_time`（unix timestamp）為準。
- `games` 存原始 id，批次解析成 `event_games`。
- `kind`（發表會／展會／頒獎）與 `seriesId` IGDB 沒有，由管理員標註；`source='manual'` 的活動不被覆蓋或刪除。
- IGDB 移除的活動目前沒有偵測機制（已知限制）。

## 併發保護

**每個排程任務都用 Postgres advisory lock 包住**，由 kernel 統一處理（02 §排程），鎖名 = `job.name`，各任務各自一把。

- **一般任務：transaction-scoped**（`pg_try_advisory_xact_lock`）。連線池不保證加鎖與解鎖用同一條連線，session-level 鎖可能卡住（D9、D-Bug4）。拿不到鎖 = 另一個實例在跑，安靜跳過。
- **長任務（回填、滾動校對）：專屬連線＋session lock**。transaction 全程握住會讓連線長時間 `idle in transaction`，若設了 `idle_in_transaction_session_timeout`，鎖會中途被釋放。自己 `pool.connect()` 取一條連線，加解鎖同一條即可；連線中斷鎖自動釋放。
- 鎖 key 用雙參數 `(int4, int4)` 版本，避免 JS 53-bit 整數問題。連線池至少 2 條。

```typescript
async function withSessionLock(name: string, fn: () => Promise<void>): Promise<boolean> {
  const client = await pool.connect();
  try {
    const [k1, k2] = lockKeyPair(name);
    const { rows: [{ locked }] } = await client.query("SELECT pg_try_advisory_lock($1,$2) AS locked", [k1, k2]);
    if (!locked) return false;
    try { await fn(); } finally { await client.query("SELECT pg_advisory_unlock($1,$2)", [k1, k2]); }
    return true;
  } finally { client.release(); }
}
```

## 資料來源介面

IGDB 授權範圍未完全確認，所以主資料也要有退路（D45）：

```typescript
interface GameDataProvider {
  readonly sourceName: string;   // 'igdb'
  fetchGames(q: { updatedSince?: Date; afterId?: number; ids?: number[]; limit: number }): Promise<GameRecord[]>;
  fetchPlatforms(): Promise<PlatformRecord[]>;
  fetchEvents(q: { updatedSince?: Date }): Promise<EventRecord[]>;
}
```

`GameRecord` 是 Domain 聚合型別；所有 IGDB 原始格式在 Provider 內轉換。同步、回填、校對只依賴這個介面。換來源仍是遷移專案（新 Provider → 用 05 的比對對應既有遊戲 → 逐步切換 → 屆時才把 `igdbId` 放寬為可 NULL），不是改一個檔案；為此重構全庫 schema 不划算。

## 排程任務

| 任務 | 頻率 | 鎖 |
| --- | --- | --- |
| `sync_games` | 每小時 | tx |
| `sync_events` | 每 6 小時 | tx |
| `sync_platforms` | 每日 | tx |
| `resolve_relations`（相似遊戲、活動關聯） | 每日＋回填每批後 | tx |
| `rolling_refresh` | 每晚 | session |
| `backfill_games` | 手動 | session |
| `backfill_detail_fields`（詳情欄位回填） | 手動 | session |
| `recompute_display_names` | 手動 | session |
| `backfill_game_groups`（分組欄與代表上市列，migration 0015 後跑一次） | 手動 | session |
| `backfill_company_positions`（公司順序，migration 0017 後跑一次，打 IGDB） | 手動 | session |
| `publish_player_ratings`（`accounts`，09） | 每小時第 27 分 | session |
| `refresh_popularity` | 每小時／每日（03 §熱度） | tx |
| `check_external_links`（失效連結） | 每週 | tx |

頻率是建議值，上線後依額度與資料新鮮度調整。
