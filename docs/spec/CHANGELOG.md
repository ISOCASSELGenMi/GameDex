# CHANGELOG

## 搜尋候選兩段式（2026-10-29 寫回；repo 副本先改，Project 正本待使用者匯入）

- 06：§導覽與 header 搜尋候選說明加兩段式；§已知限制「搜尋候選」改寫：短字（≤ 3 字元）先在熱度最高 3000 筆內找、找滿 120 筆才用、不足退回全表，附實測數字、代價與「窗口內排序（熱度、名稱、id）與全表（熱度、id）在同熱度邊界可能差一筆」的已知差異。
- 07：`GET /api/v1/games/suggest` 候選池說明加短字兩段式。無 migration、無 API 形狀變更。

## HTML 瘦身（2026-10-29 寫回；repo 副本先改，Project 正本待使用者匯入）

- 06：§評分排名移除「篩選面板只列常用平台」，改列完整平台清單（HTML 166～173 KB）；§瀏覽與搜尋 HTML 預算加「大量清單用緊湊列」、2026-10-29 全站實測數字、鎖預算的測試與量測腳本；§已知限制劃掉評分排名／`/trending` 兩項，新增「月曆頁 HTML 隨月份差很大」（待使用者決定是否限制未定日清單顯示量）。

## GameDex 第二輪 Z6 效能（2026-10-24 寫回；repo 副本先改，Project 正本待使用者匯入）

- 03：`games` 加預先計算欄 `release_group`、`publisher_group`；新增 §代表上市列 `release_picks`（規則與聚合共用、寫入路徑同 transaction 維護、繞過寫入路徑者要自己補）；索引總表加 0015、0016 的瀏覽用 index（含依語系的顯示名稱表達式 index，新增語系要補）；表歸屬加 `release_picks`。
- 04：新增 §分組欄與代表上市列 `backfill_game_groups`（維護路徑、手動回填、可續跑、開發 DB 實測 408 秒）；排程任務表加一列。
- 06：§全部遊戲與分組檢視註明組 key 預先計算；§平台頁的「全部遊戲」註明先用 `release_picks` 決定頁面、退回即時聚合的條件；§瀏覽與搜尋加 HTML 預算與做法（核取方塊 HTML 字串、精簡卡片、熱度 sprite、`DESC NULLS LAST`）；§已知限制劃掉已解決的三項。
- 16：部署檢查清單加 0015、0016 與 `backfill_game_groups` 的順序與回填前的行為。
- 90：D87 代價欄更新為 Z6 的結果與代價，含兩個 index 先不加、實測後在 0016 加回的經過。
- 15：GameDex 後續待辦劃掉已由 Z6 解決的兩條（分組與平台頁查詢時間、`/games` 不分組 HTML）。

## GameDex 第二輪（2026-10-23 寫回；repo 副本先改，Project 正本待使用者匯入）

- 06：路由表新增 `/ratings`、`/games?by=`、平台頁 `section=all`，註明沒有 `/releases`；§首頁（最新上市查看更多連時間軸 30 天前所在週、熱門分頁兩組同時 SSR）；§導覽與 header 改為已實作的 Holodex 式（依區塊切換品牌名、導覽／主題／語言／帳號四個下拉、搜尋候選 combobox、窄螢幕搜尋圖示）；§月曆新增遊戲／活動開關 `?show=`；§活動時間單行＋時區已實作；新增 §全部遊戲與分組檢視、§評分排名、§平台頁的「全部遊戲」、§互動背景、彩蛋與隱藏主題；§遊戲詳情頁重寫（公司三欄、About 資訊格、相關內容與版本標註）；新增 §已知限制；篩選表 `show` 與後置維度更新。
- 07：新增 `GET /api/v1/games/suggest`、`/games/group`、`/ratings/ranking`、`/auth/public-config`、`GET|POST /me/unlocks`；`calendar/day` 的 `show` 語意；`account/summary` 追蹤數只算遊戲；匯出 JSON 加 `unlocks`；註明舊 `/api/timeline*` 與 `/releases/column` 已刪除。
- 03：`score_provider` 加 `site_players`（玩家平均複製進 ratings）；`games` 加 `storyline`、`version_parent_id`、`version_title` 與索引 `games_parent_type_idx`、`games_version_parent_idx`、`games_lower_name_prefix_idx`；新增 `game_modes`、`player_perspectives`、`game_engines` 與三張關聯表；accounts 新增 `user_unlocks`＋`unlock_type`；索引總表與表歸屬同步（migration 0012～0014）。
- 04：`GAME_FIELDS` 新增 9 個詳情欄位；新增 §詳情欄位回填 `backfill_detail_fields`（實測 634 批、16.5 分、0 失敗）與 §顯示名稱重算 `recompute_display_names`；排程任務表加三列（含 accounts 的 `publish_player_ratings`）。
- 02、05：manifest 加 `ratingColumns` 擴充點；05 註明 `site_players` 只給評分排名頁。
- 09：玩家平均寫進 `ratings`（`publish_player_ratings`）；新增 §解鎖紀錄、收藏與成就（聯集同步、成就判定、帳號頁區塊、匯出與刪除）；摘要追蹤數只算遊戲。
- 15：新增 GameDex 第二輪待辦（效能與預算）。
- 90：新增 D87。
- `docs/design/easter-eggs.md`、`publisher-groups.md` 已於實作時更新，不屬規格章節。

## v2.1（2026-10-15，Phase 4 實作後同步；repo 副本先改，Project 正本待使用者匯入）

- 05 `normalizeTitle`：先移除 `™®©` 再 NFKC、NFKC 後才轉小寫（原範例 NFKC 會把 ™ 轉成 "TM"）。
- 05 顯示規則：分數區永遠顯示、無分數欄位留白（D74）；站長隱藏 igdb 時的預設來源。
- 12：IGDB 同鍵日期更新覆蓋人工更正（D75）；manual 列 sequence 下限；詳情頁隱藏同鍵 igdb 列；回報類型與目標組合；每 IP 上限為滾動 24 小時；IP HMAC 雜湊與 90 天清除；缺設定時 503／404 行為；管理頁 CSRF。
- 03：`data_reports` 新增兩個索引；`source` 規則加 D75 例外。
- 15：Phase 4 完成標準配合 D74、D75。
- 06：詳情頁評分區與上市日列表配合上述規則。
- 16：新增 `REPORT_IP_HASH_SECRET`、`TURNSTILE_VERIFY_URL`。
- 90：新增 D74、D75。
- 03、07、09、16、90（Phase 7 Better Auth，2026-10-16）：users／connected_accounts 改為 Better Auth 對應（email NOT NULL＋placeholder、email_verified boolean、provider varchar、密碼併入 connected_accounts、刪 password_credentials、新增 sessions／auth_verifications、auth_tokens 縮小）；07 認證端點改為 BA 原生路徑；16 新增 ACCOUNTS_SIGNUP_ENABLED、MICROSOFT_*；90 新增 D77～D81。
- 08、90（Phase 5 原型實測，2026-10-16）：Google 抓取間隔、Apple 手動重新抓取、聚合 UID 換地區不重複（D26 成立）、兩個客戶端都不依賴 SEQUENCE、TENTATIVE 無視覺差異、取消在 Google 移除／Apple 刪除線。
- 06、90（GameDex 第一輪待決，2026-10-18 寫回）：06 §首頁近期活動限進行中＋30 天內、近期熱門分頁切換即將上市／已上市，帳號總覽追蹤數只算遊戲；90 新增 D86。
- 06、07、16、90（GameDex 第一輪改版，2026-10-18 寫回）：06 路由表加首頁、月曆與時間軸新網址、帳號殼與 Steam 分頁，新增 §首頁、§導覽與 header，重寫 §月曆（一日一格一款、day API）與 §時間軸（週視圖），活動時間改本地時區，平台分組 hybrid 雙掛；07 新增 `calendar/day`、`timeline/week`、`account/summary`；16 新增 `ORG_HOME_URL`、`ORG_NAME`；90 新增 D84（第一輪）、D85（第二輪決定）。
- 02、06、07（Phase 7 第 5～7 波與 D83，2026-10-17）：02 slot 清單加 `entity.actions`、`subscribe.private`；06 路由表改為實際的 `/account/*`（lists、plays、follows、games、calendar、settings、privacy、deleted）與公開清單 `/lists/[id]`、`/lists/s/[token]`；07 補 lists、play-records（含 platform、stats）、me/games、player-ratings、follows（state、count）、calendar feeds、account（刪除重新驗證、匯出、偏好）、imports 手動指定與 games/search，connections 改由 Better Auth 端點提供，停權者寫入 403。
- 03、07、09、16、90（Phase 7 第 3 波 Steam，2026-10-17）：`owned_games` 的 `matched_game_id` FK 為 ON DELETE SET NULL（手寫於 migration）、`imported_at` NOT NULL、新增兩個索引、比對狀態語意；07 Steam plugin 發起改 POST 回 `{url}` 與錯誤碼、`POST|GET /api/v1/imports/{provider}` 的狀態碼與回應；09 比對流程（`after()`＋`match_owned_games`）、冷卻、匯入時重比找不到的列、消失的遊戲保留；16 `STEAM_WEB_API_KEY` 改選填；90 新增 D82。
- 03／08（Phase 5）：`events` 新增 `sequence` 欄位；活動同步只在欄位實際變動時更新 `updated_at`，iCal 活動 SEQUENCE 改讀該欄位（不再數 change_feed）。

## v2.0（2026-10-12）

### 結構

- 單一文件（v1.2，約 4,350 行）拆成 20 份，依模組分檔；見 00 的文件地圖與 v1.2 章節對照。
- 刪除 293 個版本標記與「v1.0 的缺陷是…」等修訂歷史敘述；正文只留現行規則。
- spike 筆數、樣本、推論過程與授權審閱移到 91；正文只留結論。
- 產品決策 `0.5-1`～`0.5-25` 改編號為 `P1`～`P25`（同號對應），新增 P26～P45。
- 決策紀錄 D1～D65 精簡為一行一條；D2 標作廢；新增 D66～D73。
- 測試策略依領域重整，不再依版本分段。

### 修正 v1.2 的矛盾與過時內容

| 位置（v1.2） | 問題 | 修正 |
| --- | --- | --- |
| 3.2.13 註記 | 寫「token 只出現一次、只存 hash」，與 D34 衝突 | 改為加密保存可再顯示（08） |
| 4.1.7 | 活動關聯「不存在就跳過」，與 3.2.8／D24 衝突 | 改為存原始 id 批次解析（04） |
| 4.2.4 | 仍寫「交給 fallback chain 退到 IGDB」，4.2.2 已作廢 fallback chain | 改為「回 null、該來源不產生資料」（05） |
| 4.5.1 表格、D12 | Google 更新間隔「8~12 小時」，同節下段已更正為 8~24 | 統一為 8~24（08） |
| 7.4 | `/ical/*` 不快取，與 4.5.8 的公開 feed 5 分鐘衝突 | 公開 feed 5 分鐘、私人不快取（16） |
| 4.8.11／4.8.12 | 語系 cookie 名稱 `locale` 與 `sok_locale` 兩種寫法 | 統一 `sok_locale` |
| 4.9.4、4.9.6 | 搜尋參數寫 `search=`，4.8.15 是 `q=` | 統一 `q` |
| 4.9.4 | 上市日 cursor 用 `release_date`，與 4.8.9 的 `period_start` 不一致 | 統一 `period_start` |
| 3.2.17 | `periodStart` 需要索引但不在索引總表 | 補上 |
| 4.5.7 | 引用「3.2.14」的 partial unique，實際在 3.2.13 | 改為連到 03 |
| 目錄 | 寫 D1～D58，實際到 D65 | — |
| 6 Phase 2、4.1.11 | 「動工前跑第二輪 spike」「第二輪 spike 會量測」，已完成 | 刪除 |
| 3.2.20 | 「列入寄給 IGDB 的問題（T01）」，已決定不寄 | 改列 91 未完成項目 |
| 4.1.3 | 稱 `game_status` 樣本全空，第 2 輪已量到 8% 有值 | 以第 2 輪為準 |

### 併入功能需求規劃書（2026-10-12）的修改

| # | 項目 | 文件 |
| --- | --- | --- |
| 1 | 產品邊界改為「不把玩家評分混進專業評分」，取代「不自建評分」；玩家平均另列 | 01、05、09 |
| 2 | 登入新增 Discord、Twitch、Twitter(X)、Email＋密碼；`password_credentials`、`auth_tokens` | 03、09 |
| 3 | 清單可見度三態（公開／僅連結／私人），預設私人；清單排序與說明 | 03、09 |
| 4 | 遊玩紀錄 `play_records`（狀態、平台、起訖、耗時、半分評分、評論、私人筆記，可多筆） | 03、09 |
| 5 | 追蹤泛化為 `follows`（遊戲、活動、平台、系列、公司），取代 `followed_games`；私人 iCal 依此擴充 | 03、08、09 |
| 6 | 通知新增 Discord 私訊管道、事件類型、即時／彙整；預設提醒改為前 7 天與當天 | 11 |
| 7 | Discord：`/game`、`/event`、`/calendar`、`/follow`、`/setup`、`/role`、定時公告、伺服器共同追蹤、反應身分組 | 03、10 |
| 8 | Discord 活動可針對活動與頒獎典禮建立；網站也有按鈕 | 03、10 |
| 9 | 頒獎資料：`award_categories`、`award_nominees`（新模組 `awards`） | 13 |
| 10 | 活動新增 `kind`、`slug`、`organizer`、`event_series` | 03、04、06 |
| 11 | 不收手機平台 | 01、03、04 |
| 12 | 社群：評論按讚、追蹤用戶、動態、封鎖、檢舉（新模組 `social`） | 13 |
| — | 10.3 三項決定：新模組歸屬（P43）、管理角色時機（P44）、玩家評分另列（P45） | 01、02、09、12 |

### 拆分時我做的設計選擇（請檢查）

- `ratings` 唯一約束改用 v1.2 已提出的 `UNIQUE NULLS NOT DISTINCT`，取代兩個 partial index（D72）。
- `discord` 模組改為依賴 `accounts`，網站按鈕由網站後端呼叫 Discord REST（D71）。
- Discord 私訊由 `notifications` 發送（D73）。
- 評論存在 `play_records`，`social` 不另存（D67）；動態首版讀取時即時查詢，不建表。
- 追蹤平台／系列／公司時，通知只發「日期確定」與「取消」；私人 iCal 對這三類套 90 天視窗與事件上限，避免洗版。
- 新增環境變數 `PLAYER_RATING_MIN_COUNT`（預設 5）、`AUTH_SECRET`、各 OAuth 憑證。
- 新增建議值：IGDB 同步各任務頻率（04 排程表）、伺服器共同追蹤上限 200、Bot 建立的遊戲身分組上限 50。
- 篩選新增 `minScore`、`show`、`rumored`、`mine=collected|list:<id>`（對應需求書 FR-CAL-00）。
- 刪除 Phase 0 的 `cheerio` 安裝（只在 Metacritic 需要，Phase 6 再依實際格式決定）。

### 待產品擁有者決定（新產生）

- 依篩選條件產生公開 iCal（FR-ICAL-02）與 P13「不做匿名自訂 feed」衝突。
- 用戶追蹤名單是否公開。
- 新帳號的評論是否先不公開。

## v1.2（2026-10-05～10-08）

取消 RAWG；IGDB spike 四輪結果併入；評分來源由使用者選擇；上市日 Cancelled 對照；遊戲層級狀態；代表日期規則（月第一天、季／年最後一天）與 `periodStart`；webhook 實測；Slice 0 範圍；不寄信給 IGDB。

## v1.1

定位改為資料庫優先；平台資料化；功能模組化與 CI 邊界檢查；多語系完整規格；熱度、上市階段、資料更正回報、通知、無障礙、營運基礎；篩選模型；語言支援；查證清單逐項處理。

## v1.0

初版規格。
