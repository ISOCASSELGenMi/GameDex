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
POST /api/v1/reports                      資料更正回報（允許匿名，rate limit＋人機驗證，12）
```

**帳號（accounts）**

```
/api/v1/auth/*                           Better Auth 提供（basePath /api/v1/auth，D81），不在 OpenAPI：
                                         sign-up/email、sign-in/email、sign-out、verify-email、request-password-reset、reset-password、
                                         sign-in/social、callback/{provider}（discord|google|twitch|twitter|microsoft）、get-session；
                                         Steam 為自寫 plugin：steam/sign-in、steam/callback
                                         OAuth app 的 redirect URI＝{站台}/api/v1/auth/callback/{provider}
DELETE /api/v1/account                    需重新驗證身分（09）
GET    /api/v1/account/export             資料匯出 JSON／CSV
GET|PATCH /api/v1/account/preferences     locale、timezone、preferredRegion、scoreProviders、preferredPlatformIds、隱私預設
GET|POST|DELETE /api/v1/account/connections/{provider}

GET|POST         /api/v1/lists            我的清單
GET|PATCH|DELETE /api/v1/lists/{id}       公開或 unlisted 清單可匿名讀取
POST|DELETE      /api/v1/lists/{id}/games/{gameId}
PATCH            /api/v1/lists/{id}/order

GET|POST         /api/v1/play-records?gameId=
PATCH|DELETE     /api/v1/play-records/{id}

GET              /api/v1/follows
PUT|DELETE       /api/v1/follows/{targetType}/{targetId}

GET|POST         /api/v1/calendar/feeds   私人 feed；GET 可再次顯示訂閱網址（P9）
POST             /api/v1/calendar/feeds/{id}/rotate
POST             /api/v1/imports/{provider}   Steam／Xbox 遊戲庫匯入（非同步）
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
