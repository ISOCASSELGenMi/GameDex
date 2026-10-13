# SoK-Game_Calendar 專案 Checklist

> 規則：做完一項就打 `[x]`；發現新工作就加進對應區塊並標註日期。
> 正本在 claude.ai Project（`claude/checklist.md`）；本檔為 repo 副本（`docs/checklist.md`），Claude Code 可直接核對與打勾，回到 claude.ai 時兩邊再同步。
> 最後更新：2026-10-13（Wave 2a 完成、交接 docs/handoff/2026-10-13-phase3b-wave2a.md；Phase 3a 完成、推上 GitHub `SoK-GameDB`、Phase 3b 開工；Phase 2a／2b 完成；Phase 3a 開工，企劃負責人＋Claude Code 子代理分工；checklist 複製進 repo）

## 0. 既有成果（依過往對話紀錄回填）
- [x] 架構規格書初稿與審閱（v1.2 單一文件；2026-10-12 起改為 `spec/` 多文件 v2.0）
- [x] 決策：完全不採用 RAWG 分數，相關項目全數取消
- [x] 決策：前端預設顯示 IGDB 分數，分數來源（IGDB / Metacritic）為用戶可選設定
- [x] 決策：日期正規化——月精度取當月第一天；季／年精度取期間最後一天；iCal 標記同規則
- [x] 決策：IGDB `Cancelled` → `release_events.status='cancelled'`；`Rumored` 預設隱藏
- [x] 決策：多語系由網站語言切換器統一控制
- [x] 決策：Slice 0 範圍含時間軸；語系＝繁中（台灣）主、英、日
- [x] 決策：首版非商業，暫不聯絡 IGDB；營利前再聯絡
- [x] IGDB Spike 第 1 輪（2026-10-05）
- [x] IGDB Spike 第 2 輪（2026-10-05）
- [x] Webhook 測試：4 個 webhook 註冊／刪除成功，約 5 分鐘收到 44 筆通知
- [x] IGDB Spike 第 3 輪（2026-10-07，結果不確定：0 筆通知）
- [x] IGDB Spike 第 4 輪 polling 檢查（2026-10-08）：release_dates 更新會推進 games.updated_at
- [ ] IGDB 資料刪除行為驗證（Spike 第 4 輪未涵蓋）
- [x] 將規格書 v1.2 上傳至本 Project（2026-10-12 使用者上傳）

## 1. 功能需求規劃書（2026-10-12 新增）
- [x] 彙整需求：平台／遊戲資料、活動與頒獎典禮、Metacritic 分數、月曆／時間軸、帳號、追蹤、收藏、iCal、Discord Bot、外部連結、IGDB 對等功能、嚴格分層與模組化
- [x] 查核 Metacritic 資料來源可行性（官方 API 經 Fabric Origin 付費提供，文件僅列電影／影集端點；遊戲分數只有非官方爬蟲）
- [x] 向使用者確認不確定事項（第 1 批：Metacritic→爬蟲、5 種登入、社群三項、活動＋頒獎名單）
- [x] 向使用者確認不確定事項（第 2 批：Bot 功能含反應身分組、按鈕兩處、通知三管道、官網＋商店連結）
- [x] 撰寫功能需求規劃書初稿 v0.1（Claude Docs）
- [x] 使用者回覆規劃書第 9 節 8 項待確認事項（2026-10-12 全數照建議；Steam 匯入依規格書 4.7 採用）
- [x] 與架構規格書 v1.2 交叉比對（規劃書第 10 節：3 處需求書配合、12 處規格書要改）
- [x] 使用者回覆規劃書 10.3 三項決定（全數照建議：awards／social 模組、Slice 2 加內容管理員、玩家平均另列）
- [ ] 使用者審閱並定稿

## 2. 待規劃（需求書定稿後展開）
- [x] 規格書改版為 v2.0：拆成 Project `spec/` 下 20 份文件、刪除修訂歷史敘述、修正 14 處矛盾、併入 12 處新需求與 10.3 決定（2026-10-12）
- [ ] 使用者審閱 v2.0，特別是 CHANGELOG「拆分時我做的設計選擇」
- [ ] 決定 3 項新產生的待定事項：依篩選的公開 iCal（與 P13 衝突）、用戶追蹤名單是否公開、新帳號評論是否先不公開（2026-10-12 新增）
- [ ] 確認後刪除舊的單一檔 v1.2（破壞性操作，需使用者同意）（2026-10-12 新增）
- [ ] 查證 Twitter/X OAuth 登入的開發者帳號條件與費用（2026-10-12 新增）
- [x] 規格書第 7 章與附錄逐段比對（2026-10-12 拆分時已全文讀過）
- [x] 分層與模組邊界圖（規劃書第 8 節的圖；規格 v2.0 的 02）
- [x] 資料模型更新（events、awards、lists、play_records、follows、external_links）— 規格 v2.0 的 03、13
- [x] 開發環境建置（Windows 本機）— 見第 3 節 Phase 0（2026-10-12）
- [ ] Metacritic 爬蟲 spike：比對準確率、速率限制、改版告警（2026-10-12 新增）
- [ ] Discord Bot spike：建立外部活動、反應身分組、250 身分組上限的清理策略（2026-10-12 新增）
- [ ] 確認 IGDB events 端點的資料覆蓋率（活動類型、時區、直播連結）（2026-10-12 新增）

## 3. 實作（本機 `C:\Users\illus\Project\SoK-Game_Calender`；2026-10-12 起在 Claude Code 繼續）

### Phase 0：環境（2026-10-12 完成）
- [x] npm workspaces（apps/web、packages/*、bots/*）＋ git（main）
- [x] Next.js 16.4.0（create-next-app，TS、Tailwind 4、App Router、src/）；TypeScript 鎖 6.0.3（dependency-cruiser 需 < 7）
- [x] drizzle-orm 0.45.4、drizzle-kit 0.31.11、pg、node-cron 4、zod 4、ical-generator 11、vitest 5、dependency-cruiser 18.6
- [x] 本機 PG 16.14：改用 `embedded-postgres`（二進位檔在 node_modules、資料在 `.local/pgdata`），不裝系統服務、不需 Docker；正式環境仍為 Docker postgres:16
- [x] npm 11 `allowScripts`：核准 esbuild、@embedded-postgres/windows-x64、unrs-resolver
- [x] 完成標準：`npm run dev` 啟動並連上本機資料庫（/healthz 200、/readyz 200）

### Phase 1：Kernel、資料模型、CI 邊界（2026-10-12 完成）
- [x] kernel：env 驗證（fail closed、空字串＝未設）、db client、advisory lock（xact／session、雙 int4 key）、sync_state 心跳、module registry＋啟動檢查、guardModule、scheduler、RequestContext、/healthz、/readyz
- [x] catalog：03 的 31 張 catalog 表＋kernel 2 張、索引總表、`$onUpdate`、pg_trgm migration；seed regions（10 筆，冪等）
- [x] Repository：getGameBySlug、upsertGame、getReleaseEventsByMonth、upsertReleaseEvent（sequence＋history＋change_feed 同交易）、getRatingsByGame、upsertRating（NULLS NOT DISTINCT＋snapshot）
- [x] `lint:arch`：15 條規則（02 的 a、b、c＋db client 限制、schema 限制、循環依賴）；7 個刻意違規 fixture 全被擋下
- [x] GitHub Actions：check（含 PG16 service 跑整合測試）＋ core-only（MODULES=none）
- [x] pg_trgm 中日文實測：Windows en-US 與 Linux C.UTF-8 結果相同；bigram 後 6 個中日英查詢皆命中，ILIKE 走 GIN 索引
- [x] 驗收（Windows 本機）：typecheck、ESLint、lint:arch 0 違規、測試 19/19（含整合）、core-only build 通過
- [x] 初次 git commit `791f0fc`（88 檔）（2026-10-12）
- [x] `CLAUDE.md` 交接說明（給 Claude Code：原則、進度、指令、地雷）（2026-10-12）
- [x] 規格書 v2.0 匯出到 repo `docs/spec/`（20 檔，commit `cb7987c`）；正本仍在 Project，改規格後需重新匯出（2026-10-12）
- [x] checklist 複製到 repo `docs/checklist.md`，Claude Code 可自行核對打勾；回到 claude.ai 時兩邊同步（2026-10-13）
- [x] 在 `CLAUDE.md` 加一行：開工前讀 `docs/checklist.md`、做完打勾、新工作加進去（2026-10-13 新增）
- [ ] 把 Phase 1 實測（Next 16 cacheComponents、embedded-postgres、Windows trgm、depcruise 細節）補進 spec/91（2026-10-12 新增）
- [ ] 規格 15 Phase 0 的指令與 02 的 dependency-cruiser 範例更新為實際做法（2026-10-12 新增）
- [ ] 選用：加 `.gitattributes` 統一 LF，消除 Windows CRLF 警告（2026-10-12 新增）
- [x] 推上 GitHub（private repo `ISOCASSELGenMi/SoK-GameDB`）後確認 CI 兩個 job 實際通過（2026-10-13：check 第一次 test:a11y 在 Linux 失敗 1 項——詳情頁表格捲動區不可聚焦，已修；run 38354844625 全綠）

### Phase 2：IGDB 同步（2026-10-13 完成）
- [x] Twitch Application（Confidential、redirect `http://localhost`）；Client ID／Secret 已填入 `.env.local`，取得 app token 驗證成功（2026-10-12）
- [x] 2a：providers/igdb.ts（token 快取、節流）、平台同步、Tier 1 回填、增量同步、上市階段、語言支援（2026-10-13）
- [x] 2b：Tier 2 回填、相似遊戲與活動關聯批次解析、滾動校對、sync_events、字典漂移偵測（2026-10-13；遊戲 314,606、上市事件 461,410）
- [ ] 規格正本更新 2a／2b 已定案判斷（04 平台只採原版機、滾動校對 misses 與查不到的處理、活動增量與 change_feed；03 相似遊戲刪舊配對；16 `ROLLING_REFRESH_PER_NIGHT`=10000），再重新匯出到 `docs/spec/`（2026-10-13 新增）
- [ ] 決定備份資料庫 `sok_studio_bak_20261013` 是否刪除（破壞性，需使用者同意）（2026-10-13 新增；同日使用者決定先保留）
- [ ] 補 RatingProvider／PopularitySignal／GameFilterProvider 介面（Phase 3b／4／7 需要時）
- [ ] `data_reports` 表（Slice 2，見 12）

### Phase 3a：月曆＋詳情＋聚合＋基本篩選＋i18n 骨架（2026-10-13 完成，分支 `feat/phase3a`；交接 `docs/handoff/2026-10-13-phase3a-done.md`）
- [x] 選型（使用者 2026-10-13 決定）：a11y 用 Playwright＋axe-core；UI 不用元件庫（純 Tailwind＋原生 HTML／ARIA）；i18n 依 spec 06 自建 `packages/i18n`（只靠 `Intl`）
- [x] Wave 1-A：`packages/i18n`（字典 zh-Hant＋en、formatReleaseLabel、語系協商、i18n:check）＋`packages/api-contract` FilterSpec（zod）
- [x] Wave 1-B：`repository/release-aggregate.ts`（聚合唯一實作）、月曆／詳情讀取 use case、篩選選項、執行計畫實測、整合測試
- [x] Wave 2-C：`[locale]` 路由與 proxy 導向、語言選單、月曆（CSS Grid、＋N、本月未定日、手機議程式）、側邊預覽卡、遊戲詳情（評分區留空）、篩選 UI
- [x] Wave 3-D：Playwright＋axe `test:a11y`、鍵盤走完月曆 → 詳情、CI 加 `i18n:check`／`test:a11y`
- [x] 驗收：四項檢查全綠＋spec 15 Phase 3 完成標準（3a 範圍）＋獨立審查；commit；交接文件

### Phase 3b：時間軸、完整篩選、瀏覽、實體頁、活動、熱度、語言支援（2026-10-13 開工，分支 `feat/phase3b`）
- [x] 整合測試支援 `TEST_DATABASE_NAME`（子代理各用一個測試 DB 並行）（2026-10-13）
- [x] Wave 1-F：`refresh_popularity`（IGDB popularity_primitives＋結構訊號、PERCENT_RANK、heatLevel）、PopularitySignal 介面、熱門榜讀取
- [x] Wave 1-G：FilterSpec 完整維度＋正規化、聚合支援新維度、時間軸讀取（cursor 雙向）、瀏覽／搜尋讀取
- [x] Wave 1-H：平台／公司／系列頁、活動列表與詳情、詳情頁補完（DLC、即將亮相活動、語言支援三態）讀取層
- [x] 使用者定案（2026-10-13）：熱度鎖用 session、暫不抓 games.hypes、無日期遊戲歸 upcoming 群、cancelled／只上 mobile 不上熱門榜；系列頁 `?kind=` 區分＋`franchises(slug)` 索引；活動類型同步時依名稱推斷；logo 擴充 ImageKind 經 ImageResolver
- [ ] 規格正本更新（3b 已定案，2026-10-13 新增）：04 `refresh_popularity` 鎖 session、hypes 暫不抓、熱度分群規則；06 §時間軸 cursor 實際鍵、upcoming／released 用期間結束日、from/to 比對 period_start；06 §篩選 單值參數規則與 308 正規化；06 §活動 undated 範圍、類型依名稱推斷；06 §詳情 連結無地區欄位無法依地區排序；系列 `?kind=`
- [x] Wave 2a：I＝時間軸頁、完整篩選 UI、proxy 308、熱度徽章、熱門榜頁；K＝franchise 索引 migration、活動類型推斷＋重新分類、logo ImageKind、平台頁改用共用挑選邏輯
- [x] 開發 DB 套用 migration 0003（`franchises_slug_idx`）＋`sync_events --reclassify`（960 筆：showcase 696、expo 101、awards 37、other 126）（2026-10-13，使用者同意）
- [x] Wave 2b：J＝瀏覽／搜尋、平台／公司／系列、活動頁、詳情頁補完（語言支援區塊、DLC、即將亮相活動）（2026-10-13 拆成 J1 瀏覽＋詳情、J2 實體頁＋活動並行；完成）
- [ ] 導覽列加「遊戲／平台／活動」入口（J1／J2 待決，Wave 3 處理）（2026-10-13 新增）
- [ ] 收斂重複：`safeDecode`（game-detail-page 與 entities/view-model）、分頁元件（browse 與 entities `Pager`）、TBA 文字兩種來源（Wave 3 審查一併看）（2026-10-13 新增）
- [ ] Wave 3：test:a11y 擴充（時間軸、瀏覽、實體頁）＋獨立審查
- [x] 在開發 DB 跑 `refresh_popularity --scope all`（2026-10-13，149 秒；heat 5＝2,731、4＝10,766、3＝28,293、2＝67,624、1＝155,134、0＝50,058）
- [ ] 驗收：全部檢查全綠＋spec 15 Phase 3 完成標準（3b 範圍）；commit；交接文件
