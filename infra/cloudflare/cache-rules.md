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

## 錯誤頁不可被 CDN 快取（H 段落，Phase 9 準備，2026-10-15）

**問題**：動態頁（月曆、時間軸、熱門榜、遊戲瀏覽、平台／公司／系列／活動頁）靠 `next.config.ts` 的 `headers()` 送 `public, s-maxage=60/300`。
查詢逾時（或資料庫斷線）時，錯誤邊界（`app/[locale]/error.tsx`）的頁面**仍是 `200 OK`、仍帶同一個 `s-maxage`**，Cloudflare 會把錯誤頁快取 60~300 秒。

**實驗結果（Next 16.4、`next start`、`CATALOG_READ_TIMEOUT_MS=1` 製造逾時；e2e `ops-9.spec.ts` 會重現）**：

```
$ curl -si http://localhost:3280/en/games | head -3          # 查詢逾時
HTTP/1.1 200 OK
Cache-Control: public, s-maxage=60, stale-while-revalidate=300
...
<!DOCTYPE html><html id="__next_error__"><head>...
```

- 狀態碼與標頭在靜態外殼開始串流時就送出，之後的渲染錯誤只能放進 HTML 串流（Next 文件 `guides/streaming.md` §The HTTP contract：「You cannot change the status code or headers after streaming starts」）。
  連 `notFound()` 在這些動態頁裡也只是 200 的軟 404（實測 `/en/platforms/zzz` 是 200＋`s-maxage=300`）。
- `next.config.ts` 的 `headers()` 是靜態的，不知道渲染結果；`proxy.ts` 在渲染前執行，同樣不知道。Error boundary、`onRequestError` 都拿不到回應物件。
- 所以**Next 層做不到「只有錯誤時不快取」**。可行但代價大的替代方案：拿掉這些路徑的 `s-maxage`（Next 預設 `private, no-store`，CDN 完全不快取 HTML；失去邊緣快取）。目前採用下面的 Cloudflare 規則，不改應用程式的快取策略。

**辨識錯誤頁的訊號**：錯誤頁（以及動態頁的軟 404）的 HTML 一律以 `<!DOCTYPE html><html id="__next_error__">` 開頭（Next 的錯誤外殼；正常頁面是 `<html lang="…"`）。回應的第一個區塊就包含它，不必讀完整個本文。
e2e `ops-9.spec.ts` 用真實的逾時回應驗證這個前綴，並直接執行下面標記範圍內的判斷程式碼。

**Cloudflare Snippet（Rules → Snippets，套用在 `Hostname eq <site>` 且路徑不是 `/_next/` 與 `/api/`；免費方案可用）**：看回應本文的第一個區塊，是錯誤外殼就改成 `Cache-Control: no-store`（狀態碼維持原樣，不改成 5xx，避免把軟 404 變成錯誤）。

```js
// BEGIN error-shell-check
function isNextErrorShell(status, contentType, head) {
  return status === 200 && /text\/html/i.test(contentType || "") && head.startsWith('<!DOCTYPE html><html id="__next_error__"');
}
// END error-shell-check

export default {
  async fetch(request) {
    const res = await fetch(request);
    const type = res.headers.get("content-type") || "";
    if (res.status !== 200 || !/text\/html/i.test(type) || !res.body) return res;
    const reader = res.body.getReader();
    const first = await reader.read();
    const head = first.value ? new TextDecoder().decode(first.value.slice(0, 120)) : "";
    const body = new ReadableStream({
      start(controller) {
        if (first.value) controller.enqueue(first.value);
        if (first.done) controller.close();
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    const headers = new Headers(res.headers);
    if (isNextErrorShell(res.status, type, head)) {
      headers.set("Cache-Control", "no-store");
      headers.delete("CDN-Cache-Control");
      headers.delete("Cloudflare-CDN-Cache-Control");
    }
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  },
};
```

**驗收（Phase 9）**：
1. 在源站暫時把 `CATALOG_READ_TIMEOUT_MS=1` 設起來（或停掉資料庫），`curl -si https://<site>/en/games` 兩次：回應 `Cache-Control: no-store`、`cf-cache-status` 不是 `HIT`。
2. 還原後同一網址立即回到正常內容（沒有殘留的錯誤頁）。
3. 正常頁面仍是 `cf-cache-status: HIT`（Snippet 只動錯誤外殼）。

**限制與備援**：Snippet 只看第一個區塊；若日後 Next 改了錯誤外殼的開頭，e2e 的前綴斷言會先失敗。不使用 Snippet 時，錯誤頁最多被快取 60 秒（月曆／時間軸／熱門榜／瀏覽）或 300 秒（實體頁），且只影響出錯的那個網址；`/internal` 與詳情頁（ISR）不受影響。

## 法務頁（H 段落）

`/{locale}/about/{data-sources,privacy,terms,contact}`：靜態內容、不送 `Set-Cookie`，`next.config.ts` 設 `public, s-maxage=3600, stale-while-revalidate=86400`（Next 對靜態頁預設的一年太長，改文字後要等 CDN 過期）。已加入 `pages.xml`。部署後若要立即更新，對這四個路徑（×三語）做單一 URL purge。
