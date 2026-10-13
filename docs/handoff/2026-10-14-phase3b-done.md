# 交接：Phase 3b 完成（2026-10-14）

分支 `feat/phase3b`（已推 `ISOCASSELGenMi/SoK-GameDB`），HEAD 見 `git log`（本檔所在 commit）。main 仍是 Phase 2b；`feat/phase3a`、`feat/phase3b` 都**尚未合併、尚未開 PR**（待使用者決定）。
前序交接仍有效：`2026-10-13-phase3b-wave2a.md`（3b Wave 1/2a 程式地圖、已定案判斷、地雷）、`2026-10-13-phase3a-done.md`、`2026-10-13-phase3.md`。

## 工作方式（延續）
負責人規劃驗收、不寫功能碼；寫碼派 Agent（`model: sonnet`、`effort: medium`、背景、各自 `TEST_DATABASE_NAME=sok_<x>_test`，test:a11y 另設 `E2E_PORT`／`E2E_DIST_DIR` 可並行）；報告沒數字就退回；驗收自己重跑六項檢查＋讀 diff；動開發 DB 先問。
**子代理撞用量上限 → 立即 CronCreate 排重置後的一次性喚醒接續**（使用者 2026-10-14 要求）。任務書與報告：`.local/agents/3b/`（J1/J2/W3A/W3B/W3C/R-review）。

## 本階段完成
| commit | 內容 |
| --- | --- |
| `501f002` | Wave 2b：`/games` 瀏覽＋搜尋、平台總覽／平台頁、公司頁（role）、系列頁（`?kind=`）、活動列表／詳情、詳情頁語言支援三態＋實體連結 |
| `78b312b` | Wave 3：導覽列遊戲／平台／活動；e2e `a11y-3b`／`behavior-3b`（fixture 441xxx）；審查修正（撇號無限 308、外部連結 http(s) 白名單唯一實作 `ui/external-url.ts`、400 取代 500、`PageNav`／`periodEndSql`／`domain/utc-date.ts` 收斂） |
| `6522a41` | 時間軸稀疏條件掃描上限（4 段、單段 ≤ 896 天）＋`nextPartial`／`prevPartial`＋「繼續找」；`docs/perf` 2026-10-14 |

開發 DB（使用者同意）：套 migration 0003、`sync_events --reclassify`（showcase 696、expo 101、awards 37、other 126）。備份庫 `sok_studio_bak_20261013` 使用者決定先保留。

## 驗收數字（2026-10-14，負責人重跑）
typecheck 0、lint 0、lint:arch 215 modules 0 違規、i18n:check 通過、`npm test` 37 檔／429、`test:a11y` 195（Wave 3 時 193 連兩次全過；有一次 exit 1 且無測試輸出，疑 webServer 啟動失敗，之後未重現）。
時間軸實測（warm）：`status=delayed` 往前 6.4 s → 1.3 s；`status=upcoming` 往前 2.3 s → 0.76 s。

## spec 15 Phase 3 完成標準對照
| 標準 | 證據 |
| --- | --- |
| 看得到當月真實上市資料 | dev server 開發 DB（3a、3b 子代理實開） |
| 詳情頁商店連結、系列作品、相似遊戲 | e2e `behavior.spec`「詳情頁」 |
| 多平台遊戲只出現一次 | e2e `behavior.spec`「一款多平台遊戲…只出現一次」 |
| 熱門月份不被截斷 | e2e「＋N」、時間軸「展開剩 M 款」（`behavior-3b`） |
| 手機月曆議程式 | e2e「手機寬度顯示議程式」 |
| 純鍵盤月曆 → 詳情 | `keyboard.spec` |
| 熱度與階段圖示＋文字 | e2e＋單元；精簡徽章只有圖示＋數字（完整文字在 aria-label），**使用者 2026-10-14 決定可接受** |
| 語言缺資料不出現「不支援」 | domain 無此值＋單元＋e2e 三態 |
| 3b 各項（時間軸、篩選 URL、瀏覽、實體頁、活動、熱度、語言支援） | 已實作，單元／整合／e2e 皆有 |
| 3c 硬體世代時間軸 | **未做**（spec 標「可後延」） |

## 使用者決定（2026-10-14）
平台頁 upcomingHint 改文字配合排序（月精度排月初）；精簡熱度徽章維持；稀疏條件先實測、超門檻再修（已修）。

## 待決（累積，詳見 `docs/checklist.md` 3b 區）
1. `feat/phase3a`、`feat/phase3b` 何時開 PR 合併進 main。
2. W3B：`/games` 預設 `sort=popularity` 是否從網址省略；無效 group key 回 200 空或 400；四份頁碼解析合併；use-cases 4 處自算 UTC 今天；分頁 `aria-current` 移出 `<li>`（需同步改 e2e）；`repository/timeline.ts` 引用 api-contract 的 `isValidIsoDate`（可移到 domain）。
3. W3C：掃描上限常數；partial 時可能多按一次「繼續找」才確認到盡頭。
4. CI：Actions Node 20 淘汰警告；`ubuntu-latest` 2026-10-19 起換 Ubuntu 26。
5. 規格正本更新（3a、3b 已定案項，見 checklist）→ 重新匯出 `docs/spec/`。
6. 活動類型 other 126 筆仍約一半是發表會（補關鍵字或等 Slice 2 人工標註）。
7. 熱門榜 e2e 只驗空榜（fixture 無熱度資料）。
8. Phase 9 前準備：VM、網域、Cloudflare、Email。

## 程式地圖（本階段新增）
| 位置 | 內容 |
| --- | --- |
| `catalog/ui/browse/` | `/games` 瀏覽＋搜尋（`role=search`、排序、分頁上限 5,000） |
| `catalog/ui/entities/` | 平台／公司／系列頁、共用清單與 logo |
| `catalog/ui/events/` | 活動列表／詳情 |
| `catalog/ui/game/language-support*.ts(x)` | 語言支援三態（純函式＋元件） |
| `catalog/ui/page-nav.tsx` | 分頁唯一元件 |
| `catalog/ui/external-url.ts` | 外部連結 http(s) 白名單唯一實作 |
| `catalog/domain/utc-date.ts` | UTC 今天唯一實作 |
| `repository/release-aggregate.ts` `periodEndSql` | 期間結束日 SQL 唯一實作 |
| `repository/timeline.ts` `TIMELINE_MAX_SCAN_WINDOWS`／`TIMELINE_MAX_WINDOW_DAYS` | 稀疏條件掃描上限 |
| `packages/api-contract/src/filter-canonical.ts` `filterRedirectSearch` | 308 判斷（逐一解碼比較，唯一實作） |
| `apps/web/e2e/{a11y-3b,behavior-3b}.spec.ts` | 3b e2e |

## 地雷（新增）
- 網址正規化比較一律用「解碼後的 (名稱, 值) 序列」；不要再寫逐字比較（撇號、`!*()`、`%2C` 都會無限 308）。
- e2e 稀疏測試 fixture 距離 1444 天，依賴掃描上限 1190 天；改常數要同步改 fixture。
- Next 啟動仍會改寫 `apps/web/tsconfig.json`／`next-env.d.ts`（`NEXT_DIST_DIR`），commit 前檢查。

## 下一步
1. 使用者決定合併方式 → 開 PR（3a 先、3b 後，或 3b 直接含 3a）。
2. Phase 3.5（spec 15）→ 4 → 5 → 9（Slice 0）。
