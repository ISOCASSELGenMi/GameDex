# 10 Discord（`discord` 模組＋Bot）

## 架構

- **Bot 是獨立 process**（D15）：網站是請求-回應，Bot 是常駐 WebSocket，合併會互相拖累。用**新申請**的 Discord Application，不與既有 TTS Bot 共用。
- **Bot 不直接連資料庫**，只呼叫網站 `/api/v1/*`（公開端點＋內部端點）。PostgreSQL 是唯一真相來源；Discord 是「通知＋使用者選擇建立活動」的介面，不是第二套行事曆。
- 網站端（`modules/discord/`）：內部端點、Discord 相關表、網站上的「建立 Discord 活動」按鈕、清理任務。
- **語言以伺服器為單位**：公開訊息整個伺服器共看，一則只能一種語言。`discord_guild_settings.locale` 初始值取 `guild.preferredLocale`（欄位名以 discord.js 版本為準 ❓）對照支援清單，對不到用 `DEFAULT_LOCALE`；`/language` 切換。ephemeral 回覆也用伺服器語言。所有文字來自 `discord.*` 字典，遊戲名與日期用 06 的共用函式。

## 指令

| 指令 | 權限 | 內容 |
| --- | --- | --- |
| `/upcoming [platform] [days]` | 所有人 | 近期上市（套聚合規則、預設可見類型與階段）；有確切日期的附「建立活動」按鈕 |
| `/game <名稱>` | 所有人 | 遊戲卡：封面、平台、上市日、分數、網站連結；按鈕：建立活動、伺服器追蹤、建立身分組 |
| `/event [kind]` | 所有人 | 近期活動與頒獎典禮；附「建立活動」按鈕 |
| `/calendar [month]` | 所有人 | 該月上市清單＋網站月曆連結 |
| `/follow add|remove|list <遊戲>` | 管理伺服器 | 伺服器共同追蹤 |
| `/setup` | 管理伺服器 | 公告頻道、公告排程、公告篩選、時區 |
| `/language` | 管理伺服器 | 伺服器語系 |
| `/role <遊戲>` | 管理身分組 | 發一則反應身分組訊息 |

**互動硬限制** ✅：3 秒內必須回應，所有指令與按鈕先 `deferReply()`；每則訊息最多 5 列 × 5 按鈕、10 個 embed，清單要分頁或改下拉選單。按鈕可能很久之後才被按，處理時重新驗證目標仍存在且日期仍精確。

## 建立 Discord 活動

**同一伺服器＋同一上市事件（或活動）最多一個 Scheduled Event**；一律由人觸發（D14），不自動大量建立。兩個入口共用同一流程（P33）：

- **Discord 內**：按鈕 `customId` 編碼目標（`create:release:{id}`、`create:event:{id}`）；上市事件取聚合後的代表 `release_events.id`。
- **網站**：遊戲頁與活動頁的按鈕（slot）→ 選伺服器（列出使用者以 Discord 登入後，`guilds` scope 回報**具管理活動權限**且 Bot 已加入的伺服器）→ 網站後端用 Bot token 呼叫 Discord REST API 建立。未以 Discord 登入時提示先綁定。

**流程：預留 → 建立 → 確認**（D31；「先查再建」不是原子操作，併發會重複，D-Bug1、D-Bug12）

```
1. deferReply()（網站則直接處理）
2. 檢查權限：使用者需有管理活動權限；Bot 需有建立／管理活動權限（權限名稱 ❓）
3. 取目標資料；上市事件 precision != 'day' → 回覆「還沒有確切日期，可以先追蹤」（P39），結束
4. 開始時間須在未來至少 5 分鐘，否則回覆已上市／即將開始
5. 【預留】POST /discord-links { target, guildId, status: 'pending' }
   撞 unique → 回覆「已存在或處理中」＋既有連結，結束（不呼叫 Discord）
6. 呼叫 Discord 建立；失敗 → DELETE 預留，回覆錯誤
7. 【確認】PATCH /discord-links/{id} { discordEventId, status: 'active', lastSynced* }
   失敗 → 保留 pending（它本身就擋住重複），由 reconcile 補寫；過期 pending 定期清理
8. 回覆成功＋活動連結
```

**時間**

- **上市事件**（P8、D58）：`scheduledStartTime` = 上市日 12:00 UTC，`scheduledEndTime` = 開始 + 1 小時。Discord 以時間戳儲存、各客戶端依使用者時區顯示 🔶。12:00 UTC 讓 UTC-12 到 UTC+11 都看到同一天；UTC+12 以東（如紐西蘭）會看到隔天凌晨，是已知限制。描述必寫「上市日 YYYY-MM-DD；實際解鎖時間依平台與地區而異」。
- **活動**：用活動的實際 `startTime`／`endTime`（無結束時間 = 開始 + 1 小時）。
- 訊息中的上市日一律用日期文字，**不用 `<t:…>` 時間戳語法**（避免 UTC+12 以東看到隔天）。

**欄位**：EXTERNAL 類型必填 `scheduledEndTime` 與 `entityMetadata.location`（放網站連結）。名稱 1~100、描述 1~1000、地點 1~100 字元 ✅，超過要截斷。每伺服器最多 100 個活動 ✅（計入哪些狀態 ❓），額滿時回覆說明。

## Reconcile（`reconcile-events`，Bot process，每小時）

從 `GET /discord-links/stale` 取有差異的 link（伺服器端篩選，Bot 不拉全部自己比）：

| 情況 | 處理 |
| --- | --- |
| 日期變了，精度仍是 day | PATCH 活動時間 |
| 精度變成 month／quarter／year／tbd | PATCH 標題加 `[延期・日期未定]`、保留原時間；有新的確切日期再改時間並移除標記。**不取消**（取消不可逆） |
| `status = 'cancelled'` | 取消 Discord 活動，link 標 `cancelled` |
| `sourceStatus = 'removed'` | **不動作**，最多在描述加註「資料來源待確認」（D32：removed 可能只是來源暫時缺漏） |
| PATCH 回 404（有人手動刪了活動） | 刪除 link，停止重試 |
| 日期已過 | 停止 reconcile 該 link |
| 伺服器改了語系 | 下次更新標題與描述 |

成功後更新 `lastSynced*`。

## 定時公告

- `/setup` 設定公告頻道、排程（每日／每週＋時間，依伺服器時區）、篩選（06 FilterSpec，例如只看 PS5＋Switch）。
- Bot 依排程呼叫 `/discord-guilds/{id}/announcements/next` 取內容：未來 N 天（每日 1 天、每週 7 天）的上市與活動，套聚合規則；附「建立活動」按鈕。
- 沒有項目時不發文。頻道被刪或 Bot 無發言權限 → 停用公告並在下次有人用指令時提示管理員。

## 伺服器共同追蹤

- `/follow` 或遊戲卡按鈕把遊戲加入 `discord_guild_follows`（每伺服器上限 ❓，建議 200）。
- 網站端 `discord` 模組讀 `change_feed`（consumer `discord-guild`），對被追蹤遊戲的「日期確定、改期、上市、取消」在公告頻道通知；沒設公告頻道就不發。同一變動同一伺服器只發一次（以 change id 去重）。

## 反應身分組

1. `/role <遊戲>`（或遊戲卡按鈕）：Bot 建立身分組「🎮 遊戲名」（可提及），在指定頻道發訊息並加上反應表情，寫入 `discord_game_roles`（`expiresAt` = 上市日 + 30 天，P40；未精確日期先空著）。
2. 成員按表情 → 給身分組；取消反應 → 移除。
3. 該遊戲改期、上市、取消時（讀 `change_feed`），在該頻道 tag 身分組。
4. 每日清理：`expiresAt` 到期 → 刪身分組、刪紀錄、編輯原訊息註明已結束。

**限制**

- 每伺服器身分組上限 250 🔶；Bot 建立的遊戲身分組另設上限（建議 50），額滿時拒絕並提示。
- Bot 需「管理身分組」權限，且 Bot 的身分組位階要高於遊戲身分組。
- 需要訊息反應的 gateway intent；Bot 重啟後要能處理舊訊息的反應（discord.js 的 partials）。

## Discord 私訊

由 `notifications` 模組發送（11）：用戶以 Discord 登入或綁定後才可開啟；用 Bot token 經 REST 建立 DM 頻道並發送。用戶需與 Bot 至少同在一個伺服器且未關閉私訊，否則失敗——失敗時改寄 Email（若已開啟）並在設定頁提示。

## Bot ↔ 網站認證

`/api/v1/discord-*` 是**只給自己 Bot 的內部端點**，用共用密鑰 `INTERNAL_API_SECRET`（不是使用者 session）：

```typescript
import { timingSafeEqual } from "node:crypto";

const SECRET = process.env.INTERNAL_API_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error("INTERNAL_API_SECRET missing or too short"); // fail closed

function requireInternalAuth(req: NextRequest) {
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${SECRET}`);
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  return ok ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

- 不可寫成 `auth !== \`Bearer ${process.env.INTERNAL_API_SECRET}\``：環境變數沒設時期望值變成 `Bearer undefined`，送這個 header 就通過（D-Bug11）。
- **縱深防禦**：Bot 走 docker 內網 `http://web:3000`，Caddy 對公網直接擋 `/api/v1/discord-*`（16）。
- 模組啟用時 `requiredEnv` 含 `INTERNAL_API_SECRET`、`DISCORD_BOT_TOKEN`；停用時不需要。
