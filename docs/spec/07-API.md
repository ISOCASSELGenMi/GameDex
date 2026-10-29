# 07 API（`/api/v1/*`）

給 Discord Bot、未來的 App 與網站的客戶端互動（追蹤、收藏等）使用，回傳乾淨的 JSON。**網站頁面的伺服器端渲染不經這層**，直接呼叫 Repository／Use Case。

- **Slice 0 不對外開放公開端點**（P4、P25）；Bot 用的內部端點與網站自己的互動端點照常。
- **一致性**：評分顯示（05）、聚合規則（06）、篩選（06）、日期與名稱格式化，頁面與 API 呼叫同一份函式（原則五、D-Bug7）。

## 端點

**公開（catalog）**

```
GET  /api/v1/games?q=&<篩選>&sort=popularity|release_date|name|trending&limit=&after=
GET  /api/v1/games/{slug}                 含 releases、ratings（站長層允許的全部來源）、primaryRating、userScore、
                                          heat: { level, followerCount }（低於門檻為 null）、
                                          languages、languageDataAvailable: { interface, subtitles, audio }、links
GET  /api/v1/releases?from=&to=&<篩選>&sort=date|popularity&limit=&after=    範圍 ≤ 366 天，超過回 400
GET  /api/v1/release-events/{id}
GET  /api/v1/events?kind=&from=&to=
GET  /api/v1/events/{slug}
GET  /api/v1/platforms | /platforms/{slug} | /companies/{slug} | /franchises/{slug}
GET  /api/v1/search?q=                    全站搜尋（遊戲、平台、公司、系列、活動）
GET  /api/v1/calendar/day?date=YYYY-MM-DD&locale=&<篩選>   月曆／時間軸同日其他款（按需載入；同一套篩選與聚合）；
                                          `show`（篩選之一）不含 releases 時不查遊戲，回 { date, total: 0, cards: [] }；200 { date, total, cards }（單日上限 500 張）；
                                          400 invalid_locale｜invalid_date、503 timeout；
                                          Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=300
GET  /api/v1/timeline/week?locale=&week=YYYY-Www&at=&<篩選>   週時間軸資料；400 invalid_locale、503 timeout；快取同上
GET  /api/v1/games/suggest?q=&locale=&limit=1..10   搜尋框候選（公開）；沒帶 q → 400 { code: "q_required" }，空白 q → { items: [] }，
                                          逾時 503 { code: "unavailable" }；limit 預設 8、最多 10；locale 不合法時忽略；
                                          200 { items: [{ slug, name（依 locale）, originalName, coverUrl, year, platforms[] }] }；
                                          排序：名稱完全相同 → 開頭符合 → 熱度（候選池為符合者中熱度前 120 筆＋完全同名者；≤ 3 字元的短字先在熱度前 3000 筆內找、找滿才用，見 06 §已知限制）；
                                          平台依名稱排序最多 3 個、不含 mobile；查詢經 tokenizeForSearch（06 §瀏覽與搜尋）；
                                          Cache-Control: public, max-age=30, s-maxage=60
GET  /api/v1/games/group?locale=&by=date|platform|publisher&key=&offset=&limit=&<篩選，含 q、sort、year>
                                          /games 分組檢視某一組的接續卡片（「顯示更多」按需載入）；key：date＝YYYY-MM｜YYYY-Qn｜YYYY｜tbd、
                                          platform＝平台 slug、publisher＝廠商欄 key（06、docs/design/publisher-groups.md）；
                                          組內順序固定＝首發日由新到舊（未定最後、同日依熱度；D89），`sort` 參數被忽略；組排序 gsort／gdir 與日期起算月 gfrom 只影響頁面的組序，這個 API 不吃（帶了也忽略）；
                                          卡片資料多一個 `o`（標題原文；主標題＝原文時省略，06 §卡片大小一致）；
                                          offset 預設 0、limit 預設 24、最多 60；200 { key, total, cards[] }；
                                          400 { error: invalid_locale｜invalid_by（缺少、none 或未知）｜invalid_key｜invalid_paging }、503 { error: "timeout" }；
                                          篩選與頁面共用 buildBrowseConditions；Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=300
GET  /api/v1/ratings/ranking?locale=&<篩選>&sort=<欄位 id>&dir=asc|desc&minVotes=0..100000&page=1..20&prev=<上一個排序欄>&chunk=1
                                          評分排名頁切換排序／載入更多（06 §評分排名）；sort 未知或模組停用 → 預設欄 igdb；minVotes 省略＝該欄預設；
                                          page 預設累計前 page 頁（每頁 50），chunk=1 只回第 page 頁；有 prev 時每列帶 prevRank；
                                          200 RatingsRankingResponse；400 { error: "invalid_locale" }、503 { error: "timeout" }；
                                          Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=300
POST /api/v1/reports                      資料更正回報（允許匿名，rate limit＋人機驗證，12）
```

**帳號（accounts）**

```
GET  /api/v1/auth/public-config          { signupEnabled, socialProviders[] }（公開，不含 secret；header 帳號下拉決定是否顯示「註冊」用，
                                         因頁面預渲染不能烤進 ACCOUNTS_SIGNUP_ENABLED）；Cache-Control: public, max-age=300；非 GET 回 404
/api/v1/auth/*                           Better Auth 提供（basePath /api/v1/auth，D81），不在 OpenAPI：
                                         sign-up/email、sign-in/email、sign-out、verify-email、request-password-reset、reset-password、
                                         sign-in/social、callback/{provider}（discord|google|twitch|twitter|microsoft）、get-session；
                                         Steam 為自寫 plugin：POST steam/sign-in（body { callbackURL?, errorCallbackURL? }，
                                         回 { url }；有 session＝綁定、沒有＝登入；受 BA origin 檢查）、GET steam/callback
                                         （成功 302 到 callbackURL；失敗 302 到 errorCallbackURL?error=steam_invalid_response|
                                         steam_verification_failed|steam_already_linked|steam_network_error|signup_disabled）；
                                         callbackURL 只收站內相對路徑
                                         OAuth app 的 redirect URI＝{站台}/api/v1/auth/callback/{provider}
DELETE /api/v1/account                    body { password? }：有密碼者必須帶密碼（錯 401 invalid_password）；沒有密碼者 session
                                         須在 10 分鐘內建立（否則 401 reauth_required）。成功 200 並清 session cookie；cascade 刪除所有
                                         帳號資料，私人 feed 隨即 404；每人每小時 5 次（429 rate_limited）；稽核 log 只記 userId 與時間
GET    /api/v1/account/export?format=json|csv[&part=profile|lists|list_games|plays|follows|owned_games]
                                         JSON 單檔；CSV 每段一檔（UTF-8 BOM、CRLF、防公式注入）。不含密碼雜湊、任何 token、feed token、
                                         shareToken；含 role、handle、emailVerified（placeholder 信箱標 emailIsPlaceholder）。
                                         attachment、no-store；每人每小時 12 次
GET    /api/v1/account/summary           帳號頁摘要 { lists, playRecords, follows }（本人；401；停權 403；no-store）；follows 只算 targetType=game（D86）
GET    /api/v1/me/unlocks                本人的解鎖紀錄 { unlocks: [{ type: theme｜collectible｜achievement, key, at(ISO UTC) }] }（依 type、key 排序）。
                                         副作用：先把帳號資料判定的成就（first-follow、first-list、first-ical-subscribe）寫入 user_unlocks，
                                         所以視同寫入：401 未登入、停權者 403 account_suspended；no-store
POST   /api/v1/me/unlocks                body { unlocks: [{ type, key, at }] }，最多 100 筆（超過 400 validation_failed fields { unlocks: too_many }；
                                         缺欄位或非陣列 400 { unlocks: required }）。檢查順序：Origin 403 invalid_origin → 401 → 停權 403 account_suspended →
                                         限流 429 rate_limited（每人每小時 300 次，Retry-After）。未知 type／key、壞時間的項目靜默丟棄；去重取較早；
                                         at 超過現在 5 分鐘夾成現在；寫入冪等（unlocked_at 取 LEAST）。all-achievements 只有前置四項
                                         （viewed-50-games、first-ical-subscribe、first-follow、first-list）都在帳號時才接受。
                                         200 回合併後完整清單（同 GET）；其他方法 405；no-store
GET|PATCH /api/v1/account/preferences     displayName、locale、timezone（IANA）、preferredRegion、scoreProviders、preferredPlatformIds、
                                         defaultListVisibility、defaultReviewVisibility；PATCH 回 { preferences, changed }；每人每小時 120 次
（綁定／解除／列出登入方式不另設 /account/connections：由 Better Auth 的 list-accounts、unlink-account、link-social 與
 Steam plugin 的 steam/sign-in 提供；「至少保留一種」由 BA 擋）

GET|POST         /api/v1/lists            我的清單（依 sortOrder）；POST { name, description?, visibility? }，
                                         visibility 省略取 users.defaultListVisibility；上限 100 個（422 list_limit_reached）
PATCH            /api/v1/lists/order      清單之間排序 { listIds }
GET|PATCH|DELETE /api/v1/lists/{id}       GET 匿名可讀：本人全部、他人只有 public；private／不存在／停權者 一律 404 list_not_found；
                                         PATCH { name?, description?, visibility?, rotateShareToken? }
GET              /api/v1/lists/shared/{shareToken}   unlisted 分享連結（匿名可讀；停權者 404）
POST|PATCH|DELETE /api/v1/lists/{id}/games/{gameId}  加入（{ note? }，已在清單回 200）／改備註／移除；每清單上限 1000 款
PATCH            /api/v1/lists/{id}/order { gameIds }   清單內排序

GET|POST         /api/v1/play-records?gameId=   只回本人；每筆含 game（卡片）與 platform（{ id, name, abbreviation }|null）；
                                         POST 驗證：平台須屬於該遊戲、完成日不早於開始日、評分 1～20 半分級、
                                         reviewVisibility 省略取 users.defaultReviewVisibility；上限 5000 筆
PATCH|DELETE     /api/v1/play-records/{id}
GET              /api/v1/play-records/stats   各狀態數、今年完成數（只算有填完成日）、總耗時
GET              /api/v1/me/games/{gameId}    詳情頁一次取回：我的清單（含是否已在其中）、這款的遊玩紀錄、平台選項
GET              /api/v1/player-ratings/{gameId}   公開（s-maxage=300）：{ ratingCount, avg, avgPlayMinutes }；
                                         avg 與 avgPlayMinutes 各自人數低於 PLAYER_RATING_MIN_COUNT 時為 null（D83）

GET              /api/v1/follows?targetType=   只回本人（D48：沒有讀別人追蹤清單的端點）
PUT|DELETE       /api/v1/follows/{targetType}/{targetId}   冪等；新增 201、已追蹤 200；每人滾動 24 小時 FOLLOW_MAX_PER_DAY
                                         （429 follow_limit_reached）；目標不存在 404 target_not_found
GET              /api/v1/me/follows/state?targets=game:1,event:2[&withCount=1]   批次狀態（最多 100 個），卡片與頁面按鈕用
GET              /api/v1/follows/count/{targetType}/{targetId}   公開（s-maxage=300）；低於 FOLLOW_COUNT_MIN_DISPLAY 為 null，停權不計
GET              /api/v1/me/games?mine=followed|owned|collected|list:<id>[,…]&from=&to=   「我的遊戲」（no-store）：
                                         遊戲卡片＋最近上市日（沿用 06 聚合規則）。followed 只含直接追蹤的遊戲（D83）

GET|POST         /api/v1/calendar/feeds   本人的 following feed，沒有就建立（冪等、再次顯示同一網址，P9）
PATCH            /api/v1/calendar/feeds/{id}   name、locale、filterPlatforms、filterRegions（偏好，不是限制）、filterGenres、
                                         filterStages、includeReleases、includeEvents；實際有變才 settingsVersion + 1
POST             /api/v1/calendar/feeds/{id}/rotate   新 token；舊網址 30 天內回空 ics、之後 410。建立與 rotate 每人每小時 10 次
POST             /api/v1/imports/{provider}   Steam／Xbox 遊戲庫匯入（目前只有 steam）：抓清單＋寫入後回 202 { imported, total }，
                                         比對在回應後與排程進行。未登入 401、Origin 不受信任 403、未綁 Steam 409 steam_not_linked、
                                         缺或失效的 STEAM_WEB_API_KEY 503 steam_import_unavailable、10 分鐘冷卻 429 import_cooldown（Retry-After）、
                                         個人檔案非公開 422 steam_profile_private、上游錯誤 502 steam_upstream_error；no-store
GET              /api/v1/imports/{provider}?status=&limit=1..100&offset=   匯入摘要與清單（帳號頁 client 端用；status 篩選）：
                                         { importAvailable, cooldownSec, summary:{ total, matched, needsReview, notFound, queued,
                                         lastImportedAt }, items:[{ id, externalGameId, title, status, confidencePct, game }], hasMore }
PATCH            /api/v1/imports/{provider}/games/{ownedGameId}   手動指定 { gameId }、否決 { gameId: null }、交給自動 { reset: true }；
                                         手動列 match_method='manual'，匯入重比與排程都不覆寫
GET              /api/v1/imports/{provider}/games/{ownedGameId}/candidates   比對候選（含信心）
GET              /api/v1/games/search?q=   遊戲搜尋（catalog，公開 s-maxage=60），手動指定時用

停權者（users.suspendedAt）：可登入，但所有新增／修改內容的端點回 403 account_suspended；匯出與刪除帳號照常（D83）。
資料匯出 JSON 頂層新增 `unlocks: [{ type, key, at }]`（exportVersion 仍為 1，純新增欄位；CSV 不加分段）；刪除帳號時 `user_unlocks` 隨 FK cascade 刪除。

以上帳號端點一律 no-store（另註公開快取者除外）；寫入要求 Origin 受信任（403 invalid_origin）；錯誤格式 { code }，
欄位錯誤 400 { code: "validation_failed", fields }。
```

**通知（notifications）**：`GET|PATCH /api/v1/notifications/preferences`、`POST /api/v1/notifications/unsubscribe`（RFC 8058 一鍵退訂）。

**頒獎（awards）**：`GET /api/v1/awards/{eventSlug}`、`GET /api/v1/games/{slug}/awards`。

**社群（social）**

```
GET            /api/v1/games/{slug}/reviews?sort=likes|recent
PUT|DELETE     /api/v1/reviews/{playRecordId}/like
PUT|DELETE     /api/v1/users/{handle}/follow
PUT|DELETE     /api/v1/users/{handle}/block
GET            /api/v1/feed
POST           /api/v1/content-reports
```

**內部（discord，只給 Bot；需 `INTERNAL_API_SECRET`；Caddy 擋公網）**

```
GET    /api/v1/discord-links?guildId=&releaseEventId=&eventId=
GET    /api/v1/discord-links/stale        只回有差異或過期 pending 的 link
POST   /api/v1/discord-links              預留（pending），撞 unique 回 409
PATCH  /api/v1/discord-links/{id}         確認或更新
DELETE /api/v1/discord-links/{id}
GET|PUT /api/v1/discord-guilds/{guildId}/settings
GET|PUT|DELETE /api/v1/discord-guilds/{guildId}/follows/{gameId}
GET|PUT|DELETE /api/v1/discord-guilds/{guildId}/roles/{gameId}
GET    /api/v1/discord-guilds/{guildId}/announcements/next   依伺服器篩選產生下一則公告內容
```

網站的「建立 Discord 活動」按鈕由網站後端直接呼叫 Discord REST API（10），不經 Bot。

模組停用時，其端點經 `guardModule` 回 404。

**已刪除**：舊時間軸端點 `GET /api/timeline`、`/api/timeline/group`、`/api/timeline/history`（D85 決定、2026-10-22 刪除，現回 404），連同其 use case、repository 與 cursor 分頁；時間軸只剩 `GET /api/v1/timeline/week` 與 `calendar/day`。第二輪曾短暫存在的 `GET /api/v1/releases/column` 也已刪除（D87）。

## 分頁

用 cursor，不用 offset（持續寫入時 offset 會重複或漏筆）。cursor 必須與排序欄位一致，編碼為 opaque 字串（base64url），平手以 id 打破：

| 排序 | cursor |
| --- | --- |
| `id` | `id` |
| `popularity` | `(popularity_score, id)` |
| `release_date`／時間軸 | `(period_start, popularity_score, game_id)` |
| `name` | `(name, id)` |

`/releases` 以 `from`／`to` 限制範圍，範圍內仍用 cursor。`/events` 數量少，暫不分頁。

## 版本

路徑帶 `/v1/`；不相容的變更開 `/v2/` 並行，相容的新增欄位直接加。

## 多語

- 回傳顯示文字的端點接受 `locale`（`zh-Hant|en|ja`；未帶才參考 `Accept-Language`，再退 `DEFAULT_LOCALE`），回應帶 `Content-Language`；`locale` 納入快取鍵。
- 回應同時含結構化欄位（`date`、`precision`、enum 值）與已本地化欄位（`name`、`dateLabel`、`status.label`），客戶端可二擇一。
- 搜尋 `q` 不分語系。

## 契約

- `packages/api-contract` 以 zod 定義每個端點的請求與回應 schema（DTO，不是 Domain 實體），網站 handler 用它驗證輸入輸出；Bot 與 App 從同一套件取型別（D44）。
- `npm run api:generate` 產生 OpenAPI（🧪 `@asteasolutions/zod-to-openapi` 9.x＋zod 4 可用）；CI 檢查已提交的產物是最新。
- 整合測試驗證實際回應符合 schema。內部端點也納入，標記 internal。
