# 交接：Phase 7 帳號（第 1、3、5、6、7 波＋D83 完成；第 2、4 波與 7.5 未做）（2026-10-17）

接手先讀這份，再讀 `docs/checklist.md` 的 Phase 7 區塊、spec `09`（帳號）、`07`（§帳號 API）、`90` 的 D76～D83。

## 狀態

- main 在 `673da95`，**沒有開著的 PR**。PR #6～#13 都已合併。
- 開發 DB（`sok_studio`，埠 54329）已套到 **migration 0011**（共 12 筆）；`games` 316,955 筆。
- 子代理任務書與報告在 `.local/agents/7/`（git 忽略）：K（Better Auth 原型與分波建議）、L／M（第 1 波）、N（第 3 波 Steam）、O（找不到重比）、P／Q（第 5 波後端／畫面）、R／S（第 6 波後端／畫面）、T（第 7 波）、U（D83）。每份報告有對外介面、判斷與理由、檢查數字。
- worktree `.local/wt/phase7` 目前停在 `docs/spec-phase7-w5-7`（已合併），下一波從 main 開新分支即可。`.local/wt/phase9`（`feat/phase9-prep`）也已合併，可清掉。

| 波次 | 內容 | PR | migration |
| --- | --- | --- | --- |
| 1 | accounts 骨架、Better Auth、Email＋密碼、帳號頁、header slot | #6 | 0007 |
| 3 | Steam OpenID plugin、`owned_games`、GetOwnedGames 匯入與比對 | #7、#8（找不到重比、D82） | 0008 |
| 5 | 清單、遊玩紀錄、玩家平均、Steam 手動指定比對 | #9→#10 | 0009 |
| 6 | 追蹤、`mine`（`/account/games`）、熱度訊號、私人 iCal | #10 | 0010 |
| 7 | 匯出、刪除帳號、停權、偏好設定 | #11 | — |
| D83 | 第 5～7 波 14 項細則 | #12 | 0011 |
| spec | 02／06／07 寫回、CLAUDE.md 測試用 chromium | #13 | — |

## 程式地圖（`apps/web/src/modules/accounts/`）

- `providers/auth/`：Better Auth 設定（`options.ts`、lazy 單例在 `use-cases/auth-instance.ts`）、`env.ts`（`parseAccountsEnv`，trustedOrigins 唯一來源）、argon2id、`token-cipher.ts`（AES-GCM，OAuth token 與 feed token 共用）、`steam/`（OpenID plugin）。
- `providers/steam/client.ts`：GetOwnedGames／GetPlayerSummaries（可注入 fetch）。
- `repository/`：唯一碰 drizzle 的地方；對 catalog 表（games、platforms）的 FK 在 migration 手寫，schema 不 import catalog。
- `use-cases/`：`import-request.ts` 的 `isTrustedRequestOrigin`（非 BA 寫入端點共用的 Origin 檢查）、停權守門（寫入一律 403 `account_suspended`）、`owned-games`、`lists`、`play-records`、`calendar-feeds`、`account-self`（匯出、刪除、偏好）。
- `ui/`：全部是 client component；共用 `api-call.ts`、`modal.tsx`、`confirm-button.tsx`、`require-user.tsx`、`follow-button.tsx`、`play-record-form.tsx`、`play-format.ts`。
- slot：`header.right`、`game.actions`、`game.sections`、`entity.actions`、`subscribe.private`（`kernel/modules/types.ts` 的 `UiSlotName`）。
- 排程：`cleanup_auth_rows`、`match_owned_games`（每 15 分）、`refresh_player_ratings`（每小時 17 分）、`cleanup_orphan_follows`（每晚；大量缺失時不刪並告警）。熱度訊號 `site_follows`／`site_follows_7d` 隨 catalog 的 `refresh_popularity` 每小時寫入。
- catalog 擴充點已接好：`PopularitySignal`、`GameFilterProvider`（registry 注入）。

## 已定案（D76～D83，細節見 spec 90）

- Better Auth、placeholder 信箱、provider varchar、密碼併入 connected_accounts、basePath `/api/v1/auth`、`ACCOUNTS_SIGNUP_ENABLED` 預設 false。
- 可快取頁面 HTML 不含使用者資訊、不送 Set-Cookie；登入狀態與個人資料一律 client 端取。`mine` 只在 `/account/games`。
- 玩家平均一人一票取建立時間最新一筆；平均分數與平均耗時都套 `PLAYER_RATING_MIN_COUNT`。
- 停權者可登入但只能看說明、匯出、刪除帳號。
- 「上升中」需 7 天 ≥ 10 新追蹤且群內前 5%。私人 iCal 關閉活動即完全不含活動。
- Steam：找不到的列每次匯入重比、消失的遊戲保留、手動指定列（`match_method='manual'`）不被覆寫。

## 待使用者

- **提供**：`STEAM_WEB_API_KEY`（Steam 真實連線未測）；Discord／Google／Twitch／Microsoft OAuth app（第 2 波；redirect URI `{站}/api/v1/auth/callback/{provider}`，建議正式網域定了再申請）。
- **決定**：Phase 7.5 寄信服務（正式開放註冊前必須完成；目前重設密碼連結只寫進 log）；Phase 9 部署（VM、網域、備份私鑰、Sentry／GlitchTip、Caddy 是否進 compose、錯誤頁快取）。
- **處理**：隱私權政策帳號段落請律師審閱；把 `docs/spec/` 匯入 claude.ai Project 正本（v2.1，含 D82、D83）。

## 下一步（不需使用者的）

- 沒有。第 2 波、第 4 波（Xbox，依賴第 2 波）、7.5、Phase 9 都等上面的提供或決定。可先做的小事：清掉已合併分支的 worktree（`.local/wt/phase9`）。

## 地雷

- **本機 e2e 一律 `PW_CHANNEL=chromium`**（Playwright 自帶無頭 chromium，已安裝）。msedge 會在使用者 Alt+Tab 留空白視窗。
- 疊起來的 PR：base 不是 main 的 PR 合併後**不會**進 main（#9 就這樣進了 `feat/phase7-w3b`）；合併前先把 base 改成 main，或依序合併並逐一改 base。
- 樂觀更新的按鈕（追蹤、加入清單）：e2e 驗 API 狀態要用 `expect.poll`，不能點完立刻查。
- `next start` 是 production 模式，Better Auth 限流會啟用；e2e 必須 `AUTH_RATE_LIMIT_ENABLED=false`。
- Better Auth 文件與實作不符：plugin rateLimit 欄位叫 `max`；drizzle adapter 的 schema key 用 drizzle 匯出名；`unlinkAccount` 參數用本地 account id。BA 在 `NODE_ENV=test` 預設略過 origin 檢查。
- 主目錄合併有新依賴的 PR 後要先 `npm install`，否則開發伺服器起不來。
- 這套 embedded-postgres 沒附 `psql`；查 DB 用 `pg` 寫小腳本（`npx tsx --import ./scripts/load-env.ts …`）。
- e2e 跑完會改 `apps/web/tsconfig.json`，要 `git checkout` 還原；`npm test` 與 `test:a11y` 共用測試 DB，不可同時跑。
