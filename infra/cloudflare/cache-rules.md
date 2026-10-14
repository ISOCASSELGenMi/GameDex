# Cloudflare Cache Rule 與 Rate Limiting 草案（Phase 9 實際設定）

Phase 3.5 只在應用程式端送出正確的快取標頭；以下規則要到 Phase 9 部署時才在 Cloudflare 設定與驗收。
來源標頭定義在 `apps/web/next.config.ts`（`headers()`、`cacheLife`）與 `catalog/ui/seo/sitemap-routes.ts`。

## 回應標頭（應用程式已送出）

| 路徑 | Cache-Control | 說明 |
|---|---|---|
| `/{locale}/games/{slug}`、`/{locale}/events/{slug}`（ISR） | Next 依 `cacheLife catalogDetail` 產生：`s-maxage=3600, stale-while-revalidate=…` | 詳情頁，1 小時重建、24 小時內可送舊版 |
| `/{locale}/calendar/{month}`、`timeline`、`trending`、`games` | `public, s-maxage=60, stale-while-revalidate=300` | 篩選驅動、變動快 |
| `/{locale}/platforms`、`platforms/{slug}`、`companies/{slug}`、`franchises/{slug}`、`events` | `public, s-maxage=300, stale-while-revalidate=3600` | 實體頁與列表 |
| `/sitemap.xml`、`/sitemap/{name}` | `public, s-maxage=3600, stale-while-revalidate=86400` | 分片很大，不進伺服器記憶體快取，交給 CDN |
| `/robots.txt` | 見路由 | |
| `/_next/static/*` | `public, max-age=31536000, immutable`（Next 預設） | |
| `/api/*`、`/healthz`、`/readyz` | 不快取 | |

所有上述頁面不送 `Set-Cookie`（e2e `seo-3.5.spec.ts` 驗證）。`Vary` 不含 Cookie。語系在網址路徑中（`/zh-Hant/…`），所以快取鍵＝完整網址，不需要依 `Accept-Language` 或 Cookie 分流。

## Cache Rule（草案）

1. **Bypass**：`URI Path starts with /api/` 或 `equals /healthz` 或 `equals /readyz` → Bypass cache。
2. **HTML 與 sitemap**：`Hostname eq <site>` 且 `URI Path` 不是 `/_next/static/` 與 `/api/` → Eligible for cache；Edge TTL = **Use cache-control header if present**（不覆寫，讓應用程式的 `s-maxage` 說了算）；Browser TTL = Respect origin。
3. **Cache key**：包含完整 query string（篩選變體各自獨立，與 `?kind=collection` 這類必要參數一致）；不加入 Cookie、不依 Accept-Language。可選：忽略 `utm_*` 這類追蹤參數。
4. **靜態資源**：`/_next/static/*` → Edge TTL 1 年。
5. **圖片**：`/_next/image` → Edge TTL 1 天（由 Next 的 `minimumCacheTTL` 決定來源；待 Phase 9 對照實測）。

### 驗收（Phase 9）

- `curl -sI https://<site>/en/games/<slug>` 連續兩次，第二次 `cf-cache-status: HIT`。
- 同一路徑切換語系前綴得到不同內容、不互相命中。
- 帶 `Cookie` 的請求仍命中同一個快取項目（證明沒有依 Cookie 分流）。
- 同步寫入後要提前更新詳情頁：呼叫 `revalidateTag("catalog:game:<slug>")`（標籤定義見 `catalog/ui/seo/cache-tags.ts`），並對該網址做 Cloudflare purge（單一 URL）。

## Rate Limiting（草案）

| 規則 | 條件 | 門檻 | 動作 |
|---|---|---|---|
| 搜尋與篩選 | `URI Path` 含 `/games` 且 query 含 `q=` | 30 次／10 秒／IP | Managed Challenge，1 分鐘 |
| 時間軸 API | `URI Path starts with /api/timeline` | 60 次／分鐘／IP | Block，1 分鐘 |
| sitemap | `URI Path starts with /sitemap` | 20 次／分鐘／IP（Googlebot 以 Verified Bots 放行） | Block，10 分鐘 |
| 一般 | 全站 | 300 次／分鐘／IP | Managed Challenge |

注意：`/api/locale` 會寫入語系偏好，不可被快取（Bypass 規則已涵蓋 `/api/`）。
Googlebot 等已驗證爬蟲用 Cloudflare 的 Verified Bots 條件排除，避免擋到索引。

## 待決

- `minimumCacheTTL`（圖片）與 Cloudflare 圖片快取是否重複快取，Phase 9 量測後定。
- accounts 模組上線後（頁面出現登入狀態）：`next.config.ts` 的 `headers()` 必須移除對應路徑或改走客戶端取得，否則使用者專屬內容會被 CDN 快取。
