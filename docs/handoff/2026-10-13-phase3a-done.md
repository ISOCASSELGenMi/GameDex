# 交接：Phase 3a 完成（2026-10-13）

分支 `feat/phase3a`（自 main `4865352`），尚未 push／開 PR。前一份整合交接：`2026-10-13-phase3.md`（資料量、排程、Phase 2 程式地圖、地雷仍有效）。
子代理任務書與報告在 `.local/agents/`（git 忽略）：A～E 報告、W1／W2 驗收備註、`ORCHESTRATION.md`。

## Commit

| commit | 內容 |
| --- | --- |
| `868261f` | Wave 1：`packages/i18n`、`packages/api-contract`（FilterSpec）、catalog 讀取層、migration 0002 |
| `e1dfa2e` | Wave 2：網站 UI（`[locale]` 路由、proxy、月曆、篩選、詳情、語言選單） |
| `d1f4253` | Wave 3：Playwright＋axe-core `test:a11y`、CI |
| `29dabed` | 獨立審查修正：聚合挑選順序、proxy 邊界、封面格式只在 Provider |

## 檢查（最後一次，全綠）
typecheck（web＋兩個 packages）、lint、lint:arch（149 modules，0 violations）、`npm test`（16 檔／205 個）、`i18n:check`、`test:a11y`（37 個，本機 msedge，axe WCAG 2.0/2.1/2.2 A＋AA 0 違規）。
spec 15 Phase 3a 完成標準逐條由獨立審查確認 ✅；CI 尚未在 GitHub 實跑過（第一次 push 後看 check job）。

## 程式地圖（3a 新增）

| 位置 | 內容 |
| --- | --- |
| `packages/i18n` | 只依賴 Intl；`negotiateLocale`、`createTranslator`（key 帶命名空間）、`translateLabel`、`formatReleaseLabel`（純日期 UTC）、`formatDateTime`；字典 `messages/{locale}/{ns}.json`；`scripts/i18n-check.ts` |
| `packages/api-contract` | `FilterSpec`（platform、platformKind、genre、stage）、`parseFilterSpec`（不 throw、>20 值拒絕）、`serializeFilterSpec`／`filterSpecToQueryString` |
| `catalog/repository/release-aggregate.ts` | **聚合規則唯一實作** `aggregateReleases`（月曆、之後的時間軸／Discord／iCal 共用） |
| `catalog/repository/{game-detail,filter-options,calendar-events,read-tx}.ts` | 讀取；唯讀交易＋`statement_timeout 3000` → `CatalogQueryTimeoutError` |
| `catalog/use-cases/read/` | `getCalendarMonth`、`getGameDetail`、`getFilterOptions`、`listReleaseCards`、`resolveFilterSlugs`、`resolveRegionPref` |
| `catalog/providers/igdb/images.ts` | IGDB 圖片網址解析與尺寸 token（Use Case 注入 Repository）；Domain 只有 `ImageRef` |
| `catalog/ui/` | 頁面內容；`index.ts`（server）、`client.ts`（error 邊界）、`routing.ts`（proxy 專用輕量入口）；`filter-mapping.ts` 是 FilterSpec→ReleaseFilter 唯一對應 |
| `src/proxy.ts` | 無前綴入口 302（Cookie → Accept-Language → 預設）、`/{locale}`→當月 307、不支援語系／月份格式錯 404 |
| `src/app/[locale]/**`、`app/api/locale` | 薄路由；POST `/api/locale` 是唯一寫 Cookie 的地方 |
| `apps/web/e2e/**`、`playwright.config.ts` | test:a11y；fixture igdbId 44xxxx、月份 2036-05；build 到 `.local/e2e-next`、埠 3200 |
| `drizzle/0002_*.sql` | `release_date_history (release_event_id)` 索引（已套本機 DB） |

效能（本機真實資料，`docs/perf/2026-10-13-calendar-query.md`）：最熱門月 2024-10 查詢約 85 ms、詳情 < 10 ms；prod 頁面約 0.3 s、2.1~2.4 MB（gzip ~275 KB）。

## 使用者已定案（2026-10-13）
- removed 上市列照 spec 04 D7 顯示並加註「資料來源待確認」；cancelled 月曆預設隱藏、詳情頁標示。
- 聚合挑選順序：manual > active > 有日期 > 偏好地區 > WW > 最早日期 > id；`source` 為 NULL 視為 igdb。同日不同階段分卡。
- 常用平台：資料驅動，排除 kind=other／mobile。
- 遊戲不存在：接受軟 404（prod 200＋noindex）；查詢逾時：頁面錯誤邊界提示，503 留給 API。
- lint:arch：`app/` 可 import `modules/*/ui/(index|client).ts`；proxy 只能 import `modules/*/ui/routing.ts` 且不可間接碰 DB／React。
- 地區偏好：3a 一律 `DEFAULT_REGION_PREF`（WW），瀏覽器語系推導延到有帳號時。
- 活動時間、改期紀錄日期：3a 用 UTC 並標註。「今天」（`/` 導向當月）用 UTC。
- 圖片外部格式只在 Provider 層（原則二）。

## 待使用者處理
1. **claude.ai Project spec 正本**：03 §索引總表加 `release_date_history (release_event_id)`；04／06 補 cancelled 月曆隱藏；06 §聚合規則補新的挑選順序（含 active 優先於 removed、有日期優先、source NULL）、規則 3 的瀏覽器推導延後；06 逾時改「API 回 503、頁面顯示提示」、遊戲不存在軟 404、活動時間 3a 用 UTC；06 test:a11y 選型定為 Playwright＋axe-core；02 §薄路由補 ui/index、ui/client、ui/routing 例外；圖片格式只在 Provider。
2. **Project checklist** 勾 Phase 3a。
3. 預設時區（`/` 導向與活動顯示）未定；詳情頁上市日排序目前偏好地區優先（tbd 可能排在其他地區有日期的列前面）是否改「有日期優先」。
4. 小決定：預覽卡 `<dialog>` 是否另做焦點陷阱（原生行為合規）；行為測試是否從 test:a11y 拆出。
5. 翻譯用詞人工確認（A-report 待決 3）；ESLint 不涵蓋 `packages/`。
6. push 分支／開 PR 由使用者決定。

## 留給 3b／3.5 的已知事項
- 篩選表單送出 `?platform=a&platform=b`（非正規 `a,b`），3.5 快取前要正規化（proxy 308 或表單改寫）。
- 熱門月份頁面 2 MB+：＋N 完整清單可改按需載入（需 spec 07 API）。
- `popularityScore` 全為 0（熱度計算未做），月曆排序退化成依名稱。
- spec 06 篩選表其他維度（status、region、theme、minHeat…）、語言支援區、截圖／預告片、hreflang／canonical／JSON-LD。

## 地雷（3a 新增）
- **Next 16.4＋cacheComponents 在 prod 頁面狀態碼一律 200**：頁面內 `notFound()` 是軟 404、`redirect()` 變客戶端導向。需要真狀態碼的判斷放 proxy。
- `next build` 會改寫 `apps/web/tsconfig.json`、`next-env.d.ts`；dev server 執行中要 build 用 `NEXT_DIST_DIR=<其他目錄>`（e2e 已自動還原兩檔）。
- `npm test` 與 `test:a11y` 共用測試 DB，不可同時跑。本機 Playwright 用 `PW_CHANNEL=msedge`，不要 `playwright install`。
- 在 Claude Code 對話內不能再啟動 `claude -p`（巢狀被擋）；子代理用 Agent 工具。
- dev server：`.claude/launch.json` 的 `web-dev-3100`（Browser 工具 preview_start），排程關閉。
