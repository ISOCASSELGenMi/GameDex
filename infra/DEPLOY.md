# 部署手冊（Oracle VM＋Docker Compose＋Cloudflare）

依 `docs/spec/16-部署維運.md`。這份是操作步驟；網域、帳號、金鑰一律由你填，repo 內不放任何真實值。

架構：Cloudflare（代理）→ VM 上的 `caddy`（80／443，Origin CA）→ `web:3000` ＋ `postgres`（都不對外）。
Discord Bot（Phase 8）與既有 TTS Bot 不在這份 compose：Bot 之後用註解保留的 service 加入；TTS Bot 獨立部署，不要動。

## A. 事前準備（只做一次）

1. **VM**：Oracle Always Free Ampere A1（ARM64）。建議 2 OCPU／12 GB 以上起步（規格尚未定案，請依實測調整）。安裝 Docker Engine 與 compose plugin、`git`、`age`、`rclone`、`openssl`。
   VM 時區建議設 UTC（`timedatectl set-timezone UTC`），備份排程與日期判斷都以 UTC 為準。
2. **兩層防火牆都要開 80／443**（只開一層仍連不通）：
   - 雲端：VCN 的 Security List 或 NSG，入站 TCP 80、443（來源 0.0.0.0/0；想更嚴可只放 Cloudflare 的 IP 範圍，見下方「來源 IP」）。
   - VM 內：`iptables`／`firewalld`（Oracle 的 Ubuntu 映像預設有 iptables 規則，需在 `REJECT` 之前插入 ACCEPT 並持久化）。SSH（22）另外限制來源。
3. **Cloudflare**
   - DNS：`<網域>` 與 `www` 指到 VM 公網 IP，**代理模式（橘色雲朵）必須開啟**。
   - SSL/TLS：模式選 **Full (Strict)**。
   - 建 **Origin CA 憑證**（SSL/TLS → Origin Server）：主機名稱含 `<網域>` 與 `*.<網域>`（或明列 www）；產生後把憑證存成 `infra/caddy/certs/origin.pem`、私鑰存成 `infra/caddy/certs/origin.key`（私鑰只顯示一次；`chmod 600`；這個目錄已被 gitignore）。
   - Cache Rules、Rate Limiting、驗收清單：照 `infra/cloudflare/cache-rules.md`（含 `/ical/{locale}/*` 邊緣快取 5 分鐘、`/ical/u/*` 不快取）。
   - Turnstile：建立 widget，取得 `TURNSTILE_SITE_KEY`／`TURNSTILE_SECRET_KEY`（回報表單用）。
4. **備份目的地與金鑰**：照 `infra/backup/README.md` 建 bucket、rclone remote、age 金鑰（私鑰離線保管）。**全量回填前必須先完成一次備份並確認可還原。**

## B. 初次部署

```bash
sudo mkdir -p /opt/sok && sudo chown "$USER" /opt/sok
git clone <repo 位址> /opt/sok && cd /opt/sok/infra
cp .env.example .env && chmod 600 .env
```

填 `infra/.env`（逐一對照 `.env.example` 的註解；以下是重點）：

| 變數 | 重點 |
| --- | --- |
| `POSTGRES_PASSWORD` | 必填，URL 安全字元：`openssl rand -hex 24`。換密碼不會改既有資料庫的密碼（只在第一次建立資料目錄時生效） |
| `SITE_DOMAIN` | 例 `example.com`，不含 `https://` |
| `NEXT_PUBLIC_SITE_URL` | 完整網址，例 `https://example.com`。**一旦有 iCal 訂閱者就不能再改**（iCal UID 用這個網域；改了訂閱者會看到重複事件）。它會在 build 時帶入 image，所以改值要重新 build |
| `IGDB_CLIENT_ID`／`IGDB_CLIENT_SECRET` | Twitch Developer Console |
| `ADMIN_BASIC_AUTH_USER`／`ADMIN_BASIC_AUTH_PASS` | 未設則 `/internal/*` 一律 404；密碼 ≥ 16 字元 |
| `TURNSTILE_*`、`REPORT_IP_HASH_SECRET`（≥ 16 字元） | 缺任何一個，回報端點回 503 |
| `ALERT_WEBHOOK_URL` | 告警通道（備份失敗、心跳告警都用） |
| `MODULES` | 留白＝預設；目前只有 catalog＋admin 有程式 |
| `BACKUP_*` | 見 `infra/backup/README.md` |

```bash
# 啟動（第一次會 build image，ARM64 約數分鐘到十幾分鐘）
docker compose up -d --build
docker compose ps                      # 全部 running／healthy；web 要等 start-period（約 40 秒）

# migration 與 seed（容器內；工作目錄已是 apps/web）
docker compose exec web npm run db:migrate
docker compose exec web npm run db:seed
```

> 與 spec 15／16 寫的 `docker compose exec web npx drizzle-kit migrate` 的差異：image 內用專案既有的 `scripts/migrate.ts`（drizzle-orm 的 migrator，與 drizzle-kit 寫同一張 `__drizzle_migrations` 表，效果等價）。`drizzle-kit` 也還在 image 裡，想用原指令也可以。

### 部署檢查清單（spec 16）

1. `dig <網域>` 回 Cloudflare 的 IP；兩層防火牆 80／443 都開（外部 `curl -I https://<網域>/healthz` 回 200）。
2. `.env` 逐項填齊。
3. `docker compose ps` 全部 running；migration 與 seed 已執行。
4. `docker compose logs web | head -50`：「已啟用模組清單」符合預期，沒有 `requiredEnv` 缺漏。
5. 手動觸發一次 IGDB 同步（`docker compose exec web npm run job -- <任務名>`，任務名見 `catalog/module.ts` 的 `jobs`），資料庫出現真實資料。
6. 網站正常；`/ical/zh-Hant/releases.ics` 可被日曆訂閱；訂閱頁 `/zh-Hant/subscribe` 正常。
7. （Phase 8 之後）Bot 在線、`/upcoming` 有回應。
8. 既有 TTS Bot 正常。
9. `/healthz`、`/readyz` 正常；uptime 監測（含一個經過 Cloudflare 的公開頁）與告警通道通過測試；備份 cron 已安裝並通過「故意失敗」測試；最近還原演練日期與 RTO 已記錄。

### 來源 IP 與 Caddy

- 回報功能的 IP 雜湊與限流取自 `CF-Connecting-IP`（`catalog/api/reports.ts`）。`Caddyfile` 只信任 Cloudflare 的來源位址宣告真實 IP；其餘來源（直連源站 IP 的人）帶的 `CF-Connecting-IP`／`X-Forwarded-For` 都會被 Caddy 覆寫成 TCP 對端位址，所以外部偽造不了。
- Caddyfile 內的 Cloudflare IP 範圍是寫死的清單，Cloudflare 偶爾會更新，**每季對照一次** https://www.cloudflare.com/ips/ 。
- 若 Docker 對 IPv6 做了 NAT，Caddy 看到的對端位址可能是 docker 閘道而不是 Cloudflare，造成真實 IP 被當成閘道位址。部署後用 `curl` 打回報端點／看 Caddy access log 的 `client_ip` 確認（log 為 JSON，在 `docker compose logs caddy`）。
- 想再縮小攻擊面：OCI 的 Security List 把 443 的來源限制成 Cloudflare IP 範圍，或啟用 Cloudflare Authenticated Origin Pulls。
- `/api/v1/discord-*` 在 Caddy 回 404；Bot 將來直連 `web:3000`。`/ical/u/*`（私人訂閱網址）不寫 access log。

## C. 更新部署（手動觸發；第一版不做 push 即部署）

```bash
cd /opt/sok && git pull
cd infra
./backup/backup.sh                            # 有 schema 變更時先備份一次
docker compose up -d --build                   # 只重建有變動的 image；web 重啟會有數十秒空窗
docker compose exec web npm run db:migrate    # 沒有新 migration 時是 no-op
docker compose ps && curl -fsS https://<網域>/readyz
```

注意：
- migration 沒有 down。破壞性變更（刪欄位）要分兩次部署（先讓程式不用，再刪）。
- 頁面是 ISR＋Cloudflare 快取：部署後舊頁面最多再存活 s-maxage 的時間；需要立即更新就在 Cloudflare 清除快取（Purge Everything 會讓源站瞬間承受全部流量，優先用單一 URL／前綴）。
- 更新 `NEXT_PUBLIC_SITE_URL` 或 `MODULES` 以外的 `.env` 值，`docker compose up -d` 就會套用；這兩個還要 `--build`。

## D. 回滾

1. 程式回滾（沒有破壞性 migration）：
   ```bash
   cd /opt/sok && git log --oneline -5            # 找上一個好的 commit
   git checkout <commit>                           # 或 git revert 後 pull
   cd infra && docker compose up -d --build
   ```
   這會留下一個分離的 HEAD；確認穩定後回到分支並正式 revert。
2. 連同資料庫回滾（migration 已套用且有問題）：用 `infra/backup/restore.sh` 還原部署前那份備份。先還原到新名稱（`--target sok_studio_rollback`）驗證，確認後停 web、`ALTER DATABASE … RENAME` 對調名稱，再起 web。會失去備份之後的資料，先評估。
3. 緊急止血：Cloudflare 開「Under Attack」或針對路徑加 WAF 規則；`docker compose stop web` 讓 Cloudflare 顯示 5xx 頁面（已快取的頁面仍會繼續提供）。

## E. 日常

- 日誌：`docker compose logs -f web`（json-file，單檔 10 MB × 5 份輪替）。
- 磁碟：`docker system df`；定期 `docker image prune -f`。磁碟 ≥ 85% 應告警（外部監測設定）。
- 資料庫連線（除錯用）：`docker compose exec postgres psql -U sok sok_studio`。**生產資料庫不要手動改資料**；要改走管理介面或寫 migration。
- 每季：還原演練、對照 Cloudflare IP 範圍、檢查依賴更新。

## F. 本機驗證 image（有 Docker 時）

```bash
docker build -f apps/web/Dockerfile -t sok-web .          # 在 repo 根目錄
cd infra && cp .env.example .env   # 至少填 POSTGRES_PASSWORD、SITE_DOMAIN、IGDB_*
docker compose up -d postgres web                          # 不起 caddy 也能驗證（web 沒有發布埠，用 docker compose exec web node -e … 或暫時加 ports）
```

CI 的 `docker` job 會做同樣的 build＋migration＋seed＋smoke（見 `.github/workflows/ci.yml`）。
