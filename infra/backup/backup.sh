#!/usr/bin/env bash
# 每日備份（16 §備份）：pg_dump -Fc → age 公鑰加密 → rclone 上傳到 VM 之外 → 保留 7 天＋4 週＋6 個月。
# 由系統 cron 執行（見 crontab.example），獨立於應用程式排程。失敗時打 ALERT_WEBHOOK_URL。
#
# 設定（行程環境變數，或寫在 infra/.env）：
#   BACKUP_AGE_RECIPIENT   age 公鑰（age1...）。私鑰不放在 VM 上。
#   BACKUP_RCLONE_REMOTE   rclone 目標，例如 oci:sok-backups/prod（remote 名稱:bucket/前綴）
#   BACKUP_KEEP_DAILY_DAYS=8、BACKUP_KEEP_WEEKLY_DAYS=29、BACKUP_KEEP_MONTHLY_DAYS=190（多留一天避免邊界，見 README）
#   BACKUP_PING_URL        選填：成功後 GET 這個網址（healthchecks.io 之類的 dead man's switch，cron 本身壞掉時才有人發現）
#   ALERT_WEBHOOK_URL      失敗告警
set -Eeuo pipefail

# shellcheck source=common.sh
# shellcheck source-path=SCRIPTDIR
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

RECIPIENT="$(get_cfg BACKUP_AGE_RECIPIENT)"
REMOTE="$(get_cfg BACKUP_RCLONE_REMOTE)"
KEEP_DAILY="$(get_cfg BACKUP_KEEP_DAILY_DAYS 8)"
KEEP_WEEKLY="$(get_cfg BACKUP_KEEP_WEEKLY_DAYS 29)"
KEEP_MONTHLY="$(get_cfg BACKUP_KEEP_MONTHLY_DAYS 190)"
PING_URL="$(get_cfg BACKUP_PING_URL)"

STAGE="初始化"
TMP=""
on_error() { alert "SoK 備份失敗（步驟：$STAGE，主機：$(hostname)，時間：$(date -u +%FT%TZ)）"; }
cleanup() { [ -z "$TMP" ] || rm -rf "$TMP"; }
trap on_error ERR
trap cleanup EXIT

# 避免兩次備份重疊（上一次還沒跑完）
exec 9>"${TMPDIR:-/tmp}/sok-backup.lock"
flock -n 9 || { echo "上一次備份仍在執行，略過" >&2; exit 0; }

STAGE="檢查設定"
[ -n "$RECIPIENT" ] || { echo "BACKUP_AGE_RECIPIENT 未設定" >&2; false; }
[ -n "$REMOTE" ] || { echo "BACKUP_RCLONE_REMOTE 未設定" >&2; false; }
command -v age >/dev/null || { echo "找不到 age" >&2; false; }
command -v rclone >/dev/null || { echo "找不到 rclone" >&2; false; }

TMP="$(mktemp -d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="${DB_NAME}-${STAMP}.dump.age"

STAGE="pg_dump＋加密"
# 明文只存在於管線中，不落地；任一端失敗 pipefail 都會讓整段失敗
compose exec -T postgres pg_dump -U "$DB_USER" -Fc "$DB_NAME" | age -r "$RECIPIENT" -o "$TMP/$NAME"
[ "$(stat -c %s "$TMP/$NAME")" -gt 1024 ] || { echo "備份檔異常地小" >&2; false; }

STAGE="各表筆數"
table_counts "$DB_NAME" > "$TMP/$NAME.counts.txt"
[ -s "$TMP/$NAME.counts.txt" ] || { echo "筆數清單是空的" >&2; false; }

STAGE="上傳"
rclone copyto "$TMP/$NAME" "$REMOTE/daily/$NAME"
rclone copyto "$TMP/$NAME.counts.txt" "$REMOTE/daily/$NAME.counts.txt"
# 上傳後確認遠端大小一致
LOCAL_SIZE="$(stat -c %s "$TMP/$NAME")"
REMOTE_SIZE="$(rclone size --json "$REMOTE/daily/$NAME" | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
[ "$LOCAL_SIZE" = "$REMOTE_SIZE" ] || { echo "遠端大小 $REMOTE_SIZE 與本機 $LOCAL_SIZE 不符" >&2; false; }

STAGE="週／月保留"
# 週日（UTC）的那份多存一份到 weekly/，每月 1 日的那份多存到 monthly/（遠端複製，不再上傳）
if [ "$(date -u +%u)" = "7" ]; then
  rclone copyto "$REMOTE/daily/$NAME" "$REMOTE/weekly/$NAME"
  rclone copyto "$REMOTE/daily/$NAME.counts.txt" "$REMOTE/weekly/$NAME.counts.txt"
fi
if [ "$(date -u +%d)" = "01" ]; then
  rclone copyto "$REMOTE/daily/$NAME" "$REMOTE/monthly/$NAME"
  rclone copyto "$REMOTE/daily/$NAME.counts.txt" "$REMOTE/monthly/$NAME.counts.txt"
fi

STAGE="清除過期備份"
# 只刪各自資料夾內超過保留天數的檔案；資料夾還不存在時 rclone 會回錯誤，視為無事
for pair in "daily:$KEEP_DAILY" "weekly:$KEEP_WEEKLY" "monthly:$KEEP_MONTHLY"; do
  rclone delete "$REMOTE/${pair%%:*}" --min-age "${pair##*:}d" 2>/dev/null || true
done

STAGE="完成回報"
echo "備份完成：$REMOTE/daily/$NAME（$LOCAL_SIZE bytes）"
if [ -n "$PING_URL" ]; then
  curl -fsS --max-time 15 "$PING_URL" >/dev/null || echo "（ping 失敗，不影響備份）" >&2
fi
