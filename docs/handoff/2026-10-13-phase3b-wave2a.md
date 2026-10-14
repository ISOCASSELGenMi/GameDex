# 交接:Phase 3b Wave 2a 完成,Wave 2b 待派(2026-10-13)

分支 `feat/phase3b`(已推 GitHub `ISOCASSELGenMi/SoK-GameDB`,private),HEAD `2fa88f5`。main 仍是 Phase 2b 的 `4865352`;`feat/phase3a` 已推但**尚未合併進 main、尚未開 PR**(使用者決定何時合併)。
前序交接:`2026-10-13-phase3a-done.md`(3a 程式地圖與地雷,仍有效)、`2026-10-13-phase3.md`(資料量、排程、Phase 2 程式地圖)。計畫全文:`C:\Users\illus\.claude\plans\polished-exploring-yao.md`(若不在了,內容摘要在本檔「後續路線」)。

## 工作方式(使用者 2026-10-13 指示,務必延續)
- 你是**規劃與驗收**(建議 Opus、中等強度、plan 思維);**寫碼任務派子代理,用 Agent 工具、`model: "sonnet"`、`effort: "medium"`、背景執行**,可並行。
- **嚴格檢視子代理證據**:報告只有「通過」沒有數字就退回;驗收時**自己重跑**全部檢查並讀 diff 確認沒超出範圍,證據對得上才 commit/推送。(本階段已發生過子代理報告與事實不符:I 說開發 DB 沒跑過熱度,其實跑過。)
- 每個子代理用獨立測試 DB:`TEST_DATABASE_NAME=sok_<x>_test`(機制在 `test/integration/test-db-url.ts`);`npm test` 與 `test:a11y` 用同一個 DB,不可同時跑。
- **不要在 plan 模式下派子代理**:子代理會繼承唯讀限制而卡住(發生過)。
- 用量上限(five_hour)會中斷子代理:新代理接續,磁碟上有進度;任務書與報告在 `.local/agents/3b/`(git 忽略):`00-common.md` 守則、`F/G/H/I/K-*.md` 任務書與 `*-report.md` 報告、`J-browse-entity-ui.md` **已寫好待派**、`ORCHESTRATION.md`(舊,以本檔為準)。
- 進度 checklist:`docs/checklist.md`(做完打勾、新工作標日期)。

## 目前狀態
- 全綠(最後一次,2026-10-13):typecheck、lint、lint:arch(195 modules,0 違規)、i18n:check、`npm test` 30 檔/367 個、`test:a11y` 37 個。GitHub CI:`feat/phase3b` 在 Wave 1 之前全綠(run 38354844625);**Wave 1 與 Wave 2a 的 push 後 CI 尚未確認**,下個階段先 `gh run list`(`C:\Program Files\GitHub CLI\gh.exe`,已登入 ISOCASSELGenMi;bash 找不到 gh,用 PowerShell 完整路徑)。
- Wave 1(`887a079`):熱度 `refresh_popularity`、熱門榜讀取、FilterSpec 完整維度、時間軸/瀏覽讀取、平台/公司/系列/活動/語言支援讀取。
- Wave 2a(`9b9fd2f`):`/timeline`、`/trending`、共用篩選 UI(`ui/filters/*`,手機抽屜)、proxy 308、熱度徽章、`franchises(slug)` 索引 migration、活動類型推斷、logo ImageRef、平台頁改用共用聚合。
- 開發 DB 已跑 `refresh_popularity --scope all`(149 秒;heat 5=2,731、4=10,766、3=28,293、2=67,624、1=155,134、0=50,058)。

## 待使用者同意後才做(動開發 DB)
1. 套用 migration 0003:`CREATE INDEX "franchises_slug_idx" ON "franchises" USING btree ("slug");`(`npm run db:migrate`)。
2. `npm run job -- sync_events --reclassify`:960 筆活動(全是 IGDB)kind 由 other 改成推斷結果(離線結果:showcase 696、expo 101、awards 37、other 126)。規則 `providers/igdb/event-kind.ts`;名稱無關鍵字的(Sonic Central、EA Play、Day of the Devs…約 60 筆)仍是 other,需補關鍵字或人工標註。
3. 備份 DB `sok_studio_bak_20261013` 刪不刪(破壞性,仍待決)。

## 下一步(依序)
1. 確認 CI;問使用者上面 1、2 並執行。
2. **派 Wave 2b 子代理 J**(任務書已寫:`.local/agents/3b/J-browse-entity-ui.md`):`/games` 瀏覽+搜尋、平台/公司/系列(`?kind=`)頁、活動列表/詳情、詳情頁補完(語言支援三態——絕不顯示「不支援」、DLC、即將亮相活動)。注意:瀏覽頁的 `q`/年份/排序表單欄位還沒有,`FilterPanel` 不處理這三類(I 的報告提到),J 要補。可拆成 2 個並行(瀏覽+詳情 / 實體頁+活動)以省時間,字典 key 分區避免衝突。
3. Wave 3:擴充 test:a11y(時間軸、瀏覽、實體頁;**補測 I 未實測的「展開剩 M 款」與往後「載入更多」**,e2e fixture 要造單日 >10 款、有下一頁的資料)+ 獨立只讀審查(reviewer,Opus)→ 修正 → 最終驗收 → 本階段交接 → 合併。
4. Phase 3 完成標準逐條核對(spec 15 §Phase 3)。之後 Phase 3.5 → 4 → 5 → 9(Slice 0),詳見計畫檔。

## 已定案的判斷(使用者 2026-10-13)
- 熱度:鎖用 session(spec 04 寫 tx);暫不抓 `games.hypes`(需全量重同步);無日期遊戲歸 upcoming 群;cancelled 與只上 mobile 的不上熱門榜;外部訊號(site_follows)待 accounts 時由 registry 注入(目前 job 傳空陣列)。
- 系列 slug 不唯一(968 組 franchise/collection 撞名):`?kind=franchise|collection`,預設 franchise。
- 活動類型:同步時依名稱推斷(`--reclassify` 可重算 IGDB 活動,人工活動不動)。
- logo 經 ImageResolver(`ImageKind` 加 `logo`;外部格式只在 Provider)。
- 時間軸:cursor 鍵多兩欄、upcoming 用期間結束日、from/to 比對 period_start;「未定」組查詢 0.5~0.65 s(已知限制,3.5 以快取/物化處理)。
- 平台頁/公司頁/系列頁的挑選邏輯收斂到 `release-aggregate.ts`(原則五),`DISTINCT ON` 全專案只剩該檔。

## 程式地圖(3b 新增)
| 位置 | 內容 |
| --- | --- |
| `packages/api-contract/src/filter-spec.ts`、`filter-canonical.ts` | FilterSpec 完整維度(多值+單值參數)、`filterRedirectSearch`/`canonicalizeFilterQuery` |
| `catalog/ui/request-routing.ts` | `decideFilterRedirect`(含「只差逗號編碼不轉址」,避免無限 308;建議之後移進 api-contract) |
| `catalog/domain/heat.ts`、`repository/popularity.ts`、`providers/igdb/popularity.ts` | 熱度公式、PERCENT_RANK 分群寫入、IGDB popularity_primitives(type 2、10) |
| `catalog/use-cases/sync/refresh-popularity.ts` | 任務 `refresh_popularity`(`--scope all\|...`) |
| `catalog/use-cases/read/{get-timeline,browse-games,get-trending,get-platform-page,get-company-page,get-franchise-page,list-events,get-event-detail,list-platforms}.ts` | 3b 讀取 Use Case(介面細節見 `.local/agents/3b/G/H/K/F-report.md`) |
| `catalog/ui/{filters,timeline,trending}/`、`ui/heat-badge.tsx`、`ui/release-history.ts` | 3b UI |
| `app/[locale]/{timeline,trending}`、`app/api/timeline/{,group,history}` | 路由 |
| `docs/perf/2026-10-13-timeline-query.md` | 時間軸查詢實測(2024-10 一頁約 50 ms) |
| `catalog/providers/igdb/event-kind.ts` | 活動類型推斷規則(純函式,可單測) |

## 地雷(新增)
- **本機啟動 Next(dev/build)會改寫 `apps/web/tsconfig.json` 與 `next-env.d.ts`**,用了 `NEXT_DIST_DIR` 時還會把該目錄路徑寫進 tsconfig;commit 前 `git diff apps/web/tsconfig.json` 檢查,不要提交(本階段誤提交過一次已還原)。
- 驗證 UI 用 dev server:`$env:SCHEDULER_ENABLED='false'`,`NEXT_DIST_DIR=.next-verify`,port 3101;結束要用 PowerShell 結束 next 的 node 行程並刪 `.next-verify`。
- 瀏覽器/Playwright 會把 `a,b` 重新編碼成 `a%2Cb`,任何網址正規化轉址必須視兩者相同。
- `ui/` 的未分層 CSS 會蓋過 Tailwind 工具類別,時間軸樣式因此寫在 `globals.css` 檔尾(`tl-*`)。
- Linux CI 的字寬會讓表格橫向溢出;可捲動區域必須 `tabIndex=0`+`role=region`+label(axe `scrollable-region-focusable`)。
- 子代理整合測試曾 TRUNCATE games、fixture igdbId 撞號;新 fixture 用專屬 id 區段(44xxxx 是 e2e)。

## 待使用者處理(累積)
1. 規格正本(claude.ai Project)更新:見 `docs/checklist.md` 3b 的「規格正本更新」項,加上 3a 交接檔的清單;更新後重新匯出到 `docs/spec/`。
2. 上述動 DB 的三項、預設時區、詳情頁上市日排序是否改「有日期優先」、翻譯用詞確認。
3. 活動類型啟發式的限制(約一半 other 其實是發表會):要補關鍵字還是等 Slice 2 內容管理員人工標註。
4. `feat/phase3a`、`feat/phase3b` 何時開 PR 合併進 main。
5. Phase 9 前準備:VM、網域、Cloudflare、Email 服務。
