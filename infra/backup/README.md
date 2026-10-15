# 備份與還原

規格：`docs/spec/16-部署維運.md` §備份。Oracle Always Free 有無預警調整資源或停用實例的紀錄，所以備份**一定存在 VM 之外並加密**。
起始目標：RPO 24 小時、RTO 4 小時（規格標 ❓，演練後修正）。

## 做法

| 步驟 | 工具 | 說明 |
| --- | --- | --- |
| 匯出 | `docker compose exec -T postgres pg_dump -Fc` | custom 格式，可選擇性還原；明文只在管線中，不落地 |
| 加密 | `age -r <公鑰>` | 只用公鑰加密；**私鑰不放 VM**，VM 被入侵也解不開歷史備份 |
| 上傳 | `rclone copyto` | rclone remote 當抽象層，換儲存服務只改設定。上傳後比對遠端大小 |
| 保留 | 資料夾 `daily/`、`weekly/`、`monthly/` | 每日一份；週日（UTC）多存一份到 weekly；每月 1 日多存一份到 monthly（遠端複製）。依檔案年齡刪除：daily 8 天、weekly 29 天、monthly 190 天（比 7 天／4 週／6 個月各多一天，避免邊界誤刪） |
| 筆數清單 | `<備份檔>.counts.txt`（不加密） | 備份當下各表筆數，還原演練時對照；只含表名與數字 |
| 告警 | `ALERT_WEBHOOK_URL` | 任何一步失敗都送出（含失敗步驟名稱） |
| 排程 | 系統 cron | 獨立於應用程式內建排程；見 `crontab.example` |

備份含個資（之後有帳號時）：刪除帳號後，舊備份在保留期（最長約 6 個月）後自然過期，隱私權政策要如實說明。

## 安裝（VM 上，一次）

```bash
# age 與 rclone（Ubuntu／Debian 範例；Oracle Linux 用 dnf，或到各專案 release 頁下載 arm64 binary）
sudo apt-get install -y age rclone
```

1. **產生金鑰（不要在 VM 上）**：在你自己的電腦 `age-keygen -o sok-backup-key.txt`。畫面印出的 `age1…` 是公鑰，填進 `infra/.env` 的 `BACKUP_AGE_RECIPIENT`。
   `sok-backup-key.txt` 是私鑰：存到密碼管理員的附件**以及**另一個離線位置（例如加密隨身碟），兩處都要有。**私鑰遺失＝所有備份作廢。**
2. **rclone remote**（OCI Object Storage 的 S3 相容 API；先在 OCI 主控台建一個 bucket 與一組 Customer Secret Key）：

   ```ini
   # ~/.config/rclone/rclone.conf（chmod 600）
   [oci]
   type = s3
   provider = Other
   env_auth = false
   access_key_id = <Customer Secret Key 的 Access Key>
   secret_access_key = <Customer Secret Key 的 Secret>
   region = <例如 ap-tokyo-1>
   endpoint = https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
   no_check_bucket = true
   ```

   `infra/.env`：`BACKUP_RCLONE_REMOTE=oci:<bucket 名稱>/prod`。測試：`rclone lsd oci:`。
   建議此組金鑰只授權該 bucket 的讀寫；bucket 開啟 versioning／retention 可再防誤刪（自行評估費用）。
3. **手動跑一次**：`/opt/sok/infra/backup/backup.sh`，確認遠端 `daily/` 出現 `.dump.age` 與 `.counts.txt`。
4. **故意製造失敗確認告警**：暫時把 `BACKUP_RCLONE_REMOTE` 改成不存在的 remote 再跑一次，確認 `ALERT_WEBHOOK_URL` 收到訊息，然後改回。
5. 裝 cron：見 `crontab.example`。建議再設 `BACKUP_PING_URL`（healthchecks.io 之類的 dead man's switch）——cron 或整台 VM 掛了時，不會有「備份失敗」訊息，只有「沒收到 ping」才會告警。

## 還原演練（每季一次；災難復原用同一支腳本）

演練用**另一個資料庫名稱**，不碰正式資料庫。建議在乾淨環境（新的 VM 或本機 docker）做，才算驗證「從零還原」。

```bash
# 1. 乾淨環境：clone repo、cp infra/.env.example infra/.env 填 POSTGRES_PASSWORD、BACKUP_RCLONE_REMOTE、rclone.conf
cd infra && docker compose up -d postgres
# 2. 臨時放上私鑰（用完刪除）
./backup/restore.sh --latest --identity ~/sok-backup-key.txt --target sok_restore_check
# 3. 看輸出最後的「筆數對照」：完全一致最好；備份與取數之間的同步寫入造成少量差異屬預期（退出碼 3）
# 4. smoke：起 web 指到還原後的資料庫，檢查 /readyz、當月月曆、/ical/zh-Hant/releases.ics
docker compose run --rm -e DATABASE_URL=postgres://sok:$POSTGRES_PASSWORD@postgres:5432/sok_restore_check web npm run db:migrate   # 應為「無新增」
# 5. 記錄耗時（下表），清理
docker compose exec postgres dropdb -U sok sok_restore_check
shred -u ~/sok-backup-key.txt
```

災難復原（資料庫已毀）：同樣流程但 `--target sok_studio --allow-production`，之後 `docker compose up -d`。

### 演練紀錄

起始目標 RPO 24 小時（每日備份）、RTO 4 小時。RTO 要算到「網站對外恢復」，不只是 pg_restore 的秒數。

| 日期 | 備份檔 | 備份大小 | 下載＋解密＋還原耗時 | 筆數對照 | 建 VM／部署／DNS 耗時 | 總 RTO | 問題與修正 | 執行者 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| （待第一次演練） | | | | | | | | |
