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

## 3. 實作（本機 `C:\Users\illus\Project\SoK-GameDB`，2026-10-14 由 `SoK-Game_Calender` 改名；2026-10-12 起在 Claude Code 繼續）

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

### Phase 3b：時間軸、完整篩選、瀏覽、實體頁、活動、熱度、語言支援（2026-10-13 開工、2026-10-14 完成，分支 `feat/phase3b`）
- [x] 整合測試支援 `TEST_DATABASE_NAME`（子代理各用一個測試 DB 並行）（2026-10-13）
- [x] Wave 1-F：`refresh_popularity`（IGDB popularity_primitives＋結構訊號、PERCENT_RANK、heatLevel）、PopularitySignal 介面、熱門榜讀取
- [x] Wave 1-G：FilterSpec 完整維度＋正規化、聚合支援新維度、時間軸讀取（cursor 雙向）、瀏覽／搜尋讀取
- [x] Wave 1-H：平台／公司／系列頁、活動列表與詳情、詳情頁補完（DLC、即將亮相活動、語言支援三態）讀取層
- [x] 使用者定案（2026-10-13）：熱度鎖用 session、暫不抓 games.hypes、無日期遊戲歸 upcoming 群、cancelled／只上 mobile 不上熱門榜；系列頁 `?kind=` 區分＋`franchises(slug)` 索引；活動類型同步時依名稱推斷；logo 擴充 ImageKind 經 ImageResolver
- [ ] 規格正本更新（3b 已定案，2026-10-13 新增）：04 `refresh_popularity` 鎖 session、hypes 暫不抓、熱度分群規則；06 §時間軸 cursor 實際鍵、upcoming／released 用期間結束日、from/to 比對 period_start；06 §篩選 單值參數規則與 308 正規化；06 §活動 undated 範圍、類型依名稱推斷；06 §詳情 連結無地區欄位無法依地區排序；系列 `?kind=`
- [x] Wave 2a：I＝時間軸頁、完整篩選 UI、proxy 308、熱度徽章、熱門榜頁；K＝franchise 索引 migration、活動類型推斷＋重新分類、logo ImageKind、平台頁改用共用挑選邏輯
- [x] 開發 DB 套用 migration 0003（`franchises_slug_idx`）＋`sync_events --reclassify`（960 筆：showcase 696、expo 101、awards 37、other 126）（2026-10-13，使用者同意）
- [x] Wave 2b：J＝瀏覽／搜尋、平台／公司／系列、活動頁、詳情頁補完（語言支援區塊、DLC、即將亮相活動）（2026-10-13 拆成 J1 瀏覽＋詳情、J2 實體頁＋活動並行；完成）
- [x] 導覽列加「遊戲／平台／活動」入口（J1／J2 待決，Wave 3 處理）（2026-10-13 新增；2026-10-14 W3A 完成）
- [x] 收斂重複：`safeDecode`（game-detail-page 與 entities/view-model）、分頁元件（browse 與 entities `Pager`）、TBA 文字兩種來源（Wave 3 審查一併看）（2026-10-13 新增）
- [x] Wave 3：test:a11y 擴充（時間軸、瀏覽、實體頁）＋獨立審查（2026-10-14：W3A e2e 156 個新測試，test:a11y 193；審查 R 1 高 4 中 8 低）
- [x] Wave 3 修正 W3B（2026-10-14）：高-1 撇號無限 308、外部連結 http(s) 白名單唯一實作、history 超大 id／不存在日期不再 500、重複實作收斂（PageNav、periodEndSql、utc-date、safeDecode）、平台頁 upcomingHint 文字配合排序（使用者決定）；精簡熱度徽章維持（使用者決定）
- [x] W3C：時間軸稀疏條件視窗上限＋部分結果（實測 2026-10-14：status=delayed 往前 6.4 s→1.3 s、status=upcoming 往前 2.3 s→0.76 s；單次最多 4 段、單段 ≤ 896 天；回應 nextPartial／prevPartial＋「繼續找」）
- [ ] 待決（W3C）：掃描上限常數是否調整；partial 時篩選後可能要多按一次「繼續找」才確認到盡頭（2026-10-14 新增）
- [ ] 待決（W3B）：/games 預設 sort 是否從網址省略；無效 group key 回 200 空結果或 400；四份頁碼解析合併；use-cases 4 處自算 UTC 今天；分頁 aria-current 移出 li（需同步改 e2e）；repository 引用 api-contract 的 isValidIsoDate（可移到 domain）（2026-10-14 新增）
- [ ] CI：Actions Node 20 淘汰警告、ubuntu-latest 2026-10-19 起改 Ubuntu 26（2026-10-14 新增）
- [x] 在開發 DB 跑 `refresh_popularity --scope all`（2026-10-13，149 秒；heat 5＝2,731、4＝10,766、3＝28,293、2＝67,624、1＝155,134、0＝50,058）
- [x] 驗收：全部檢查全綠＋spec 15 Phase 3 完成標準（3b 範圍）；commit；交接文件（2026-10-14，`docs/handoff/2026-10-14-phase3b-done.md`；3c 硬體世代時間軸未做，spec 標可後延）
- [x] PR `ISOCASSELGenMi/SoK-GameDB#1`（feat/phase3b → main，含 3a）2026-10-14 使用者合併（merge commit `be43a6e`）
- [x] PR `ISOCASSELGenMi/SoK-GameDB#2`（feat/phase3.5 → main）2026-10-14 已合併

### Phase 3.5：多語補完、SEO、快取（2026-10-14 開工，分支 `feat/phase3.5`）
- [x] 使用者決定（2026-10-14）：先做本機可做的；Cloudflare Cache Rule／rate limiting 實際設定與搜尋主控台驗收移到 Phase 9；ja 由子代理出初稿、使用者審專有名詞對照表
- [x] L：ja 字典、類型／主題翻譯、game_localizations→displayNames、翻譯缺漏報告＋CI 三語字典檢查
- [x] S：sitemap 分片、canonical、hreflang（x-default）、JSON-LD、ISR／快取（語系不互相污染）、Cloudflare 規則草案文件
- [x] 使用者審 ja 專有名詞對照表（120 列，`docs/review/ja-terms.md`）；2026-10-15 依回覆改 `trending.upcoming`、`filters.statusValues.upcoming`＝発売直前、`enums.datePrecision.quarter`＝シーズン，其餘照初稿
- [ ] 待決（L）：zh-Hant 顯示名稱規則保守，既有遊戲要下次同步才重算；立即回填需對開發 DB 重跑同步（需使用者同意）（2026-10-14 新增）
- [ ] 待決（S）：多維篩選頁一律 noindex、canonical 不帶篩選參數；正式環境必須設 `NEXT_PUBLIC_SITE_URL`（沒設時 canonical 為相對網址）（2026-10-14 新增）
- [ ] 待決（負責人）：PPR 下查詢逾時的錯誤頁是 200，加上依路徑的 `s-maxage` 會讓 CDN 快取錯誤頁 60~300 秒，Phase 9 前要處理；`/games` 預設排序冷查詢 1.9 s（熱 0.27 s），DB 重啟後首次可能逾時（2026-10-14 新增）
- [ ] 已知：本機在同一個 shell 中 `npm test` 後緊接 `test:a11y` 會 exit 1 且無測試輸出（單獨跑 287 全過；CI 分步驟不受影響），原因未查（2026-10-14 新增）
- [x] 驗收：全部檢查全綠＋spec 15 Phase 3.5 完成標準（本機部分）；commit；交接文件（2026-10-14，`docs/handoff/2026-10-14-phase3.5-done.md`；sitemap 被搜尋主控台接受移到 Phase 9）
- [x] 本機資料夾改名 `SoK-Game_Calender` → `SoK-GameDB`、記憶搬到新路徑、CLAUDE.md 加「工作方式」（2026-10-14）
- [ ] Phase 9 前：PPR 錯誤頁 200 會被 `s-maxage` 快取的處理；設 `NEXT_PUBLIC_SITE_URL`（2026-10-14 新增）

### Phase 4：評分顯示、比對函式、回報（2026-10-15 開工，分支 `feat/phase4`）
- [x] A：IGDB 分數列測試、`normalizeTitle`／`findBestMatch`、`selectRatings`＋兩個環境變數驗證、詳情頁評分區（localStorage 來源選擇）、Metacritic 關閉時無評分任務的守門測試
- [x] B：`data_reports`＋migration、`POST /api/v1/reports`（Turnstile、IP 每日上限、IP 雜湊 90 天清除）、核可寫 manual 上市日（同 transaction、sequence 遞增）、admin 模組 `/internal/reports`（Basic auth、CSRF）、回報入口與表單頁
- [x] 驗收：全部檢查＋spec 15 Phase 4 完成標準（iCal sequence 只驗資料層，iCal 在 Phase 5）；commit；交接 `docs/handoff/2026-10-15-phase4-done.md`（2026-10-15）
- [x] ja 日期格式與說明文字的「四半期」一併改為「シーズン」（使用者 2026-10-15 決定）
- [x] 使用者決定（2026-10-15）：無分數時評分區照顯示、欄位留白（D74）；詳情頁隱藏同鍵 igdb 列、IGDB 同鍵日期更新覆蓋人工更正（D75）——子代理 C 實作完成
- [ ] 待決：缺金鑰行為（503／404，沿用中）；missing_region_date 階段推測；takedown 專用動作；被覆蓋的人工更正是否通知（2026-10-15 新增，詳見交接）
- [x] 規格 repo 副本同步（CHANGELOG v2.1，2026-10-15）
- [ ] 使用者把 `docs/spec/` v2.1 改動匯入 Project 正本
- [x] 開發 DB 套 migration 0004（使用者同意，2026-10-15）
- [x] PR `ISOCASSELGenMi/SoK-GameDB#3`（feat/phase4 → main）2026-10-15 已合併（CI 修正：表格捲動容器 relative）

### Phase 5：iCal（2026-10-15 開工，分支 `feat/phase5`）
- [x] D：ics 產生函式（聚合 UID、SEQUENCE、精度、tbd／取消過渡期、字典標記）、公開 feed 三種、視窗與視窗離開、ETag／304、訂閱頁、原型驗證用 feed
- [x] E：events.sequence（migration 0005，已套開發 DB）、活動同步無變動不寫 updated_at（2026-10-15）
- [x] cloudflared 安裝與通道（使用者同意，2026-10-15）
- [x] 原型驗證：Google（網頁版）與 Apple（iPadOS 26.6.1）7 步全部通過，結論寫回 spec 08（2026-10-16）
- [x] F：訂閱頁文案依實測更新（2026-10-16）
- [x] 驗收：全部檢查＋spec 15 Phase 5 完成標準；交接 `docs/handoff/2026-10-16-phase5-done.md`（2026-10-16）
- [x] PR `feat/phase5` → main（#4，2026-10-16 合併）

### Phase 9 本機準備（分支 `feat/phase9-prep`）
- [x] Dockerfile、compose、Caddy、備份、心跳告警（migration 0006）、錯誤 scrub、法務頁草稿；PR #5 2026-10-16 合併

### Phase 7：帳號（Better Auth，D76～D82）
- [x] 第 1 波：accounts 骨架、Email＋密碼、帳號頁、migration 0007（PR #6，2026-10-16 合併；0006／0007 已套開發 DB）
- [x] 第 3 波：Steam 登入／綁定、owned_games（migration 0008，已套開發 DB）、GetOwnedGames 匯入與比對（PR #7，2026-10-17 合併）
- [x] 待決定案（2026-10-17，D82）：找不到的列每次匯入重比、Steam 消失的遊戲保留、手動指定比對 UI 排第 5 波；spec 03／07／09／16／90 寫回
- [x] 第 3 波補：匯入時重比找不到的列（分支 `feat/phase7-w3b`，PR #8，2026-10-17；待合併）
- [x] 第 5 波：清單、遊玩紀錄、玩家平均、Steam 手動指定比對（分支 `feat/phase7-w5`，PR #9 疊在 #8 上，2026-10-17；待合併；migration 0009 未套開發 DB）
- [x] 第 5～7 波待決定案（2026-10-17，D83）：
  - 「今年完成」只算有填完成日；玩家平均「最新一筆」改以建立時間判定；平均耗時也套 `PLAYER_RATING_MIN_COUNT` 門檻；未達門檻的說明不寫數字
  - 停權者的 public 與 unlisted 清單都對他人隱藏；停權者可登入但只能看說明、匯出與刪除帳號，不能新增或修改內容；cookie 快取最多 5 分鐘延遲可接受
  - 公開清單頁 CDN 快取 60 秒、不進 sitemap；帳號頁遊玩紀錄顯示平台名稱；評論可見度 followers 用詞改為「關注我的人」
  - `mine` 維持 `/account/games` 專頁，月曆／時間軸／瀏覽頁加連結；`followed` 只含直接追蹤的遊戲；月曆／時間軸卡片加追蹤按鈕（批次查狀態）；平台／系列／公司／活動頁也顯示追蹤人數
  - 「上升中」加門檻：7 天至少 10 人新追蹤且在同群前 5%；私人 iCal 關掉「包含活動」時完全不含活動（含明確追蹤的）；私人 iCal 加遊戲類型篩選 UI，地區維持偏好
  - 孤兒清理保險（≥ 20 個全不存在時不刪）保留並發告警；匯出加入 role、handle、emailVerified；刪帳號後等每小時重算可接受
- [ ] 實作 D83（分支 `feat/phase7-w7b`，疊在第 7 波上）
- [ ] 使用者：過目 ja 用語（クリア／全クリア／挫折 等）；隱私權政策帳號段落請律師審閱
- [x] 第 6 波：追蹤、我的遊戲（mine）、熱度訊號、私人 iCal（分支 `feat/phase7-w6`，PR 疊在 #9 上，2026-10-17；待合併；migration 0010 未套開發 DB）
- [x] 第 7 波：資料匯出、刪除帳號、停權、偏好設定頁（分支 `feat/phase7-w7`，PR 疊在 #10 上，2026-10-17；待合併；無 migration）
- [x] spec 待補：06 路由表（account/follows、games、calendar、lists、plays、/lists/*）、02 slot 清單（entity.actions、subscribe.private）、07（follows、me/games、calendar feeds、第 5 波 API）（2026-10-17 寫回，分支 `docs/spec-phase7-w5-7`）
- [ ] Steam 真實連線實測（需使用者提供 `STEAM_WEB_API_KEY`）
- [ ] 第 2 波：Discord／Google／Twitch／Microsoft 社群登入（需使用者申請 OAuth app，建議正式網域定了再申請）
- [ ] 第 4 波 Xbox 匯入（依賴第 2 波 Microsoft 登入）
- [ ] Phase 7.5 寄信服務（正式開放註冊前必須完成）
